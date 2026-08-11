// ###############################################################################################
// # BINDER BACKUP                                                                               #
// #                                                                                             #
// # The bulk storage side of the `.tin` format: read the whole binder (or one folder subtree)    #
// # into a TinFile manifest, and write a TinFile back in one of two modes. Merge grafts the       #
// # bundle into the current binder non-destructively (folders get fresh ids, documents get fresh  #
// # ids, everything re-homes under a target folder). Replace wipes the binder and restores every  #
// # record verbatim so it matches the exported state byte for byte. The id-remap is factored out  #
// # as a pure, deterministic function (remapTinForMerge) so the graft graph is unit-testable      #
// # without IndexedDB. tinFile.ts owns the format + compression; this owns the store glue.        #
// ###############################################################################################

// -- Lib Imports --
import {
   openDatabase, transactionDone,
   DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE, FOLDERS_STORE, TEMPLATES_STORE, ROOT_FOLDER_ID,
} from './binderDatabase'
import { listDocuments, loadDocument, RECORD_SCHEMA_VERSION, type LoadedDocument } from './binderDocuments'
import { listAllFolders } from './binderFolders'
import { listTemplates, saveTemplate } from './templateStore'
import { captureTemplate, type TemplateChrome } from './documentTemplate'
import { migrateIds, migrateFormatPageBreaks, migrateFormatBands } from './documentMigration'
import { normalizePresentation } from './presentation'
import { normalizeFormat, isDefaultFormat } from './format'
import { buildPreviewSections, extractDocumentText } from './documentPreview'
import { TIN_SCHEMA_VERSION, type TinFile, type TinFolder, type TinDocument, type TinTemplate } from './tinFile'

// -- Type Imports --
import type { BinderDocumentRecord, BinderDocumentContent, BinderFolderRecord } from '../types'

/** How many records of each kind an import wrote, for the caller's confirmation message. */
export interface TinImportSummary {
   templates: number
   folders:   number
   documents: number
}

/** Mints ids for the merge remap. Injected in tests as a sequential counter; defaults to UUIDs. */
export type TinIdFactory = () => string

// ###################
// # RECORD MAPPING  #
// ###################

/** BinderFolderRecord -> TinFolder (identical fields, picked explicitly to drop any stray props). */
function toTinFolder(folder: BinderFolderRecord): TinFolder {
   return {
      id:        folder.id,
      name:      folder.name,
      parentId:  folder.parentId,
      sortOrder: folder.sortOrder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
   }
}

/** Light placement (from the card record) + heavy body (from the loaded document) -> TinDocument.
 *  Drops a default format so a document that never touched Page Setup stays byte-clean. */
function toTinDocument(record: BinderDocumentRecord, loaded: LoadedDocument): TinDocument {
   return {
      id:        record.id,
      meta:      loaded.meta,
      folderId:  record.folderId,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      docTheme:  loaded.docTheme,
      docAccent: loaded.docAccent,
      sections:  loaded.sections,
      ...(loaded.presentation ? { presentation: loaded.presentation } : {}),
      ...(loaded.format && !isDefaultFormat(loaded.format) ? { format: loaded.format } : {}),
   }
}

/** DocumentTemplate chrome + name -> TinTemplate. Built-ins are code, never exported. */
function toTinTemplate(template: { name: string } & TemplateChrome): TinTemplate {
   return {
      name:      template.name,
      meta:      template.meta,
      docTheme:  template.docTheme,
      docAccent: template.docAccent,
      ...(template.presentation ? { presentation: template.presentation } : {}),
      ...(template.format       ? { format: template.format }             : {}),
   }
}

// ###################
// # COLLECT (READ)  #
// ###################

/** Read the ENTIRE binder into a TinFile: every folder, every document body, every user template. */
export async function collectBinderForTin(): Promise<TinFile> {
   const folderRecords   = await listAllFolders()
   const documentRecords = await listDocuments()
   const templates       = await listTemplates()

   const documents: TinDocument[] = []
   for (const record of documentRecords) {
      // touch: false, exporting a document is not opening it.
      const loaded = await loadDocument(record.id, { touch: false })
      if (loaded) documents.push(toTinDocument(record, loaded))
   }

   return {
      documinterTin: true,
      schemaVersion: TIN_SCHEMA_VERSION,
      exportedAt:    new Date().toISOString(),
      templates:     templates.filter(template => !template.builtIn).map(toTinTemplate),
      folders:       folderRecords.map(toTinFolder),
      documents,
   }
}

/**
 * Read one folder and everything under it into a TinFile: the root folder record, every descendant
 * folder (breadth-first down the parentId tree), and every document filed in any of those folders.
 * Carries no templates (a subtree Tin is structure + documents only).
 */
export async function collectFolderSubtreeForTin(rootFolderId: string): Promise<TinFile> {
   const allFolders = await listAllFolders()
   const childrenByParent = new Map<string, BinderFolderRecord[]>()
   for (const folder of allFolders) {
      const siblings = childrenByParent.get(folder.parentId) ?? []
      siblings.push(folder)
      childrenByParent.set(folder.parentId, siblings)
   }

   const subtree:   BinderFolderRecord[] = []
   const folderIds: Set<string>          = new Set()
   const root = allFolders.find(folder => folder.id === rootFolderId)
   if (root) {
      subtree.push(root)
      folderIds.add(root.id)
   }
   // Breadth-first walk of descendants (the deleteFolder collection pattern, over the in-memory map).
   const frontier = [rootFolderId]
   for (let index = 0; index < frontier.length; index++) {
      for (const child of childrenByParent.get(frontier[index]) ?? []) {
         subtree.push(child)
         folderIds.add(child.id)
         frontier.push(child.id)
      }
   }

   const documentRecords = await listDocuments()
   const documents: TinDocument[] = []
   for (const record of documentRecords) {
      if (!folderIds.has(record.folderId)) continue
      const loaded = await loadDocument(record.id, { touch: false })
      if (loaded) documents.push(toTinDocument(record, loaded))
   }

   return {
      documinterTin: true,
      schemaVersion: TIN_SCHEMA_VERSION,
      exportedAt:    new Date().toISOString(),
      templates:     [],
      folders:       subtree.map(toTinFolder),
      documents,
   }
}

// ###################
// # MERGE REMAP     #
// ###################

/**
 * Re-id a Tin for a non-destructive graft under `targetFolderId`. Pure and deterministic given
 * `makeId`, so the graft graph is unit-testable without IndexedDB.
 *
 * Every folder gets a fresh id. An id map carries each old folder id to its new one, plus the root
 * sentinel '0' to `targetFolderId`. Pointers resolve through the map with a fallback to the target:
 * a parentId of '0' becomes the target, a parentId pointing at an imported folder becomes that
 * folder's new id, and a parentId pointing OUTSIDE the bundle (a subtree export's root, whose parent
 * was left behind) also becomes the target, so the subtree re-homes cleanly under it. Document
 * folderId resolves the same way. Any record whose remapped parent is the target is a top-level item
 * of the graft, so its sortOrder is offset by `sortOrderOffset` to land after existing content
 * instead of interleaving. Document ids are NOT touched here; importTin mints them at write time
 * (nothing references a document id, so freshness is a write-layer concern).
 */
export function remapTinForMerge(
   tin: TinFile,
   targetFolderId: string,
   sortOrderOffset: number,
   makeId: TinIdFactory = () => crypto.randomUUID(),
): { folders: TinFolder[]; documents: TinDocument[] } {
   const idMap = new Map<string, string>()
   idMap.set(ROOT_FOLDER_ID, targetFolderId)
   for (const folder of tin.folders) idMap.set(folder.id, makeId())

   const resolveParent = (parentId: string): string => idMap.get(parentId) ?? targetFolderId

   const folders: TinFolder[] = tin.folders.map(folder => {
      const parentId = resolveParent(folder.parentId)
      return {
         ...folder,
         id:        idMap.get(folder.id)!,
         parentId,
         sortOrder: parentId === targetFolderId ? folder.sortOrder + sortOrderOffset : folder.sortOrder,
      }
   })

   const documents: TinDocument[] = tin.documents.map(document => {
      const folderId = resolveParent(document.folderId)
      return {
         ...document,
         folderId,
         sortOrder: folderId === targetFolderId ? document.sortOrder + sortOrderOffset : document.sortOrder,
      }
   })

   return { folders, documents }
}

// ###################
// # IMPORT (WRITE)  #
// ###################

/** Build the light + heavy store records for one imported document under `id`. Runs the same
 *  read-time migrators the JSON backup import runs (id / meta / page-break / band healing), then
 *  regenerates the search + preview fields and stamps the current record schema version. */
function buildDocumentRecords(document: TinDocument, id: string): {
   record: BinderDocumentRecord
   content: BinderDocumentContent
} {
   const migrated     = migrateIds({ meta: document.meta, sections: document.sections })
   const presentation = normalizePresentation(document.presentation)
   const format       = normalizeFormat(migrateFormatBands(migrateFormatPageBreaks(document.format, migrated.sections)))

   const record: BinderDocumentRecord = {
      id,
      meta:            migrated.meta,
      createdAt:       document.createdAt,
      updatedAt:       document.updatedAt,
      lastOpenedAt:    undefined,
      folderId:        document.folderId,
      sortOrder:       document.sortOrder,
      sectionTitles:   migrated.sections.map(section => section.title),
      contentText:     extractDocumentText(migrated.sections),
      previewSections: buildPreviewSections(migrated.sections),
      docTheme:        document.docTheme,
      docAccent:       document.docAccent,
      schemaVersion:   RECORD_SCHEMA_VERSION,
   }
   const content: BinderDocumentContent = {
      id,
      sections: migrated.sections,
      ...(presentation ? { presentation } : {}),
      ...(format && !isDefaultFormat(format) ? { format } : {}),
   }
   return { record, content }
}

/** Write folder records into the folders store in one transaction. Verbatim: the caller supplies
 *  already-remapped (merge) or already-verbatim (replace) records. */
async function writeFolders(folders: TinFolder[]): Promise<void> {
   if (folders.length === 0) return
   const database    = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store       = transaction.objectStore(FOLDERS_STORE)
   for (const folder of folders) store.put(folder)
   await transactionDone(transaction)
}

/** Write documents (light + heavy) in one transaction. `makeDocumentId` picks the target id per
 *  document: a fresh UUID for merge, the record's own id for a verbatim replace. */
async function writeDocuments(documents: TinDocument[], makeDocumentId: (document: TinDocument) => string): Promise<void> {
   if (documents.length === 0) return
   const database     = await openDatabase()
   const transaction  = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore  = transaction.objectStore(DOCUMENT_CONTENT_STORE)
   for (const document of documents) {
      const { record, content } = buildDocumentRecords(document, makeDocumentId(document))
      documentStore.put(record)
      contentStore.put(content)
   }
   await transactionDone(transaction)
}

/** Materialize each Tin template as a fresh stored user template (new id + timestamps). The Tin
 *  format carries only name + chrome, so a template is always re-captured, never written verbatim. */
async function writeTemplates(templates: TinTemplate[]): Promise<void> {
   for (const { name, ...chrome } of templates) {
      await saveTemplate(captureTemplate(name, chrome, crypto.randomUUID(), Date.now()))
   }
}

/**
 * Wipe the binder and restore a Tin verbatim, all in ONE readwrite transaction across the four stores.
 * Clearing then re-writing inside a single transaction is what makes Replace safe: if any write fails
 * the transaction aborts and rolls back to the pre-import binder, so a failed restore can never leave a
 * half-erased, half-written mess (the old separate-transaction version could). Every put is queued
 * SYNCHRONOUSLY (buildDocumentRecords + captureTemplate are pure and synchronous, no await mid-flight),
 * so the transaction never auto-commits early. Document ids are reused (a verbatim restore); templates
 * are re-captured with fresh ids since the format carries only name + chrome.
 */
async function replaceBinder(tin: TinFile): Promise<void> {
   const database    = await openDatabase()
   const transaction = database.transaction(
      [FOLDERS_STORE, DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE, TEMPLATES_STORE], 'readwrite')
   const folderStore   = transaction.objectStore(FOLDERS_STORE)
   const documentStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore  = transaction.objectStore(DOCUMENT_CONTENT_STORE)
   const templateStore = transaction.objectStore(TEMPLATES_STORE)

   folderStore.clear()
   documentStore.clear()
   contentStore.clear()
   templateStore.clear()

   for (const folder of tin.folders) folderStore.put(folder)
   for (const document of tin.documents) {
      const { record, content } = buildDocumentRecords(document, document.id)
      documentStore.put(record)
      contentStore.put(content)
   }
   for (const { name, ...chrome } of tin.templates) {
      templateStore.put(captureTemplate(name, chrome, crypto.randomUUID(), Date.now()))
   }

   await transactionDone(transaction)
}

/** The next free sort position among a folder's existing children, taken across BOTH the folder
 *  siblings and the document siblings so a graft's top-level items clear whichever is higher. */
async function nextTopLevelSortOrder(targetFolderId: string): Promise<number> {
   const folders   = await listAllFolders()
   const documents = await listDocuments({ folderId: targetFolderId })
   const folderMax = folders
      .filter(folder => folder.parentId === targetFolderId)
      .reduce((max, folder) => Math.max(max, folder.sortOrder), -1)
   const documentMax = documents.reduce((max, document) => Math.max(max, document.sortOrder), -1)
   return Math.max(folderMax, documentMax) + 1
}

/**
 * Write a TinFile into the binder. Merge grafts the bundle under `targetFolderId` (default root)
 * with fresh folder + document ids, top-level items appended after existing content; it never
 * touches records already present. Replace wipes folders / documents / documentContent / templates,
 * then restores every record verbatim (ids reused, no remap), so the binder matches the exported
 * state; `targetFolderId` is ignored in replace. Both modes heal each document through the read-time
 * migrators. Returns the per-kind write counts.
 */
export async function importTin(
   tin: TinFile,
   mode: 'merge' | 'replace',
   targetFolderId?: string,
): Promise<TinImportSummary> {
   if (mode === 'replace') {
      await replaceBinder(tin)
      return { templates: tin.templates.length, folders: tin.folders.length, documents: tin.documents.length }
   }

   const target          = targetFolderId ?? ROOT_FOLDER_ID
   const sortOrderOffset  = await nextTopLevelSortOrder(target)
   const { folders, documents } = remapTinForMerge(tin, target, sortOrderOffset)
   await writeFolders(folders)
   await writeDocuments(documents, () => crypto.randomUUID())
   await writeTemplates(tin.templates)
   return { templates: tin.templates.length, folders: folders.length, documents: documents.length }
}

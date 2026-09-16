// ###############################################################################################
// # BINDER BACKUP                                                                               #
// #                                                                                             #
// # The bulk side of the `.tin` format: read the whole binder (or one folder subtree) into a    #
// # TinFile, and write one back in two modes. Merge grafts a bundle in non-destructively (with  #
// # fresh folder + document ids, re-homed under a target folder). Replace wipes the binder and  #
// # restores every record verbatim, so it matches the exported state byte for byte. tinFile.ts  #
// # owns the format + compression; this owns the store glue.                                    #
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

/** Fields picked explicitly to drop stray props. Shared so both backends emit an identical shape. */
export function toTinFolder(folder: BinderFolderRecord): TinFolder {
   return {
      id:        folder.id,
      name:      folder.name,
      parentId:  folder.parentId,
      sortOrder: folder.sortOrder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
   }
}

/** Light placement + heavy body -> TinDocument. Drops a default format so a document that never
 *  touched Page Setup stays byte-clean. Shared so both backends emit an identical shape. */
export function toTinDocument(record: BinderDocumentRecord, loaded: LoadedDocument): TinDocument {
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

/** Built-ins are code, never exported. Shared so the filesystem backend maps `.mintplate`
 *  templates the same way. */
export function toTinTemplate(template: { name: string } & TemplateChrome): TinTemplate {
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

/** Read one folder and everything under it into a TinFile. Carries no templates: a subtree Tin is
 *  structure + documents only. */
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
   // Breadth-first walk of descendants over the in-memory child map.
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
 * `makeId`. Every folder gets a fresh id; an id map carries each old folder id to its new one, plus
 * the root sentinel '0' to `targetFolderId`. Pointers resolve through the map with a fallback to the
 * target, so a parentId pointing OUTSIDE the bundle (a subtree export's root) re-homes under it.
 * A record landing at the target is top-level, so its sortOrder is offset to land after existing
 * content instead of interleaving. Document ids are untouched here; importTin mints them at write.
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

/** Light + heavy store records for one imported document. Runs the read-time migrators (id / meta /
 *  page-break / band healing), regenerates the search + preview fields, stamps the schema version. */
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

/** One transaction. Verbatim: the caller supplies already-remapped or already-verbatim records. */
async function writeFolders(folders: TinFolder[]): Promise<void> {
   if (folders.length === 0) return
   const database    = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store       = transaction.objectStore(FOLDERS_STORE)
   for (const folder of folders) store.put(folder)
   await transactionDone(transaction)
}

/** One transaction. `makeDocumentId` picks the target id: a fresh UUID for merge, the record's own
 *  id for a verbatim replace. */
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

/** Re-capture each Tin template as a fresh user template (new id + timestamps): the format carries
 *  only name + chrome, never a verbatim record. */
async function writeTemplates(templates: TinTemplate[]): Promise<void> {
   for (const { name, ...chrome } of templates) {
      await saveTemplate(captureTemplate(name, chrome, crypto.randomUUID(), Date.now()))
   }
}

/**
 * Wipe the binder and restore a Tin verbatim in ONE readwrite transaction across the four stores.
 * Clearing then re-writing in a single transaction is what makes Replace safe: any failed write
 * aborts and rolls back to the pre-import binder, never a half-erased, half-written mess. Every put
 * is queued SYNCHRONOUSLY (buildDocumentRecords + captureTemplate are pure, no await mid-flight), so
 * the transaction never auto-commits early. Document ids are reused; templates get fresh ids.
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

/** Next free sort position among a folder's children, across BOTH folder and document siblings so a
 *  graft's top-level items clear whichever is higher. */
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
 * Merge grafts the bundle under `targetFolderId` (default root) with fresh ids, appended after
 * existing content, never touching records already present. Replace wipes all four stores then
 * restores every record verbatim (ids reused), so the binder matches the exported state, and ignores
 * `targetFolderId`. Both modes heal each document through the read-time migrators.
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

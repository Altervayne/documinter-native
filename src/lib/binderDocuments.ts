/**
 * binderDocuments.ts, Document CRUD + move/order for the binder (IndexedDB).
 *
 * Relocated verbatim from storage.ts. Reads/writes the `documents` (light record) and
 * `documentContent` (heavy sections) stores via the shared connection in binderDatabase.
 * nextDocumentSortOrder is exported because binderFolders.deleteFolder reflows orphaned
 * documents to root.
 */

import {
   openDatabase, requestToPromise, transactionDone,
   DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE, FOLDER_ID_INDEX, ROOT_FOLDER_ID,
} from './binderDatabase'
import { buildPreviewSections, extractDocumentText } from './documentPreview'
import { matchesCriteria, documentComparator, type DocumentListFilter } from './binderSearch'
import { migrateIds, migrateMeta } from './documentMigration'
import { normalizePresentation, type DocPresentationExtras } from './presentation'
import { cloneBlock } from './document'
import type {
   DocMeta, DocState, Section,
   BinderDocumentRecord, BinderDocumentContent,
} from '../types'

const RECORD_SCHEMA_VERSION = 4   // v4 adds field zones (position) + color to freeform meta
                                  // (v3 moved meta to the freeform { title, fields } shape;
                                  //  v2 added contentText, the flattened block text for full-text search)

/** Presentation settings persisted per-document alongside the DocState. `presentation` carries the
 *  image-bearing export/editor extras (watermark, …); it stores on the HEAVY content record, not
 *  the light card record, see saveDocument. */
export interface DocPresentation {
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
}

/** Full editable document returned by loadDocument, DocState plus presentation. */
export interface LoadedDocument {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
}

/** Next manual sort position for a new document appended to the end of a folder. */
export async function nextDocumentSortOrder(documentsStore: IDBObjectStore, folderId: string): Promise<number> {
   const siblings = await requestToPromise<BinderDocumentRecord[]>(documentsStore.index(FOLDER_ID_INDEX).getAll(folderId))
   return siblings.reduce((max, sibling) => Math.max(max, sibling.sortOrder), -1) + 1
}

/** Read just a document's folder placement (light record), or null if the document is gone. */
export async function getDocumentFolderId(id: string): Promise<string | null> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const record = await requestToPromise<BinderDocumentRecord | undefined>(
      transaction.objectStore(DOCUMENTS_STORE).get(id),
   )
   return record ? record.folderId : null
}

/**
 * Save a document to IndexedDB. With existingId, updates that record (preserving
 * createdAt); otherwise creates a new one. Regenerates previewSections and updatedAt
 * every call. Returns the document id.
 */
export async function saveDocument(
   state: DocState,
   presentation: DocPresentation,
   existingId?: string,
   targetFolderId?: string,
): Promise<string> {
   const database = await openDatabase()
   const id  = existingId ?? crypto.randomUUID()
   const now = new Date().toISOString()

   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)

   // Preserve createdAt / folder placement / lastOpenedAt across updates. Upsert if existingId
   // was passed but is gone. A new record lands in targetFolderId (defaulting to root), appended.
   const existing = existingId
      ? await requestToPromise<BinderDocumentRecord | undefined>(documentsStore.get(existingId))
      : undefined
   const createdAt    = existing?.createdAt ?? now
   const folderId     = existing?.folderId ?? targetFolderId ?? ROOT_FOLDER_ID
   const lastOpenedAt = existing?.lastOpenedAt
   const sortOrder    = existing?.sortOrder ?? await nextDocumentSortOrder(documentsStore, folderId)

   const record: BinderDocumentRecord = {
      id,
      meta:          state.meta,
      createdAt,
      updatedAt:     now,
      lastOpenedAt,
      folderId,
      sortOrder,
      sectionTitles: state.sections.map(section => section.title),
      contentText:   extractDocumentText(state.sections),
      previewSections: buildPreviewSections(state.sections),
      docTheme:      presentation.docTheme,
      docAccent:     presentation.docAccent,
      schemaVersion: RECORD_SCHEMA_VERSION,
   }
   // The image-bearing presentation extras live on the HEAVY content record ONLY (never the light
   // card record above), so a full-bleed watermark base64 can't bloat the listDocuments() query.
   const content: BinderDocumentContent = {
      id,
      sections: state.sections,
      ...(presentation.presentation ? { presentation: presentation.presentation } : {}),
   }

   documentsStore.put(record)
   contentStore.put(content)
   await transactionDone(transaction)
   return id
}

/** Read the full editable document without side effects. Internal, loadDocument wraps it. */
async function readDocument(id: string): Promise<LoadedDocument | null> {
   const database = await openDatabase()
   const transaction = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readonly')
   const recordRequest  = transaction.objectStore(DOCUMENTS_STORE).get(id)
   const contentRequest = transaction.objectStore(DOCUMENT_CONTENT_STORE).get(id)
   const record  = await requestToPromise<BinderDocumentRecord | undefined>(recordRequest)
   const content = await requestToPromise<BinderDocumentContent | undefined>(contentRequest)
   if (!record || !content) return null
   const migrated = migrateIds({ meta: record.meta, sections: content.sections })
   return {
      meta: migrated.meta,
      sections: migrated.sections,
      docTheme: record.docTheme,
      docAccent: record.docAccent,
      // Presentation extras ride on the heavy content record; normalize defensively on read
      // (clamp opacity, drop an empty-src watermark), the mirror of migrateMeta for metadata.
      presentation: normalizePresentation(content.presentation),
   }
}

/**
 * Load the full editable document (DocState + presentation) by id, or null if absent.
 * Records the open in lastOpenedAt by default; pass { touch: false } for non-open reads
 * (e.g. exporting a document from the binder, which shouldn't count as opening it).
 */
export async function loadDocument(id: string, options?: { touch?: boolean }): Promise<LoadedDocument | null> {
   const document = await readDocument(id)
   if (document && options?.touch !== false) await touchDocument(id)
   return document
}

/** Set lastOpenedAt to now. Called by loadDocument automatically (unless touch:false). */
export async function touchDocument(id: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
   const store = transaction.objectStore(DOCUMENTS_STORE)
   const record = await requestToPromise<BinderDocumentRecord | undefined>(store.get(id))
   if (record) {
      record.lastOpenedAt = new Date().toISOString()
      store.put(record)
   }
   await transactionDone(transaction)
}

/**
 * List document records (light store only, no sections/base64), filtered by folder,
 * searched in-memory, and sorted. Defaults to all folders, updatedAt descending.
 */
export async function listDocuments(filter?: DocumentListFilter): Promise<BinderDocumentRecord[]> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const store = transaction.objectStore(DOCUMENTS_STORE)

   const sourceRequest = filter?.folderId !== undefined
      ? store.index(FOLDER_ID_INDEX).getAll(filter.folderId)
      : store.getAll()
   let records = await requestToPromise<BinderDocumentRecord[]>(sourceRequest)

   // Light records stored before the freeform-metadata migration still carry the legacy flat meta.
   // Normalize on read so the cards + free-text search always see the { title, fields } shape.
   records = records.map(record => ({ ...record, meta: migrateMeta(record.meta) }))

   if (filter?.criteria) records = records.filter(record => matchesCriteria(record, filter.criteria!))

   records.sort(documentComparator(filter?.sortBy ?? 'updatedAt', filter?.sortDir ?? 'desc'))
   return records
}

/** Permanently delete a document from both stores. Idempotent (absent id is a no-op). */
export async function deleteDocument(id: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   transaction.objectStore(DOCUMENTS_STORE).delete(id)
   transaction.objectStore(DOCUMENT_CONTENT_STORE).delete(id)
   await transactionDone(transaction)
}

/** Copy a document with a fresh id, createdAt, and updatedAt. Returns the new id. */
export async function duplicateDocument(id: string): Promise<string> {
   const database = await openDatabase()
   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)

   const recordRequest  = documentsStore.get(id)
   const contentRequest = contentStore.get(id)
   const sourceRecord  = await requestToPromise<BinderDocumentRecord | undefined>(recordRequest)
   const sourceContent = await requestToPromise<BinderDocumentContent | undefined>(contentRequest)
   if (!sourceRecord || !sourceContent) throw new Error('Cannot duplicate: document not found')

   const newId = crypto.randomUUID()
   const now   = new Date().toISOString()
   // Deep-clone sections with fresh section + block ids (no aliasing between copies).
   const clonedSections: Section[] = sourceContent.sections.map(section => ({
      ...section,
      id:     crypto.randomUUID(),
      blocks: section.blocks.map(cloneBlock),
   }))
   // The copy lands in the same folder, appended to the end, never-opened.
   const sortOrder = await nextDocumentSortOrder(documentsStore, sourceRecord.folderId)

   const newRecord: BinderDocumentRecord = {
      id:            newId,
      meta:          migrateMeta(sourceRecord.meta),
      createdAt:     now,
      updatedAt:     now,
      lastOpenedAt:  undefined,
      folderId:      sourceRecord.folderId,
      sortOrder,
      sectionTitles: clonedSections.map(section => section.title),
      contentText:   extractDocumentText(clonedSections),
      previewSections: buildPreviewSections(clonedSections),
      docTheme:      sourceRecord.docTheme,
      docAccent:     sourceRecord.docAccent,
      schemaVersion: RECORD_SCHEMA_VERSION,
   }
   const newContent: BinderDocumentContent = {
      id: newId,
      sections: clonedSections,
      ...(sourceContent.presentation ? { presentation: sourceContent.presentation } : {}),
   }

   documentsStore.put(newRecord)
   contentStore.put(newContent)
   await transactionDone(transaction)
   return newId
}

/**
 * Populate contentText on any pre-v2 records that lack it (one-time, idempotent). Reads each
 * stale document's content to flatten its block text, then rewrites the light record. Returns
 * how many records were updated so the caller can refresh the view. A no-op once all records
 * carry contentText, so it is cheap to call on every binder open.
 */
export async function backfillSearchText(): Promise<number> {
   const database = await openDatabase()
   const readTransaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const allRecords = await requestToPromise<BinderDocumentRecord[]>(readTransaction.objectStore(DOCUMENTS_STORE).getAll())
   const staleRecords = allRecords.filter(record => record.contentText === undefined)
   if (staleRecords.length === 0) return 0

   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)
   for (const record of staleRecords) {
      const content = await requestToPromise<BinderDocumentContent | undefined>(contentStore.get(record.id))
      record.contentText   = content ? extractDocumentText(content.sections) : ''
      record.schemaVersion = RECORD_SCHEMA_VERSION
      documentsStore.put(record)
   }
   await transactionDone(transaction)
   return staleRecords.length
}

/** Move a document into targetFolderId, appended to the end of that folder. */
export async function moveDocument(id: string, targetFolderId: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
   const store = transaction.objectStore(DOCUMENTS_STORE)
   const record = await requestToPromise<BinderDocumentRecord | undefined>(store.get(id))
   if (record) {
      const siblings = await requestToPromise<BinderDocumentRecord[]>(store.index(FOLDER_ID_INDEX).getAll(targetFolderId))
      const maxSort  = siblings.reduce((max, sibling) => sibling.id === id ? max : Math.max(max, sibling.sortOrder), -1)
      record.folderId = targetFolderId
      record.sortOrder = maxSort + 1
      store.put(record)
   }
   await transactionDone(transaction)
}

/** Assign sortOrder by array position. All ids must belong to the same folder (validated). */
export async function reorderDocuments(orderedIds: string[]): Promise<void> {
   if (orderedIds.length === 0) return
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
   const store = transaction.objectStore(DOCUMENTS_STORE)
   const records = await Promise.all(
      orderedIds.map(id => requestToPromise<BinderDocumentRecord | undefined>(store.get(id))),
   )
   const present = records.filter((record): record is BinderDocumentRecord => record !== undefined)
   const folderId = present[0]?.folderId
   if (present.length !== orderedIds.length || present.some(record => record.folderId !== folderId)) {
      transaction.abort()
      throw new Error('reorderDocuments: all ids must belong to the same folder')
   }
   present.forEach((record, index) => { record.sortOrder = index; store.put(record) })
   await transactionDone(transaction)
}

/*
 * Document CRUD + move / order for the binder (IndexedDB), over the `documents` (light) and
 * `documentContent` (heavy) stores. nextDocumentSortOrder is exported because
 * binderFolders.deleteFolder reflows orphaned documents to root.
 */

import {
   openDatabase, requestToPromise, transactionDone,
   DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE, FOLDER_ID_INDEX, ROOT_FOLDER_ID,
} from './binderDatabase'
import { extractDocumentText } from './documentPreview'
import { matchesCriteria, documentComparator, type DocumentListFilter } from './binderSearch'
import { migrateMeta } from './documentMigration'
import { isDefaultFormat, type DocFormat } from './format'
import type { DocPresentationExtras } from './presentation'
import {
   RECORD_SCHEMA_VERSION,
   buildDocumentRecord, buildDocumentContent, cloneSectionsWithFreshIds,
   assembleLoadedDocument, migrateListRecord,
   type LoadedDocument,
} from './documentRecord'
import type {
   DocState,
   BinderDocumentRecord, BinderDocumentContent,
} from '../types'

// Re-export so importers keep their `./binderDocuments` path; the source of truth is documentRecord.
export { RECORD_SCHEMA_VERSION }
export type { LoadedDocument }

/** Persisted per-document alongside the DocState. `presentation` carries the image-bearing export /
 *  editor extras (watermark, ...) and stores on the HEAVY content record, not the light card record.
 *  `format` rides the same bundle; absent means infinite / normal behavior. */
export interface DocPresentation {
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
   format?: DocFormat
}

/** Next manual sort position for a new document appended to the end of a folder. */
export async function nextDocumentSortOrder(documentsStore: IDBObjectStore, folderId: string): Promise<number> {
   const siblings = await requestToPromise<BinderDocumentRecord[]>(documentsStore.index(FOLDER_ID_INDEX).getAll(folderId))
   return siblings.reduce((max, sibling) => Math.max(max, sibling.sortOrder), -1) + 1
}

/** The light record by id, normalized like listDocuments (legacy flat meta lifted to { title, fields }).
 *  Null when the document is gone. The cheap read behind the open-tab external-change check. */
export async function getDocumentRecord(id: string): Promise<BinderDocumentRecord | null> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const record = await requestToPromise<BinderDocumentRecord | undefined>(
      transaction.objectStore(DOCUMENTS_STORE).get(id),
   )
   return record ? migrateListRecord(record) : null
}

/** Null when the document is gone. */
export async function getDocumentFolderId(id: string): Promise<string | null> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const record = await requestToPromise<BinderDocumentRecord | undefined>(
      transaction.objectStore(DOCUMENTS_STORE).get(id),
   )
   return record ? record.folderId : null
}

/** Upsert. With existingId, updates that record (preserving createdAt); otherwise creates one.
 *  Regenerates previewSections and updatedAt every call. */
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

   const record = buildDocumentRecord({
      id,
      meta:         state.meta,
      sections:     state.sections,
      docTheme:     presentation.docTheme,
      docAccent:    presentation.docAccent,
      createdAt,
      updatedAt:    now,
      lastOpenedAt,
      folderId,
      sortOrder,
   })
   // Presentation extras live on the HEAVY content record ONLY, so a watermark base64 can't bloat the
   // listDocuments() query. `format` is only written when it diverges from the default, so a document
   // that never touched Page Setup stays byte-clean; that guard is save-specific, hence here.
   const content = buildDocumentContent(id, state.sections, {
      presentation: presentation.presentation,
      format: presentation.format && !isDefaultFormat(presentation.format) ? presentation.format : undefined,
   })

   documentsStore.put(record)
   contentStore.put(content)
   await transactionDone(transaction)
   return id
}

/** No side effects, unlike loadDocument which wraps it. */
async function readDocument(id: string): Promise<LoadedDocument | null> {
   const database = await openDatabase()
   const transaction = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readonly')
   const recordRequest  = transaction.objectStore(DOCUMENTS_STORE).get(id)
   const contentRequest = transaction.objectStore(DOCUMENT_CONTENT_STORE).get(id)
   const record  = await requestToPromise<BinderDocumentRecord | undefined>(recordRequest)
   const content = await requestToPromise<BinderDocumentContent | undefined>(contentRequest)
   if (!record || !content) return null
   return assembleLoadedDocument({
      meta: record.meta,
      sections: content.sections,
      docTheme: record.docTheme,
      docAccent: record.docAccent,
      presentation: content.presentation,
      format: content.format,
      updatedAt: record.updatedAt,
   })
}

/** Full editable read. Bumps lastOpenedAt by default; pass { touch: false } for non-open reads
 *  (e.g. exporting a document, which shouldn't count as opening it). */
export async function loadDocument(id: string, options?: { touch?: boolean }): Promise<LoadedDocument | null> {
   const document = await readDocument(id)
   if (document && options?.touch !== false) await touchDocument(id)
   return document
}

/** Set lastOpenedAt to now. */
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

/** Light store only, filtered by folder, searched in-memory, sorted. Defaults to all folders,
 *  updatedAt descending. */
export async function listDocuments(filter?: DocumentListFilter): Promise<BinderDocumentRecord[]> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const store = transaction.objectStore(DOCUMENTS_STORE)

   const sourceRequest = filter?.folderId !== undefined
      ? store.index(FOLDER_ID_INDEX).getAll(filter.folderId)
      : store.getAll()
   let records = await requestToPromise<BinderDocumentRecord[]>(sourceRequest)

   // Records predating the freeform-metadata migration carry the legacy flat meta. Normalize on read
   // so the cards + free-text search always see the { title, fields } shape.
   records = records.map(migrateListRecord)

   if (filter?.criteria) records = records.filter(record => matchesCriteria(record, filter.criteria!))

   records.sort(documentComparator(filter?.sortBy ?? 'updatedAt', filter?.sortDir ?? 'desc'))
   return records
}

/** Deletes from both stores. Idempotent: an absent id is a no-op. */
export async function deleteDocument(id: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   transaction.objectStore(DOCUMENTS_STORE).delete(id)
   transaction.objectStore(DOCUMENT_CONTENT_STORE).delete(id)
   await transactionDone(transaction)
}

/** Copy with a fresh id, createdAt, and updatedAt. */
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
   // Fresh section + block ids, so no aliasing between copies.
   const clonedSections = cloneSectionsWithFreshIds(sourceContent.sections)
   const sortOrder = await nextDocumentSortOrder(documentsStore, sourceRecord.folderId)

   const newRecord = buildDocumentRecord({
      id:           newId,
      meta:         migrateMeta(sourceRecord.meta),
      sections:     clonedSections,
      docTheme:     sourceRecord.docTheme,
      docAccent:    sourceRecord.docAccent,
      createdAt:    now,
      updatedAt:    now,
      lastOpenedAt: undefined,
      folderId:     sourceRecord.folderId,
      sortOrder,
   })
   // Presentation + format copied verbatim (no guard): the source already stored only a divergent
   // format, so a byte-clean source stays byte-clean.
   const newContent = buildDocumentContent(newId, clonedSections, {
      presentation: sourceContent.presentation,
      format: sourceContent.format,
   })

   documentsStore.put(newRecord)
   contentStore.put(newContent)
   await transactionDone(transaction)
   return newId
}

/** Populate contentText on records that lack it (idempotent). Returns how many were updated. A no-op
 *  once every record carries contentText, so it is cheap to call on every binder open. */
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

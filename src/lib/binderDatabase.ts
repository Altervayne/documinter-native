/*
 * IndexedDB connection singleton + schema for the binder library. One cached connection, opened
 * once across the binder layer, plus the request/transaction promise wrappers. Two stores keyed by
 * the same id: `documents` (light record) and `documentContent` (heavy sections + base64), so
 * listDocuments reads only the light store and never deserializes base64, keeping the card grid cheap.
 */

import type { BinderDocumentRecord } from '../types'

const DATABASE_NAME          = 'documinter'
export const DOCUMENTS_STORE        = 'documents'
export const DOCUMENT_CONTENT_STORE = 'documentContent'
export const FOLDERS_STORE          = 'folders'
const UPDATED_AT_INDEX       = 'by_updatedAt'
export const FOLDER_ID_INDEX        = 'by_folderId'
const SORT_ORDER_INDEX       = 'by_sortOrder'
export const PARENT_ID_INDEX        = 'by_parentId'
export const ROOT_FOLDER_ID         = '0'
export const TEMPLATES_STORE           = 'templates'
const TEMPLATES_UPDATED_AT_INDEX       = 'by_templateUpdatedAt'

let databasePromise: Promise<IDBDatabase> | null = null

/** Create any missing store / index (idempotent). Repairs a partial schema and a fresh install
 *  identically. Runs from onupgradeneeded. */
function ensureSchema(database: IDBDatabase, transaction: IDBTransaction): void {
   if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
      database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' })
   }
   if (!database.objectStoreNames.contains(DOCUMENT_CONTENT_STORE)) {
      database.createObjectStore(DOCUMENT_CONTENT_STORE, { keyPath: 'id' })
   }
   if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
      database.createObjectStore(FOLDERS_STORE, { keyPath: 'id' })
   }
   if (!database.objectStoreNames.contains(TEMPLATES_STORE)) {
      database.createObjectStore(TEMPLATES_STORE, { keyPath: 'id' })
   }

   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   if (!documentsStore.indexNames.contains(UPDATED_AT_INDEX)) documentsStore.createIndex(UPDATED_AT_INDEX, 'updatedAt', { unique: false })
   if (!documentsStore.indexNames.contains(FOLDER_ID_INDEX))  documentsStore.createIndex(FOLDER_ID_INDEX, 'folderId', { unique: false })
   if (!documentsStore.indexNames.contains(SORT_ORDER_INDEX)) documentsStore.createIndex(SORT_ORDER_INDEX, 'sortOrder', { unique: false })

   const foldersStore = transaction.objectStore(FOLDERS_STORE)
   if (!foldersStore.indexNames.contains(PARENT_ID_INDEX)) foldersStore.createIndex(PARENT_ID_INDEX, 'parentId', { unique: false })

   const templatesStore = transaction.objectStore(TEMPLATES_STORE)
   if (!templatesStore.indexNames.contains(TEMPLATES_UPDATED_AT_INDEX)) templatesStore.createIndex(TEMPLATES_UPDATED_AT_INDEX, 'updatedAt', { unique: false })

   // Backfill folderId / sortOrder / lastOpenedAt on any documents that predate them.
   const cursorRequest = documentsStore.openCursor()
   cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const record = cursor.value as Partial<BinderDocumentRecord>
      let changed = false
      if (record.folderId === undefined)  { record.folderId = ROOT_FOLDER_ID; changed = true }
      if (record.sortOrder === undefined) { record.sortOrder = 0;             changed = true }
      if (!('lastOpenedAt' in record))    { record.lastOpenedAt = undefined;  changed = true }
      if (changed) cursor.update(record)
      cursor.continue()
   }
}

function hasCompleteSchema(database: IDBDatabase): boolean {
   if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) return false
   if (!database.objectStoreNames.contains(DOCUMENT_CONTENT_STORE)) return false
   if (!database.objectStoreNames.contains(FOLDERS_STORE)) return false
   if (!database.objectStoreNames.contains(TEMPLATES_STORE)) return false
   try {
      const transaction     = database.transaction([DOCUMENTS_STORE, FOLDERS_STORE, TEMPLATES_STORE], 'readonly')
      const documentIndexes = transaction.objectStore(DOCUMENTS_STORE).indexNames
      const folderIndexes   = transaction.objectStore(FOLDERS_STORE).indexNames
      const templateIndexes = transaction.objectStore(TEMPLATES_STORE).indexNames
      return documentIndexes.contains(UPDATED_AT_INDEX)
          && documentIndexes.contains(FOLDER_ID_INDEX)
          && documentIndexes.contains(SORT_ORDER_INDEX)
          && folderIndexes.contains(PARENT_ID_INDEX)
          && templateIndexes.contains(TEMPLATES_UPDATED_AT_INDEX)
   } catch {
      return false
   }
}

/** Version omitted opens at the current version. */
function openAtVersion(version?: number): Promise<IDBDatabase> {
   return new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
         request = version === undefined ? indexedDB.open(DATABASE_NAME) : indexedDB.open(DATABASE_NAME, version)
      } catch (error) {
         reject(error instanceof Error ? error : new Error('IndexedDB is unavailable'))
         return
      }
      request.onupgradeneeded = () => {
         const transaction = request.transaction
         if (transaction) ensureSchema(request.result, transaction)
      }
      request.onsuccess = () => {
         const database = request.result
         // If another tab requests a version upgrade, close so it isn't blocked.
         database.onversionchange = () => { database.close(); databasePromise = null }
         resolve(database)
      }
      request.onerror   = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab'))
   })
}

/**
 * Open the binder database, self-healing a partial or old schema. If any required store / index is
 * missing, reopen one version higher to force onupgradeneeded to repair it, independent of the
 * version number, so it works even when the DB is already "current". Cached singleton.
 */
export function openDatabase(): Promise<IDBDatabase> {
   if (databasePromise) return databasePromise
   databasePromise = (async () => {
      try {
         let database = await openAtVersion()
         if (!hasCompleteSchema(database)) {
            const repairVersion = database.version + 1
            database.close()
            database = await openAtVersion(repairVersion)
         }
         return database
      } catch (error) {
         databasePromise = null
         throw error instanceof Error ? error : new Error('Failed to open IndexedDB')
      }
   })()
   return databasePromise
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
   return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror   = () => reject(request.error ?? new Error('IndexedDB request failed'))
   })
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
   return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror    = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
      transaction.onabort    = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
   })
}

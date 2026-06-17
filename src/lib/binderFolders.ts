/**
 * binderFolders.ts, Folder CRUD + move/order for the binder (IndexedDB).
 *
 * Relocated verbatim from storage.ts. Reads/writes the `folders` store via the shared
 * connection in binderDatabase. deleteFolder reflows orphaned documents to root using
 * binderDocuments.nextDocumentSortOrder (the one document-side dependency).
 */

import {
   openDatabase, requestToPromise, transactionDone,
   FOLDERS_STORE, DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE, FOLDER_ID_INDEX, PARENT_ID_INDEX, ROOT_FOLDER_ID,
} from './binderDatabase'
import { nextDocumentSortOrder } from './binderDocuments'
import type { BinderDocumentRecord, BinderFolderRecord } from '../types'

/** Read a single folder record by id (its own readonly transaction). */
export async function getFolder(id: string): Promise<BinderFolderRecord | undefined> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readonly')
   return requestToPromise<BinderFolderRecord | undefined>(transaction.objectStore(FOLDERS_STORE).get(id))
}

/** Create a folder under parentId ('0' = root), appended after existing siblings. Returns its id. */
export async function createFolder(name: string, parentId: string): Promise<string> {
   const database = await openDatabase()
   const id  = crypto.randomUUID()
   const now = new Date().toISOString()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const siblings = await requestToPromise<BinderFolderRecord[]>(store.index(PARENT_ID_INDEX).getAll(parentId))
   const sortOrder = siblings.reduce((max, folder) => Math.max(max, folder.sortOrder), -1) + 1
   store.put({ id, name, parentId, createdAt: now, updatedAt: now, sortOrder })
   await transactionDone(transaction)
   return id
}

/** Rename a folder. No-op if the folder is gone. */
export async function renameFolder(id: string, name: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const folder = await requestToPromise<BinderFolderRecord | undefined>(store.get(id))
   if (folder) {
      folder.name = name
      folder.updatedAt = new Date().toISOString()
      store.put(folder)
   }
   await transactionDone(transaction)
}

/**
 * Delete a folder and all descendant folders. By default the documents in any deleted folder
 * are kept, moved to root (folderId '0'), appended to the end of root in their discovered order.
 * With { recursive: true } the documents are permanently deleted from both stores instead.
 * Returns the ids of the documents that were deleted (empty unless recursive), so the caller can
 * clear a now-stale "currently open" document.
 */
export async function deleteFolder(id: string, options?: { recursive?: boolean }): Promise<string[]> {
   const recursive = options?.recursive ?? false
   const database = await openDatabase()

   // Phase 1, collect the folder and all descendants (iterative breadth-first).
   const toDelete: string[] = [id]
   for (let index = 0; index < toDelete.length; index++) {
      const children = await getFolderChildren(toDelete[index])
      for (const child of children) toDelete.push(child.id)
   }

   // Phase 2, handle the contained documents, then delete the folders themselves.
   const stores = recursive
      ? [FOLDERS_STORE, DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE]
      : [FOLDERS_STORE, DOCUMENTS_STORE]
   const transaction    = database.transaction(stores, 'readwrite')
   const foldersStore   = transaction.objectStore(FOLDERS_STORE)
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const folderIndex    = documentsStore.index(FOLDER_ID_INDEX)

   const deletedDocumentIds: string[] = []
   if (recursive) {
      const contentStore = transaction.objectStore(DOCUMENT_CONTENT_STORE)
      for (const folderId of toDelete) {
         const documents = await requestToPromise<BinderDocumentRecord[]>(folderIndex.getAll(folderId))
         for (const document of documents) {
            documentsStore.delete(document.id)
            contentStore.delete(document.id)
            deletedDocumentIds.push(document.id)
         }
         foldersStore.delete(folderId)
      }
   } else {
      let nextRootSort = await nextDocumentSortOrder(documentsStore, ROOT_FOLDER_ID)
      for (const folderId of toDelete) {
         const documents = await requestToPromise<BinderDocumentRecord[]>(folderIndex.getAll(folderId))
         for (const document of documents) {
            document.folderId = ROOT_FOLDER_ID
            document.sortOrder = nextRootSort++
            documentsStore.put(document)
         }
         foldersStore.delete(folderId)
      }
   }
   await transactionDone(transaction)
   return deletedDocumentIds
}

/** Direct children of a folder, sorted by sortOrder ascending. */
export async function getFolderChildren(parentId: string): Promise<BinderFolderRecord[]> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readonly')
   const children = await requestToPromise<BinderFolderRecord[]>(
      transaction.objectStore(FOLDERS_STORE).index(PARENT_ID_INDEX).getAll(parentId),
   )
   return children.sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Folder ancestors from the root-most ancestor down to the immediate parent (excludes
 * the folder itself; empty for a top-level folder). Iterative walk of the parentId chain.
 */
export async function getFolderAncestors(id: string): Promise<BinderFolderRecord[]> {
   const chain: BinderFolderRecord[] = []
   const self = await getFolder(id)
   if (!self) return chain
   let parentId = self.parentId
   while (parentId !== ROOT_FOLDER_ID) {
      const parent = await getFolder(parentId)
      if (!parent) break
      chain.unshift(parent)
      parentId = parent.parentId
   }
   return chain
}

/**
 * Move a folder under a new parent, appended to the end of the target parent's children
 * (sortOrder = max sibling sortOrder + 1). Does NOT validate cycles, the caller must ensure
 * targetParentId is not the folder itself or a descendant of it.
 */
export async function moveFolder(id: string, targetParentId: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const folder = await requestToPromise<BinderFolderRecord | undefined>(store.get(id))
   if (folder) {
      const siblings = await requestToPromise<BinderFolderRecord[]>(store.index(PARENT_ID_INDEX).getAll(targetParentId))
      const maxSort  = siblings.reduce((max, sibling) => sibling.id === id ? max : Math.max(max, sibling.sortOrder), -1)
      folder.parentId  = targetParentId
      folder.sortOrder = maxSort + 1
      folder.updatedAt = new Date().toISOString()
      store.put(folder)
   }
   await transactionDone(transaction)
}

/** Assign sortOrder by array position. All ids must be siblings (same parentId; validated). */
export async function reorderFolders(orderedIds: string[]): Promise<void> {
   if (orderedIds.length === 0) return
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const folders = await Promise.all(
      orderedIds.map(id => requestToPromise<BinderFolderRecord | undefined>(store.get(id))),
   )
   const present = folders.filter((folder): folder is BinderFolderRecord => folder !== undefined)
   const parentId = present[0]?.parentId
   if (present.length !== orderedIds.length || present.some(folder => folder.parentId !== parentId)) {
      transaction.abort()
      throw new Error('reorderFolders: all ids must be siblings')
   }
   present.forEach((folder, index) => { folder.sortOrder = index; store.put(folder) })
   await transactionDone(transaction)
}

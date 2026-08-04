// ###############################################################################################
// # TEMPLATE STORE                                                                              #
// #                                                                                             #
// # IndexedDB CRUD for user-saved document templates, keyed by id in the `templates` store       #
// # (added to the self-healing binder schema in binderDatabase.ts). Built-in templates          #
// # (documentTemplate.BUILT_IN_TEMPLATES) live in code and are NOT stored here; the picker merges #
// # them ahead of what this returns. This is the same thin async shape as binderDocuments.ts.    #
// ###############################################################################################

// -- Lib Imports --
import { openDatabase, requestToPromise, transactionDone, TEMPLATES_STORE } from './binderDatabase'
import type { DocumentTemplate } from './documentTemplate'

/** Create or overwrite a user template. */
export async function saveTemplate(template: DocumentTemplate): Promise<void> {
   const database    = await openDatabase()
   const transaction = database.transaction(TEMPLATES_STORE, 'readwrite')
   transaction.objectStore(TEMPLATES_STORE).put(template)
   await transactionDone(transaction)
}

/** All user templates, newest-updated first. */
export async function listTemplates(): Promise<DocumentTemplate[]> {
   const database    = await openDatabase()
   const transaction = database.transaction(TEMPLATES_STORE, 'readonly')
   const all = await requestToPromise(transaction.objectStore(TEMPLATES_STORE).getAll() as IDBRequest<DocumentTemplate[]>)
   return all.sort((first, second) => second.updatedAt - first.updatedAt)
}

/** One user template by id, or null when it does not exist. */
export async function loadTemplate(id: string): Promise<DocumentTemplate | null> {
   const database    = await openDatabase()
   const transaction = database.transaction(TEMPLATES_STORE, 'readonly')
   const result = await requestToPromise(transaction.objectStore(TEMPLATES_STORE).get(id) as IDBRequest<DocumentTemplate | undefined>)
   return result ?? null
}

/** Delete a user template. */
export async function deleteTemplate(id: string): Promise<void> {
   const database    = await openDatabase()
   const transaction = database.transaction(TEMPLATES_STORE, 'readwrite')
   transaction.objectStore(TEMPLATES_STORE).delete(id)
   await transactionDone(transaction)
}

/** Rename a user template (touches updatedAt). No-op if it does not exist. */
export async function renameTemplate(id: string, name: string, now: number): Promise<void> {
   const database    = await openDatabase()
   const transaction = database.transaction(TEMPLATES_STORE, 'readwrite')
   const store    = transaction.objectStore(TEMPLATES_STORE)
   const existing = await requestToPromise(store.get(id) as IDBRequest<DocumentTemplate | undefined>)
   if (existing) store.put({ ...existing, name, updatedAt: now })
   await transactionDone(transaction)
}

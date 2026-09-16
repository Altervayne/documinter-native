// ###############################################################################################
// # BINDER BACKEND                                                                              #
// #                                                                                             #
// # The persistence seam. The whole app talks to one BinderBackend interface, so the storage    #
// # engine can be swapped without touching a single call site. createIndexedDbBackend delegates #
// # over the binder*.ts / templateStore.ts / binderBackup.ts free functions, which hold the     #
// # IndexedDB logic. The filesystem backend implements the same interface against files + a     #
// # rebuildable index.                                                                          #
// ###############################################################################################

// -- Lib Imports --
import {
   saveDocument, loadDocument, listDocuments, getDocumentFolderId,
   deleteDocument, duplicateDocument, moveDocument, reorderDocuments,
   backfillSearchText,
} from './binderDocuments'
import {
   getFolder, createFolder, renameFolder, deleteFolder,
   listAllFolders, getFolderChildren, getFolderAncestors, moveFolder, reorderFolders,
} from './binderFolders'
import { saveTemplate, listTemplates, renameTemplate, deleteTemplate } from './templateStore'
import { collectBinderForTin, collectFolderSubtreeForTin, importTin } from './binderBackup'

// -- Type Imports --
import type { DocState, BinderDocumentRecord, BinderFolderRecord } from '../types'
import type { DocPresentation, LoadedDocument } from './binderDocuments'
import type { DocumentListFilter } from './binderSearch'
import type { DocumentTemplate } from './documentTemplate'
import type { TinFile } from './tinFile'
import type { TinImportSummary } from './binderBackup'

/** An external content change the UI reconciles by re-querying. IndexedDB never fires one; the
 *  filesystem backend fires on Explorer add / change / delete / move / rename. Coarse on purpose. */
export type BinderChange =
   | { kind: 'documents' }
   | { kind: 'folders' }
   | { kind: 'templates' }
   | { kind: 'all' }

/**
 * The persistence surface every backend implements. Operations are whole and atomic; no transaction,
 * store handle, or cursor crosses the seam. The light / heavy split holds: listDocuments returns
 * metadata records (no sections, no base64), loadDocument / saveDocument move the full content.
 */
export interface BinderBackend {
   // ===== DOCUMENTS =====
   /** Upsert. A new id is minted when existingId is absent; a new document appends to targetFolderId
    *  (default root). Writes the light record + heavy content together. */
   saveDocument(state: DocState, presentation: DocPresentation, existingId?: string, targetFolderId?: string): Promise<string>
   /** Full editable read (runs the read-time migrators). touch bumps lastOpenedAt unless touch:false. */
   loadDocument(id: string, options?: { touch?: boolean }): Promise<LoadedDocument | null>
   /** Light records only, filtered by folder + searched + sorted. No heavy content. */
   listDocuments(filter?: DocumentListFilter): Promise<BinderDocumentRecord[]>
   getDocumentFolderId(id: string): Promise<string | null>
   deleteDocument(id: string): Promise<void>
   duplicateDocument(id: string): Promise<string>
   moveDocument(id: string, targetFolderId: string): Promise<void>
   reorderDocuments(orderedIds: string[]): Promise<void>

   // ===== FOLDERS =====
   getFolder(id: string): Promise<BinderFolderRecord | null>
   createFolder(parentId: string, name: string): Promise<string>
   renameFolder(id: string, name: string): Promise<void>
   deleteFolder(id: string, options?: { recursive?: boolean }): Promise<string[]>
   listAllFolders(): Promise<BinderFolderRecord[]>
   getFolderChildren(parentId: string): Promise<BinderFolderRecord[]>
   getFolderAncestors(id: string): Promise<BinderFolderRecord[]>
   moveFolder(id: string, targetParentId: string): Promise<void>
   reorderFolders(orderedIds: string[]): Promise<void>

   // ===== TEMPLATES =====
   saveTemplate(template: DocumentTemplate): Promise<void>
   listTemplates(): Promise<DocumentTemplate[]>
   renameTemplate(id: string, name: string, now: number): Promise<void>
   deleteTemplate(id: string): Promise<void>

   // ===== BULK (Tin) =====
   collectBinderForTin(): Promise<TinFile>
   collectFolderSubtreeForTin(rootFolderId: string): Promise<TinFile>
   importTin(tin: TinFile, mode: 'merge' | 'replace', targetFolderId?: string): Promise<TinImportSummary>

   // ===== IndexedDB-ONLY MIGRATION =====
   /** Populate contentText on pre-full-text-search records (one-time, idempotent). IndexedDB-only:
    *  the filesystem backend builds its index fresh, so it no-ops this. */
   backfillSearchText(): Promise<number>

   // ===== REACTIVITY + LIFECYCLE =====
   /** External-change subscription. Returns an unsubscribe. The IndexedDB backend never fires. */
   subscribe(listener: (change: BinderChange) => void): () => void
   /** Release resources on Binder switch / app close. IndexedDB is a no-op. */
   dispose(): Promise<void>
}

/**
 * The IndexedDB backend: thin delegation over the binder*.ts / templateStore.ts / binderBackup.ts
 * functions. Two boundary normalizations differ from a pass-through (createFolder arg order,
 * getFolder undefined -> null); the rest forward verbatim. subscribe / dispose are inert.
 */
export function createIndexedDbBackend(): BinderBackend {
   return {
      // ===== DOCUMENTS =====
      saveDocument,
      loadDocument,
      listDocuments,
      getDocumentFolderId,
      deleteDocument,
      duplicateDocument,
      moveDocument,
      reorderDocuments,

      // ===== FOLDERS =====
      getFolder: async (id: string) => (await getFolder(id)) ?? null,
      createFolder: (parentId: string, name: string) => createFolder(name, parentId),
      renameFolder,
      deleteFolder,
      listAllFolders,
      getFolderChildren,
      getFolderAncestors,
      moveFolder,
      reorderFolders,

      // ===== TEMPLATES =====
      saveTemplate,
      listTemplates,
      renameTemplate,
      deleteTemplate,

      // ===== BULK (Tin) =====
      collectBinderForTin,
      collectFolderSubtreeForTin,
      importTin,

      // ===== IndexedDB-ONLY MIGRATION =====
      backfillSearchText,

      // ===== REACTIVITY + LIFECYCLE =====
      subscribe: () => () => {},
      dispose: () => Promise.resolve(),
   }
}

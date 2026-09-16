// ###############################################################################################
// # BINDER BACKEND                                                                              #
// #                                                                                             #
// # The persistence seam. The whole app talks to one BinderBackend interface, so the storage    #
// # engine stays behind a single boundary. The filesystem backend implements it against `.mint` #
// # files + a rebuildable index; the interface keeps that swappable.                            #
// ###############################################################################################

// -- Type Imports --
import type { DocState, BinderDocumentRecord, BinderFolderRecord } from '../types'
import type { DocPresentation, LoadedDocument } from './documentRecord'
import type { DocumentListFilter } from './binderSearch'
import type { DocumentTemplate } from './documentTemplate'
import type { TinFile } from './tinFile'
import type { TinImportSummary } from './tinMapping'

/** An external content change the UI reconciles by re-querying. The filesystem backend fires on
 *  Explorer add / change / delete / move / rename. Coarse on purpose. */
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
   /** The single light record by id, null when gone. The cheap read behind the open-tab external-change
    *  check: it compares this record's updatedAt to the version a tab last synced to. */
   getDocumentRecord(id: string): Promise<BinderDocumentRecord | null>
   getDocumentFolderId(id: string): Promise<string | null>
   /** The document id stored at a Binder-relative path, or null. Backs the `.mint` file-association
    *  open (a launched file's path -> its document). A backend with no path model omits it. */
   resolveDocumentByRelativePath?(relativePath: string): Promise<string | null>
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

   // ===== REACTIVITY + LIFECYCLE =====
   /** External-change subscription. Returns an unsubscribe. */
   subscribe(listener: (change: BinderChange) => void): () => void
   /** Release resources on Binder switch / app close. */
   dispose(): Promise<void>
}

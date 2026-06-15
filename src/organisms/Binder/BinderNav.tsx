import { FolderPlus, ChevronLeft, X } from 'lucide-react'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'
import type { BinderFolderRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { BinderNavFolder } from './BinderNavFolder'

/** Folders don't shift during a drag, zone detection drives the nest highlight / reorder line. */
const noopStrategy: SortingStrategy = () => null

export type FolderDropZone = 'before' | 'after' | 'nest'
export interface FolderDropTarget { id: string; zone: FolderDropZone }

interface BinderNavProps {
   currentFolder:        BinderFolderRecord | null   // null = root ("All Documents")
   subfolders:           BinderFolderRecord[]
   folderDocumentCounts: Record<string, number>
   selectedFolderId:     string | null
   editingFolderId:      string | null
   isDocumentDragging:   boolean
   draggingDocFolderId:  string | null   // folderId of the doc being dragged (its own folder isn't a drop target)
   folderDropTarget:     FolderDropTarget | null   // during a folder drag: the hovered row + zone
   rootRef?:             React.RefObject<HTMLDivElement | null>      // for drag-over-nav detection
   backRef?:             React.RefObject<HTMLButtonElement | null>   // Back button, up-drop hit target
   isUpTarget?:          boolean   // a dragged card is hovering the Back button (up-drop)
   isDragging?:          boolean   // any drag in progress, shows the Cancel-move dropzone
   cancelRef?:           React.RefObject<HTMLDivElement | null>      // Cancel-move zone hit target
   isCancelTarget?:      boolean   // the cursor is over the Cancel-move dropzone
   onNavigateUp:         () => void                  // go up one level (to the parent folder)
   onSelectFolder:       (id: string | null) => void
   onEnterFolder:        (folder: BinderFolderRecord) => void
   onNewFolder:          () => void
   onFolderMenu:         (folder: BinderFolderRecord, event: React.MouseEvent) => void
   onCommitRename:       (id: string, name: string) => void
   onCancelRename:       () => void
}

/**
 * Left-hand drill-down folder panel (fixed 240px). Lists the current folder's immediate
 * subfolders (flat, no nesting); double-click a folder to enter it. "New folder" creates
 * a subfolder of the current folder and enters inline rename.
 */
export function BinderNav({
   currentFolder, subfolders, folderDocumentCounts, selectedFolderId, editingFolderId, isDocumentDragging,
   draggingDocFolderId, folderDropTarget, rootRef, backRef, isUpTarget, isDragging, cancelRef, isCancelTarget,
   onNavigateUp, onSelectFolder, onEnterFolder, onNewFolder, onFolderMenu, onCommitRename, onCancelRename,
}: BinderNavProps) {
   const { t } = useLang()

   return (
      <div ref={rootRef} className="w-60 shrink-0 flex flex-col min-h-0 border-r border-border bg-raised/40">
         {/* Header: at root, a static label; inside a folder, a Back button (also an up-drop target). */}
         {currentFolder ? (
            <button
               ref={backRef}
               type="button"
               onClick={onNavigateUp}
               className={`flex w-full items-center gap-1.5 px-3 py-2.5 border-b border-border text-xs font-semibold transition-colors cursor-pointer ${
                  isUpTarget ? 'bg-accent/15 ring-1 ring-inset ring-accent text-accent' : 'text-muted hover:text-text hover:bg-accent/10'
               }`}
            >
               <ChevronLeft size={14} className="shrink-0" />
               <span className="truncate">{currentFolder.name}</span>
            </button>
         ) : (
            <div className="px-3 py-2.5 border-b border-border text-xs font-semibold text-muted truncate">
               {t.binderAllDocuments}
            </div>
         )}

         <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
            <SortableContext items={subfolders.map(folder => `folder:${folder.id}`)} strategy={noopStrategy}>
               {subfolders.map(folder => {
                  const isFolderTarget = folderDropTarget?.id === folder.id
                  return (
                  <BinderNavFolder
                     key={folder.id}
                     folder={folder}
                     documentCount={folderDocumentCounts[folder.id] ?? 0}
                     isSelected={selectedFolderId === folder.id}
                     isEditing={editingFolderId === folder.id}
                     isDocumentDragging={isDocumentDragging}
                     isSourceFolder={draggingDocFolderId === folder.id}
                     nestHighlight={isFolderTarget && folderDropTarget!.zone === 'nest'}
                     reorderEdge={isFolderTarget && folderDropTarget!.zone !== 'nest' ? folderDropTarget!.zone : null}
                     onSelect={() => onSelectFolder(folder.id)}
                     onEnter={() => onEnterFolder(folder)}
                     onContextMenu={event => onFolderMenu(folder, event)}
                     onMoreClick={event => onFolderMenu(folder, event)}
                     onCommitRename={name => onCommitRename(folder.id, name)}
                     onCancelRename={onCancelRename}
                  />
                  )
               })}
            </SortableContext>
            {subfolders.length === 0 ? (
               /* No subfolders → a prominent "create a folder" call to action (the New-folder
                  button blown up, since there's nothing else to anchor it to). */
               <button
                  type="button"
                  onClick={onNewFolder}
                  className="group/empty mt-1 w-full flex flex-col items-center gap-2.5 px-3 py-6 rounded-lg border border-dashed border-accent/30 hover:border-accent/50 hover:bg-accent/8 text-center transition-colors cursor-pointer"
               >
                  <FolderPlus size={26} className="text-accent/40 group-hover/empty:text-accent/70 transition-colors" />
                  <span className="flex flex-col gap-0.5">
                     <span className="text-sm font-medium text-muted">{t.binderNoFolders}</span>
                     <span className="text-xs font-medium text-accent/70">{t.binderNoFoldersHint}</span>
                  </span>
               </button>
            ) : (
               /* New folder, sticks to the bottom of the scrolling list (like the workspace
                  "Add section" button), always in view but scrolls with content as needed. */
               <div className="sticky bottom-0 mt-1 bg-raised/40">
                  <button
                     type="button"
                     onClick={onNewFolder}
                     className="w-full flex items-center justify-center gap-2 px-2 py-1.5 text-xs font-medium text-accent/60 hover:text-accent hover:bg-accent/8 rounded-md border border-dashed border-accent/30 hover:border-accent/50 transition-colors cursor-pointer"
                  >
                     <FolderPlus size={13} />
                     {t.binderNewFolder}
                  </button>
               </div>
            )}
         </div>

         {/* Cancel-move dropzone, appears at the foot of the nav during any drag; dropping here
             aborts the move (detected by cursor geometry in the binder, like the Back button). */}
         {isDragging && (
            <div
               ref={cancelRef}
               className={`binder-cancel-zone shrink-0 m-1.5 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-dashed text-xs font-medium transition-colors ${
                  isCancelTarget ? 'border-red bg-red/10 text-red' : 'border-border/70 text-muted/70'
               }`}
            >
               <X size={13} />
               {t.binderCancelMove}
            </div>
         )}
      </div>
   )
}

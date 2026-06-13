import { FolderPlus, ChevronLeft } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BinderFolderRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { BinderNavFolder } from './BinderNavFolder'

interface BinderNavProps {
   currentFolder:        BinderFolderRecord | null   // null = root ("All Documents")
   subfolders:           BinderFolderRecord[]
   folderDocumentCounts: Record<string, number>
   selectedFolderId:     string | null
   editingFolderId:      string | null
   isDocumentDragging:   boolean
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
 * subfolders (flat — no nesting); double-click a folder to enter it. "New folder" creates
 * a subfolder of the current folder and enters inline rename.
 */
export function BinderNav({
   currentFolder, subfolders, folderDocumentCounts, selectedFolderId, editingFolderId, isDocumentDragging,
   onNavigateUp, onSelectFolder, onEnterFolder, onNewFolder, onFolderMenu, onCommitRename, onCancelRename,
}: BinderNavProps) {
   const { t } = useLang()

   return (
      <div className="w-60 shrink-0 flex flex-col min-h-0 border-r border-border bg-raised/40">
         {/* Header: at root, a static label; inside a folder, a Back button to the parent. */}
         {currentFolder ? (
            <button
               type="button"
               onClick={onNavigateUp}
               className="flex w-full items-center gap-1.5 px-3 py-2.5 border-b border-border text-xs font-semibold text-muted hover:text-text hover:bg-accent/10 transition-colors cursor-pointer"
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
            <SortableContext items={subfolders.map(folder => `folder:${folder.id}`)} strategy={verticalListSortingStrategy}>
               {subfolders.map(folder => (
                  <BinderNavFolder
                     key={folder.id}
                     folder={folder}
                     documentCount={folderDocumentCounts[folder.id] ?? 0}
                     isSelected={selectedFolderId === folder.id}
                     isEditing={editingFolderId === folder.id}
                     isDocumentDragging={isDocumentDragging}
                     onSelect={() => onSelectFolder(folder.id)}
                     onEnter={() => onEnterFolder(folder)}
                     onContextMenu={event => onFolderMenu(folder, event)}
                     onMoreClick={event => onFolderMenu(folder, event)}
                     onCommitRename={name => onCommitRename(folder.id, name)}
                     onCancelRename={onCancelRename}
                  />
               ))}
            </SortableContext>
            {subfolders.length === 0 && (
               <div className="px-2 py-1.5 text-xs text-muted/40 select-none">—</div>
            )}

            {/* New folder — sticks to the bottom of the scrolling list (like the workspace
                "Add section" button), always in view but scrolls with content as needed. */}
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
         </div>
      </div>
   )
}

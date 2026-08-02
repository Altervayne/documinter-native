// -- React Imports --
import { useEffect, useState } from 'react'

// -- Library Imports --
import { createPortal } from 'react-dom'
import { Folder } from 'lucide-react'

// -- Type Imports --
import type { BinderFolderRecord } from '../types'

// -- Lib Imports --
import { getFolderChildren, getFolderAncestors } from '../lib/binderFolders'

// -- Component Imports --
import { BinderBreadcrumb } from '../organisms/Binder/BinderBreadcrumb'
import { Button } from '../atoms/Button'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

interface SaveAsDialogProps {
   initialFolder: BinderFolderRecord | null   // the document's current folder (null = root)
   onConfirm:     (destinationFolderId: string) => void
   onCancel:      () => void
}

const ROOT_FOLDER_ID = '0'

/**
 * Save As dialog: a folder navigator that picks where the copy is saved. Drill into the folder tree
 * (the folder shown in the breadcrumb is the destination); the copy keeps the document's own title,
 * the title is part of the document and is renamed in the tab, never here. Reuses BinderBreadcrumb;
 * mirrors ConfirmDialog's portal/backdrop shell.
 */
export function SaveAsDialog({ initialFolder, onConfirm, onCancel }: SaveAsDialogProps) {
   const { t } = useLang()
   const [currentFolder, setCurrentFolder] = useState<BinderFolderRecord | null>(initialFolder)
   const [ancestors,     setAncestors]     = useState<BinderFolderRecord[]>([])
   const [subfolders,    setSubfolders]    = useState<BinderFolderRecord[]>([])

   // Load the shown folder's subfolders (to descend into) + ancestors (for the breadcrumb).
   useEffect(() => {
      let cancelled = false
      const folderId = currentFolder?.id ?? ROOT_FOLDER_ID
      Promise.all([
         getFolderChildren(folderId),
         currentFolder ? getFolderAncestors(currentFolder.id) : Promise.resolve([]),
      ]).then(([children, folderAncestors]) => {
         if (cancelled) return
         setSubfolders(children)
         setAncestors(folderAncestors)
      })
      return () => { cancelled = true }
   }, [currentFolder])

   useEffect(() => {
      function handleKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onCancel()
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [onCancel])

   return createPortal(
      <div
         className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4"
         onMouseDown={onCancel}
      >
         <div
            className="w-full max-w-md rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
            style={{ animation: 'menu-in 120ms ease-out both' }}
            onMouseDown={event => event.stopPropagation()}
         >
            <div className="px-4 pt-4 pb-3">
               <div className="text-sm font-semibold text-text mb-3">{t.saveAsTitle}</div>

               <label className="block text-xs text-muted mb-1">{t.saveAsDestination}</label>
               <div className="rounded border border-border bg-bg">
                  <div className="px-2 py-1.5 border-b border-border">
                     <BinderBreadcrumb ancestors={ancestors} currentFolder={currentFolder} onNavigate={setCurrentFolder} />
                  </div>
                  <div className="flex flex-col max-h-52 overflow-y-auto p-1 gap-1">
                     {subfolders.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted/70 italic">{t.saveAsNoSubfolders}</div>
                     ) : subfolders.map(folder => (
                        <button
                           key={folder.id}
                           type="button"
                           onClick={() => setCurrentFolder(folder)}
                           className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-text/80 hover:text-text hover:bg-accent/10 transition-colors cursor-pointer"
                        >
                           <Folder size={13} className="shrink-0 text-muted" />
                           <span className="truncate">{folder.name}</span>
                        </button>
                     ))}
                  </div>
               </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost" onClick={onCancel}>{t.binderUnsavedCancel}</Button>
               <Button size="sm" variant="primary" onClick={() => onConfirm(currentFolder?.id ?? ROOT_FOLDER_ID)}>{t.saveAsConfirm}</Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

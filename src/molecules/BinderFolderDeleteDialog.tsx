import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../atoms/Button'
import { useLang } from '../contexts/LangContext'

interface BinderFolderDeleteDialogProps {
   /** Confirm the deletion. recursive=true permanently deletes the contents too. */
   onConfirm: (recursive: boolean) => void
   onCancel:  () => void
}

/**
 * Folder-deletion confirm. A checkbox chooses between keeping the contents (the default: documents
 * and subfolders are moved to the root) and recursively deleting everything inside. The warning
 * text tracks the checkbox so the consequence of confirming is always spelled out.
 */
export function BinderFolderDeleteDialog({ onConfirm, onCancel }: BinderFolderDeleteDialogProps) {
   const { t } = useLang()
   const [recursive, setRecursive] = useState(false)

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onCancel()
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onCancel])

   return createPortal(
      <div
         className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4"
         onMouseDown={onCancel}
      >
         <div
            className="w-full max-w-sm rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
            style={{ animation: 'menu-in 120ms ease-out both' }}
            onMouseDown={event => event.stopPropagation()}
         >
            <div className="px-4 pt-4 pb-3">
               <div className="text-sm font-semibold text-text mb-1.5">{t.binderDeleteFolder}</div>
               <div className="text-sm text-muted leading-relaxed mb-3">
                  {recursive ? t.binderDeleteFolderRecursiveWarning : t.binderDeleteFolderWarning}
               </div>
               <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                     type="checkbox"
                     checked={recursive}
                     onChange={event => setRecursive(event.target.checked)}
                     className="mt-0.5 cursor-pointer"
                     style={{ accentColor: 'var(--color-red)' }}
                  />
                  <span className="text-sm text-text leading-snug">{t.binderDeleteFolderRecursive}</span>
               </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost"  onClick={onCancel}>{t.binderUnsavedCancel}</Button>
               <Button size="sm" variant="danger" onClick={() => onConfirm(recursive)}>{t.binderDelete}</Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

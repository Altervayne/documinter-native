import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../atoms/Button'
import { useLang } from '../contexts/LangContext'

interface DiskConflictDialogProps {
   /** The conflicting document's title, woven into the body copy. */
   title:      string
   onKeepMine: () => void
   onLoadDisk: () => void
}

/** Shown when a document open in a tab with unsaved edits was also changed on disk. Forces a deliberate
 *  choice between the in-tab edits and the disk version. Escape keeps the in-tab edits (the safe default). */
export function DiskConflictDialog({ title, onKeepMine, onLoadDisk }: DiskConflictDialogProps) {
   const { t } = useLang()

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onKeepMine()
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onKeepMine])

   return createPortal(
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4">
         <div
            className="w-full max-w-sm rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
            style={{ animation: 'menu-in 120ms ease-out both' }}
         >
            <div className="px-4 pt-4 pb-3">
               <div className="text-sm font-semibold text-text mb-1.5">{t.diskConflictTitle}</div>
               <div className="text-sm text-muted leading-relaxed">{t.diskConflictBody.replace('{title}', title)}</div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost" onClick={onLoadDisk}>{t.diskConflictLoadDisk}</Button>
               <Button size="sm" variant="primary" onClick={onKeepMine}>{t.diskConflictKeepMine}</Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

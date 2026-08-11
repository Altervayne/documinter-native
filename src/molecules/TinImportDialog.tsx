import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { GitMerge, RefreshCw } from 'lucide-react'
import { Button } from '../atoms/Button'
import { useLang } from '../contexts/LangContext'

interface TinImportDialogProps {
   /** Counts from the parsed Tin's own arrays, shown so the user knows what is in the bundle. */
   templates:  number
   folders:    number
   documents:  number
   onMerge:    () => void
   onReplace:  () => void
   onCancel:   () => void
}

/**
 * Import-mode chooser for a Tin: Merge (graft the bundle into the current binder) or Replace (wipe
 * the binder and restore the Tin). Same portal + backdrop chrome as ConfirmDialog, but with two
 * described option rows instead of one confirm button; Replace is a destructive step, so it hands
 * off to a second confirmation rather than acting here. Backdrop click and Escape cancel.
 */
export function TinImportDialog({ templates, folders, documents, onMerge, onReplace, onCancel }: TinImportDialogProps) {
   const { t } = useLang()

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onCancel()
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onCancel])

   const counts = t.tinImportModeCounts
      .replace('{templates}', String(templates))
      .replace('{folders}',   String(folders))
      .replace('{documents}', String(documents))

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
               <div className="text-sm font-semibold text-text mb-1">{t.tinImportModeTitle}</div>
               <div className="text-xs font-mono text-muted">{counts}</div>
            </div>

            <div className="flex flex-col gap-2 px-4 pb-2">
               <button
                  type="button"
                  onClick={onMerge}
                  className="flex items-start gap-2.5 rounded-md border border-border p-3 text-left
                     transition-colors cursor-pointer hover:border-accent/50 hover:bg-accent/5"
               >
                  <GitMerge size={15} className="text-accent shrink-0 mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                     <span className="text-sm font-medium text-text">{t.tinImportMergeLabel}</span>
                     <span className="text-xs text-muted leading-relaxed">{t.tinImportMergeDescription}</span>
                  </span>
               </button>

               <button
                  type="button"
                  onClick={onReplace}
                  className="flex items-start gap-2.5 rounded-md border border-border p-3 text-left
                     transition-colors cursor-pointer hover:border-red/50 hover:bg-red/5"
               >
                  <RefreshCw size={15} className="text-red shrink-0 mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                     <span className="text-sm font-medium text-text">{t.tinImportReplaceLabel}</span>
                     <span className="text-xs text-muted leading-relaxed">{t.tinImportReplaceDescription}</span>
                  </span>
               </button>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost" onClick={onCancel}>{t.tinImportCancel}</Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

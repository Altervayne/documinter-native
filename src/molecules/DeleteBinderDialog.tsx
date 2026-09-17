/*
 * The severe "delete this Binder" confirmation. Portaled modal (z above the menus / windows). The delete
 * button stays disabled until the user types the Binder's exact name, since this erases the whole folder
 * and every document in it from disk, with no undo.
 */

// -- React Imports --
import { useState } from 'react'
import { createPortal } from 'react-dom'

// -- Icon Imports --
import { AlertTriangle } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

interface DeleteBinderDialogProps {
   binderName: string
   binderPath: string
   busy?: boolean
   onConfirm: () => void
   onCancel: () => void
}

export function DeleteBinderDialog({ binderName, binderPath, busy, onConfirm, onCancel }: DeleteBinderDialogProps) {
   const { t } = useLang()
   const [typed, setTyped] = useState('')
   const confirmed = typed === binderName

   return createPortal(
      <div
         className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
         onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}
         onKeyDown={event => { if (event.key === 'Escape') onCancel() }}
      >
         <div
            className="w-full max-w-md rounded-lg border border-border bg-raised shadow-xl"
            style={{ animation: 'menu-in 120ms ease-out both' }}
         >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[var(--callout-danger-accent)]">
               <AlertTriangle size={18} className="shrink-0" />
               <h2 className="font-semibold">{t.deleteBinderTitle}</h2>
            </div>

            <div className="px-4 py-3 text-sm text-muted">
               <p>{t.deleteBinderWarning.replace('{name}', binderName)}</p>
               <p className="mt-2 truncate rounded border border-border bg-el px-2 py-1 text-xs" title={binderPath}>{binderPath}</p>

               <label className="mt-4 block text-xs font-medium text-text">
                  {t.deleteBinderConfirmLabel.replace('{name}', binderName)}
               </label>
               <input
                  type="text"
                  value={typed}
                  autoFocus
                  spellCheck={false}
                  onChange={event => setTyped(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter' && confirmed && !busy) onConfirm() }}
                  placeholder={binderName}
                  className="mt-1 w-full rounded border border-border bg-el px-2 py-1.5 text-sm text-text outline-none focus:border-[var(--callout-danger-accent)]"
               />
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
               <button
                  type="button"
                  onClick={onCancel}
                  className="rounded border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-el hover:text-text cursor-pointer"
               >
                  {t.deleteBinderCancel}
               </button>
               <button
                  type="button"
                  onClick={onConfirm}
                  disabled={!confirmed || busy}
                  className="rounded bg-[var(--callout-danger-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
               >
                  {t.deleteBinderConfirm}
               </button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

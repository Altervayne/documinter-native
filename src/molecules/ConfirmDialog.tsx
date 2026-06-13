import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../atoms/Button'

interface ConfirmDialogProps {
   title:        string
   message:      string
   confirmLabel: string
   cancelLabel:  string
   onConfirm:    () => void
   onCancel:     () => void
   /** Render the confirm action in the danger style (for destructive confirmations). */
   danger?:      boolean
}

/**
 * Generic confirmation modal. Portal-rendered, centered over a dimmed backdrop.
 * Backdrop click and Escape both cancel.
 */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel, danger }: ConfirmDialogProps) {
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
               <div className="text-sm font-semibold text-text mb-1.5">{title}</div>
               <div className="text-sm text-muted leading-relaxed">{message}</div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
               <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

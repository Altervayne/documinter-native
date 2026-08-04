// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Library Imports --
import { createPortal } from 'react-dom'

// -- Component Imports --
import { Button } from '../atoms/Button'

interface PromptDialogProps {
   title:         string
   label:         string
   initialValue?: string
   placeholder?:  string
   confirmLabel:  string
   cancelLabel:   string
   onConfirm:     (value: string) => void
   onCancel:      () => void
}

/**
 * A single-line text-input modal (name this thing / rename this thing). Portal-rendered over a
 * dimmed backdrop like ConfirmDialog; the input auto-focuses and selects its initial value on
 * mount, Enter confirms a non-empty (trimmed) value, Escape and backdrop-click cancel. Confirm is
 * disabled while the field is blank.
 */
export function PromptDialog({ title, label, initialValue = '', placeholder, confirmLabel, cancelLabel, onConfirm, onCancel }: PromptDialogProps) {
   const [value, setValue] = useState(initialValue)
   const inputRef = useRef<HTMLInputElement>(null)

   useEffect(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
   }, [])

   useEffect(() => {
      function handleKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onCancel()
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [onCancel])

   const trimmed = value.trim()
   function confirm() {
      if (trimmed) onConfirm(trimmed)
   }

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
               <div className="text-sm font-semibold text-text mb-3">{title}</div>
               <label className="block text-xs text-muted mb-1">{label}</label>
               <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  placeholder={placeholder}
                  onChange={event => setValue(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); confirm() } }}
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text outline-none focus:border-accent transition-colors"
               />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
               <Button size="sm" variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
               <Button
                  size="sm"
                  variant="primary"
                  onClick={confirm}
                  disabled={!trimmed}
                  className="disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
               >
                  {confirmLabel}
               </Button>
            </div>
         </div>
      </div>,
      document.body,
   )
}

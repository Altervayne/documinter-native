import { useEffect, useRef, useState } from 'react'
import type { DocMeta, Section } from '../types'

// #########
// # TYPES #
// #########

export interface RawEditorOptions {
   sections:  Section[]
   meta:      DocMeta
   onCommit:  (sections: Section[], meta: DocMeta) => void
   /** Must be a stable module-level reference (excluded from the sync effect's deps). */
   serialize: (sections: Section[], meta: DocMeta) => string
   /** Must be a stable module-level reference (excluded from the sync effect's deps). */
   parse:     (source: string) => { sections: Section[], meta: DocMeta }
}

export interface RawEditorResult {
   text:          string
   handleChange:  (event: React.ChangeEvent<HTMLTextAreaElement>) => void
   handleFocus:   () => void
   handleBlur:    () => void
   handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

// ########
// # HOOK #
// ########

/**
 * Shared debounce + sync contract for raw text editors (Markdown). While isActiveWriterRef is true
 * (focused or typing) external sections/meta changes are ignored, so the other panel can't overwrite
 * the textarea mid-keystroke. serialize/parse must be stable module-level refs (excluded from the sync
 * effect's deps); onCommit only fires from event handlers, so its identity churn is harmless.
 */
export function useRawEditor({
   sections,
   meta,
   onCommit,
   serialize,
   parse,
}: RawEditorOptions): RawEditorResult {

   const [localText, setLocalText] = useState<string>(
      () => serialize(sections, meta)
   )

   // Always-current mirror of localText, read inside the debounce callback to dodge a stale closure.
   const localTextRef = useRef(localText)

   const isActiveWriterRef = useRef(false)

   const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

   // ==============
   //  External sync
   // ==============
   useEffect(() => {
      if (isActiveWriterRef.current) return
      const fresh = serialize(sections, meta)
      localTextRef.current = fresh
      setLocalText(fresh)
   }, [sections, meta]) // eslint-disable-line react-hooks/exhaustive-deps

   // ===================
   //  Cleanup on unmount
   // ===================
   useEffect(() => {
      return () => {
         if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current)
         }
      }
   }, [])

   // ===============
   //  Event handlers
   // ===============

   function handleFocus(): void {
      isActiveWriterRef.current = true
   }

   function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
      const newValue = event.target.value
      localTextRef.current = newValue
      setLocalText(newValue)

      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)

      debounceTimerRef.current = setTimeout(() => {
         debounceTimerRef.current = null
         const result = parse(localTextRef.current)
         onCommit(result.sections, result.meta)
      }, 300)
   }

   function handleBlur(): void {
      isActiveWriterRef.current = false
      if (debounceTimerRef.current !== null) {
         clearTimeout(debounceTimerRef.current)
         debounceTimerRef.current = null
      }
      const result = parse(localTextRef.current)
      onCommit(result.sections, result.meta)
   }

   function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
      if (event.key === 'Tab') {
         event.preventDefault()
         const textarea = event.currentTarget
         const start    = textarea.selectionStart
         const end      = textarea.selectionEnd
         const newValue =
            localTextRef.current.slice(0, start) +
            '  ' +
            localTextRef.current.slice(end)
         localTextRef.current = newValue
         setLocalText(newValue)
         // Defer cursor reset until React has flushed the value update to the DOM.
         requestAnimationFrame(() => {
            textarea.selectionStart = start + 2
            textarea.selectionEnd   = start + 2
         })
      } else if (event.key === 'Escape') {
         event.currentTarget.blur()
      }
   }

   return { text: localText, handleChange, handleFocus, handleBlur, handleKeyDown }
}

import { useEffect, useRef, useState } from 'react'
import type { DocMeta, Section } from '../types'

// #########
// # TYPES #
// #########

export interface RawEditorOptions {
   sections:  Section[]
   meta:      DocMeta
   onCommit:  (sections: Section[], meta: DocMeta) => void
   /** Converts document state to raw text. Must be a stable reference (module-level function). */
   serialize: (sections: Section[], meta: DocMeta) => string
   /** Converts raw text back to document state. Must be a stable reference (module-level function). */
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
 * Shared debounce + sync contract for raw text editors (Markdown, Mintdown).
 *
 * Sync invariant: while `isActiveWriterRef` is true (user is typing or focused),
 * external `sections`/`meta` prop changes are silently ignored. This prevents
 * the other panel from overwriting the textarea mid-keystroke.
 *
 * `serialize` and `parse` are expected to be stable module-level function
 * references. They are intentionally excluded from useEffect dependency arrays.
 * Do not pass inline functions or the external-sync effect would need updating.
 *
 * `onCommit` is only called from event handlers, never from a useEffect
 * dependency array, so reference churn on the caller side has no correctness impact.
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

   // Always-current mirror of localText — read inside debounce callbacks to
   // avoid capturing a stale closure.
   const localTextRef = useRef(localText)

   // When true, external sections/meta prop changes do NOT overwrite the textarea.
   const isActiveWriterRef = useRef(false)

   // Handle for the pending debounce timer.
   const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

   // ==============
   //  External sync
   // ==============
   // Re-derive text from parent state whenever sections/meta change,
   // provided the user is not currently focused in the textarea.
   // serialize/parse are stable module-level refs, intentionally omitted from deps.
   useEffect(() => {
      if (isActiveWriterRef.current) return
      const fresh = serialize(sections, meta)
      localTextRef.current = fresh
      setLocalText(fresh)
   }, [sections, meta]) // eslint-disable-line react-hooks/exhaustive-deps

   // ===================
   //  Cleanup on unmount
   // ===================
   // Cancels any pending debounce so it does not fire after the component unmounts.
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

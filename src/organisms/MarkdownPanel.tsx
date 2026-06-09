import { useEffect, useRef, useState } from 'react'
import type { DocMeta, Section } from '../types'
import { documentToMarkdown, markdownToDocument } from '../lib/markdown'

// ============================================================
// Types
// ============================================================

interface MarkdownPanelProps {
   sections: Section[]
   meta:     DocMeta
   onCommit: (sections: Section[], meta: DocMeta) => void
}

// ============================================================
// Component
// ============================================================

/**
 * A full-height textarea that mirrors the document state as a Markdown string.
 *
 * Editing behaviour:
 *   - Changes are debounced 300 ms then committed via onCommit.
 *   - Blur flushes any pending debounce immediately.
 *   - Tab key inserts two spaces at the cursor position.
 *   - Escape blurs the textarea.
 *
 * Sync behaviour:
 *   - When sections/meta change externally (e.g. from the WYSIWYG editor),
 *     the textarea is recomputed from the new state — but only when the user
 *     is NOT actively writing (isActiveWriterRef gate).
 *   - localMarkdownRef always mirrors the latest textarea value so that the
 *     debounced commit callback never captures a stale closure.
 */
export function MarkdownPanel({ sections, meta, onCommit }: MarkdownPanelProps) {
   const [localMarkdown, setLocalMarkdown] = useState<string>(
      () => documentToMarkdown(sections, meta)
   )

   // Always-current mirror of localMarkdown for use inside debounce callbacks.
   const localMarkdownRef = useRef(localMarkdown)

   // When true, external prop changes do NOT overwrite the textarea.
   const isActiveWriterRef = useRef(false)

   // Active debounce timer handle.
   const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

   // ── External sync ──────────────────────────────────────────
   // Re-derive markdown from parent state whenever sections/meta change,
   // provided the user is not currently typing.
   useEffect(() => {
      if (isActiveWriterRef.current) return
      const fresh = documentToMarkdown(sections, meta)
      localMarkdownRef.current = fresh
      setLocalMarkdown(fresh)
   }, [sections, meta])

   // ── Cleanup on unmount ─────────────────────────────────────
   useEffect(() => {
      return () => {
         if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current)
         }
      }
   }, [])

   // ── Helpers ────────────────────────────────────────────────

   function performCommit(source: string): void {
      const result = markdownToDocument(source)
      onCommit(result.sections, result.meta)
   }

   // ── Event handlers ─────────────────────────────────────────

   function handleFocus(): void {
      isActiveWriterRef.current = true
   }

   function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
      const newValue = event.target.value
      localMarkdownRef.current = newValue
      setLocalMarkdown(newValue)

      if (debounceTimerRef.current !== null) {
         clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
         debounceTimerRef.current = null
         performCommit(localMarkdownRef.current)
      }, 300)
   }

   function handleBlur(): void {
      isActiveWriterRef.current = false
      if (debounceTimerRef.current !== null) {
         clearTimeout(debounceTimerRef.current)
         debounceTimerRef.current = null
      }
      performCommit(localMarkdownRef.current)
   }

   function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
      if (event.key === 'Tab') {
         event.preventDefault()
         const textarea = event.currentTarget
         const start    = textarea.selectionStart
         const end      = textarea.selectionEnd
         const newValue =
            localMarkdownRef.current.slice(0, start) +
            '  ' +
            localMarkdownRef.current.slice(end)
         localMarkdownRef.current = newValue
         setLocalMarkdown(newValue)
         // Restore cursor after the two inserted spaces.
         requestAnimationFrame(() => {
            textarea.selectionStart = start + 2
            textarea.selectionEnd   = start + 2
         })
      } else if (event.key === 'Escape') {
         event.currentTarget.blur()
      }
   }

   // ── Render ─────────────────────────────────────────────────

   return (
      <div className="h-full flex flex-col bg-surface overflow-hidden">
         <textarea
            className={[
               'flex-1 w-full h-full resize-none',
               'bg-transparent text-text text-sm font-mono leading-relaxed',
               'p-5 focus:outline-none',
               'placeholder:text-muted/40',
            ].join(' ')}
            value={localMarkdown}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="# Markdown…"
         />
      </div>
   )
}

import { useEffect, useLayoutEffect, useRef, type ElementType } from 'react'
import {
   computeCursorPosition,
   domToInlineContent,
   inlineContentEquals,
   isEmptyContent,
   renderInlineContent,
} from '../lib/inline'
import type { CursorPosition, InlineContent } from '../types'

interface RichEditableProps {
   tag?:            ElementType
   content:         InlineContent
   onCommit:        (content: InlineContent) => void
   onCursorChange?: (position: CursorPosition) => void
   spellCheck?:     boolean
   className?:      string
   style?:          React.CSSProperties
   onClick?:        React.MouseEventHandler<HTMLElement>
   onKeyDown?:      (event: React.KeyboardEvent<HTMLElement>) => void
   /** Prevents Enter entirely (single-line fields). */
   singleLine?:     boolean
   /** Shown as greyed italic hint when the field is empty and unfocused. */
   placeholder?:    string
   /** When true, renders a plain static element, no editing, no event handlers. */
   readOnly?:       boolean
}

/**
 * Rich inline-content editor backed by a contentEditable element.
 *
 * Accepts InlineContent as data; emits InlineContent on commit (blur, only if changed).
 * FormatToolbar targets this element via the data-rich="true" attribute.
 *
 * The onCursorChange callback emits a typed CursorPosition derived from the browser
 * Selection API. This is the designated replacement slot for a future custom cursor
 * engine: when that engine arrives, only this component's internals change. Nothing
 * outside the component needs to know how cursor position is tracked.
 */
export function RichEditable({
   tag: Tag = 'p',
   content,
   onCommit,
   onCursorChange,
   spellCheck = true,
   className,
   style,
   onClick,
   onKeyDown,
   singleLine,
   placeholder,
   readOnly,
}: RichEditableProps) {
   const ref             = useRef<HTMLElement>(null)
   const editing         = useRef(false)
   const snapshotOnFocus = useRef<InlineContent>([])

   // ========================
   //  Mount + readOnly toggle
   // ========================
   // Re-runs when readOnly changes because React removes managed children when
   // switching readOnly=true → false, leaving the element blank.
   useLayoutEffect(() => {
      if (!ref.current) return
      ref.current.innerHTML = renderInlineContent(content)
   }, [readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

   // ======================
   //  External content sync
   // ======================
   // Sync from prop only when not actively editing, to avoid clobbering mid-edit.
   useEffect(() => {
      if (!ref.current || editing.current) return
      const rendered = renderInlineContent(content)
      if (ref.current.innerHTML !== rendered) {
         ref.current.innerHTML = rendered
      }
   }, [content])

   // =======================
   //  Cursor change listener
   // =======================
   useEffect(() => {
      if (!onCursorChange || !ref.current) return
      const element = ref.current

      function handleSelectionChange() {
         if (!element) return
         const position = computeCursorPosition(element)
         if (position) onCursorChange!(position)
      }

      document.addEventListener('selectionchange', handleSelectionChange)
      return () => document.removeEventListener('selectionchange', handleSelectionChange)
   }, [onCursorChange])

   // ===============
   //  Read-only path
   // ===============
   if (readOnly) {
      return (
         <Tag
            className={className}
            style={style}
            dangerouslySetInnerHTML={{ __html: renderInlineContent(content) }}
         />
      )
   }

   // ==============
   //  Editable path
   // ==============
   return (
      <Tag
         ref={ref}
         className={className}
         style={style}
         contentEditable
         suppressContentEditableWarning
         spellCheck={spellCheck}
         data-rich="true"
         {...(placeholder && isEmptyContent(content) ? { 'data-placeholder': placeholder } : {})}
         onClick={onClick}
         onFocus={() => {
            editing.current = true
            snapshotOnFocus.current = ref.current ? domToInlineContent(ref.current) : []
         }}
         onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
            // External handler runs first; if it calls preventDefault, skip internal logic
            onKeyDown?.(event)
            if (event.defaultPrevented) return

            if (event.key === 'Enter') {
               if (singleLine) {
                  event.preventDefault()
               } else {
                  // No external handler or Shift+Enter: insert a <br> (paragraph mode)
                  // With external handler, bare Enter is handled externally (e.g. list items)
                  if (!onKeyDown || event.shiftKey) {
                     event.preventDefault()
                     // execCommand is deprecated but remains the only cross-browser way
                     // to insert a <br> without splitting the element in contenteditable
                     document.execCommand('insertLineBreak')
                  } else {
                     event.preventDefault()
                  }
               }
            }
         }}
         onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
            // Always paste as plain text to prevent injecting foreign HTML or styles
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
         }}
         onBlur={(event: React.FocusEvent<HTMLElement>) => {
            editing.current = false
            const currentContent = domToInlineContent(event.currentTarget)
            if (inlineContentEquals(currentContent, snapshotOnFocus.current)) return
            onCommit(currentContent)
         }}
      />
   )
}

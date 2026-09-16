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
   /** Pressed on the read-only element, the click-to-focus hook a split paragraph fragment uses to
    *  reflow itself whole and place the caret. Only wired on the read-only path. */
   onMouseDown?:    React.MouseEventHandler<HTMLElement>
   /** Fired after the editable path commits on blur (whether or not the content changed), so a focused
    *  paragraph can clear its focus state and re-split. */
   onBlur?:         () => void
   /** Fired when the editable path gains focus, so a focused paragraph can be held whole and freeze the
    *  paged re-measure while it is edited. */
   onFocus?:        () => void
   onKeyDown?:      (event: React.KeyboardEvent<HTMLElement>) => void
   /** Prevents Enter entirely (single-line fields). */
   singleLine?:     boolean
   /** Shown as greyed italic hint when the field is empty and unfocused. */
   placeholder?:    string
   /** When true, renders a plain static element, no editing, no event handlers. */
   readOnly?:       boolean
}

/**
 * Rich inline-content editor over a contentEditable element. Accepts InlineContent, emits it on blur
 * only if changed. FormatToolbar targets this element via the data-rich="true" attribute, and
 * onCursorChange emits a typed CursorPosition derived from the Selection API.
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
   onMouseDown,
   onBlur,
   onFocus,
   onKeyDown,
   singleLine,
   placeholder,
   readOnly,
}: RichEditableProps) {
   const ref             = useRef<HTMLElement>(null)
   const editing         = useRef(false)
   const snapshotOnFocus = useRef<InlineContent>([])

   // Repopulate on a readOnly toggle: React removes managed children when readOnly goes true -> false,
   // leaving the element blank.
   useLayoutEffect(() => {
      if (!ref.current) return
      ref.current.innerHTML = renderInlineContent(content)
   }, [readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

   // Sync from the prop only when not actively editing, to avoid clobbering mid-edit.
   useEffect(() => {
      if (!ref.current || editing.current) return
      const rendered = renderInlineContent(content)
      if (ref.current.innerHTML !== rendered) {
         ref.current.innerHTML = rendered
      }
   }, [content])

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

   if (readOnly) {
      return (
         <Tag
            className={className}
            style={style}
            onMouseDown={onMouseDown}
            dangerouslySetInnerHTML={{ __html: renderInlineContent(content) }}
         />
      )
   }

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
            onFocus?.()
         }}
         onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
            // The external handler runs first and can preventDefault to claim the key (e.g. list items).
            onKeyDown?.(event)
            if (event.defaultPrevented) return

            if (event.key === 'Enter') {
               if (singleLine) {
                  event.preventDefault()
               } else {
                  // No external handler or Shift+Enter: insert a <br>. execCommand is deprecated but is
                  // the only cross-browser way to do it without splitting the contenteditable element.
                  if (!onKeyDown || event.shiftKey) {
                     event.preventDefault()
                     document.execCommand('insertLineBreak')
                  } else {
                     event.preventDefault()
                  }
               }
            }
         }}
         onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
            // Plain text only, so no foreign HTML or styles get injected.
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
         }}
         onBlur={(event: React.FocusEvent<HTMLElement>) => {
            editing.current = false
            const currentContent = domToInlineContent(event.currentTarget)
            if (!inlineContentEquals(currentContent, snapshotOnFocus.current)) onCommit(currentContent)
            // After any commit, so a focused paragraph re-splits from its just-committed text.
            onBlur?.()
         }}
      />
   )
}

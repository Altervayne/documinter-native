import { useEffect, useLayoutEffect, useRef, type ElementType } from 'react'
import { sanitizeRichText } from '../lib/helpers'

interface ContentEditableProps {
   tag?: ElementType
   content: string
   onBlur?: (value: string) => void
   spellCheck?: boolean
   className?: string
   style?: React.CSSProperties
   onClick?: React.MouseEventHandler<HTMLElement>
   /** Enables inline formatting toolbar + Enter inserts <br> instead of a block element. */
   rich?: boolean
   /** Prevents Enter key entirely (for single-line fields like titles). */
   singleLine?: boolean
   /** Shown as greyed italic hint when the field is empty and unfocused. */
   placeholder?: string
   /** When true, renders a plain static element — no editing, no event handlers. */
   readOnly?: boolean
}

/**
 * Inline contenteditable element that plays nicely with React.
 *
 * - rich=false (default): innerText mode — plain text, suitable for titles/meta.
 * - rich=true: innerHTML mode — stores HTML with <strong>,<em>,<u>,<s>,<br> only.
 *   Enter inserts a <br>. The FormatToolbar targets elements with data-rich="true".
 * - singleLine=true: prevents Enter entirely (single-line fields).
 */
export function ContentEditable({
   tag: Tag = 'p',
   content,
   onBlur = () => {},
   spellCheck = true,
   className,
   style,
   onClick,
   rich,
   singleLine,
   placeholder,
   readOnly,
}: ContentEditableProps) {
   const ref = useRef<HTMLElement>(null)
   const editing = useRef(false)

   // Mount: set content imperatively
   useLayoutEffect(() => {
      if (!ref.current) return
      if (rich) {
         ref.current.innerHTML = content
      } else {
         ref.current.innerText = content
      }
   }, []) // eslint-disable-line react-hooks/exhaustive-deps

   // External changes: sync only when not actively editing
   useEffect(() => {
      if (!ref.current || editing.current) return
      if (rich) {
         if (ref.current.innerHTML !== content) ref.current.innerHTML = content
      } else {
         if (ref.current.innerText !== content) ref.current.innerText = content
      }
   }, [content, rich])

   if (readOnly) {
      if (rich) return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: content }} />
      return <Tag className={className} style={style}>{content}</Tag>
   }

   return (
      <Tag
         ref={ref}
         className={className}
         style={style}
         contentEditable
         suppressContentEditableWarning
         spellCheck={spellCheck}
         onClick={onClick}
         {...(rich ? { 'data-rich': 'true' } : {})}
         {...(placeholder ? { 'data-placeholder': placeholder } : {})}
         onFocus={() => { editing.current = true }}
         onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
            if (event.key === 'Enter') {
               if (singleLine) {
                  event.preventDefault()
               } else if (rich) {
                  event.preventDefault()
                  // execCommand is deprecated but remains the only cross-browser way
                  // to insert a <br> without splitting the element in contenteditable
                  document.execCommand('insertLineBreak')
               }
            }
         }}
         onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
            // Always paste as plain text to avoid injecting foreign HTML/styles
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
         }}
         onBlur={(event: React.FocusEvent<HTMLElement>) => {
            editing.current = false
            if (rich) {
               onBlur(sanitizeRichText(event.currentTarget.innerHTML))
            } else {
               onBlur(event.currentTarget.innerText)
            }
         }}
      />
   )
}

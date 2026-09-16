import { useEffect, useLayoutEffect, useRef, type ElementType } from 'react'

interface PlainEditableProps {
   tag?: ElementType
   content: string
   onBlur?: (value: string) => void
   spellCheck?: boolean
   className?: string
   style?: React.CSSProperties
   onClick?: React.MouseEventHandler<HTMLElement>
   onContextMenu?: React.MouseEventHandler<HTMLElement>
   onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
   /** Prevents Enter entirely (single-line fields). */
   singleLine?: boolean
   /** Shown as greyed italic hint when the field is empty and unfocused. */
   placeholder?: string
   /** When true, renders a plain static element, no editing, no event handlers. */
   readOnly?: boolean
}

/**
 * Plain-text contenteditable: stores and emits raw innerText, no HTML. For section titles, meta, and
 * code overlays; for rich formatted text use ContentEditable.
 */
export function PlainEditable({
   tag: Tag = 'p',
   content,
   onBlur = () => {},
   spellCheck = true,
   className,
   style,
   onClick,
   onContextMenu,
   onKeyDown,
   singleLine,
   placeholder,
   readOnly,
}: PlainEditableProps) {
   const ref             = useRef<HTMLElement>(null)
   const editing         = useRef(false)
   const snapshotOnFocus = useRef<string>('')

   // Repopulate on a readOnly toggle: React removes managed children when readOnly goes true -> false,
   // leaving the element blank.
   useLayoutEffect(() => {
      if (!ref.current) return
      ref.current.innerText = content
   }, [readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

   // Sync from the prop only when not actively editing, to avoid clobbering mid-edit.
   useEffect(() => {
      if (!ref.current || editing.current) return
      if (ref.current.innerText !== content) ref.current.innerText = content
   }, [content])

   if (readOnly) {
      return <Tag className={className} style={style} onContextMenu={onContextMenu}>{content}</Tag>
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
         onContextMenu={onContextMenu}
         {...(placeholder ? { 'data-placeholder': placeholder } : {})}
         onFocus={() => {
            editing.current = true
            snapshotOnFocus.current = ref.current?.innerText ?? ''
         }}
         onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
            onKeyDown?.(event)
            if (event.defaultPrevented) return
            if (event.key === 'Enter') {
               event.preventDefault()
               if (!singleLine) {
                  document.execCommand('insertLineBreak')
               }
            }
         }}
         onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
         }}
         onBlur={(event: React.FocusEvent<HTMLElement>) => {
            editing.current = false
            const currentContent = event.currentTarget.innerText
            if (currentContent === snapshotOnFocus.current) return
            onBlur(currentContent)
         }}
      />
   )
}

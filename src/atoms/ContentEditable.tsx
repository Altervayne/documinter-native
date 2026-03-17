import { useEffect, useLayoutEffect, useRef, type ElementType } from 'react'

interface ContentEditableProps {
  tag?: ElementType
  content: string
  onBlur: (value: string) => void
  spellCheck?: boolean
  className?: string
  style?: React.CSSProperties
  onClick?: React.MouseEventHandler<HTMLElement>
}

/**
 * Inline contenteditable element that plays nicely with React.
 *
 * Strategy:
 * - Set initial innerText via useLayoutEffect on mount (DOM, not React prop).
 * - While the user is typing, React never touches the DOM (editing ref guards it).
 * - On blur, sync innerText → state via onBlur callback.
 * - External state changes (e.g. move/reorder) are synced back via useEffect.
 */
export function ContentEditable({
  tag: Tag = 'p',
  content,
  onBlur,
  spellCheck = true,
  className,
  style,
  onClick,
}: ContentEditableProps) {
  const ref = useRef<HTMLElement>(null)
  const editing = useRef(false)

  // Mount: set content imperatively so React doesn't manage innerHTML
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerText = content
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // External changes: sync only when not actively editing
  useEffect(() => {
    if (ref.current && !editing.current) {
      if (ref.current.innerText !== content) {
        ref.current.innerText = content
      }
    }
  }, [content])

  return (
    <Tag
      ref={ref}
      className={className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck={spellCheck}
      onClick={onClick}
      onFocus={() => { editing.current = true }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        editing.current = false
        onBlur(e.currentTarget.innerText)
      }}
    />
  )
}

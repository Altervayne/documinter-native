import { useMemo, useRef } from 'react'
import { tokenize } from '../lib/highlight/tokenize'
import { markdownRules } from '../lib/highlight/languages/markdown'

// #########
// # TYPES #
// #########

interface HighlightedTextareaProps {
   value:        string
   language:     'markdown'
   onChange:     (event: React.ChangeEvent<HTMLTextAreaElement>) => void
   /** No event arg: a `() => void` is assignable to React's FocusEventHandler. */
   onFocus?:     () => void
   onBlur?:      () => void
   onKeyDown?:   (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
   placeholder?: string
}

// #######################
// # SHARED FONT METRICS #
// #######################
// Applied identically to both the backdrop and the textarea: every property that affects glyph
// position, so the two stay aligned. Keep them in sync, and add no border to either (a border shifts
// the content box).

const METRIC_CLASSES =
   'font-mono text-sm leading-relaxed p-5 whitespace-pre-wrap break-words [tab-size:4]'

// #############
// # COMPONENT #
// #############

export function HighlightedTextarea({
   value,
   language,
   onChange,
   onFocus,
   onBlur,
   onKeyDown,
   placeholder,
}: HighlightedTextareaProps) {

   const backdropRef = useRef<HTMLDivElement>(null)

   // The trailing '\n ' keeps the backdrop from ending up shorter than the textarea when the cursor
   // sits on the last empty line.
   const highlightedHtml = useMemo(() => {
      return tokenize(value + '\n ', markdownRules)
   }, [value, language])

   // The backdrop is overflow:hidden, so only a programmatic scroll keeps it aligned with the textarea.
   function handleScroll(event: React.UIEvent<HTMLTextAreaElement>) {
      if (backdropRef.current) {
         backdropRef.current.scrollTop  = event.currentTarget.scrollTop
         backdropRef.current.scrollLeft = event.currentTarget.scrollLeft
      }
   }

   return (
      <div className="relative flex-1 overflow-hidden">

         {/* The backdrop under the textarea, holding the tokenized HTML. */}
         <div
            ref={backdropRef}
            aria-hidden="true"
            className={`tok-backdrop ${METRIC_CLASSES} absolute inset-0 overflow-hidden pointer-events-none select-none text-text`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
         />

         {/* The textarea on top: its text is transparent so the backdrop's coloured spans show through,
             with caret-color restoring a visible caret. */}
         <textarea
            className={`${METRIC_CLASSES} absolute inset-0 w-full h-full overflow-auto [scrollbar-gutter:stable] bg-transparent text-transparent [caret-color:var(--color-text)] resize-none border-0 focus:outline-none placeholder:text-muted/40`}
            value={value}
            onChange={onChange}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onScroll={handleScroll}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder={placeholder}
         />
      </div>
   )
}

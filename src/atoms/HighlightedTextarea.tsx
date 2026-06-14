import { useMemo, useRef } from 'react'
import { tokenize } from '../lib/highlight/tokenize'
import { markdownRules } from '../lib/highlight/languages/markdown'
import { mintdown } from '../lib/highlight/languages/mintdown'

// #########
// # TYPES #
// #########

interface HighlightedTextareaProps {
   value:        string
   language:     'markdown' | 'mintdown'
   onChange:     (event: React.ChangeEvent<HTMLTextAreaElement>) => void
   /** useRawEditor returns () => void (no event arg) — compatible with React's
    *  FocusEventHandler because TypeScript allows callbacks with fewer parameters. */
   onFocus?:     () => void
   onBlur?:      () => void
   onKeyDown?:   (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
   placeholder?: string
}

// #######################
// # SHARED FONT METRICS #
// #######################
// These classes are applied identically to BOTH the backdrop div and the
// textarea. They cover every CSS property that affects glyph position:
// font-family, font-size, line-height, padding, white-space, overflow-wrap,
// and tab-size.
//
// IMPORTANT: if any of these values are changed, they must be updated on
// both elements to maintain pixel-perfect alignment at all zoom levels.
// Never add a border to either element — border shifts the content box.

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

   // Tokenize on each value/language change.
   // A trailing '\n ' (newline + space) prevents the backdrop from being
   // shorter than the textarea when the cursor sits on the last empty line.
   const highlightedHtml = useMemo(() => {
      const rules = language === 'mintdown' ? mintdown.rules : markdownRules
      return tokenize(value + '\n ', rules)
   }, [value, language])

   // Keep the backdrop's scroll position in sync with the textarea.
   // The backdrop uses overflow: hidden so only programmatic scrollTop/Left work.
   function handleScroll(event: React.UIEvent<HTMLTextAreaElement>) {
      if (backdropRef.current) {
         backdropRef.current.scrollTop  = event.currentTarget.scrollTop
         backdropRef.current.scrollLeft = event.currentTarget.scrollLeft
      }
   }

   return (
      <div className="relative flex-1 overflow-hidden">

         {/* Backdrop
             Sits underneath the textarea. Receives the tokenized HTML.
             pointer-events-none + aria-hidden: purely visual, never interactive.
             scroll position is driven by handleScroll on the textarea above.  */}
         <div
            ref={backdropRef}
            aria-hidden="true"
            className={`tok-backdrop ${METRIC_CLASSES} absolute inset-0 overflow-hidden pointer-events-none select-none text-text`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
         />

         {/* Textarea
             Sits on top of the backdrop.
             bg-transparent: the backdrop's coloured spans show through.
             text-transparent: the textarea's own text is invisible; the
               backdrop renders the text with syntax-highlighted colours.
             caret-color: restores a visible caret despite text-transparent.
             border-0: no border to avoid shifting the content box vs backdrop. */}
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

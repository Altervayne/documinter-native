import { ContentEditable } from '../../../atoms/ContentEditable'
import { useLang } from '../../../contexts/LangContext'
import { useParagraphFocus } from '../../../contexts/ParagraphFocusContext'
import { caretCharOffsetAtPoint } from '../../../lib/inlineFormatting'
import type { Block, InlineContent } from '../../../types'

interface ParagraphBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

export function ParagraphBlock({ block, patch, readOnly }: ParagraphBlockProps) {
   const { t } = useLang()
   const paragraphFocus = useParagraphFocus()
   const tag = block.type as 'p' | 'h3' | 'h4'
   const placeholder = tag === 'h3' ? t.blockH3 : tag === 'h4' ? t.blockH4 : t.clickToEdit
   const content: InlineContent = block.richText ?? []

   // A page-split fragment (see pageLayout.ts sliceParagraphBlock): only a slice of the paragraph's
   // richText, so it renders READ-ONLY (committing a partial richText would clobber the model). Pressing
   // it asks the paragraph to reflow whole and focus, caret at the pressed char. Never a fragment in
   // preview (readOnly), where nothing splits.
   const fragment = !readOnly ? block.paragraphFragment : undefined

   if (fragment) {
      return (
         <ContentEditable
            tag={tag}
            content={content}
            onCommit={() => {}}
            readOnly
            onMouseDown={event => {
               // Map the press to a char offset inside the fragment, then shift by the fragment's start
               // to get the model-absolute offset the whole editable will place the caret at.
               const localOffset = caretCharOffsetAtPoint(event.currentTarget, event.clientX, event.clientY)
               const caretOffset = fragment.charStart + (localOffset < 0 ? 0 : localOffset)
               paragraphFocus.requestFocus(block.id, caretOffset)
            }}
         />
      )
   }

   // A whole paragraph (the focused one, or one short enough not to overflow) edits as usual. Focus holds
   // it as the focused id so the paged re-measure freezes while it is edited (no re-mount under the caret,
   // no lost typing); blur clears that id so it re-splits. The clear is a no-op unless this paragraph is
   // still the focused one (the guard lives in notifyBlur), so wiring both on every editable is safe.
   return (
      <ContentEditable
         tag={tag}
         content={content}
         onCommit={richText => patch({ richText })}
         placeholder={placeholder}
         readOnly={readOnly}
         onFocus={readOnly ? undefined : () => paragraphFocus.notifyFocus(block.id)}
         onBlur={readOnly ? undefined : () => paragraphFocus.notifyBlur(block.id)}
      />
   )
}

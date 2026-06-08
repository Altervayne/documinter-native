import { ContentEditable } from '../../../atoms/ContentEditable'
import { CalloutStylePicker } from '../../../molecules/CalloutStylePicker'
import { useLang } from '../../../contexts/LangContext'
import type { Block, CalloutStyle, InlineContent } from '../../../types'

interface CalloutBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

export function CalloutBlock({ block, patch, readOnly }: CalloutBlockProps) {
   const { t } = useLang()
   const content: InlineContent = block.richText ?? []
   return (
      <>
         {!readOnly && (
            <CalloutStylePicker
               current={block.style ?? 'info'}
               onChange={(style: CalloutStyle) => patch({ style })}
            />
         )}
         <ContentEditable
            tag="p"
            className={`callout ${block.style ?? 'info'}`}
            content={content}
            onCommit={richText => patch({ richText })}
            placeholder={t.clickToEdit}
            readOnly={readOnly}
         />
      </>
   )
}

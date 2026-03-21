import { ContentEditable } from '../../../atoms/ContentEditable'
import { CalloutStylePicker } from '../../../molecules/CalloutStylePicker'
import { useLang } from '../../../lib/LangContext'
import type { Block, CalloutStyle } from '../../../types'

interface CalloutBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
}

export function CalloutBlock({ block, patch }: CalloutBlockProps) {
   const { t } = useLang()
   return (
      <>
         <CalloutStylePicker
            current={block.style ?? 'info'}
            onChange={(style: CalloutStyle) => patch({ style })}
         />
         <ContentEditable
            tag="p"
            className={`callout ${block.style ?? 'info'}`}
            content={block.text ?? ''}
            onBlur={value => patch({ text: value })}
            rich
            placeholder={t.clickToEdit}
         />
      </>
   )
}

import { ContentEditable } from '../../../atoms/ContentEditable'
import { CalloutStylePicker } from '../../../molecules/CalloutStylePicker'
import { useLang } from '../../../contexts/LangContext'
import type { Block, CalloutStyle } from '../../../types'

interface CalloutBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

export function CalloutBlock({ block, patch, readOnly }: CalloutBlockProps) {
   const { t } = useLang()
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
            content={block.text ?? ''}
            onBlur={value => patch({ text: value })}
            rich
            placeholder={t.clickToEdit}
            readOnly={readOnly}
         />
      </>
   )
}

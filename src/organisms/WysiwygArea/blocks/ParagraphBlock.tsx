import { ContentEditable } from '../../../atoms/ContentEditable'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface ParagraphBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

export function ParagraphBlock({ block, patch, readOnly }: ParagraphBlockProps) {
   const { t } = useLang()
   const tag = block.type as 'p' | 'h3' | 'h4'
   const placeholder = tag === 'h3' ? t.blockH3 : tag === 'h4' ? t.blockH4 : t.clickToEdit
   return (
      <ContentEditable tag={tag} content={block.text ?? ''} onBlur={value => patch({ text: value })} rich placeholder={placeholder} readOnly={readOnly} />
   )
}

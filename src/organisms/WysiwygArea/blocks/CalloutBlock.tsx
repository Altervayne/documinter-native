import type React from 'react'
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
   const customColor = block.calloutColor

   // A custom hex overrides the preset's class-driven border/background inline (both edit and
   // readOnly render this way); absent, the `.callout.<style>` class drives it, unchanged.
   const customStyle: React.CSSProperties | undefined = customColor
      ? {
         borderColor: customColor,
         background:  `color-mix(in srgb, ${customColor} 12%, var(--doc-canvas-bg))`,
      }
      : undefined

   return (
      <>
         {!readOnly && (
            <CalloutStylePicker
               current={block.style ?? 'info'}
               customColor={customColor}
               onChange={(style: CalloutStyle) => patch({ style, calloutColor: undefined })}
               onCustomColorChange={hex => patch({ calloutColor: hex })}
               onClearCustomColor={() => patch({ calloutColor: undefined })}
            />
         )}
         <ContentEditable
            tag="p"
            className={`callout ${block.style ?? 'info'}`}
            style={customStyle}
            content={content}
            onCommit={richText => patch({ richText })}
            placeholder={t.clickToEdit}
            readOnly={readOnly}
         />
      </>
   )
}

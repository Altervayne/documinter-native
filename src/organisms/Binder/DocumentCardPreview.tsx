import { DocumentMiniPreview } from '../../atoms/DocumentMiniPreview'
import type { DocMeta, PreviewSection } from '../../types'

interface DocumentCardPreviewProps {
   meta:            DocMeta
   previewSections: PreviewSection[]
   docTheme:        'light' | 'dark'
   docAccent:       string
}

const BOX_WIDTH  = 180
const BOX_HEIGHT = 240

/** A fixed-size box holding a read-only DocumentMiniPreview (scaled `.doc-render`). No iframe. */
export function DocumentCardPreview({ meta, previewSections, docTheme, docAccent }: DocumentCardPreviewProps) {
   return (
      <div
         className="shrink-0 overflow-hidden p-2"
         style={{ width: BOX_WIDTH, height: BOX_HEIGHT, borderRight: '1px solid var(--color-border)' }}
      >
         <DocumentMiniPreview
            meta={meta}
            previewSections={previewSections}
            docTheme={docTheme}
            docAccent={docAccent}
         />
      </div>
   )
}

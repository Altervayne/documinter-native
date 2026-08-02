// -- Library Imports --
import { ImagePlus } from 'lucide-react'

// -- Library / Hook Imports --
import { renderImageMarkupToSvg } from '../../../lib/imageMarkup'
import { useLang } from '../../../contexts/LangContext'

// -- Type Imports --
import type { Block } from '../../../types'

interface ImageMarkupBlockProps {
   block:     Block
   patch:     (partial: Partial<Block>) => void
   readOnly?: boolean
}

/**
 * Image-markup (annotation) block, FOUNDATION PASS ONLY (see docs/reference/image_markup_study.md
 * and docs/reports/2026-08-02-image-markup-foundation.md). This component renders the stored
 * `block.imageMarkup` spec through the pure `renderImageMarkupToSvg` exactly like the graph block
 * renders `renderGraphToSvg`, self-contained inline SVG via `dangerouslySetInnerHTML`, no runtime.
 *
 * NOT YET BUILT: the interactive annotation editor (place/drag/resize/select/delete overlay
 * elements, the base-image picker, the floating tool-palette BlockEditorWindow). Until that lands,
 * every mode (read-only AND editing) renders the same read view, `patch` is accepted for
 * contract consistency with every other block component (mirrors HrBlock) but is unused here.
 * A block created via `mkBlock('image-markup', t)` starts with an empty `src` and no elements, so
 * the empty state below (a labeled drop-zone-shaped placeholder) is what an author sees today;
 * `renderImageMarkupToSvg` itself already renders a neutral placeholder ground for an empty `src`
 * (see lib/imageMarkup/index.ts), which is what a `.mint`/`.md` reopen shows once it carries real
 * annotations (base64 pixels never round-trip through those text formats, see imageMarkupFence.ts).
 *
 * EXTENSION POINT for the editor pass: swap this component's non-readOnly branch for the inline
 * annotation canvas (base image + SVG overlay + pointer-capture layer) plus a
 * `BlockEditorWindow`-hosted tool palette, following the graph block's draft/commit-on-blur model
 * (see GraphBlock.tsx). The read-only branch below should not need to change.
 */
export function ImageMarkupBlock({ block, patch: _patch, readOnly }: ImageMarkupBlockProps) {
   const { t } = useLang()
   const spec = block.imageMarkup
   const hasContent = !!spec && (!!spec.src || spec.elements.length > 0)

   if (!hasContent) {
      if (readOnly) return null
      return (
         <div className="image-markup-empty flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center text-muted">
            <ImagePlus size={28} strokeWidth={1.5} />
            <span className="text-sm">{t.blockImageMarkupDesc}</span>
         </div>
      )
   }

   const svg = renderImageMarkupToSvg(spec!)
   if (!svg) return null
   return <div className="doc-image-markup" dangerouslySetInnerHTML={{ __html: svg }} />
}

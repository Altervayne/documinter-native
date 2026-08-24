/**
 * imageMarkupBlock.ts, the adapter between an `image` Block and the pure image-markup layer.
 *
 * The markup renderer (`lib/imageMarkup/index.ts`) and the fence serializer (`imageMarkupFence.ts`)
 * both speak `ImageMarkupSpec` ({ src, width, height, elements, alt?, caption? }). On the image Block
 * itself, the base image (src/alt/caption) lives on the block's own fields and only the overlay-specific
 * dims + element stack live in `block.imageMarkup` (an {@link ImageMarkupOverlay}). These two total,
 * pure helpers bridge the two representations so the renderer/fence stay untouched:
 *
 *   - {@link imageBlockToMarkupSpec} builds the spec the renderer/fence consume, pulling src/alt/
 *     caption off the block and dims/elements off its overlay.
 *   - {@link markupSpecToImageBlock} rebuilds an image Block from a spec (the fence parser and the
 *     legacy `image-markup`->`image` load migration both land here); `src` is always '' from a fence
 *     (no base64 in text formats), non-empty only from the JSON/migration path.
 */

import type { Block } from '../types'
import type { ImageMarkupSpec } from './imageMarkup'

/** True when an image block carries an annotation overlay (markup mode is on). */
export function imageBlockHasMarkup(block: Block): boolean {
   return block.imageMarkup !== undefined
}

/**
 * Reconstruct the renderer/fence {@link ImageMarkupSpec} from an image block. The base64 `src` (and
 * alt/caption) come from the block's own fields; the viewBox dims + overlay stack come from its
 * `imageMarkup` overlay. Total: a block with no overlay yields an empty-dims, empty-elements spec.
 */
export function imageBlockToMarkupSpec(block: Block): ImageMarkupSpec {
   const overlay = block.imageMarkup
   const spec: ImageMarkupSpec = {
      src:      block.src ?? '',
      width:    overlay?.width  ?? 0,
      height:   overlay?.height ?? 0,
      elements: overlay?.elements ?? [],
   }
   if (block.alt     !== undefined && block.alt     !== '') spec.alt     = block.alt
   if (block.caption !== undefined && block.caption !== '') spec.caption = block.caption
   return spec
}

/**
 * Build an image Block (markup mode on) from an {@link ImageMarkupSpec}. Used by the Markdown
 * `imagemarkup` fence parser and by the legacy `image-markup`->`image` load migration.
 * The overlay stores only the viewBox dims + element stack; src/alt/caption land on the block.
 */
export function markupSpecToImageBlock(id: string, spec: ImageMarkupSpec): Block {
   const block: Block = {
      id,
      type: 'image',
      src:  spec.src ?? '',
      imageMarkup: { width: spec.width, height: spec.height, elements: spec.elements },
   }
   if (spec.alt     !== undefined && spec.alt     !== '') block.alt     = spec.alt
   if (spec.caption !== undefined && spec.caption !== '') block.caption = spec.caption
   return block
}

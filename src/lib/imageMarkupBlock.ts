/*
 * The adapter between an `image` Block and the pure image-markup layer, which speaks `ImageMarkupSpec`.
 * On the block, the base image (src/alt/caption) lives on its own fields; only the overlay dims +
 * element stack live in `block.imageMarkup`. These two helpers bridge the representations so the
 * renderer/fence stay untouched. From a fence `src` is always '' (no base64 in text formats).
 */

import type { Block } from '../types'
import type { ImageMarkupSpec } from './imageMarkup'

export function imageBlockHasMarkup(block: Block): boolean {
   return block.imageMarkup !== undefined
}

/** Reconstruct an ImageMarkupSpec from an image block: src/alt/caption from the block's fields,
 *  dims + overlay stack from `imageMarkup`. */
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

/** Build a markup-mode image Block from an ImageMarkupSpec: overlay keeps dims + elements, src/alt/
 *  caption land on the block. */
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

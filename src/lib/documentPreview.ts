/**
 * documentPreview.ts, Pure snapshot + full-text builders for binder records.
 *
 * Relocated verbatim from storage.ts. buildPreviewSections produces the card-preview snapshot
 * (first N blocks, image src stripped); extractDocumentText flattens every block to searchable
 * plain text. Both are pure and used by binderDocuments when writing a record.
 */

import type { Block, InlineContent, ListItem, PreviewSection, Section } from '../types'

const PREVIEW_BLOCK_COUNT = 8

/** Structural copy of a block with image src removed (recurses into containers). */
function stripImageSource(block: Block): Block {
   if (block.type === 'image') return { ...block, src: '' }
   if (block.type === 'image-markup' && block.imageMarkup) {
      return { ...block, imageMarkup: { ...block.imageMarkup, src: '' } }
   }
   if (block.type === 'container') {
      return {
         ...block,
         left:  (block.left  ?? []).map(stripImageSource),
         right: (block.right ?? []).map(stripImageSource),
      }
   }
   return block
}

/**
 * Section-grouped snapshot of the first N blocks (document order), image src stripped.
 * Preserves section titles so the card preview can render recognizable section headings.
 */
export function buildPreviewSections(sections: Section[]): PreviewSection[] {
   const result: PreviewSection[] = []
   let count = 0
   for (const section of sections) {
      if (count >= PREVIEW_BLOCK_COUNT) break
      const blocks: Block[] = []
      for (const block of section.blocks) {
         if (count >= PREVIEW_BLOCK_COUNT) break
         blocks.push(stripImageSource(block))
         count++
      }
      result.push({ title: section.title, blocks })
   }
   return result
}

/** Concatenate an InlineContent array's run text (formatting dropped). */
function inlineText(content?: InlineContent): string {
   return content ? content.map(run => run.text).join('') : ''
}

/** All searchable plain text within a single block (recurses lists + container columns). */
function blockText(block: Block): string {
   const parts: string[] = []
   if (block.richText) parts.push(inlineText(block.richText))
   if (block.code)     parts.push(block.code)
   if (block.latex)    parts.push(block.latex)
   if (block.alt)      parts.push(block.alt)
   if (block.caption)  parts.push(block.caption)
   if (block.imageMarkup) {
      if (block.imageMarkup.alt)     parts.push(block.imageMarkup.alt)
      if (block.imageMarkup.caption) parts.push(block.imageMarkup.caption)
      for (const oneElement of block.imageMarkup.elements) {
         if ('text' in oneElement && oneElement.text) parts.push(oneElement.text)
      }
   }
   if (block.items) {
      const walkItems = (items: ListItem[]) => {
         for (const item of items) {
            parts.push(inlineText(item.richText))
            if (item.children.length > 0) walkItems(item.children)
         }
      }
      walkItems(block.items)
   }
   if (block.richHeaders) for (const header of block.richHeaders) parts.push(inlineText(header))
   if (block.richRows)    for (const row of block.richRows) for (const cell of row) parts.push(inlineText(cell))
   if (block.left)  for (const inner of block.left)  parts.push(blockText(inner))
   if (block.right) for (const inner of block.right) parts.push(blockText(inner))
   return parts.filter(Boolean).join(' ')
}

/** Flattened plain text of every block across every section (section titles excluded, stored separately). */
export function extractDocumentText(sections: Section[]): string {
   const parts: string[] = []
   for (const section of sections) for (const block of section.blocks) parts.push(blockText(block))
   return parts.filter(Boolean).join(' ')
}

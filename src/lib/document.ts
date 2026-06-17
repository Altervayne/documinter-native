/**
 * document.ts, Document primitive factories, block display utilities, and
 * shared mutation helpers used by the three mutation hooks.
 *
 * Exports:
 *   Factories:  mkSection, mkBlock, cloneBlock
 *   Display:    blockAnchor, generateHandle, blkPreview
 *   Utilities:  moveItem, mutateSec
 *
 * moveItem and mutateSec were previously duplicated across useBlockMutations,
 * useSectionMutations, and useContainerMutations. They live here so each hook
 * imports a single authoritative copy.
 */

import type { Dispatch, SetStateAction } from 'react'
import type { Block, BlockType, ListItem, Section } from '../types'
import type { T } from './i18n'


// #############
// # FACTORIES #
// #############

/** Create a new section with a fresh UUID and empty block list. */
export function mkSection(title: string): Section {
   return { id: crypto.randomUUID(), title, collapsed: false, blocks: [] }
}

/** Deep-copy a ListItem tree, assigning fresh UUIDs at every level. */
function cloneListItem(item: ListItem): ListItem {
   return { ...item, id: crypto.randomUUID(), children: item.children.map(cloneListItem) }
}

/** Deep-copy a block, assigning fresh UUIDs to it and any nested blocks or list items. */
export function cloneBlock(block: Block): Block {
   const base = { ...block, id: crypto.randomUUID() }
   if (block.type === 'container') {
      return {
         ...base,
         left:  (block.left  ?? []).map(cloneBlock),
         right: (block.right ?? []).map(cloneBlock),
      }
   }
   if (block.type === 'list' && block.items) {
      return { ...base, items: block.items.map(cloneListItem) }
   }
   return base
}

/** Create a new block of the given type with localised default content. */
export function mkBlock(type: BlockType, t: T): Block {
   const id = crypto.randomUUID()
   switch (type) {
      case 'p':       return { id, type, richText: [{ text: t.blockDefaultP }] }
      case 'h3':      return { id, type, richText: [{ text: t.blockDefaultH3 }] }
      case 'h4':      return { id, type, richText: [{ text: t.blockDefaultH4 }] }
      case 'callout': return { id, type, style: 'info', richText: [{ text: t.blockDefaultCallout }] }
      case 'code':      return { id, type, code: t.blockDefaultCode, lang: 'windev' }
      case 'list':      return {
         id, type,
         items: [
            { id: crypto.randomUUID(), richText: [{ text: t.blockDefaultListItem1 }], children: [] },
            { id: crypto.randomUUID(), richText: [{ text: t.blockDefaultListItem2 }], children: [] },
         ],
      }
      case 'table': return {
         id, type,
         richHeaders: [[{ text: 'Column 1' }], [{ text: 'Column 2' }]],
         richRows:    [[ [], [] ], [ [], [] ]],
      }
      case 'image':     return { id, type, src: '', alt: '', caption: '' }
      case 'container': return { id, type, ratio: 0.5, left: [], right: [] }
      case 'hr':        return { id, type }
   }
}

// ###########################
// # BLOCK DISPLAY UTILITIES #
// ###########################

/** Return the HTML anchor id for a block, just the user-defined handle slug. */
export function blockAnchor(block: { handle?: string }): string {
   return block.handle ?? ''
}

/** Extract plain text from a block's primary content field. */
function blockPlainText(block: Block): string {
   if (!block.richText || block.richText.length === 0) return ''
   return block.richText.map(run => run.text).join('').replace(/\n/g, ' ')
}

/** Extract plain text from a list item. */
function listItemPlainText(item: { richText?: { text: string }[] }): string {
   if (!item.richText || item.richText.length === 0) return ''
   return item.richText.map(run => run.text).join('').replace(/\n/g, ' ')
}

/**
 * Suggest an anchor handle slug derived from the block's content.
 * Uses the first line of text, code, or list item. Falls back to a UUID fragment.
 */
export function generateHandle(block: Block): string {
   const rawText = block.richText
      ? blockPlainText(block)
      : block.code
         ? block.code.split('\n')[0]
         : block.items?.[0]
            ? listItemPlainText(block.items[0])
            : ''
   const slug = rawText.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 28)
   return slug || crypto.randomUUID().substring(0, 8)
}

/** Short plain-text preview of a block's content, used in the panel. */
export function blkPreview(block: Block): string {
   if (block.type === 'p' || block.type === 'h3' || block.type === 'h4')
      return blockPlainText(block).substring(0, 32)
   if (block.type === 'callout')
      return `[${block.style}] ${blockPlainText(block).substring(0, 20)}`
   if (block.type === 'code')
      return (block.code ?? '').substring(0, 32)
   if (block.type === 'list')
      return (block.items?.[0] ? listItemPlainText(block.items[0]) : '').substring(0, 32)
   if (block.type === 'table')
      return `${(block.richHeaders ?? []).length} col × ${(block.richRows ?? []).length} rows`
   if (block.type === 'image')
      return `[Image] ${block.alt || '—'}`
   if (block.type === 'container') {
      const pct = Math.round((block.ratio ?? 0.5) * 100)
      return `Container (${pct}/${100 - pct})`
   }
   if (block.type === 'hr') return '———————————————'
   return ''
}

// #########################################################
// # MUTATION HELPERS, SHARED BY THE THREE MUTATION HOOKS #
// #########################################################

/**
 * Swap two items in an array by index. Returns the original array unchanged
 * if either index is out of bounds.
 */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
   if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
   const next = [...arr]
   ;[next[from], next[to]] = [next[to], next[from]]
   return next
}

/**
 * Apply a transformation to a single section identified by secId,
 * leaving all other sections untouched.
 */
export function mutateSec(
   setSections: Dispatch<SetStateAction<Section[]>>,
   secId: string,
   fn: (sec: Section) => Section,
): void {
   setSections(sections => sections.map(sec => sec.id === secId ? fn(sec) : sec))
}

/**
 * document.ts — Document primitive factories, block display utilities, and
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
import type { Block, BlockType, Section } from '../types'
import { stripTags } from './text'

// ============================================================
// Factories
// ============================================================

/** Create a new section with a fresh UUID and empty block list. */
export function mkSection(title = 'New section'): Section {
   return { id: crypto.randomUUID(), title, collapsed: false, blocks: [] }
}

/** Deep-copy a block, assigning fresh UUIDs to it and any nested blocks. */
export function cloneBlock(block: Block): Block {
   const base = { ...block, id: crypto.randomUUID() }
   if (block.type === 'container') {
      return {
         ...base,
         left:  (block.left  ?? []).map(cloneBlock),
         right: (block.right ?? []).map(cloneBlock),
      }
   }
   return base
}

/** Create a new block of the given type with sensible default content. */
export function mkBlock(type: BlockType): Block {
   const id = crypto.randomUUID()
   switch (type) {
      case 'p':         return { id, type, text: 'Your paragraph here.' }
      case 'h3':        return { id, type, text: 'Heading H3' }
      case 'h4':        return { id, type, text: 'Heading H4' }
      case 'callout':   return { id, type, style: 'info', text: 'Your note here.' }
      case 'code':      return { id, type, code: '// Code here', lang: 'windev' }
      case 'list':      return { id, type, items: [{ text: 'First item', children: [] }, { text: 'Second item', children: [] }] }
      case 'table':     return { id, type, headers: ['Column 1', 'Column 2'], rows: [['', ''], ['', '']] }
      case 'image':     return { id, type, src: '', alt: '', caption: '' }
      case 'container': return { id, type, ratio: 0.5, left: [], right: [] }
   }
}

// ============================================================
// Block display utilities
// ============================================================

/** Return the HTML anchor id for a block — just the user-defined handle slug. */
export function blockAnchor(block: { handle?: string }): string {
   return block.handle ?? ''
}

/**
 * Suggest an anchor handle slug derived from the block's content.
 * Uses the first line of text, code, or list item. Falls back to a UUID fragment.
 */
export function generateHandle(block: Block): string {
   const rawText = block.text
      ? stripTags(block.text)
      : block.code
         ? block.code.split('\n')[0]
         : block.items?.[0]?.text
            ? stripTags(block.items[0].text)
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
      return stripTags(block.text ?? '').substring(0, 32)
   if (block.type === 'callout')
      return `[${block.style}] ${stripTags(block.text ?? '').substring(0, 20)}`
   if (block.type === 'code')
      return (block.code ?? '').substring(0, 32)
   if (block.type === 'list')
      return stripTags(block.items?.[0]?.text ?? '').substring(0, 32)
   if (block.type === 'table')
      return `${(block.headers ?? []).length} col × ${(block.rows ?? []).length} rows`
   if (block.type === 'image')
      return `[Image] ${block.alt || '—'}`
   if (block.type === 'container') {
      const pct = Math.round((block.ratio ?? 0.5) * 100)
      return `Container (${pct}/${100 - pct})`
   }
   return ''
}

// ============================================================
// Mutation helpers — shared by the three mutation hooks
// ============================================================

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

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

import { arrayMove } from '@dnd-kit/sortable'
import type { Dispatch, SetStateAction } from 'react'
import type { Block, BlockType, ListItem, Section } from '../types'


// ============================================================
// Factories
// ============================================================

/** Create a new section with a fresh UUID and empty block list. */
export function mkSection(title = 'New section'): Section {
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

/** Create a new block of the given type with sensible default content. */
export function mkBlock(type: BlockType): Block {
   const id = crypto.randomUUID()
   switch (type) {
      case 'p':       return { id, type, richText: [{ text: 'Your paragraph here.' }] }
      case 'h3':      return { id, type, richText: [{ text: 'Heading H3' }] }
      case 'h4':      return { id, type, richText: [{ text: 'Heading H4' }] }
      case 'callout': return { id, type, style: 'info', richText: [{ text: 'Your note here.' }] }
      case 'code':      return { id, type, code: '// Code here', lang: 'windev' }
      case 'list':      return {
         id, type,
         items: [
            { id: crypto.randomUUID(), richText: [{ text: 'First item' }],  children: [] },
            { id: crypto.randomUUID(), richText: [{ text: 'Second item' }], children: [] },
         ],
      }
      case 'table': return {
         id, type,
         richHeaders: [[{ text: 'Column 1' }], [{ text: 'Column 2' }]],
         richRows:    [[ [], [] ], [ [], [] ]],
      }
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

// ============================================================
// List item tree helpers — pure functions used by WysiwygBlock
// ============================================================

/** Walk the tree and apply a transform to the matching item. Returning null removes the item. */
export function mutateListItem(
   items: ListItem[],
   itemId: string,
   transform: (item: ListItem) => ListItem | null,
): ListItem[] {
   const result: ListItem[] = []
   for (const item of items) {
      if (item.id === itemId) {
         const transformed = transform(item)
         if (transformed !== null) result.push(transformed)
      } else {
         result.push({ ...item, children: mutateListItem(item.children, itemId, transform) })
      }
   }
   return result
}

export function updateListItemRichText(items: ListItem[], itemId: string, richText: import('../types').InlineContent): ListItem[] {
   return mutateListItem(items, itemId, item => ({ ...item, richText }))
}

export function removeListItemById(items: ListItem[], itemId: string): ListItem[] {
   return mutateListItem(items, itemId, () => null)
}

export function moveListItemUp(items: ListItem[], itemId: string): ListItem[] {
   const index = items.findIndex(item => item.id === itemId)
   if (index > 0) {
      const next = [...items]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
   }
   // Not at this level — recurse
   return items.map(item => ({ ...item, children: moveListItemUp(item.children, itemId) }))
}

export function moveListItemDown(items: ListItem[], itemId: string): ListItem[] {
   const index = items.findIndex(item => item.id === itemId)
   if (index !== -1 && index < items.length - 1) {
      const next = [...items]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
   }
   if (index === -1) {
      return items.map(item => ({ ...item, children: moveListItemDown(item.children, itemId) }))
   }
   return items
}

export function indentListItem(items: ListItem[], itemId: string): ListItem[] {
   const index = items.findIndex(item => item.id === itemId)
   if (index > 0) {
      const target = items[index]
      const prevSibling = items[index - 1]
      return [
         ...items.slice(0, index - 1),
         { ...prevSibling, children: [...prevSibling.children, target] },
         ...items.slice(index + 1),
      ]
   }
   return items.map(item => ({ ...item, children: indentListItem(item.children, itemId) }))
}

/**
 * Find the path from the root to the item with the given ID.
 * Returns an array of indices: path[0] is the index in `items`, path[1] in that item's children, etc.
 */
function findItemPath(items: ListItem[], targetId: string, path: number[] = []): number[] | null {
   for (let index = 0; index < items.length; index++) {
      if (items[index].id === targetId) return [...path, index]
      const found = findItemPath(items[index].children, targetId, [...path, index])
      if (found) return found
   }
   return null
}

/**
 * Walk the tree following `path` and, at the grandparent level (path.length - 2),
 * remove the target from its parent's children and insert it after the parent.
 */
function unindentByPath(items: ListItem[], path: number[], depth: number): ListItem[] {
   if (depth === path.length - 2) {
      // We are at the grandparent level. The parent is at path[depth].
      const parentIndex     = path[depth]
      const itemIndexInParent = path[depth + 1]
      const parent          = items[parentIndex]
      const target          = parent.children[itemIndexInParent]
      const newParent       = { ...parent, children: parent.children.filter((_, idx) => idx !== itemIndexInParent) }
      return [
         ...items.slice(0, parentIndex),
         newParent,
         target,
         ...items.slice(parentIndex + 1),
      ]
   }
   // Recurse deeper
   const idx = path[depth]
   return items.map((item, index) => {
      if (index !== idx) return item
      return { ...item, children: unindentByPath(item.children, path, depth + 1) }
   })
}

/**
 * Move the item with the given ID exactly one level up (to be a sibling of its parent,
 * placed immediately after its parent). If the item is already at the root level, no-op.
 */
export function unindentListItem(items: ListItem[], itemId: string): ListItem[] {
   const path = findItemPath(items, itemId)
   // path.length < 2 means the item is at the root — can't unindent further
   if (!path || path.length < 2) return items
   return unindentByPath(items, path, 0)
}

/** Reorder siblings under a given parent (null = root level). */
export function reorderListItemsUnderParent(
   items: ListItem[],
   parentItemId: string | null,
   oldIndex: number,
   newIndex: number,
): ListItem[] {
   if (parentItemId === null) return arrayMove(items, oldIndex, newIndex)
   return items.map(item => {
      if (item.id === parentItemId) return { ...item, children: arrayMove(item.children, oldIndex, newIndex) }
      return { ...item, children: reorderListItemsUnderParent(item.children, parentItemId, oldIndex, newIndex) }
   })
}

/** Insert a new item immediately after the item with the given ID (anywhere in the tree). */
export function insertListItemAfter(items: ListItem[], afterItemId: string, newItem: ListItem): ListItem[] {
   const index = items.findIndex(item => item.id === afterItemId)
   if (index !== -1) {
      const next = [...items]
      next.splice(index + 1, 0, newItem)
      return next
   }
   return items.map(item => ({
      ...item,
      children: insertListItemAfter(item.children, afterItemId, newItem),
   }))
}

export interface ListItemContext {
   depth:          number
   indexInParent:  number
   siblingsCount:  number
}

/** Find a list item's position context for enabling/disabling context menu actions. */
export function getListItemContext(items: ListItem[], targetId: string, depth = 0): ListItemContext | null {
   for (let index = 0; index < items.length; index++) {
      if (items[index].id === targetId) return { depth, indexInParent: index, siblingsCount: items.length }
      const found = getListItemContext(items[index].children, targetId, depth + 1)
      if (found) return found
   }
   return null
}

/**
 * listItemTree.ts, Pure recursive algorithms over the ListItem tree.
 *
 * Used by ListBlock (keyboard + drag edits) and WysiwygBlock (context-menu list actions).
 * No React, no DOM, no side effects, every function returns a new tree.
 *
 * Exports:
 *   mutateListItem              , walk + transform a matching item (null transform removes it)
 *   updateListItemRichText      , replace a single item's rich text
 *   removeListItemById          , delete an item anywhere in the tree
 *   moveListItemUp / Down       , swap an item with its sibling
 *   indentListItem              , make an item the last child of its previous sibling
 *   unindentListItem            , move an item one level up (path-based)
 *   reorderListItemsUnderParent , DnD reorder of siblings under a parent (null = root)
 *   insertListItemAfter         , insert a new item immediately after a given item
 *   getListItemContext          , an item's depth / index / sibling count (for the context menu)
 */

import { arrayMove } from '@dnd-kit/sortable'
import type { ListItem } from '../types'

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
   // path.length < 2 means the item is at the root, can't unindent further
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

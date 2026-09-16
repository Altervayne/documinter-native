/*
 * Pure recursive transforms over the ListItem tree (keyboard, drag, and context-menu list edits).
 * No React, no DOM, no side effects; every function returns a new tree.
 */

import { arrayMove } from '@dnd-kit/sortable'
import type { ListItem, ListMarker } from '../types'

/** Walk the tree and apply a transform to the matching item; returning null removes it. */
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

/** Path of child-indices from the root to the item, or null. path[0] indexes `items`, path[1] that
 *  item's children, and so on. */
function findItemPath(items: ListItem[], targetId: string, path: number[] = []): number[] | null {
   for (let index = 0; index < items.length; index++) {
      if (items[index].id === targetId) return [...path, index]
      const found = findItemPath(items[index].children, targetId, [...path, index])
      if (found) return found
   }
   return null
}

/** At the grandparent level (path.length - 2), pull the target out of its parent's children and
 *  reinsert it right after the parent. */
function unindentByPath(items: ListItem[], path: number[], depth: number): ListItem[] {
   if (depth === path.length - 2) {
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

/** Move the item one level up, to sit right after its parent. Root-level items are a no-op. */
export function unindentListItem(items: ListItem[], itemId: string): ListItem[] {
   const path = findItemPath(items, itemId)
   // path.length < 2: already at the root.
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

/** An item's depth / index / sibling count, for enabling or disabling context-menu actions. */
export function getListItemContext(items: ListItem[], targetId: string, depth = 0): ListItemContext | null {
   for (let index = 0; index < items.length; index++) {
      if (items[index].id === targetId) return { depth, indexInParent: index, siblingsCount: items.length }
      const found = getListItemContext(items[index].children, targetId, depth + 1)
      if (found) return found
   }
   return null
}

/** Set (or clear, when `marker` is undefined) an item's `childMarker`, which styles its child
 *  sub-list. Only the path to that item is copied; untouched subtrees keep their reference. */
export function setItemChildMarker(items: ListItem[], itemId: string, marker: ListMarker | undefined): ListItem[] {
   return mutateListItem(items, itemId, item => {
      if (marker === undefined) {
         const { childMarker, ...rest } = item
         void childMarker
         return rest as ListItem
      }
      return { ...item, childMarker: marker }
   })
}

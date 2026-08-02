import { describe, it, expect } from 'vitest'
import { indentListItem, unindentListItem, moveListItemUp, moveListItemDown } from './listItemTree'
import type { ListItem } from '../types'

// Hand-built trees with constant ids (no crypto.randomUUID needed here). Assertions read each
// level's id order via `.map(item => item.id)` to keep parent/child placement explicit.

describe('moveListItemUp', () => {
   it('swaps an item with its previous sibling', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
         { id: 'C', children: [] },
      ]
      expect(moveListItemUp(tree, 'B').map(item => item.id)).toEqual(['B', 'A', 'C'])
   })

   it('leaves the first item in place (nothing above it)', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
      ]
      expect(moveListItemUp(tree, 'A').map(item => item.id)).toEqual(['A', 'B'])
   })
})

describe('moveListItemDown', () => {
   it('swaps an item with its next sibling', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
         { id: 'C', children: [] },
      ]
      expect(moveListItemDown(tree, 'B').map(item => item.id)).toEqual(['A', 'C', 'B'])
   })

   it('leaves the last item in place (nothing below it)', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
      ]
      expect(moveListItemDown(tree, 'B').map(item => item.id)).toEqual(['A', 'B'])
   })
})

describe('indentListItem', () => {
   it('makes an item the last child of its previous sibling', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
      ]
      const result = indentListItem(tree, 'B')
      expect(result.map(item => item.id)).toEqual(['A'])
      expect(result[0].children.map(item => item.id)).toEqual(['B'])
   })

   it('leaves a first child in place (no previous sibling to nest under)', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
      ]
      const result = indentListItem(tree, 'A')
      expect(result.map(item => item.id)).toEqual(['A', 'B'])
      expect(result[0].children.map(item => item.id)).toEqual([])
   })
})

describe('unindentListItem', () => {
   it('moves a nested item to sit right after its parent, one level up', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [
            { id: 'B', children: [] },
         ] },
      ]
      const result = unindentListItem(tree, 'B')
      // B leaves A's children and becomes A's next sibling at the root level.
      expect(result.map(item => item.id)).toEqual(['A', 'B'])
      expect(result[0].children.map(item => item.id)).toEqual([])
   })

   it('unindents the grandparent case up exactly one level (to the parent, not the root)', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [
            { id: 'B', children: [
               { id: 'C', children: [] },
            ] },
         ] },
      ]
      const result = unindentListItem(tree, 'C')
      // C moves out of B to sit after B inside A's children, it does NOT jump to the root.
      expect(result.map(item => item.id)).toEqual(['A'])
      expect(result[0].children.map(item => item.id)).toEqual(['B', 'C'])
      const movedSibling = result[0].children.find(item => item.id === 'B')!
      expect(movedSibling.children.map(item => item.id)).toEqual([])
   })

   it('leaves a root-level item in place', () => {
      const tree: ListItem[] = [
         { id: 'A', children: [] },
         { id: 'B', children: [] },
      ]
      expect(unindentListItem(tree, 'A').map(item => item.id)).toEqual(['A', 'B'])
   })
})

import { describe, it, expect } from 'vitest'
import {
   visiblePanels,
   isPanelVisible,
   countVisiblePanels,
   hasExactPanels,
   removePanel,
   insertPanelRight,
   relocatePanel,
   setSplitRatio,
} from './paneTree'
import type { PaneNode } from '../types'

// A horizontal split of two leaves, and a nested three-leaf tree, reused across the queries below.
const twoLeaves: PaneNode = {
   kind: 'split', orientation: 'h', ratio: 0.5,
   children: [{ kind: 'leaf', paneId: 'wysiwyg' }, { kind: 'leaf', paneId: 'mintdown' }],
}
const threeLeaves: PaneNode = {
   kind: 'split', orientation: 'h', ratio: 0.5,
   children: [twoLeaves, { kind: 'leaf', paneId: 'markdown' }],
}

describe('read-only queries', () => {
   it('visiblePanels collects every leaf paneId', () => {
      expect(visiblePanels({ kind: 'leaf', paneId: 'wysiwyg' })).toEqual(new Set(['wysiwyg']))
      expect(visiblePanels(threeLeaves)).toEqual(new Set(['wysiwyg', 'mintdown', 'markdown']))
   })

   it('isPanelVisible finds present leaves and misses absent ones', () => {
      expect(isPanelVisible(twoLeaves, 'mintdown')).toBe(true)
      expect(isPanelVisible(twoLeaves, 'markdown')).toBe(false)
   })

   it('countVisiblePanels counts leaves', () => {
      expect(countVisiblePanels({ kind: 'leaf', paneId: 'wysiwyg' })).toBe(1)
      expect(countVisiblePanels(twoLeaves)).toBe(2)
      expect(countVisiblePanels(threeLeaves)).toBe(3)
   })

   it('hasExactPanels compares the leaf set exactly', () => {
      expect(hasExactPanels(twoLeaves, new Set(['wysiwyg', 'mintdown']))).toBe(true)
      expect(hasExactPanels(twoLeaves, new Set(['wysiwyg']))).toBe(false)
      expect(hasExactPanels(twoLeaves, new Set(['wysiwyg', 'mintdown', 'markdown']))).toBe(false)
   })
})

describe('removePanel', () => {
   it('collapses a split into its remaining child', () => {
      expect(removePanel(twoLeaves, 'mintdown')).toEqual({ kind: 'leaf', paneId: 'wysiwyg' })
   })

   it('collapses a nested split up one level', () => {
      expect(removePanel(threeLeaves, 'markdown')).toEqual(twoLeaves)
   })

   it('returns null when the input is the matching single leaf', () => {
      expect(removePanel({ kind: 'leaf', paneId: 'wysiwyg' }, 'wysiwyg')).toBeNull()
   })

   it('leaves the tree intact when the paneId is absent', () => {
      expect(removePanel(twoLeaves, 'markdown')).toEqual(twoLeaves)
   })
})

describe('insertPanelRight', () => {
   it('wraps the tree in a new horizontal split with the new leaf on the right', () => {
      expect(insertPanelRight({ kind: 'leaf', paneId: 'wysiwyg' }, 'mintdown')).toEqual({
         kind: 'split', orientation: 'h', ratio: 0.5,
         children: [{ kind: 'leaf', paneId: 'wysiwyg' }, { kind: 'leaf', paneId: 'mintdown' }],
      })
   })
})

describe('relocatePanel', () => {
   it('removes the dragged leaf then re-inserts it beside the target on the chosen side', () => {
      // Drag mintdown to the top of wysiwyg → a vertical split with mintdown first.
      expect(relocatePanel(twoLeaves, 'mintdown', 'wysiwyg', 'top')).toEqual({
         kind: 'split', orientation: 'v', ratio: 0.5,
         children: [{ kind: 'leaf', paneId: 'mintdown' }, { kind: 'leaf', paneId: 'wysiwyg' }],
      })
   })
})

describe('setSplitRatio', () => {
   it('updates the root split with an empty path', () => {
      const result = setSplitRatio(twoLeaves, [], 0.7)
      expect(result).toEqual({ ...twoLeaves, ratio: 0.7 })
   })

   it('updates a nested split reached by path, leaving the root ratio untouched', () => {
      const result = setSplitRatio(threeLeaves, [0], 0.3)
      expect(result.kind).toBe('split')
      if (result.kind === 'split') {
         expect(result.ratio).toBe(0.5)                       // root unchanged
         const nested = result.children[0]
         expect(nested.kind === 'split' && nested.ratio).toBe(0.3)
      }
   })

   it('is a no-op when the path lands on a leaf', () => {
      expect(setSplitRatio(threeLeaves, [1], 0.9)).toEqual(threeLeaves)
   })
})

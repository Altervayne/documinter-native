/**
 * Pure multi-select geometry for the diagram editor: equal-spacing snap detection, marquee hit-test,
 * align / distribute, and the group-translate primitive. All proven without a DOM.
 */

import { describe, it, expect } from 'vitest'
import type { DiagramNode } from './types'
import type { NodeBox } from './edit'
import {
   computeSpacingSnaps, nodesInRect, alignNodes, distributeNodes, translateNodes,
} from './align'

// ###########
// # FIXTURE  #
// ###########

function node(id: string, over: Partial<DiagramNode> = {}): DiagramNode {
   return { id, x: 40, y: 40, width: 120, height: 56, shape: 'rounded', label: id, ...over }
}

function box(over: Partial<NodeBox> = {}): NodeBox {
   return { x: 0, y: 0, width: 100, height: 60, ...over }
}

// ####################
// # SPACING SNAP     #
// ####################

describe('computeSpacingSnaps', () => {
   it('snaps a fourth box onto the even rhythm of three-in-a-row and emits one badge', () => {
      // three boxes at x = 0 / 200 / 400 (width 100): gaps 100 and 100 between their facing edges.
      const first  = box({ x: 0, y: 0 })
      const second = box({ x: 200, y: 0 })
      const third  = box({ x: 400, y: 0 })
      // drag the fourth to x = 603 (want 600 to keep the 100 rhythm past the third's right edge 500)
      const dragged = box({ x: 603, y: 0 })
      const result = computeSpacingSnaps(dragged, [first, second, third], 6)
      expect(result.snapX).toBe(600)
      expect(result.snapY).toBeUndefined()
      expect(result.spacingBadges).toHaveLength(1)
      const badge = result.spacingBadges[0]
      expect(badge.orientation).toBe('horizontal')
      expect(badge.gap).toBe(100)
      expect(badge.segments).toHaveLength(2)
      // the dragged box's snapped gap: from the third's right edge (500) to its own left edge (600)
      expect(badge.segments[0]).toMatchObject({ start: 500, end: 600 })
      // the matched existing peer gap (first found on a tie): between the first and second box
      expect(badge.segments[1]).toMatchObject({ start: 100, end: 200 })
   })

   it('does not snap when the rhythm is just beyond the threshold', () => {
      const first  = box({ x: 0, y: 0 })
      const second = box({ x: 200, y: 0 })
      const third  = box({ x: 400, y: 0 })
      // x = 607 is 7 units from the 600 rhythm, past a threshold of 6
      const dragged = box({ x: 607, y: 0 })
      const result = computeSpacingSnaps(dragged, [first, second, third], 6)
      expect(result.snapX).toBeUndefined()
      expect(result.snapY).toBeUndefined()
      expect(result.spacingBadges).toEqual([])
   })

   it('ignores a peer that is not co-aligned on the perpendicular axis', () => {
      // two co-aligned peers give one existing gap of 200 (right edge 100 -> left edge 300).
      const first  = box({ x: 0, y: 0 })
      const second = box({ x: 300, y: 0 })
      // dragging the third to x = 600 continues that 200 rhythm past the second's right edge (400).
      const dragged = box({ x: 600, y: 0 })
      // an off-row box sitting exactly where the dragged box lands would block the snap IF counted,
      // but it is far below on y, so it is not a peer and must be ignored.
      const offRow = box({ x: 560, y: 5000 })
      const result = computeSpacingSnaps(dragged, [first, second, offRow], 6)
      expect(result.snapX).toBe(600)
      // when that same box IS co-aligned (overlapping y), it becomes the right flank and the snap that
      // would overlap it is rejected, proving the co-alignment filter is what let the snap through above.
      const onRow = box({ x: 560, y: 0 })
      const blocked = computeSpacingSnaps(dragged, [first, second, onRow], 6)
      expect(blocked.snapX).toBeUndefined()
   })

   it('snaps a vertical column and reports snapY', () => {
      // three boxes stacked at y = 0 / 200 / 400 (height 60): gaps 140 and 140 between facing edges.
      const first  = box({ x: 0, y: 0,   width: 100, height: 60 })
      const second = box({ x: 0, y: 200, width: 100, height: 60 })
      const third  = box({ x: 0, y: 400, width: 100, height: 60 })
      // third's bottom edge = 460; a 140 gap lands the fourth's top at 600. Drag near it (598).
      const dragged = box({ x: 0, y: 598, width: 100, height: 60 })
      const result = computeSpacingSnaps(dragged, [first, second, third], 6)
      expect(result.snapY).toBe(600)
      expect(result.snapX).toBeUndefined()
      expect(result.spacingBadges).toHaveLength(1)
      expect(result.spacingBadges[0].orientation).toBe('vertical')
      expect(result.spacingBadges[0].gap).toBe(140)
   })

   it('returns no snap and no badges when there are no other boxes', () => {
      expect(computeSpacingSnaps(box({ x: 10, y: 10 }), [], 6))
         .toEqual({ snapX: undefined, snapY: undefined, spacingBadges: [] })
   })

   it('returns no snap with only a single peer (no existing gap to match)', () => {
      const only = box({ x: 0, y: 0 })
      const dragged = box({ x: 300, y: 0 })
      expect(computeSpacingSnaps(dragged, [only], 6).snapX).toBeUndefined()
   })
})

// ####################
// # MARQUEE HIT-TEST #
// ####################

describe('nodesInRect', () => {
   const nodes = [
      node('inside',  { x: 20,  y: 20,  width: 40, height: 40 }),
      node('partial', { x: 90,  y: 90,  width: 60, height: 60 }),  // straddles the marquee edge
      node('outside', { x: 500, y: 500, width: 40, height: 40 }),
   ]

   it('grabs fully-inside and partially-overlapping nodes, misses the far one', () => {
      const rect = { x: 0, y: 0, width: 100, height: 100 }
      expect(nodesInRect(nodes, rect)).toEqual(['inside', 'partial'])
   })

   it('normalizes a marquee dragged up-and-left (negative width/height)', () => {
      // same 0,0 -> 100,100 region expressed as a drag from the bottom-right corner back to the origin
      const rect = { x: 100, y: 100, width: -100, height: -100 }
      expect(nodesInRect(nodes, rect)).toEqual(['inside', 'partial'])
   })

   it('returns an empty list when nothing is touched', () => {
      const rect = { x: 200, y: 200, width: 50, height: 50 }
      expect(nodesInRect(nodes, rect)).toEqual([])
   })

   it('keeps input order in the result', () => {
      const shuffled = [nodes[2], nodes[1], nodes[0]]
      const rect = { x: 0, y: 0, width: 200, height: 200 }
      expect(nodesInRect(shuffled, rect)).toEqual(['partial', 'inside'])
   })
})

// ###########
// # ALIGN    #
// ###########

describe('alignNodes', () => {
   // three boxes with distinct positions + sizes, so every alignment line is unambiguous.
   const nodes = [
      node('a', { x: 0,   y: 0,   width: 100, height: 40 }),   // box left 0,   right 100, top 0,   bottom 40
      node('b', { x: 200, y: 100, width: 60,  height: 80 }),   // box left 200, right 260, top 100, bottom 180
      node('c', { x: 400, y: 300, width: 120, height: 20 }),   // box left 400, right 520, top 300, bottom 320
   ]
   // selection bounds: minX 0, maxX 520, minY 0, maxY 320
   const selected = new Set(['a', 'b', 'c'])

   it('left aligns every selected node to the box min x', () => {
      const result = alignNodes(nodes, selected, 'left')
      expect(result.map(single => single.x)).toEqual([0, 0, 0])
   })

   it('right aligns every selected node so its right edge meets the box max x', () => {
      const result = alignNodes(nodes, selected, 'right')
      // x = 520 - width: 420, 460, 400
      expect(result.map(single => single.x)).toEqual([420, 460, 400])
   })

   it('hcenter aligns every selected node center to the box mid x (260)', () => {
      const result = alignNodes(nodes, selected, 'hcenter')
      // x = 260 - width/2: 210, 230, 200
      expect(result.map(single => single.x)).toEqual([210, 230, 200])
   })

   it('top aligns every selected node to the box min y', () => {
      const result = alignNodes(nodes, selected, 'top')
      expect(result.map(single => single.y)).toEqual([0, 0, 0])
   })

   it('bottom aligns every selected node so its bottom edge meets the box max y (320)', () => {
      const result = alignNodes(nodes, selected, 'bottom')
      // y = 320 - height: 280, 240, 300
      expect(result.map(single => single.y)).toEqual([280, 240, 300])
   })

   it('vmiddle aligns every selected node center to the box mid y (160)', () => {
      const result = alignNodes(nodes, selected, 'vmiddle')
      // y = 160 - height/2: 140, 120, 150
      expect(result.map(single => single.y)).toEqual([140, 120, 150])
   })

   it('leaves a non-selected node untouched', () => {
      const result = alignNodes(nodes, new Set(['a', 'c']), 'left')
      expect(result.find(single => single.id === 'b')).toBe(nodes[1])
      expect(result.find(single => single.id === 'a')!.x).toBe(0)
      expect(result.find(single => single.id === 'c')!.x).toBe(0)
   })

   it('is a no-op with fewer than two selected', () => {
      expect(alignNodes(nodes, new Set(['a']), 'left')).toBe(nodes)
      expect(alignNodes(nodes, new Set(), 'left')).toBe(nodes)
   })
})

// ####################
// # DISTRIBUTE       #
// ####################

describe('distributeNodes', () => {
   it('equalizes the horizontal edge-to-edge gaps, keeping the extremes fixed', () => {
      // a (0..100), b (150..250) crowded left, c (500..600). span 600, sizes 300, gap = (600-300)/2 = 150
      const nodes = [
         node('a', { x: 0,   y: 0, width: 100, height: 40 }),
         node('b', { x: 150, y: 0, width: 100, height: 40 }),
         node('c', { x: 500, y: 0, width: 100, height: 40 }),
      ]
      const result = distributeNodes(nodes, new Set(['a', 'b', 'c']), 'horizontal')
      const byId = Object.fromEntries(result.map(single => [single.id, single.x]))
      expect(byId.a).toBe(0)     // extreme fixed
      expect(byId.c).toBe(500)   // extreme fixed
      expect(byId.b).toBe(250)   // 100 (a right) + 150 gap
      // both gaps are now equal: b.left - a.right = 250 - 100 = 150, c.left - b.right = 500 - 350 = 150
   })

   it('equalizes the vertical edge-to-edge gaps, keeping the extremes fixed', () => {
      const nodes = [
         node('a', { x: 0, y: 0,   width: 40, height: 100 }),
         node('b', { x: 0, y: 130, width: 40, height: 100 }),
         node('c', { x: 0, y: 500, width: 40, height: 100 }),
      ]
      // span 600, sizes 300, gap = 150; b.top = 100 (a bottom) + 150 = 250
      const result = distributeNodes(nodes, new Set(['a', 'b', 'c']), 'vertical')
      const byId = Object.fromEntries(result.map(single => [single.id, single.y]))
      expect(byId.a).toBe(0)
      expect(byId.c).toBe(500)
      expect(byId.b).toBe(250)
   })

   it('sorts by position, so the selection order does not matter', () => {
      const nodes = [
         node('c', { x: 500, y: 0, width: 100, height: 40 }),
         node('a', { x: 0,   y: 0, width: 100, height: 40 }),
         node('b', { x: 150, y: 0, width: 100, height: 40 }),
      ]
      const result = distributeNodes(nodes, new Set(['a', 'b', 'c']), 'horizontal')
      expect(result.find(single => single.id === 'b')!.x).toBe(250)
   })

   it('leaves non-selected nodes untouched', () => {
      const nodes = [
         node('a', { x: 0,   y: 0, width: 100, height: 40 }),
         node('b', { x: 150, y: 0, width: 100, height: 40 }),
         node('c', { x: 500, y: 0, width: 100, height: 40 }),
         node('d', { x: 999, y: 0, width: 100, height: 40 }),
      ]
      const result = distributeNodes(nodes, new Set(['a', 'b', 'c']), 'horizontal')
      expect(result.find(single => single.id === 'd')).toBe(nodes[3])
   })

   it('is a no-op with fewer than three selected', () => {
      const nodes = [node('a', { x: 0, y: 0 }), node('b', { x: 300, y: 0 })]
      expect(distributeNodes(nodes, new Set(['a', 'b']), 'horizontal')).toBe(nodes)
   })
})

// ####################
// # GROUP TRANSLATE  #
// ####################

describe('translateNodes', () => {
   it('moves every selected node by the delta, rounding, leaving others in place', () => {
      const nodes = [
         node('a', { x: 40, y: 40 }),
         node('b', { x: 200, y: 40 }),
         node('c', { x: 400, y: 40 }),
      ]
      const result = translateNodes(nodes, new Set(['a', 'c']), 15.6, -4.2)
      expect(result.find(single => single.id === 'a')).toMatchObject({ x: 56, y: 36 })
      expect(result.find(single => single.id === 'c')).toMatchObject({ x: 416, y: 36 })
      expect(result.find(single => single.id === 'b')).toBe(nodes[1])
   })

   it('is an identity map (per node) with an empty selection', () => {
      const nodes = [node('a'), node('b')]
      const result = translateNodes(nodes, new Set(), 10, 10)
      expect(result[0]).toBe(nodes[0])
      expect(result[1]).toBe(nodes[1])
   })
})

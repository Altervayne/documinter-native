import { describe, it, expect } from 'vitest'
import {
   nodeCenter, intersectNodeBoundary, contentBounds, nodeCornerPoints,
   estimateTextWidth, wrapLabel, maxLabelLines, edgePolyline,
} from './geometry'
import type { DiagramNode } from './types'

function node(partial: Partial<DiagramNode> = {}): DiagramNode {
   return { id: 'n', x: 0, y: 0, width: 100, height: 60, shape: 'rectangle', label: '', ...partial }
}

// ##################
// # NODE GEOMETRY  #
// ##################

describe('nodeCenter', () => {
   it('returns the center of the bounding box', () => {
      expect(nodeCenter(node({ x: 10, y: 20, width: 100, height: 40 }))).toEqual({ x: 60, y: 40 })
   })
})

describe('intersectNodeBoundary', () => {
   it('clips a rectangle edge to its right wall when the target is directly to the right', () => {
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 60 }), { x: 500, y: 30 })
      // center (50,30); a point straight right lands on x = right wall = 100.
      expect(point.x).toBeCloseTo(100)
      expect(point.y).toBeCloseTo(30)
   })

   it('clips a rectangle edge to its top wall when the target is directly above', () => {
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 60 }), { x: 50, y: -500 })
      expect(point.x).toBeCloseTo(50)
      expect(point.y).toBeCloseTo(0)
   })

   it('clips an ellipse to its rim along the ray', () => {
      // A circle (rx = ry = 50) centered at (50,50); a target straight right lands at the rim x=100.
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 100, shape: 'ellipse' }), { x: 500, y: 50 })
      expect(point.x).toBeCloseTo(100)
      expect(point.y).toBeCloseTo(50)
   })

   it('clips an ellipse along a 45° ray to the circle radius', () => {
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 100, shape: 'ellipse' }), { x: 100, y: 100 })
      // 45° on a radius-50 circle: offset = 50/√2 ≈ 35.355 from center (50,50).
      expect(point.x).toBeCloseTo(50 + 50 / Math.SQRT2, 3)
      expect(point.y).toBeCloseTo(50 + 50 / Math.SQRT2, 3)
   })

   it('clips a diamond to its vertex along the axis', () => {
      // Diamond right vertex sits at the box's right-mid, x = 100, y = 30.
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 60, shape: 'diamond' }), { x: 500, y: 30 })
      expect(point.x).toBeCloseTo(100)
      expect(point.y).toBeCloseTo(30)
   })

   it('returns the center for a zero-length ray (target at the center)', () => {
      const boundary = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 60 }), { x: 50, y: 30 })
      expect(boundary).toEqual({ x: 50, y: 30 })
   })

   it('clips a banner (heading bar) to its bounding rect like a plain rectangle', () => {
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 60, shape: 'banner' }), { x: 500, y: 30 })
      expect(point.x).toBeCloseTo(100)
      expect(point.y).toBeCloseTo(30)
   })

   it('clips a chevron (arrow heading) to its bounding rect approximation, not its point/notch', () => {
      // The chevron's point/notch is NOT modeled for edge clipping (v1 simplification, per the study);
      // it falls through to the same bounding-rect rule as rectangle/rounded/pill/banner.
      const point = intersectNodeBoundary(node({ x: 0, y: 0, width: 100, height: 60, shape: 'chevron' }), { x: 500, y: 30 })
      expect(point.x).toBeCloseTo(100)
      expect(point.y).toBeCloseTo(30)
   })

   it('never emits NaN for a zero-size node', () => {
      const boundary = intersectNodeBoundary(node({ width: 0, height: 0 }), { x: 100, y: 100 })
      expect(Number.isFinite(boundary.x)).toBe(true)
      expect(Number.isFinite(boundary.y)).toBe(true)
   })
})

// ###################
// # EDGE POLYLINE   #
// ###################

describe('edgePolyline (shared by the renderer + the editor hit-test)', () => {
   const nodeA = node({ id: 'a', x: 0, y: 0, width: 100, height: 60 })   // right border x=100, midY=30
   const nodeB = node({ id: 'b', x: 200, y: 0, width: 100, height: 60 }) // left border x=200, midY=30

   it('a straight edge is a two-point segment clipped to both borders', () => {
      const points = edgePolyline({ id: 'e', from: 'a', to: 'b' }, nodeA, nodeB)
      expect(points).toHaveLength(2)
      expect(points[0]).toEqual({ x: 100, y: 30 }) // exits A's right border
      expect(points[1]).toEqual({ x: 200, y: 30 }) // enters B's left border
   })

   it('an orthogonal edge is a four-point single-mid elbow', () => {
      const points = edgePolyline({ id: 'e', from: 'a', to: 'b', routing: 'orthogonal' }, nodeA, nodeB)
      expect(points).toHaveLength(4)
      // horizontal-dominant: exits A's right side, one mid bend, enters B's left side
      expect(points[0]).toEqual({ x: 100, y: 30 })
      expect(points[points.length - 1]).toEqual({ x: 200, y: 30 })
   })

   it('honors waypoints: start-border, each waypoint, end-border', () => {
      const points = edgePolyline({ id: 'e', from: 'a', to: 'b', waypoints: [{ x: 150, y: 200 }] }, nodeA, nodeB)
      expect(points).toHaveLength(3)
      expect(points[1]).toEqual({ x: 150, y: 200 }) // the waypoint is preserved verbatim
   })
})

// ###################
// # BOUNDING BOXES  #
// ###################

describe('contentBounds', () => {
   it('encloses the points with padding', () => {
      const bounds = contentBounds([{ x: 10, y: 20 }, { x: 110, y: 80 }], 5)
      expect(bounds).toEqual({ minX: 5, minY: 15, maxX: 115, maxY: 85 })
   })

   it('returns a default box for no points', () => {
      expect(contentBounds([], 24)).toEqual({ minX: 0, minY: 0, maxX: 48, maxY: 48 })
   })

   it('ignores non-finite points', () => {
      const bounds = contentBounds([{ x: 0, y: 0 }, { x: Number.NaN, y: 5 }, { x: 40, y: 40 }], 0)
      expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 40 })
   })
})

describe('nodeCornerPoints', () => {
   it('returns the four corners', () => {
      expect(nodeCornerPoints(node({ x: 10, y: 20, width: 30, height: 40 }))).toEqual([
         { x: 10, y: 20 }, { x: 40, y: 20 }, { x: 10, y: 60 }, { x: 40, y: 60 },
      ])
   })
})

// ###################
// # TEXT ESTIMATION #
// ###################

describe('estimateTextWidth', () => {
   it('is zero for empty text and scales with length', () => {
      expect(estimateTextWidth('', 14)).toBe(0)
      expect(estimateTextWidth('abcd', 10)).toBeCloseTo(4 * 10 * 0.6)
   })
})

describe('wrapLabel', () => {
   it('returns [] for an empty label', () => {
      expect(wrapLabel('', 100, 14, 3)).toEqual([])
   })

   it('honors explicit newlines', () => {
      expect(wrapLabel('a\nb', 200, 14, 5)).toEqual(['a', 'b'])
   })

   it('word-wraps a long line to fit the width', () => {
      // At fontSize 10, ratio 0.6 → each char ~6px. maxWidth 40 → ~6 chars per line.
      const lines = wrapLabel('aaa bbb ccc', 40, 10, 10)
      expect(lines.length).toBeGreaterThan(1)
      expect(lines.join(' ')).toBe('aaa bbb ccc')
   })

   it('clips to maxLines and ellipsizes the last kept line', () => {
      const lines = wrapLabel('one two three four five', 30, 10, 2)
      expect(lines.length).toBe(2)
      expect(lines[lines.length - 1].endsWith('…')).toBe(true)
   })

   it('keeps a single over-wide word whole rather than chopping it', () => {
      const lines = wrapLabel('supercalifragilistic', 20, 10, 5)
      expect(lines).toEqual(['supercalifragilistic'])
   })
})

describe('maxLabelLines', () => {
   it('is at least one even for a short box', () => {
      expect(maxLabelLines(1, 14)).toBe(1)
   })

   it('scales with the box height and line-height', () => {
      // lineHeight = 14 * 1.25 = 17.5; height 60 → floor(60/17.5) = 3.
      expect(maxLabelLines(60, 14)).toBe(3)
   })
})

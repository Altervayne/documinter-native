import { describe, it, expect } from 'vitest'
import { computeViewBox, arrowheadPolygonPoints, calloutTailPolygonPoints, ellipseFromBoundingBox } from './geometry'
import { MARKUP_VIEWBOX_LONG_EDGE } from './types'

// #############
// # VIEW BOX  #
// #############

describe('computeViewBox', () => {
   it('normalizes the longest edge for a landscape image', () => {
      const { vbWidth, vbHeight } = computeViewBox(1600, 900)
      expect(vbWidth).toBe(MARKUP_VIEWBOX_LONG_EDGE)
      expect(vbHeight).toBeCloseTo((MARKUP_VIEWBOX_LONG_EDGE * 900) / 1600, 6)
   })

   it('normalizes the longest edge for a portrait image', () => {
      const { vbWidth, vbHeight } = computeViewBox(900, 1600)
      expect(vbHeight).toBe(MARKUP_VIEWBOX_LONG_EDGE)
      expect(vbWidth).toBeCloseTo((MARKUP_VIEWBOX_LONG_EDGE * 900) / 1600, 6)
   })

   it('yields a square viewBox for a square image', () => {
      const { vbWidth, vbHeight } = computeViewBox(500, 500)
      expect(vbWidth).toBe(MARKUP_VIEWBOX_LONG_EDGE)
      expect(vbHeight).toBe(MARKUP_VIEWBOX_LONG_EDGE)
   })

   it('falls back to a square placeholder viewBox for zero/missing dimensions', () => {
      expect(computeViewBox(0, 0)).toEqual({ vbWidth: MARKUP_VIEWBOX_LONG_EDGE, vbHeight: MARKUP_VIEWBOX_LONG_EDGE })
      expect(computeViewBox(Number.NaN, 100)).toEqual({ vbWidth: MARKUP_VIEWBOX_LONG_EDGE, vbHeight: MARKUP_VIEWBOX_LONG_EDGE })
      expect(computeViewBox(-10, 20)).toEqual({ vbWidth: MARKUP_VIEWBOX_LONG_EDGE, vbHeight: MARKUP_VIEWBOX_LONG_EDGE })
   })
})

// ###############
// # ARROWHEADS  #
// ###############

describe('arrowheadPolygonPoints', () => {
   it('places the tip exactly at the arrow endpoint', () => {
      const [tip] = arrowheadPolygonPoints(0, 0, 100, 0)
      expect(tip).toEqual({ x: 100, y: 0 })
   })

   it('produces two wing points symmetric around the shaft for a horizontal arrow', () => {
      const [, wingA, wingB] = arrowheadPolygonPoints(0, 0, 100, 0)
      // Both wings sit behind the tip (x < 100) and mirror each other across the shaft line (y=0).
      expect(wingA.x).toBeLessThan(100)
      expect(wingB.x).toBeLessThan(100)
      expect(wingA.y).toBeCloseTo(-wingB.y, 6)
   })

   it('never produces coincident points for a zero-length line', () => {
      const [tip, wingA, wingB] = arrowheadPolygonPoints(5, 5, 5, 5)
      expect(tip).toEqual({ x: 5, y: 5 })
      // Degenerate but still a valid (non-NaN) triangle.
      expect(Number.isFinite(wingA.x)).toBe(true)
      expect(Number.isFinite(wingB.y)).toBe(true)
   })
})

// ####################
// # CALLOUT TAIL     #
// ####################

describe('calloutTailPolygonPoints', () => {
   it('anchors the tail base on the bottom edge when the tip is below the box', () => {
      const box = { x: 10, y: 10, w: 20, h: 10 }
      const [tip, baseA, baseB] = calloutTailPolygonPoints(box, { x: 20, y: 40 })
      expect(tip).toEqual({ x: 20, y: 40 })
      // Both base points sit on the box's bottom edge.
      expect(baseA.y).toBeCloseTo(box.y + box.h, 6)
      expect(baseB.y).toBeCloseTo(box.y + box.h, 6)
   })

   it('anchors the tail base on the right edge when the tip is to the right of a wide box', () => {
      const box = { x: 0, y: 0, w: 100, h: 20 }
      const [, baseA, baseB] = calloutTailPolygonPoints(box, { x: 150, y: 10 })
      expect(baseA.x).toBeCloseTo(box.x + box.w, 6)
      expect(baseB.x).toBeCloseTo(box.x + box.w, 6)
   })

   it('never throws for a degenerate zero-size box', () => {
      const result = calloutTailPolygonPoints({ x: 5, y: 5, w: 0, h: 0 }, { x: 5, y: 20 })
      for (const point of result) {
         expect(Number.isFinite(point.x)).toBe(true)
         expect(Number.isFinite(point.y)).toBe(true)
      }
   })
})

// #############
// # ELLIPSE   #
// #############

describe('ellipseFromBoundingBox', () => {
   it('converts a bounding box to center + radii', () => {
      expect(ellipseFromBoundingBox({ x: 10, y: 20, w: 40, h: 10 })).toEqual({ cx: 30, cy: 25, rx: 20, ry: 5 })
   })
})

import { describe, it, expect } from 'vitest'
import {
   computeViewBox, arrowheadPolygonPoints, arrowShaftEnd, calloutTailPolygonPoints,
   ellipseFromBoundingBox, strokeDashArray,
} from './geometry'
import { MARKUP_ARROWHEAD_ANGLE_DEGREES, MARKUP_ARROWHEAD_LENGTH, MARKUP_VIEWBOX_LONG_EDGE } from './types'

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

// #####################
// # ARROW SHAFT END   #
// #####################

describe('arrowShaftEnd (Bug 3: shaft stops at the arrowhead base)', () => {
   const axialDepth = MARKUP_ARROWHEAD_LENGTH * Math.cos((MARKUP_ARROWHEAD_ANGLE_DEGREES * Math.PI) / 180)

   it('retracts the shaft end from the tip by the arrowhead axial depth, along the shaft', () => {
      const end = arrowShaftEnd(0, 0, 100, 0)
      expect(end.x).toBeCloseTo(100 - axialDepth, 4)
      expect(end.y).toBeCloseTo(0, 6)
   })

   it('retracts along an arbitrary direction (stays on the shaft line)', () => {
      const end = arrowShaftEnd(0, 0, 0, 200) // straight down
      expect(end.x).toBeCloseTo(0, 6)
      expect(end.y).toBeCloseTo(200 - axialDepth, 4)
   })

   it('collapses to the tail rather than reversing past it when the shaft is shorter than the head', () => {
      const end = arrowShaftEnd(0, 0, 10, 0) // 10 < axialDepth (~16.4)
      expect(end.x).toBeCloseTo(0, 6)
      expect(end.y).toBeCloseTo(0, 6)
   })

   it('returns the tip for a zero-length arrow (no direction)', () => {
      expect(arrowShaftEnd(7, 7, 7, 7)).toEqual({ x: 7, y: 7 })
   })
})

// #####################
// # STROKE DASHARRAY  #
// #####################

describe('strokeDashArray (Polish 4: contour line styles)', () => {
   it('returns undefined for solid / undefined so a default contour emits no dash attribute', () => {
      expect(strokeDashArray(undefined, 4)).toBeUndefined()
      expect(strokeDashArray('solid', 4)).toBeUndefined()
   })
   it('scales the dashed pattern to the stroke width', () => {
      expect(strokeDashArray('dashed', 4)).toBe('12,8')
      expect(strokeDashArray('dashed', 2)).toBe('6,4')
   })
   it('scales the dotted pattern to the stroke width', () => {
      expect(strokeDashArray('dotted', 4)).toBe('4,8')
      expect(strokeDashArray('dotted', 3)).toBe('3,6')
   })
   it('falls back to a width of 1 for a zero / non-finite stroke width', () => {
      expect(strokeDashArray('dashed', 0)).toBe('3,2')
      expect(strokeDashArray('dashed', Number.NaN)).toBe('3,2')
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

   it('is byte-identical to the square-corner geometry when no corner radius is given (default 0)', () => {
      const box = { x: 10, y: 10, w: 40, h: 20 }
      const tip = { x: 60, y: 15 }
      expect(calloutTailPolygonPoints(box, tip)).toEqual(calloutTailPolygonPoints(box, tip, undefined, 0))
   })

   it('insets the tail base onto the straight edge span (never over a rounded corner) — Bug 2', () => {
      // Tip aimed toward the bottom-left corner; with a corner radius the base must stay within
      // [x + radius, x + w - radius] on the bottom edge, not run out to the rounded corner at x = 0.
      const box = { x: 0, y: 0, w: 100, h: 100 }
      const radius = 20
      const [, baseA, baseB] = calloutTailPolygonPoints(box, { x: 3, y: 160 }, 28, radius)
      for (const base of [baseA, baseB]) {
         expect(base.y).toBeCloseTo(box.y + box.h, 6) // still flush on the bottom edge line
         expect(base.x).toBeGreaterThanOrEqual(box.x + radius - 1e-6)
         expect(base.x).toBeLessThanOrEqual(box.x + box.w - radius + 1e-6)
      }
   })

   it('insets the vertical tail base by the radius on a side edge', () => {
      const box = { x: 0, y: 0, w: 100, h: 100 }
      const radius = 25
      const [, baseA, baseB] = calloutTailPolygonPoints(box, { x: 160, y: 5 }, 28, radius)
      for (const base of [baseA, baseB]) {
         expect(base.x).toBeCloseTo(box.x + box.w, 6) // flush on the right edge line
         expect(base.y).toBeGreaterThanOrEqual(box.y + radius - 1e-6)
         expect(base.y).toBeLessThanOrEqual(box.y + box.h - radius + 1e-6)
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

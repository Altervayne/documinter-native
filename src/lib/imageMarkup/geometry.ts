/*
 * Pure coordinate math for the image-markup renderer: the viewBox aspect ratio, arrowhead wing points,
 * the callout tail polygon, and the ellipse bounding-box to center/radii conversion. No SVG string
 * building (that lives in render.ts).
 */

import { MARKUP_ARROWHEAD_ANGLE_DEGREES, MARKUP_ARROWHEAD_LENGTH, MARKUP_CALLOUT_TAIL_BASE_WIDTH, MARKUP_VIEWBOX_LONG_EDGE } from './types'
import type { MarkupStrokeStyle } from './types'

export interface Point {
   x: number
   y: number
}

/** An axis-aligned box (top-left + size), shared by rect/ellipse/callout. */
export interface Box {
   x: number
   y: number
   w: number
   h: number
}

// #############
// # VIEW BOX  #
// #############

/**
 * The fixed viewBox dimensions for a base image: the longest edge is {@link MARKUP_VIEWBOX_LONG_EDGE},
 * the other follows the aspect ratio. A missing/zero/non-finite size (no image yet, or a `.mint` reopen
 * with no pixels) falls back to a square viewBox so the overlay still has a canvas.
 */
export function computeViewBox(imageWidth: number, imageHeight: number): { vbWidth: number; vbHeight: number } {
   const longEdge = MARKUP_VIEWBOX_LONG_EDGE
   if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
      return { vbWidth: longEdge, vbHeight: longEdge }
   }
   if (imageWidth >= imageHeight) {
      return { vbWidth: longEdge, vbHeight: (longEdge * imageHeight) / imageWidth }
   }
   return { vbWidth: (longEdge * imageWidth) / imageHeight, vbHeight: longEdge }
}

// ###############
// # ARROWHEADS  #
// ###############

/**
 * The two wing points of an arrowhead triangle whose tip sits at `(tipX, tipY)`, pointing away from
 * `(fromX, fromY)`. Returns `[tip, wingA, wingB]` for an SVG `<polygon>` (explicit polygons, not a
 * `<marker>`, since marker ids collide across SVGs in one export). A zero-length line falls back to
 * pointing along +x so the triangle stays valid.
 */
export function arrowheadPolygonPoints(
   fromX: number, fromY: number, tipX: number, tipY: number,
   length = MARKUP_ARROWHEAD_LENGTH, halfAngleDegrees = MARKUP_ARROWHEAD_ANGLE_DEGREES,
): [Point, Point, Point] {
   const deltaX = tipX - fromX
   const deltaY = tipY - fromY
   const lineAngle = (deltaX === 0 && deltaY === 0) ? 0 : Math.atan2(deltaY, deltaX)
   const halfAngle = (halfAngleDegrees * Math.PI) / 180

   const wingAngleA = lineAngle + Math.PI - halfAngle
   const wingAngleB = lineAngle - Math.PI + halfAngle

   const tip: Point = { x: tipX, y: tipY }
   const wingA: Point = { x: tipX + length * Math.cos(wingAngleA), y: tipY + length * Math.sin(wingAngleA) }
   const wingB: Point = { x: tipX + length * Math.cos(wingAngleB), y: tipY + length * Math.sin(wingAngleB) }
   return [tip, wingA, wingB]
}

/**
 * The point on the shaft axis at the BASE of the arrowhead: the tip retracted toward `(fromX, fromY)`
 * by the arrowhead's axial depth (`length x cos(halfAngle)`). {@link renderArrow} stops the shaft here
 * so the line's stroke never blunts the sharp point. Clamped so a shaft shorter than the arrowhead
 * collapses to `(fromX, fromY)` rather than reversing past the tail.
 */
export function arrowShaftEnd(
   fromX: number, fromY: number, tipX: number, tipY: number,
   length = MARKUP_ARROWHEAD_LENGTH, halfAngleDegrees = MARKUP_ARROWHEAD_ANGLE_DEGREES,
): Point {
   const deltaX = tipX - fromX
   const deltaY = tipY - fromY
   const shaftLength = Math.hypot(deltaX, deltaY)
   if (shaftLength === 0) return { x: tipX, y: tipY }
   const halfAngle = (halfAngleDegrees * Math.PI) / 180
   const retract = length * Math.cos(halfAngle)
   // Fraction of the way from tip back toward the tail; clamped into [0, 1] so it never overshoots.
   const retractFraction = Math.min(1, retract / shaftLength)
   return {
      x: tipX - deltaX * retractFraction,
      y: tipY - deltaY * retractFraction,
   }
}

// ####################
// # STROKE DASHING   #
// ####################

/**
 * The `stroke-dasharray` for a contour style, scaled to the stroke width so the rhythm reads
 * consistently at any thickness. `undefined` for `solid` (and any unknown value) so the element emits
 * no dash attribute. `dashed` = long dash + gap; `dotted` = a short dash (a round dot under the round
 * caps) + a wider gap.
 */
export function strokeDashArray(strokeStyle: MarkupStrokeStyle | undefined, strokeWidth: number): string | undefined {
   const width = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 1
   if (strokeStyle === 'dashed') return `${roundDash(width * 3)},${roundDash(width * 2)}`
   if (strokeStyle === 'dotted') return `${roundDash(width)},${roundDash(width * 2)}`
   return undefined
}

/** Round a dash length to 2 decimals (deterministic, NaN-safe) for compact dash-array output. */
function roundDash(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value * 100) / 100
}

// ####################
// # CALLOUT TAIL     #
// ####################

/**
 * The callout tail polygon: a triangle from the box edge closest to `tip` out to the tip. Picks which
 * of the four edges the tip lies beyond by comparing its offset from center against the half-extents
 * (scaled fair for a non-square box), then straddles two base points around the nearest point on it.
 *
 * `cornerRadius` INSETS the allowed base span on each edge by the radius, so the base attaches on the
 * STRAIGHT part of the rounded-rect perimeter, never over a rounded corner where it would float in a
 * gap. Defaults to 0 (square-corner behavior). Returns `[tip, baseA, baseB]`; a zero-size box still
 * yields a valid (harmless sliver) triangle.
 */
export function calloutTailPolygonPoints(
   box: Box, tip: Point, baseWidth = MARKUP_CALLOUT_TAIL_BASE_WIDTH, cornerRadius = 0,
): [Point, Point, Point] {
   const centerX = box.x + box.w / 2
   const centerY = box.y + box.h / 2
   const halfW = Math.max(box.w / 2, 1e-6)
   const halfH = Math.max(box.h / 2, 1e-6)

   const offsetX = (tip.x - centerX) / halfW
   const offsetY = (tip.y - centerY) / halfH

   const halfBase = baseWidth / 2
   const radius = Math.max(0, cornerRadius)
   const tipPoint: Point = { x: tip.x, y: tip.y }

   if (Math.abs(offsetX) >= Math.abs(offsetY)) {
      // Nearest edge is the LEFT or RIGHT side: the tail base runs vertically along that edge, within
      // the straight span [box.y + radius, box.y + box.h - radius] (never over a rounded corner).
      const edgeX = offsetX >= 0 ? box.x + box.w : box.x
      const spanMin = box.y + radius
      const spanMax = box.y + box.h - radius
      const centerOnEdge = clamp(tip.y, spanMin + halfBase, spanMax - halfBase, (spanMin + spanMax) / 2)
      return [
         tipPoint,
         { x: edgeX, y: clamp(centerOnEdge - halfBase, spanMin, spanMax) },
         { x: edgeX, y: clamp(centerOnEdge + halfBase, spanMin, spanMax) },
      ]
   }
   // Nearest edge is the TOP or BOTTOM side: the tail base runs horizontally along the straight span.
   const edgeY = offsetY >= 0 ? box.y + box.h : box.y
   const spanMin = box.x + radius
   const spanMax = box.x + box.w - radius
   const centerOnEdge = clamp(tip.x, spanMin + halfBase, spanMax - halfBase, (spanMin + spanMax) / 2)
   return [
      tipPoint,
      { x: clamp(centerOnEdge - halfBase, spanMin, spanMax), y: edgeY },
      { x: clamp(centerOnEdge + halfBase, spanMin, spanMax), y: edgeY },
   ]
}

/** Clamp `value` into `[min, max]`; if the range is inverted (a box narrower than the base width),
 *  fall back to `fallback` (the box's own midpoint) rather than producing a crossed range. */
function clamp(value: number, min: number, max: number, fallback = min): number {
   if (min > max) return fallback
   return Math.min(Math.max(value, min), max)
}

// #############
// # ELLIPSE   #
// #############

/** Convert a rect-shaped bounding box (x, y, w, h) into ellipse center + radii. */
export function ellipseFromBoundingBox(box: Box): { cx: number; cy: number; rx: number; ry: number } {
   return {
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      rx: Math.abs(box.w) / 2,
      ry: Math.abs(box.h) / 2,
   }
}

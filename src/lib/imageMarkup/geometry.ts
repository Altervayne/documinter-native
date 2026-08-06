/**
 * geometry.ts, pure coordinate math for the image-markup renderer: the viewBox aspect ratio,
 * arrowhead wing points, the callout tail polygon, and the ellipse bounding-box <-> center/radii
 * conversion. PURE FUNCTIONS, no SVG string building (that lives in render.ts), unit-tested in
 * isolation exactly like `lib/graph`'s scale.ts / layout.ts.
 */

import { MARKUP_ARROWHEAD_ANGLE_DEGREES, MARKUP_ARROWHEAD_LENGTH, MARKUP_CALLOUT_TAIL_BASE_WIDTH, MARKUP_VIEWBOX_LONG_EDGE } from './types'
import type { MarkupStrokeStyle } from './types'

/** A plain 2D point in whatever coordinate space the caller is working in. */
export interface Point {
   x: number
   y: number
}

/** An axis-aligned box (top-left + size), the shape rect/ellipse/callout all share. */
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
 * Compute the fixed internal viewBox dimensions for a base image of `imageWidth` x `imageHeight`:
 * the LONGEST edge is normalized to {@link MARKUP_VIEWBOX_LONG_EDGE}, the other edge follows the
 * image's aspect ratio. A missing/zero/non-finite image size (no image picked yet, or a `.mint`
 * reopen with no pixels) falls back to a square viewBox, a sane, never-degenerate placeholder
 * canvas for the overlay to still render onto.
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
 * Compute the two wing points of an arrowhead triangle whose tip sits at `(tipX, tipY)`, pointing
 * away from `(fromX, fromY)` (the tail end of the line/arrow). Returns a 3-point polygon
 * `[tip, wingA, wingB]` ready to hand to an SVG `<polygon>`. Arrowheads are drawn as explicit
 * polygons rather than an SVG `<marker>`, since marker ids can collide across multiple SVGs in one
 * export. A degenerate zero-length line (tip === tail) falls back to pointing along +x so the
 * polygon is still a valid (if arbitrary) triangle rather than three coincident points.
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
 * The point on the shaft axis at the BASE of the arrowhead, i.e. the tip retracted toward
 * `(fromX, fromY)` by the arrowhead's axial depth (`length x cos(halfAngle)`, how far the two wings
 * sit behind the tip along the line). Used by {@link renderArrow} to STOP the shaft short of the tip
 * so the line's own stroke width never thickens or blunts the sharp point. Clamped so a shaft
 * shorter than the arrowhead collapses to `(fromX, fromY)` rather than reversing past the tail.
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
 * The SVG `stroke-dasharray` value for a contour {@link MarkupStrokeStyle}, scaled to the stroke
 * width so the dash/dot rhythm reads consistently at any thickness, or `undefined` for `solid`
 * (and any unknown value) so a default-styled element emits NO dash attribute and renders as a
 * plain solid stroke. `dashed` = long dash + gap; `dotted` = a short dash (a round dot under the
 * line/arrow round caps) + a wider gap.
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
 * Compute the callout tail polygon: a triangle from the box edge closest to `tip` out to the tip
 * itself. Determines which of the box's four edges the tip lies "beyond" by comparing the tip's
 * offset from the box center against the box's half-width/half-height (scaled so the comparison
 * is fair for a non-square box), then places two base points straddling the nearest point on that
 * edge.
 *
 * `cornerRadius` (viewBox units, matching the box's drawn `rx`) INSETS the allowed base span on each
 * edge by the radius so the base always attaches on the STRAIGHT part of the rounded-rect perimeter,
 * never over a rounded corner where the outline has curved inward and the base would float in a gap.
 * The tail is drawn under the box, so a base flush on the straight edge reads as a speech-bubble
 * pointer joined to the bubble. `cornerRadius` defaults to 0 (square-corner behavior), so existing
 * callers/tests are byte-identical.
 *
 * Returns `[tip, baseA, baseB]`, ready for an SVG `<polygon>`. Never throws: a degenerate
 * (zero-size) box still yields a valid triangle (the base points collapse to the box's single
 * point, which draws as a degenerate but harmless sliver).
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

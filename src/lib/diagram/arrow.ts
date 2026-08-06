/**
 * arrow.ts, the hand-drawn arrowhead for a diagram edge.
 *
 * PURE FUNCTIONS. Arrowheads are drawn as inline <polygon>s oriented to the incoming segment,
 * NOT as shared <marker> defs: a <marker> needs an `id` + a document-level <defs>, and with
 * MULTIPLE diagrams inlined into one exported HTML file those ids would collide unless namespaced.
 * An inline polygon keeps every SVG fully self-contained and id-free, the same "no cross-SVG
 * dependency" discipline the graph renderer follows.
 */

import type { Point } from './geometry'
import { selfClosingElement } from '../svg'

// #############
// # CONSTANTS #
// #############

/** Arrowhead length (tip to base), in diagram units. */
export const ARROW_LENGTH = 12

/** Arrowhead half-width (base half-span), in diagram units. */
export const ARROW_HALF_WIDTH = 6

/**
 * Build a filled triangular arrowhead polygon whose TIP sits at `tip`, pointing along the
 * direction from `from` -> `tip` (the incoming segment). A zero-length segment (from === tip)
 * draws nothing (returns ''), so a degenerate edge never emits NaN geometry.
 *
 * The polygon is filled with `color` (the edge's line color) so, layered over the edge <path>,
 * it reads as one solid arrow; the thin line beneath the triangle is fully covered.
 */
export function renderArrowhead(from: Point, tip: Point, color: string): string {
   const directionX = tip.x - from.x
   const directionY = tip.y - from.y
   const length = Math.hypot(directionX, directionY)
   if (length === 0 || !Number.isFinite(length)) return ''

   // Unit vector along the segment (toward the tip) and its perpendicular.
   const unitX = directionX / length
   const unitY = directionY / length
   const perpendicularX = -unitY
   const perpendicularY = unitX

   // The base sits ARROW_LENGTH back from the tip, spanning +/-ARROW_HALF_WIDTH across the segment.
   const baseCenterX = tip.x - unitX * ARROW_LENGTH
   const baseCenterY = tip.y - unitY * ARROW_LENGTH
   const leftX  = baseCenterX + perpendicularX * ARROW_HALF_WIDTH
   const leftY  = baseCenterY + perpendicularY * ARROW_HALF_WIDTH
   const rightX = baseCenterX - perpendicularX * ARROW_HALF_WIDTH
   const rightY = baseCenterY - perpendicularY * ARROW_HALF_WIDTH

   const points = `${round(tip.x)},${round(tip.y)} ${round(leftX)},${round(leftY)} ${round(rightX)},${round(rightY)}`
   return selfClosingElement('polygon', { points, fill: color })
}

/** Round to 2 places for compact, deterministic polygon output. */
function round(value: number): number {
   return Math.round(value * 100) / 100
}

/*
 * The hand-drawn arrowhead for a diagram edge. Arrowheads are inline <polygon>s, not shared
 * <marker> defs, so ids never collide when many diagrams are inlined into one exported HTML file.
 */

import type { Point } from './geometry'
import { selfClosingElement } from '../svg'

// #############
// # CONSTANTS #
// #############

/** Arrowhead length tip-to-base, diagram units. */
export const ARROW_LENGTH = 12

/** Arrowhead half-width (base half-span), diagram units. */
export const ARROW_HALF_WIDTH = 6

/**
 * A filled triangular arrowhead whose tip sits at `tip`, pointing along `from` -> `tip`. A
 * zero-length segment returns '' so a degenerate edge never emits NaN geometry.
 */
export function renderArrowhead(from: Point, tip: Point, color: string): string {
   const directionX = tip.x - from.x
   const directionY = tip.y - from.y
   const length = Math.hypot(directionX, directionY)
   if (length === 0 || !Number.isFinite(length)) return ''

   const unitX = directionX / length
   const unitY = directionY / length
   const perpendicularX = -unitY
   const perpendicularY = unitX

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

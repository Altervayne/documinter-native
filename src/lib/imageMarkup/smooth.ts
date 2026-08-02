/**
 * smooth.ts, turns a freehand point list into a smoothed SVG path `d` string via a
 * Catmull-Rom -> cubic-Bezier conversion. PURE, unit-tested in isolation.
 *
 * The freehand tool stores raw (lightly simplified at capture, see the study's Q7 ratification)
 * sample points; smoothing is deliberately a RENDER concern, not a model concern, so a future
 * improvement to the curve algorithm needs no data migration (re-smoothing the same stored points
 * differently is free).
 */

import type { Point } from './geometry'

/**
 * Build a smoothed `d` path attribute value from an ordered point list, using a standard uniform
 * Catmull-Rom spline converted to cubic Bezier segments (the "1/6 tangent" construction). Total:
 * - 0 points  -> '' (nothing to draw)
 * - 1 point   -> '' (a single point has no stroke to show)
 * - 2 points  -> a plain straight `M...L...` segment (a spline needs >= 2 real segments to curve)
 * - 3+ points -> one Bezier segment per gap, using the neighbor before/after (duplicating the
 *   first/last point as its own neighbor at the ends, the standard open-curve convention).
 */
export function catmullRomPath(points: Point[]): string {
   if (points.length < 2) return ''
   if (points.length === 2) {
      return `M ${formatPoint(points[0])} L ${formatPoint(points[1])}`
   }

   const segments: string[] = [`M ${formatPoint(points[0])}`]
   for (let index = 0; index < points.length - 1; index++) {
      const previous = points[index - 1] ?? points[index]
      const current  = points[index]
      const next      = points[index + 1]
      const afterNext = points[index + 2] ?? next

      const control1: Point = {
         x: current.x + (next.x - previous.x) / 6,
         y: current.y + (next.y - previous.y) / 6,
      }
      const control2: Point = {
         x: next.x - (afterNext.x - current.x) / 6,
         y: next.y - (afterNext.y - current.y) / 6,
      }
      segments.push(`C ${formatPoint(control1)} ${formatPoint(control2)} ${formatPoint(next)}`)
   }
   return segments.join(' ')
}

/** Format one point as `x,y`, rounded to 2 decimals for compact, deterministic output. */
function formatPoint(point: Point): string {
   const x = Number.isFinite(point.x) ? Math.round(point.x * 100) / 100 : 0
   const y = Number.isFinite(point.y) ? Math.round(point.y * 100) / 100 : 0
   return `${x},${y}`
}

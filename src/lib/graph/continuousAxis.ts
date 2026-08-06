/**
 * The continuous (numeric) x-axis foundation shared by chart types that sample/plot over a real
 * numeric domain instead of a categorical band (function, scatter).
 *
 * Two small, generic pieces:
 *   - buildContinuousXAdapter: wraps an already-built numeric x-scale plus a fixed list of
 *     sampled x-values into the same narrow `{ center(index) }` shape cartesian.ts's line/area
 *     drawing loops (`buildPointRuns` / `renderLineSeries` / `renderAreaSeries`) already consume
 *     for a categorical `BandScale`, so those loops need zero changes to draw a sampled curve
 *     instead of a categorical series. `index` here is a sample index (a position in the sampled
 *     x-value list), the same way the existing band-scale adapter treats `index` as a category
 *     position.
 *   - renderNumericXAxisLabels: mirrors cartesian.ts's `renderCategoryLabels`, but draws formatted
 *     number tick labels (from `niceTicks` over the domain) instead of one label per category. No
 *     vertical gridlines or tick marks, matching the existing x-axis's plain-label minimalism
 *     (the category axis draws no vertical gridlines either).
 */

import { niceTicks } from './scale'
import { textElement, formatNumber, element } from './svg'
import { TICK_FONT_SIZE } from './layout'
import type { GraphTheme } from './types'

// #############
// # CONSTANTS #
// #############

const TARGET_X_TICK_COUNT = 5

// #####################
// # CONTINUOUS-X ADAPTER #
// #####################

/** The narrow x-positioning shape cartesian.ts's line/area drawing loops already consume. */
export interface ContinuousXAdapter {
   center(index: number): number
}

/**
 * Build a `{ center(index) }` adapter over a fixed, ordered list of sampled x-values (e.g. the
 * evenly spaced samples across a function's domain), through an already-built numeric x-scale
 * (`linearScale([xMin, xMax], [plotLeft, plotRight])`, reused as-is, no new scale code needed).
 */
export function buildContinuousXAdapter(
   sampleXValues: number[],
   xScale: (value: number) => number,
): ContinuousXAdapter {
   return {
      center: (index: number): number => xScale(sampleXValues[index] ?? 0),
   }
}

// #########################
// # NUMERIC X-AXIS TICKS  #
// #########################

/**
 * Draw numeric x-axis tick labels along the bottom of the plot, at `niceTicks(xMin, xMax)`
 * positions mapped through `xScale`. Labels only (no vertical gridlines), a pure transposition
 * of cartesian.ts's category-label renderer onto a continuous domain, in the same muted ink /
 * font-size the y-ticks already use so the visual language stays unchanged.
 */
export function renderNumericXAxisLabels(
   xMin: number,
   xMax: number,
   xScale: (value: number) => number,
   plot: { x: number; y: number; width: number; height: number },
   theme: GraphTheme,
): string {
   const xTicks = niceTicks(xMin, xMax, TARGET_X_TICK_COUNT)
   const parts: string[] = []
   for (const tick of xTicks.ticks) {
      // A nice-tick can round slightly outside the actual sampled domain; skip it so the axis
      // never labels a position past where the curve is actually drawn.
      if (tick < xMin || tick > xMax) continue
      parts.push(textElement({
         x: xScale(tick),
         y: plot.y + plot.height + TICK_FONT_SIZE + 6,
         'text-anchor': 'middle',
         'font-size': TICK_FONT_SIZE,
         'font-variant-numeric': 'tabular-nums',
         fill: theme.ink.textMuted,
      }, formatNumber(tick)))
   }
   return element('g', {}, parts.join(''))
}

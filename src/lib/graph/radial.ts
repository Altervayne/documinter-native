/*
 * The radial rendering core: pie and donut. `renderRadial` returns inner SVG markup; index.ts wraps
 * it in the responsive <svg>. No axes, no scales, just arc geometry. Slices are colored by category
 * index (a radial chart plots one series, each slice a category), separated by a 2px surface stroke;
 * a donut is a pie with an inner radius (`options.donutHole`, default 0.55).
 */

import type { GraphSpec, GraphTheme } from './types'
import { resolveSeriesColor, readableTextOn } from './palette'
import {
   CANVAS_WIDTH,
   CANVAS_HEIGHT,
   TITLE_FONT_SIZE,
   LEGEND_FONT_SIZE,
   layoutLegend,
   legendHeight,
} from './layout'
import { element, selfClosingElement, textElement, titleElement } from './svg'

// #############
// # CONSTANTS #
// #############

const DEFAULT_DONUT_HOLE = 0.55
const SURFACE_GAP = 2
const MIN_LABEL_FRACTION = 0.05
const LEGEND_SWATCH_SIZE = 12
const LEGEND_SWATCH_TEXT_GAP = 6
const LEGEND_ROW_HEIGHT = LEGEND_FONT_SIZE + 8

// ####################
// # PUBLIC RENDERER  #
// ####################

/** Render a pie or donut to inner SVG markup. Reads the FIRST series only; each label is one slice,
 *  negative/null cells count as zero. A zero total returns a centered empty-state note. */
export function renderRadial(spec: GraphSpec, theme: GraphTheme): string {
   const { type, data, options } = spec
   const labels = data.labels
   const series = data.series[0]
   const rawValues = labels.map((_, index) => {
      const value = series?.values[index]
      if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return 0
      return value
   })
   const total = rawValues.reduce((sum, value) => sum + value, 0)

   const pieces: string[] = []
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))

   if (total <= 0) {
      pieces.push(textElement({
         x: CANVAS_WIDTH / 2,
         y: CANVAS_HEIGHT / 2,
         'text-anchor': 'middle',
         'dominant-baseline': 'central',
         'font-size': 14,
         fill: theme.ink.textMuted,
      }, 'No data to chart'))
      return element('g', {}, pieces.join(''))
   }

   // ====== geometry ======
   const legendWanted = options.legend !== false
   const legendLayout = legendWanted
      ? layoutLegend(labels, CANVAS_WIDTH - 28)
      : { rows: [], rowCount: 0, widestRowWidth: 0 }
   const reservedTop = options.title ? 44 : 16
   const reservedBottom = 16 + legendHeight(legendLayout.rowCount)
   const availableHeight = CANVAS_HEIGHT - reservedTop - reservedBottom
   const centerX = CANVAS_WIDTH / 2
   const centerY = reservedTop + availableHeight / 2
   const radius = Math.max(0, Math.min(CANVAS_WIDTH / 2, availableHeight / 2) - 8)
   const holeFraction = type === 'donut' ? clampHole(options.donutHole) : 0
   const innerRadius = radius * holeFraction

   // ====== slices ======
   let cursorAngle = 0
   for (let index = 0; index < labels.length; index++) {
      const value = rawValues[index]
      if (value <= 0) continue
      const fraction = value / total
      const startAngle = cursorAngle
      const endAngle = cursorAngle + fraction * 360
      cursorAngle = endAngle
      const color = resolveSeriesColor(index, data.categoryColors?.[index], theme)
      const pathData = innerRadius > 0
         ? donutSegmentPath(centerX, centerY, radius, innerRadius, startAngle, endAngle)
         : pieSlicePath(centerX, centerY, radius, startAngle, endAngle)
      const percentText = `${formatPercent(fraction)}%`
      pieces.push(element('path', {
         d: pathData,
         fill: color,
         stroke: theme.ink.surface,
         'stroke-width': SURFACE_GAP,
      }, titleElement(`${labels[index]}: ${formatValue(value)} (${percentText})`)))

      if (fraction >= MIN_LABEL_FRACTION) {
         const labelRadius = innerRadius > 0 ? (radius + innerRadius) / 2 : radius * 0.6
         const midAngle = (startAngle + endAngle) / 2
         const labelPoint = polarToCartesian(centerX, centerY, labelRadius, midAngle)
         pieces.push(textElement({
            x: labelPoint.x,
            y: labelPoint.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            'font-size': 11,
            fill: readableTextOn(color),
         }, percentText))
      }
   }

   if (legendWanted) pieces.push(renderLegend(labels, legendLayout, theme, data.categoryColors))

   return element('g', {}, pieces.join(''))
}

// #############
// # ARC MATH  #
// #############

/** Polar (radius + angle) to cartesian, with 0deg at the top and angle increasing clockwise. */
export function polarToCartesian(
   centerX: number,
   centerY: number,
   radius: number,
   angleDegrees: number,
): { x: number; y: number } {
   const angleRadians = ((angleDegrees - 90) * Math.PI) / 180
   return {
      x: centerX + radius * Math.cos(angleRadians),
      y: centerY + radius * Math.sin(angleRadians),
   }
}

/** The `d` for a filled pie slice from `startAngle` to `endAngle`. Handles the full-circle case. */
export function pieSlicePath(
   centerX: number,
   centerY: number,
   radius: number,
   startAngle: number,
   endAngle: number,
): string {
   const sweep = endAngle - startAngle
   if (sweep >= 359.999) {
      // A full circle needs two 180deg arcs (one A-command cannot draw 360deg).
      const midAngle = startAngle + 180
      const start = polarToCartesian(centerX, centerY, radius, startAngle)
      const mid = polarToCartesian(centerX, centerY, radius, midAngle)
      return [
         `M${round(centerX)},${round(centerY)}`,
         `L${round(start.x)},${round(start.y)}`,
         `A${round(radius)},${round(radius)} 0 0 1 ${round(mid.x)},${round(mid.y)}`,
         `A${round(radius)},${round(radius)} 0 0 1 ${round(start.x)},${round(start.y)}`,
         'Z',
      ].join(' ')
   }
   const largeArc = sweep > 180 ? 1 : 0
   const start = polarToCartesian(centerX, centerY, radius, startAngle)
   const end = polarToCartesian(centerX, centerY, radius, endAngle)
   return [
      `M${round(centerX)},${round(centerY)}`,
      `L${round(start.x)},${round(start.y)}`,
      `A${round(radius)},${round(radius)} 0 ${largeArc} 1 ${round(end.x)},${round(end.y)}`,
      'Z',
   ].join(' ')
}

/** The `d` for a donut (annular) segment between `innerRadius` and `radius`. Handles full-circle. */
export function donutSegmentPath(
   centerX: number,
   centerY: number,
   radius: number,
   innerRadius: number,
   startAngle: number,
   endAngle: number,
): string {
   const sweep = endAngle - startAngle
   if (sweep >= 359.999) {
      const midAngle = startAngle + 180
      const outerStart = polarToCartesian(centerX, centerY, radius, startAngle)
      const outerMid = polarToCartesian(centerX, centerY, radius, midAngle)
      const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle)
      const innerMid = polarToCartesian(centerX, centerY, innerRadius, midAngle)
      return [
         `M${round(outerStart.x)},${round(outerStart.y)}`,
         `A${round(radius)},${round(radius)} 0 0 1 ${round(outerMid.x)},${round(outerMid.y)}`,
         `A${round(radius)},${round(radius)} 0 0 1 ${round(outerStart.x)},${round(outerStart.y)}`,
         `M${round(innerStart.x)},${round(innerStart.y)}`,
         `A${round(innerRadius)},${round(innerRadius)} 0 0 0 ${round(innerMid.x)},${round(innerMid.y)}`,
         `A${round(innerRadius)},${round(innerRadius)} 0 0 0 ${round(innerStart.x)},${round(innerStart.y)}`,
         'Z',
      ].join(' ')
   }
   const largeArc = sweep > 180 ? 1 : 0
   const outerStart = polarToCartesian(centerX, centerY, radius, startAngle)
   const outerEnd = polarToCartesian(centerX, centerY, radius, endAngle)
   const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle)
   const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle)
   return [
      `M${round(outerStart.x)},${round(outerStart.y)}`,
      `A${round(radius)},${round(radius)} 0 ${largeArc} 1 ${round(outerEnd.x)},${round(outerEnd.y)}`,
      `L${round(innerEnd.x)},${round(innerEnd.y)}`,
      `A${round(innerRadius)},${round(innerRadius)} 0 ${largeArc} 0 ${round(innerStart.x)},${round(innerStart.y)}`,
      'Z',
   ].join(' ')
}

// #############
// # LEGEND    #
// #############

/** The legend: one swatch + category label per slice, centered in the reserved bottom band. */
function renderLegend(
   labels: string[],
   legendLayout: { rows: { label: string; offsetX: number; width: number }[][] },
   theme: GraphTheme,
   categoryColors: (string | undefined)[] | undefined,
): string {
   const parts: string[] = []
   const colorByLabel = new Map<string, string>()
   for (let index = 0; index < labels.length; index++) {
      colorByLabel.set(labels[index], resolveSeriesColor(index, categoryColors?.[index], theme))
   }
   const firstRowY = CANVAS_HEIGHT - (16 + legendHeight(legendLayout.rows.length)) + 24
   for (let rowIndex = 0; rowIndex < legendLayout.rows.length; rowIndex++) {
      const row = legendLayout.rows[rowIndex]
      const rowWidth = row.length === 0 ? 0 : row[row.length - 1].offsetX + row[row.length - 1].width
      const rowLeft = (CANVAS_WIDTH - rowWidth) / 2
      const rowY = firstRowY + rowIndex * LEGEND_ROW_HEIGHT
      for (const item of row) {
         const swatchX = rowLeft + item.offsetX
         parts.push(selfClosingElement('rect', {
            x: swatchX,
            y: rowY - LEGEND_SWATCH_SIZE / 2,
            width: LEGEND_SWATCH_SIZE,
            height: LEGEND_SWATCH_SIZE,
            rx: 2,
            fill: colorByLabel.get(item.label) ?? theme.ink.textMuted,
         }))
         parts.push(textElement({
            x: swatchX + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_TEXT_GAP,
            y: rowY,
            'dominant-baseline': 'central',
            'font-size': LEGEND_FONT_SIZE,
            fill: theme.ink.textSecondary,
         }, item.label))
      }
   }
   return element('g', {}, parts.join(''))
}

// #############
// # HELPERS   #
// #############

/** The visible chart title, centered along the top in primary ink. */
function renderVisibleTitle(title: string, theme: GraphTheme): string {
   return textElement({
      x: CANVAS_WIDTH / 2,
      y: 14 + TITLE_FONT_SIZE - 2,
      'text-anchor': 'middle',
      'font-size': TITLE_FONT_SIZE,
      'font-weight': 600,
      fill: theme.ink.text,
   }, title)
}

/** Clamp a donut-hole fraction into the sane [0, 0.9] range, defaulting when absent/invalid. */
function clampHole(hole: number | undefined): number {
   if (hole === undefined || !Number.isFinite(hole)) return DEFAULT_DONUT_HOLE
   return Math.min(0.9, Math.max(0, hole))
}

/** Round a coordinate to 2 places for compact, deterministic path strings. */
function round(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value * 100) / 100
}

/** A percentage with one decimal place, trailing `.0` trimmed (e.g. `25`, `12.5`). */
function formatPercent(fraction: number): string {
   const percent = Math.round(fraction * 1000) / 10
   return String(percent)
}

/** A slice value formatted for the tooltip (integers plain, decimals trimmed to 6 places). */
function formatValue(value: number): string {
   const rounded = Math.round(value * 1e6) / 1e6
   return String(rounded)
}

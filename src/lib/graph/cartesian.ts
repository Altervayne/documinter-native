/**
 * cartesian.ts, the cartesian rendering core: bar / bar-grouped / bar-stacked / line / area.
 *
 * PURE FUNCTION. `renderCartesian(spec, theme)` returns the INNER SVG markup (a `<g>` group)
 * for a cartesian chart; index.ts wraps it in the responsive `<svg>` envelope with the a11y
 * `<title>`/`<desc>`. This module owns: the value domain per chart type, nice-tick gridlines,
 * the band x-axis, every mark loop, and the legend. It delegates numeric scaling to scale.ts
 * and all margin/text math to layout.ts, and never measures the DOM.
 *
 * Mark specs follow the dataviz skill: bars capped at 24px with a 2px surface gap between
 * neighbours, 2px round-capped lines, >=8px markers with a 2px surface ring, area fills at
 * ~10% opacity, recessive hairline gridlines, and a legend whenever there is >1 series.
 */

import type { GraphSpec, GraphTheme, GraphSeries } from './types'
import { MAX_SERIES, resolveSeriesColor } from './palette'
import { linearScale, niceTicks, bandScale } from './scale'
import {
   computeCartesianLayout,
   layoutLegend,
   TITLE_FONT_SIZE,
   AXIS_CAPTION_FONT_SIZE,
   TICK_FONT_SIZE,
   LEGEND_FONT_SIZE,
   CANVAS_WIDTH,
} from './layout'
import {
   element,
   selfClosingElement,
   textElement,
   titleElement,
   formatNumber,
   escapeXml,
} from './svg'

// #############
// # CONSTANTS #
// #############

const MAX_BAR_THICKNESS = 24
const BAR_CORNER_RADIUS = 3
const SURFACE_GAP = 2
const MARKER_RADIUS = 4
const LINE_WIDTH = 2
const AREA_FILL_OPACITY = 0.1
const TARGET_TICK_COUNT = 5
const LEGEND_SWATCH_SIZE = 12
const LEGEND_SWATCH_TEXT_GAP = 6
const LEGEND_ROW_HEIGHT = LEGEND_FONT_SIZE + 8

// ####################
// # PUBLIC RENDERER  #
// ####################

/**
 * Render a cartesian graph spec to its inner SVG markup for the given resolved theme.
 * Assumes non-empty data (index.ts screens empty specs and emits a placeholder instead).
 */
export function renderCartesian(spec: GraphSpec, theme: GraphTheme): string {
   const { type, data, options } = spec
   const labels = data.labels
   // v1 caps the number of drawn series at the palette size.
   const cappedSeries = data.series.slice(0, MAX_SERIES)

   // A plain `bar` renders the first series only; grouped/stacked read every capped series.
   const drawnSeries: GraphSeries[] = type === 'bar' ? cappedSeries.slice(0, 1) : cappedSeries

   // ====== value domain + nice ticks ======
   const [domainMin, domainMax] = computeValueDomain(type, labels, drawnSeries, options)
   const niceScale = niceTicks(domainMin, domainMax, TARGET_TICK_COUNT)
   const tickLabels = niceScale.ticks.map(formatNumber)

   // ====== legend reservation ======
   const legendWanted = options.legend !== false && drawnSeries.length > 1
   const legendLabels = drawnSeries.map(series => series.name)
   const legendLayout = legendWanted
      ? layoutLegend(legendLabels, CANVAS_WIDTH - 28)
      : { rows: [], rowCount: 0, widestRowWidth: 0 }

   // ====== layout ======
   const layout = computeCartesianLayout({
      hasTitle: Boolean(options.title),
      xCaption: options.xLabel,
      yCaption: options.yLabel,
      yTickLabels: tickLabels,
      legendRowCount: legendLayout.rowCount,
   })
   const { plot } = layout

   // ====== scales ======
   const yScale = linearScale([niceScale.niceMin, niceScale.niceMax], [plot.y + plot.height, plot.y])
   const xBand = bandScale(labels.length, [plot.x, plot.x + plot.width])
   const baselineValue = Math.min(niceScale.niceMax, Math.max(niceScale.niceMin, 0))
   const baselineY = yScale(baselineValue)

   // ====== assemble ======
   const pieces: string[] = []
   pieces.push(renderGridlines(niceScale.ticks, yScale, tickLabels, plot, theme))
   pieces.push(renderAxes(plot, baselineY, theme))
   pieces.push(renderCategoryLabels(labels, xBand, plot, theme))

   if (type === 'bar') {
      pieces.push(renderSingleBars(labels, drawnSeries[0], xBand, yScale, baselineY, theme, options.showValues ?? false))
   } else if (type === 'bar-grouped') {
      pieces.push(renderGroupedBars(labels, drawnSeries, xBand, yScale, baselineY, theme, options.showValues ?? false))
   } else if (type === 'bar-stacked') {
      pieces.push(renderStackedBars(labels, drawnSeries, xBand, yScale, theme))
   } else if (type === 'area') {
      pieces.push(renderAreaSeries(labels, drawnSeries, xBand, yScale, baselineY, theme))
   } else {
      // 'line'
      pieces.push(renderLineSeries(labels, drawnSeries, xBand, yScale, theme))
   }

   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))
   if (legendWanted) pieces.push(renderLegend(drawnSeries, legendLayout, layout, theme))

   return element('g', {}, pieces.join(''))
}

// #####################
// # VALUE DOMAIN      #
// #####################

/**
 * Compute the raw value domain for a chart type before nice-ticking. The domain always starts
 * from a zero baseline (bars grow from 0), extended to any negative data. Stacked charts sum
 * per category (positive and negative stacks kept separate). `options.yMin`/`yMax` override.
 */
function computeValueDomain(
   type: GraphSpec['type'],
   labels: string[],
   series: GraphSeries[],
   options: GraphSpec['options'],
): [number, number] {
   let dataMin = 0
   let dataMax = 0

   if (type === 'bar-stacked') {
      for (let categoryIndex = 0; categoryIndex < labels.length; categoryIndex++) {
         let positiveSum = 0
         let negativeSum = 0
         for (const oneSeries of series) {
            const value = oneSeries.values[categoryIndex]
            if (value === null || value === undefined || !Number.isFinite(value)) continue
            if (value >= 0) positiveSum += value
            else negativeSum += value
         }
         if (positiveSum > dataMax) dataMax = positiveSum
         if (negativeSum < dataMin) dataMin = negativeSum
      }
   } else {
      for (const oneSeries of series) {
         for (const value of oneSeries.values) {
            if (value === null || value === undefined || !Number.isFinite(value)) continue
            if (value > dataMax) dataMax = value
            if (value < dataMin) dataMin = value
         }
      }
   }

   const min = options.yMin !== undefined ? options.yMin : dataMin
   const max = options.yMax !== undefined ? options.yMax : dataMax
   return [min, max]
}

// #####################
// # AXES & GRIDLINES  #
// #####################

/** Horizontal hairline gridlines at each nice tick, with the tick value labelled at the left. */
function renderGridlines(
   ticks: number[],
   yScale: (value: number) => number,
   tickLabels: string[],
   plot: { x: number; y: number; width: number; height: number },
   theme: GraphTheme,
): string {
   const parts: string[] = []
   for (let tickIndex = 0; tickIndex < ticks.length; tickIndex++) {
      const tickY = yScale(ticks[tickIndex])
      parts.push(selfClosingElement('line', {
         x1: plot.x,
         y1: tickY,
         x2: plot.x + plot.width,
         y2: tickY,
         stroke: theme.ink.grid,
         'stroke-width': 1,
      }))
      parts.push(textElement({
         x: plot.x - 8,
         y: tickY,
         'text-anchor': 'end',
         'dominant-baseline': 'central',
         'font-size': TICK_FONT_SIZE,
         'font-variant-numeric': 'tabular-nums',
         fill: theme.ink.textMuted,
      }, tickLabels[tickIndex]))
   }
   return element('g', {}, parts.join(''))
}

/** The left y-axis line and the bottom x-axis baseline, in the recessive axis color. */
function renderAxes(
   plot: { x: number; y: number; width: number; height: number },
   baselineY: number,
   theme: GraphTheme,
): string {
   const yAxis = selfClosingElement('line', {
      x1: plot.x,
      y1: plot.y,
      x2: plot.x,
      y2: plot.y + plot.height,
      stroke: theme.ink.axis,
      'stroke-width': 1,
   })
   const xAxis = selfClosingElement('line', {
      x1: plot.x,
      y1: baselineY,
      x2: plot.x + plot.width,
      y2: baselineY,
      stroke: theme.ink.axis,
      'stroke-width': 1,
   })
   return element('g', {}, yAxis + xAxis)
}

/** Category (x) labels centered under each band. */
function renderCategoryLabels(
   labels: string[],
   xBand: { center(index: number): number },
   plot: { x: number; y: number; width: number; height: number },
   theme: GraphTheme,
): string {
   const parts: string[] = []
   for (let index = 0; index < labels.length; index++) {
      parts.push(textElement({
         x: xBand.center(index),
         y: plot.y + plot.height + TICK_FONT_SIZE + 6,
         'text-anchor': 'middle',
         'font-size': TICK_FONT_SIZE,
         fill: theme.ink.textMuted,
      }, labels[index]))
   }
   return element('g', {}, parts.join(''))
}

// #############
// # BAR MARKS #
// #############

/** A rounded-corner rect for a bar (rx softens the data-end; the baseline side sits on the axis). */
function barRect(
   x: number,
   y: number,
   width: number,
   height: number,
   fill: string,
   tooltip: string,
): string {
   const radius = Math.min(BAR_CORNER_RADIUS, width / 2, height / 2)
   return element('rect', {
      x,
      y,
      width,
      height,
      rx: radius > 0 ? radius : undefined,
      fill,
   }, titleElement(tooltip))
}

/** Single-series bars: one rect per category, capped at 24px and centered in its band. */
function renderSingleBars(
   labels: string[],
   series: GraphSeries,
   xBand: { center(index: number): number; bandwidth: number },
   yScale: (value: number) => number,
   baselineY: number,
   theme: GraphTheme,
   showValues: boolean,
): string {
   const color = resolveSeriesColor(0, series.color, theme)
   const barWidth = Math.min(xBand.bandwidth, MAX_BAR_THICKNESS)
   const parts: string[] = []
   for (let index = 0; index < labels.length; index++) {
      const value = series.values[index]
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      const valueY = yScale(value)
      const rectY = Math.min(baselineY, valueY)
      const rectHeight = Math.abs(valueY - baselineY)
      const rectX = xBand.center(index) - barWidth / 2
      parts.push(barRect(rectX, rectY, barWidth, rectHeight, color, `${labels[index]}: ${formatNumber(value)}`))
      if (showValues) {
         parts.push(valueLabel(xBand.center(index), rectY - 4, formatNumber(value), theme))
      }
   }
   return element('g', {}, parts.join(''))
}

/** Grouped bars: each series a side-by-side sub-bar within the band, 2px surface gaps between. */
function renderGroupedBars(
   labels: string[],
   series: GraphSeries[],
   xBand: { start(index: number): number; bandwidth: number },
   yScale: (value: number) => number,
   baselineY: number,
   theme: GraphTheme,
   showValues: boolean,
): string {
   const seriesCount = series.length
   const subStep = xBand.bandwidth / seriesCount
   const barWidth = Math.max(1, Math.min(subStep - SURFACE_GAP, MAX_BAR_THICKNESS))
   const parts: string[] = []
   for (let categoryIndex = 0; categoryIndex < labels.length; categoryIndex++) {
      const bandStart = xBand.start(categoryIndex)
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
         const value = series[seriesIndex].values[categoryIndex]
         if (value === null || value === undefined || !Number.isFinite(value)) continue
         const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
         const valueY = yScale(value)
         const rectY = Math.min(baselineY, valueY)
         const rectHeight = Math.abs(valueY - baselineY)
         const slotCenter = bandStart + subStep * seriesIndex + subStep / 2
         const rectX = slotCenter - barWidth / 2
         const tooltip = `${series[seriesIndex].name} - ${labels[categoryIndex]}: ${formatNumber(value)}`
         parts.push(barRect(rectX, rectY, barWidth, rectHeight, color, tooltip))
         if (showValues) {
            parts.push(valueLabel(slotCenter, rectY - 4, formatNumber(value), theme))
         }
      }
   }
   return element('g', {}, parts.join(''))
}

/** Stacked bars: per-category cumulative segments, 2px surface gap trimmed off each segment top. */
function renderStackedBars(
   labels: string[],
   series: GraphSeries[],
   xBand: { center(index: number): number; bandwidth: number },
   yScale: (value: number) => number,
   theme: GraphTheme,
): string {
   const barWidth = Math.min(xBand.bandwidth, MAX_BAR_THICKNESS)
   const parts: string[] = []
   for (let categoryIndex = 0; categoryIndex < labels.length; categoryIndex++) {
      const rectX = xBand.center(categoryIndex) - barWidth / 2
      let positiveCursor = 0
      let negativeCursor = 0
      for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
         const value = series[seriesIndex].values[categoryIndex]
         if (value === null || value === undefined || !Number.isFinite(value)) continue
         const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
         let segmentBottomValue: number
         let segmentTopValue: number
         if (value >= 0) {
            segmentBottomValue = positiveCursor
            segmentTopValue = positiveCursor + value
            positiveCursor = segmentTopValue
         } else {
            segmentTopValue = negativeCursor
            segmentBottomValue = negativeCursor + value
            negativeCursor = segmentBottomValue
         }
         const topY = yScale(Math.max(segmentBottomValue, segmentTopValue))
         const bottomY = yScale(Math.min(segmentBottomValue, segmentTopValue))
         const rawHeight = bottomY - topY
         const rectHeight = Math.max(0, rawHeight - SURFACE_GAP)
         const tooltip = `${series[seriesIndex].name} - ${labels[categoryIndex]}: ${formatNumber(value)}`
         parts.push(barRect(rectX, topY, barWidth, rectHeight, color, tooltip))
      }
   }
   return element('g', {}, parts.join(''))
}

// ###################
// # LINE / AREA     #
// ###################

/** A contiguous run of plotted points for one series (null values break runs apart). */
interface PointRun {
   points: { x: number; y: number; value: number; label: string }[]
}

/** Split a series into contiguous point runs, dropping null/malformed cells (they become gaps). */
function buildPointRuns(
   labels: string[],
   series: GraphSeries,
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
): PointRun[] {
   const runs: PointRun[] = []
   let current: PointRun | null = null
   for (let index = 0; index < labels.length; index++) {
      const value = series.values[index]
      if (value === null || value === undefined || !Number.isFinite(value)) {
         current = null
         continue
      }
      const point = { x: xBand.center(index), y: yScale(value), value, label: labels[index] }
      if (current === null) {
         current = { points: [point] }
         runs.push(current)
      } else {
         current.points.push(point)
      }
   }
   return runs
}

/** Point markers (>=8px, filled with the series color, 2px surface ring) plus per-point tooltip. */
function renderMarkers(runs: PointRun[], seriesName: string, color: string, theme: GraphTheme): string {
   const parts: string[] = []
   for (const run of runs) {
      for (const point of run.points) {
         parts.push(element('circle', {
            cx: point.x,
            cy: point.y,
            r: MARKER_RADIUS,
            fill: color,
            stroke: theme.ink.surface,
            'stroke-width': SURFACE_GAP,
         }, titleElement(`${seriesName} - ${point.label}: ${formatNumber(point.value)}`)))
      }
   }
   return parts.join('')
}

/** Line series: one polyline per contiguous run, 2px round-capped, plus point markers. */
function renderLineSeries(
   labels: string[],
   series: GraphSeries[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   theme: GraphTheme,
): string {
   const parts: string[] = []
   for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
      const runs = buildPointRuns(labels, series[seriesIndex], xBand, yScale)
      for (const run of runs) {
         if (run.points.length === 1) {
            // A lone point cannot form a polyline; the marker below carries it.
            continue
         }
         const pointsAttribute = run.points
            .map(point => `${roundForPath(point.x)},${roundForPath(point.y)}`)
            .join(' ')
         parts.push(selfClosingElement('polyline', {
            points: pointsAttribute,
            fill: 'none',
            stroke: color,
            'stroke-width': LINE_WIDTH,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
         }))
      }
      parts.push(renderMarkers(runs, series[seriesIndex].name, color, theme))
   }
   return element('g', {}, parts.join(''))
}

/** Area series: a filled polygon to the baseline at ~10% opacity, plus the line and markers. */
function renderAreaSeries(
   labels: string[],
   series: GraphSeries[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   baselineY: number,
   theme: GraphTheme,
): string {
   const parts: string[] = []
   for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
      const runs = buildPointRuns(labels, series[seriesIndex], xBand, yScale)
      for (const run of runs) {
         if (run.points.length === 0) continue
         const topPath = run.points
            .map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${roundForPath(point.x)},${roundForPath(point.y)}`)
            .join(' ')
         const firstPoint = run.points[0]
         const lastPoint = run.points[run.points.length - 1]
         const areaPath = `${topPath} L${roundForPath(lastPoint.x)},${roundForPath(baselineY)} L${roundForPath(firstPoint.x)},${roundForPath(baselineY)} Z`
         parts.push(selfClosingElement('path', {
            d: areaPath,
            fill: color,
            'fill-opacity': AREA_FILL_OPACITY,
            stroke: 'none',
         }))
         if (run.points.length > 1) {
            const linePoints = run.points.map(point => `${roundForPath(point.x)},${roundForPath(point.y)}`).join(' ')
            parts.push(selfClosingElement('polyline', {
               points: linePoints,
               fill: 'none',
               stroke: color,
               'stroke-width': LINE_WIDTH,
               'stroke-linejoin': 'round',
               'stroke-linecap': 'round',
            }))
         }
      }
      parts.push(renderMarkers(runs, series[seriesIndex].name, color, theme))
   }
   return element('g', {}, parts.join(''))
}

// ####################
// # LABELS & LEGEND  #
// ####################

/** A direct value label above a mark, in secondary ink (never the series color). */
function valueLabel(centerX: number, y: number, text: string, theme: GraphTheme): string {
   return textElement({
      x: centerX,
      y,
      'text-anchor': 'middle',
      'font-size': TICK_FONT_SIZE,
      'font-variant-numeric': 'tabular-nums',
      fill: theme.ink.textSecondary,
   }, text)
}

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

/** The x-axis caption (bottom center) and y-axis caption (left center, rotated), in muted ink. */
function renderAxisCaptions(
   xCaption: string | undefined,
   yCaption: string | undefined,
   layout: { canvasWidth: number; canvasHeight: number; margin: { left: number }; plot: { x: number; y: number; width: number; height: number } },
   theme: GraphTheme,
): string {
   const parts: string[] = []
   if (xCaption) {
      parts.push(textElement({
         x: layout.plot.x + layout.plot.width / 2,
         y: layout.canvasHeight - 6,
         'text-anchor': 'middle',
         'font-size': AXIS_CAPTION_FONT_SIZE,
         fill: theme.ink.textMuted,
      }, xCaption))
   }
   if (yCaption) {
      const captionX = 14 + AXIS_CAPTION_FONT_SIZE - 4
      const captionY = layout.plot.y + layout.plot.height / 2
      parts.push(element('text', {
         x: captionX,
         y: captionY,
         'text-anchor': 'middle',
         'font-size': AXIS_CAPTION_FONT_SIZE,
         fill: theme.ink.textMuted,
         transform: `rotate(-90 ${captionX} ${captionY})`,
      }, escapeXml(yCaption)))
   }
   return element('g', {}, parts.join(''))
}

/**
 * The legend rows: a colored swatch + the series name, in secondary ink. Placed in the bottom
 * band reserved by the layout, each row centered horizontally.
 */
function renderLegend(
   series: GraphSeries[],
   legendLayout: { rows: { label: string; offsetX: number; width: number }[][]; widestRowWidth: number },
   layout: { canvasWidth: number; canvasHeight: number; margin: { bottom: number }; plot: { y: number; height: number } },
   theme: GraphTheme,
): string {
   const parts: string[] = []
   // Map each series name to its palette color, so legend swatches match the marks.
   const colorByName = new Map<string, string>()
   for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      colorByName.set(series[seriesIndex].name, resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme))
   }
   const firstRowY = layout.canvasHeight - layout.margin.bottom + 30
   for (let rowIndex = 0; rowIndex < legendLayout.rows.length; rowIndex++) {
      const row = legendLayout.rows[rowIndex]
      const rowWidth = rowWidthOf(row)
      const rowLeft = (layout.canvasWidth - rowWidth) / 2
      const rowY = firstRowY + rowIndex * LEGEND_ROW_HEIGHT
      for (const item of row) {
         const swatchX = rowLeft + item.offsetX
         const color = colorByName.get(item.label) ?? theme.ink.textMuted
         parts.push(selfClosingElement('rect', {
            x: swatchX,
            y: rowY - LEGEND_SWATCH_SIZE / 2,
            width: LEGEND_SWATCH_SIZE,
            height: LEGEND_SWATCH_SIZE,
            rx: 2,
            fill: color,
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

/** The pixel width of a laid-out legend row (last item's offset + its width). */
function rowWidthOf(row: { offsetX: number; width: number }[]): number {
   if (row.length === 0) return 0
   const last = row[row.length - 1]
   return last.offsetX + last.width
}

// #############
// # HELPERS   #
// #############

/** Round a path coordinate to 2 places for compact, deterministic `d`/`points` strings. */
function roundForPath(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value * 100) / 100
}

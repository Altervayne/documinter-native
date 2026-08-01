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

import type { GraphSpec, GraphTheme, GraphSeries, Overlay, FunctionDomain } from './types'
import {
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
   FUNCTION_MIN_SAMPLES,
   FUNCTION_MAX_SAMPLES,
} from './types'
import { MAX_SERIES, resolveSeriesColor } from './palette'
import { mean as meanOf, median as medianOf, linearRegression } from './stats'
import { linearScale, niceTicks, bandScale } from './scale'
import { compileExpression, evaluate } from './expr'
import { buildContinuousXAdapter, renderNumericXAxisLabels } from './continuousAxis'
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
const TARGET_TICK_COUNT = 5

// ====== per-type option clamp bounds ======
// The renderer resolves each per-type option to its GRAPH_DEFAULT_* fallback (see types.ts) when
// unset, then clamps to these sane bounds so a hand-edited fence can never produce a broken chart.
const MIN_BAR_WIDTH_FRACTION = 0.1
const MAX_BAR_WIDTH_FRACTION = 1
const MIN_LINE_WIDTH = 0.5
const MAX_LINE_WIDTH = 12
const MIN_FILL_OPACITY = 0
const MAX_FILL_OPACITY = 1

// ====== overlay styling (dataviz: annotation reads distinct from the solid hairline grid) ======
// Dashed so an overlay never masquerades as a gridline (never dashed) or a data line (solid,
// heavier). ~1.5px round-capped sits between the 1px grid and the 2px data stroke.
const OVERLAY_STROKE_WIDTH = 1.5
const OVERLAY_DASH_LINE = '6 4'    // mean / median / reference horizontals
const OVERLAY_DASH_TREND = '5 3'   // the sloped trendline, a touch tighter
const OVERLAY_LABEL_HALO_WIDTH = 3 // the surface-color halo behind a label, via paint-order:stroke
const OVERLAY_LABEL_GAP = 4        // px the label sits off its line

// The bar-peak-line stroke weight: a sensible ~2px, matching GRAPH_DEFAULT_LINE_WIDTH so a bar+line
// combo reads like the line chart's own default weight rather than inventing a new visual language.
const BAR_PEAK_LINE_STROKE_WIDTH = 2

const LEGEND_SWATCH_SIZE = 12
const LEGEND_SWATCH_TEXT_GAP = 6
const LEGEND_ROW_HEIGHT = LEGEND_FONT_SIZE + 8

// ====== function-plot discontinuity heuristic ======
// Two adjacent finite samples with OPPOSITE sign, where at least one's magnitude is this many
// times the resolved y-domain's half-range, are treated as straddling an asymptote (tan(x), 1/x)
// rather than a genuine crossing — a pragmatic sign-change + magnitude heuristic (not symbolic
// limit analysis), per docs/reference/graph_equation_study.md Q4.
const ASYMPTOTE_MAGNITUDE_MULTIPLIER = 4

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
   // Reference overlays AUTO-EXTEND the domain (before nice-ticks) so a target line outside the data
   // range is always visible — the data rescales to fit it. Mean/trend are data-derived (already
   // inside the domain), so they need no extension.
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

   // ====== resolve per-type options (unset => GRAPH_DEFAULT_*, then clamped) ======
   const barWidthFraction = clamp(
      options.barWidth ?? GRAPH_DEFAULT_BAR_WIDTH, MIN_BAR_WIDTH_FRACTION, MAX_BAR_WIDTH_FRACTION)
   const lineStrokeWidth = clamp(
      options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH)
   const showPoints = options.showPoints ?? GRAPH_DEFAULT_SHOW_POINTS
   const areaFillOpacity = clamp(
      options.areaFillOpacity ?? GRAPH_DEFAULT_AREA_FILL_OPACITY, MIN_FILL_OPACITY, MAX_FILL_OPACITY)

   // ====== assemble ======
   const pieces: string[] = []
   pieces.push(renderGridlines(niceScale.ticks, yScale, tickLabels, plot, theme))
   pieces.push(renderAxes(plot, baselineY, theme))
   pieces.push(renderCategoryLabels(labels, xBand, plot, theme))

   if (type === 'bar') {
      pieces.push(renderSingleBars(labels, drawnSeries[0], data.categoryColors, xBand, yScale, baselineY, theme, options.showValues ?? false, barWidthFraction))
   } else if (type === 'bar-grouped') {
      pieces.push(renderGroupedBars(labels, drawnSeries, xBand, yScale, baselineY, theme, options.showValues ?? false, barWidthFraction))
   } else if (type === 'bar-stacked') {
      pieces.push(renderStackedBars(labels, drawnSeries, xBand, yScale, theme, barWidthFraction))
   } else if (type === 'area') {
      pieces.push(renderAreaSeries(labels, drawnSeries, xBand, yScale, baselineY, theme, lineStrokeWidth, showPoints, areaFillOpacity))
   } else {
      // 'line'
      pieces.push(renderLineSeries(labels, drawnSeries, xBand, yScale, theme, lineStrokeWidth, showPoints))
   }

   // The bar-top peak line is a DISPLAY option (traces the raw bars already drawn), so it is drawn
   // right after the bar marks — on top of them — and before the statistic overlays below. Bar
   // family only; a `line`/`area`/radial spec silently ignores the option.
   if ((type === 'bar' || type === 'bar-grouped' || type === 'bar-stacked') && options.barPeakLine === true) {
      pieces.push(renderBarPeakLines(type, labels, drawnSeries, xBand, yScale, theme))
   }

   // Overlays draw AFTER the data marks (z-order: on top of the data), reusing the same scales.
   if (options.overlays && options.overlays.length > 0) {
      pieces.push(renderOverlays(
         options.overlays, labels, drawnSeries, xBand, yScale, plot, niceScale.niceMin, niceScale.niceMax, theme))
   }

   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))
   if (legendWanted) pieces.push(renderLegend(drawnSeries, legendLayout, layout, theme))

   return element('g', {}, pieces.join(''))
}

// #####################
// # FUNCTION PLOT     #
// #####################

/**
 * Render a `function`-type graph spec (sampled equation curves over a continuous numeric domain)
 * to its inner SVG markup. Reuses the EXISTING, unmodified `renderLineSeries`/`buildPointRuns`
 * (via the {@link buildContinuousXAdapter} adapter from continuousAxis.ts) instead of a categorical
 * `BandScale`; the categorical `bar`/`bar-grouped`/`bar-stacked`/`line`/`area` paths above are
 * completely untouched by this function. Never throws on bad/empty input — an uncompileable
 * equation, an empty equation list, or a degenerate domain all degrade to a graceful chart with an
 * empty (or partially empty) curve set, never an exception.
 */
export function renderFunctionPlot(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   // v1 caps the number of drawn equations at the palette size, same cap every other series-based
   // chart type already uses.
   const equations = (spec.functionPlot?.equations ?? []).slice(0, MAX_SERIES)
   const { xMin, xMax, samples } = resolveFunctionDomain(spec.functionPlot?.domain)
   const sampleXPositions = sampleXValuesAcrossDomain(xMin, xMax, samples)
   // Used only as buildPointRuns'/renderMarkers' per-point tooltip label (point markers default OFF
   // for function charts, see below) — formatted x-values read sensibly if points are ever enabled.
   const sampleLabels = sampleXPositions.map(formatNumber)

   // ====== compile + sample each equation ======
   // An uncompileable expression contributes an all-null value list (draws nothing, never dropped
   // from the list) so its legend entry / palette slot still lines up with the other equations —
   // matching the "invalid never breaks the chart" contract every other graph/math parser honors.
   const rawValueLists: (number | null)[][] = equations.map(equation => {
      const compiled = compileExpression(equation.expression)
      if (compiled === null) return sampleXPositions.map(() => null)
      return sampleXPositions.map(x => evaluate(compiled, x))
   })

   // ====== y-domain: autoscale to the finite sampled range, NO forced zero baseline ======
   // (an arbitrary f(x), e.g. "100 + 0.001*x", should not be crushed against a forced-zero domain
   // the way bar/line-over-real-data charts are — see docs/reference/graph_equation_study.md Q4/6).
   const [domainMin, domainMax] = computeFunctionValueDomain(rawValueLists, options)
   const niceScale = niceTicks(domainMin, domainMax, TARGET_TICK_COUNT)
   const tickLabels = niceScale.ticks.map(formatNumber)

   // ====== discontinuity handling ======
   // True domain errors (sqrt(-1), 1/0, ...) are already `null` from evaluate() and fall straight
   // into the existing null-gap-breaks-the-polyline mechanism below with zero new code. The
   // asymptote heuristic additionally breaks a run between two finite-but-huge, opposite-signed
   // adjacent samples (tan(x), 1/x near zero) that would otherwise draw a near-vertical spike.
   const gappedValueLists = rawValueLists.map(
      values => applyAsymptoteGaps(values, niceScale.niceMin, niceScale.niceMax))

   const drawnSeries: GraphSeries[] = equations.map((equation, equationIndex) => ({
      name: equation.name,
      values: gappedValueLists[equationIndex],
      color: equation.color,
   }))

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
   // linearScale is the SAME generic affine map the y-axis already uses; reused as-is for x, per
   // the study's Q2 finding (no new scale primitive needed for a continuous x-axis).
   const yScale = linearScale([niceScale.niceMin, niceScale.niceMax], [plot.y + plot.height, plot.y])
   const xScale = linearScale([xMin, xMax], [plot.x, plot.x + plot.width])
   const xAdapter = buildContinuousXAdapter(sampleXPositions, xScale)
   const baselineValue = Math.min(niceScale.niceMax, Math.max(niceScale.niceMin, 0))
   const baselineY = yScale(baselineValue)

   const lineStrokeWidth = clamp(
      options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH)
   // Point markers default OFF for function charts (a sampled curve of dozens/hundreds of points is
   // visual noise, unlike a small genuine categorical series) — a LOCAL default distinct from
   // GRAPH_DEFAULT_SHOW_POINTS (true), which stays correct for real bar/line/area data.
   const showPoints = options.showPoints ?? false

   // ====== assemble ======
   const pieces: string[] = []
   pieces.push(renderGridlines(niceScale.ticks, yScale, tickLabels, plot, theme))
   pieces.push(renderAxes(plot, baselineY, theme))
   pieces.push(renderNumericXAxisLabels(xMin, xMax, xScale, plot, theme))
   pieces.push(renderLineSeries(sampleLabels, drawnSeries, xAdapter, yScale, theme, lineStrokeWidth, showPoints))
   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))
   if (legendWanted) pieces.push(renderLegend(drawnSeries, legendLayout, layout, theme))

   return element('g', {}, pieces.join(''))
}

/**
 * Resolve a (possibly absent/partial/malformed) {@link FunctionDomain} to sane, finite, ordered
 * bounds + a clamped sample count. A hand-edited fence can never produce a broken domain: any
 * non-finite field falls back to the documented default, an inverted range is swapped, and a
 * degenerate (equal) range is nudged open by 1.
 */
function resolveFunctionDomain(domain: FunctionDomain | undefined): {
   xMin: number
   xMax: number
   samples: number
} {
   let xMin = domain?.xMin
   let xMax = domain?.xMax
   let samples = domain?.samples

   if (xMin === undefined || !Number.isFinite(xMin)) xMin = FUNCTION_DEFAULT_X_MIN
   if (xMax === undefined || !Number.isFinite(xMax)) xMax = FUNCTION_DEFAULT_X_MAX
   if (xMin > xMax) { const swap = xMin; xMin = xMax; xMax = swap }
   if (xMin === xMax) xMax = xMin + 1

   if (samples === undefined || !Number.isFinite(samples)) samples = FUNCTION_DEFAULT_SAMPLES
   samples = Math.round(clamp(samples, FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES))

   return { xMin, xMax, samples }
}

/** Evenly spaced sample x-values across `[xMin, xMax]`, inclusive of both ends. */
function sampleXValuesAcrossDomain(xMin: number, xMax: number, samples: number): number[] {
   if (samples <= 1) return [xMin]
   const step = (xMax - xMin) / (samples - 1)
   const values: number[] = []
   for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
      values.push(xMin + sampleIndex * step)
   }
   return values
}

/**
 * The raw (pre-nice-tick) y-domain for a function chart: the min/max across every FINITE sampled
 * value of every equation, with NO folded-in zero baseline (decision 6 — bars/lines-over-real-data
 * fold in zero via {@link computeValueDomain}; an arbitrary f(x) should not be). Falls back to
 * [0, 1] when nothing finite was sampled (every equation invalid/empty). `yMin`/`yMax` overrides
 * still win, identical to every other cartesian type.
 */
function computeFunctionValueDomain(
   valueLists: (number | null)[][],
   options: GraphSpec['options'],
): [number, number] {
   let dataMin = Infinity
   let dataMax = -Infinity
   for (const values of valueLists) {
      for (const value of values) {
         if (value === null || value === undefined || !Number.isFinite(value)) continue
         if (value < dataMin) dataMin = value
         if (value > dataMax) dataMax = value
      }
   }
   if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      dataMin = 0
      dataMax = 1
   }
   const min = options.yMin !== undefined ? options.yMin : dataMin
   const max = options.yMax !== undefined ? options.yMax : dataMax
   return [min, max]
}

/**
 * Apply the asymptote heuristic: break the run between two adjacent FINITE samples that have
 * opposite sign AND at least one magnitude >= {@link ASYMPTOTE_MAGNITUDE_MULTIPLIER} x the
 * resolved y-domain's half-range, by nulling the second of the pair. This is deliberately a
 * pragmatic threshold, not an exact discontinuity detector (a pathological function could still
 * fool it) — see docs/reference/graph_equation_study.md Q4 for the documented rationale. A `null`
 * sample from a true domain error (sqrt(-1), 1/0, ...) already breaks the run via the existing
 * {@link buildPointRuns} gap logic and needs no help from this function.
 */
function applyAsymptoteGaps(
   values: (number | null)[],
   niceMin: number,
   niceMax: number,
): (number | null)[] {
   const halfRange = (niceMax - niceMin) / 2
   if (!Number.isFinite(halfRange) || halfRange <= 0) return values
   const magnitudeThreshold = halfRange * ASYMPTOTE_MAGNITUDE_MULTIPLIER
   const result = values.slice()
   for (let index = 0; index < result.length - 1; index++) {
      const current = result[index]
      const next = result[index + 1]
      if (current === null || next === null) continue
      const oppositeSign = (current > 0 && next < 0) || (current < 0 && next > 0)
      if (!oppositeSign) continue
      if (Math.abs(current) >= magnitudeThreshold || Math.abs(next) >= magnitudeThreshold) {
         result[index + 1] = null
      }
   }
   return result
}

// #####################
// # STATISTIC OVERLAYS #
// #####################

/** A plot rect passed around the overlay helpers (matches the layout's PlotRect shape). */
interface OverlayPlot { x: number; y: number; width: number; height: number }

/**
 * Draw every statistical overlay over the plot. Reuses the computed `yScale` / `xBand` / `plot`.
 * Per-series kinds (mean / median / trend) expand `series: 'all'` to one mark per drawn series
 * (each echoing that series' hue); a specific index that is not among the drawn series is skipped.
 * Reference is a single per-chart horizontal in neutral ink. Never throws on degenerate data — a
 * series with too few points, or a value off the domain, simply draws nothing.
 */
function renderOverlays(
   overlays: Overlay[],
   labels: string[],
   drawnSeries: GraphSeries[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   plot: OverlayPlot,
   niceMin: number,
   niceMax: number,
   theme: GraphTheme,
): string {
   const singleSeries = drawnSeries.length <= 1
   const parts: string[] = []

   for (const overlay of overlays) {
      if (overlay.kind === 'reference') {
         parts.push(renderReferenceOverlay(overlay, plot, yScale, niceMin, niceMax, theme))
         continue
      }
      // Computed kinds (mean / median / trend): resolve the target series, fanning out for 'all'.
      const targetIndices = overlay.series === 'all'
         ? drawnSeries.map((_series, index) => index)
         : [typeof overlay.series === 'number' ? overlay.series : 0]
      for (const seriesIndex of targetIndices) {
         if (seriesIndex < 0 || seriesIndex >= drawnSeries.length) continue
         const oneSeries = drawnSeries[seriesIndex]
         const color = resolveSeriesColor(seriesIndex, oneSeries.color, theme)
         if (overlay.kind === 'trend') {
            parts.push(renderTrendOverlay(
               overlay, oneSeries, labels, xBand, yScale, plot, color, singleSeries, theme))
         } else {
            parts.push(renderStatLineOverlay(
               overlay, oneSeries, plot, yScale, niceMin, niceMax, color, singleSeries, theme))
         }
      }
   }
   return element('g', {}, parts.join(''))
}

/** A per-chart reference line: a neutral-ink horizontal at the constant value, off-domain skipped. */
function renderReferenceOverlay(
   overlay: Overlay,
   plot: OverlayPlot,
   yScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   theme: GraphTheme,
): string {
   const value = overlay.value
   if (value === undefined || !Number.isFinite(value)) return ''
   // The domain was auto-extended to include this value, so it is normally in range; the clip is a
   // defensive guard (e.g. a hand-pinned yMin/yMax that excludes it).
   if (value < niceMin || value > niceMax) return ''
   const lineY = yScale(value)
   const label = overlay.label && overlay.label !== '' ? overlay.label : formatNumber(value)
   return horizontalOverlay(lineY, label, plot, theme.ink.text, OVERLAY_DASH_LINE, theme)
}

/** A per-series mean/median line: a series-hued horizontal at the computed stat, off-domain skipped. */
function renderStatLineOverlay(
   overlay: Overlay,
   oneSeries: GraphSeries,
   plot: OverlayPlot,
   yScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   color: string,
   singleSeries: boolean,
   theme: GraphTheme,
): string {
   const stat = overlay.kind === 'median' ? medianOf(oneSeries.values) : meanOf(oneSeries.values)
   if (stat === null || stat < niceMin || stat > niceMax) return ''
   const lineY = yScale(stat)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultStatLabel(overlay.kind, oneSeries.name, stat, singleSeries)
   return horizontalOverlay(lineY, label, plot, color, OVERLAY_DASH_LINE, theme)
}

/** A per-series linear trendline: a series-hued sloped segment analytically clipped to the plot rect. */
function renderTrendOverlay(
   overlay: Overlay,
   oneSeries: GraphSeries,
   labels: string[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   plot: OverlayPlot,
   color: string,
   singleSeries: boolean,
   theme: GraphTheme,
): string {
   const fit = linearRegression(oneSeries.values)
   if (fit === null) return '' // fewer than 2 finite points: no line to draw

   const lastIndex = labels.length - 1
   const startX = xBand.center(0)
   const endX = xBand.center(lastIndex)
   const startY = yScale(fit.intercept)
   const endY = yScale(fit.intercept + fit.slope * lastIndex)

   // Analytic clamp to the plot rect (NO SVG clipPath — a fixed id would collide across the many
   // chart SVGs inlined into one exported HTML doc): clip the segment to the plot's vertical band.
   const clipped = clipSegmentToBand(startX, startY, endX, endY, plot.y, plot.y + plot.height)
   if (clipped === null) return '' // the whole segment sits off the plot vertically

   const line = selfClosingElement('line', {
      x1: clipped.x1,
      y1: clipped.y1,
      x2: clipped.x2,
      y2: clipped.y2,
      stroke: color,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'stroke-dasharray': OVERLAY_DASH_TREND,
      'stroke-linecap': 'round',
   })
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultTrendLabel(fit.slope, fit.intercept, fit.rSquared, overlay.showEquation ?? false)
   // Anchor the label at the clipped right end, nudged inward so it never spills past the plot edge.
   const labelText = overlayLabel(
      Math.min(clipped.x2, plot.x + plot.width) - OVERLAY_LABEL_GAP,
      clipped.y2 - OVERLAY_LABEL_GAP,
      'end',
      label,
      theme)
   return element('g', {}, line + labelText)
}

/** Draw a full-width horizontal dashed overlay at `lineY` with a right-anchored haloed label. */
function horizontalOverlay(
   lineY: number,
   label: string,
   plot: OverlayPlot,
   color: string,
   dash: string,
   theme: GraphTheme,
): string {
   const line = selfClosingElement('line', {
      x1: plot.x,
      y1: lineY,
      x2: plot.x + plot.width,
      y2: lineY,
      stroke: color,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'stroke-dasharray': dash,
      'stroke-linecap': 'round',
   })
   const labelText = overlayLabel(
      plot.x + plot.width - OVERLAY_LABEL_GAP,
      lineY - OVERLAY_LABEL_GAP,
      'end',
      label,
      theme)
   return element('g', {}, line + labelText)
}

/**
 * A small overlay label in PRIMARY ink (never a series hue — a light categorical color is illegible
 * as text), wearing a surface-color halo via `paint-order:stroke` so it stays readable where it
 * crosses gridlines and data marks (the same "surface doing the separating" principle as a marker ring).
 */
function overlayLabel(
   x: number,
   y: number,
   anchor: 'start' | 'middle' | 'end',
   text: string,
   theme: GraphTheme,
): string {
   return textElement({
      x,
      y,
      'text-anchor': anchor,
      'font-size': TICK_FONT_SIZE,
      'font-variant-numeric': 'tabular-nums',
      fill: theme.ink.text,
      stroke: theme.ink.surface,
      'stroke-width': OVERLAY_LABEL_HALO_WIDTH,
      'stroke-linejoin': 'round',
      'paint-order': 'stroke',
   }, text)
}

/** The default label for a mean/median line: `mean 42.3`, or `Revenue · mean 42.3` when multi-series. */
function defaultStatLabel(
   kind: 'mean' | 'median',
   seriesName: string,
   value: number,
   singleSeries: boolean,
   ): string {
   const word = kind === 'median' ? 'median' : 'mean'
   const stat = `${word} ${formatNumber(value)}`
   return singleSeries || seriesName === '' ? stat : `${seriesName} · ${stat}`
}

/** The default trend label: `R² 0.94`, plus `y = 2.5x + 1` prepended when `showEquation`. */
function defaultTrendLabel(
   slope: number,
   intercept: number,
   rSquared: number,
   showEquation: boolean,
): string {
   const rSquaredText = `R² ${formatNumber(roundToDigits(rSquared, 3))}`
   if (!showEquation) return rSquaredText
   const sign = intercept < 0 ? '-' : '+'
   const equation = `y = ${formatNumber(roundToDigits(slope, 3))}x ${sign} ${formatNumber(roundToDigits(Math.abs(intercept), 3))}`
   return `${equation} · ${rSquaredText}`
}

/**
 * Clip the segment (x1,y1)-(x2,y2) to the horizontal band [bandTop, bandBottom] (the plot's vertical
 * extent; x already sits within the plot). Returns the trimmed endpoints, or null when the whole
 * segment lies above or below the band. Pure line-parameter math — no SVG clipPath needed.
 */
function clipSegmentToBand(
   x1: number,
   y1: number,
   x2: number,
   y2: number,
   bandTop: number,
   bandBottom: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
   const deltaY = y2 - y1
   let parameterMin = 0
   let parameterMax = 1
   if (deltaY === 0) {
      // A flat segment: either wholly inside the band or wholly outside it.
      if (y1 < bandTop || y1 > bandBottom) return null
   } else {
      const parameterAtTop = (bandTop - y1) / deltaY
      const parameterAtBottom = (bandBottom - y1) / deltaY
      parameterMin = Math.max(0, Math.min(parameterAtTop, parameterAtBottom))
      parameterMax = Math.min(1, Math.max(parameterAtTop, parameterAtBottom))
      if (parameterMin > parameterMax) return null // segment entirely outside the band
   }
   const deltaX = x2 - x1
   return {
      x1: x1 + deltaX * parameterMin,
      y1: y1 + deltaY * parameterMin,
      x2: x1 + deltaX * parameterMax,
      y2: y1 + deltaY * parameterMax,
   }
}

/** Round a value to a fixed number of fractional digits (kills float drift on displayed stats). */
function roundToDigits(value: number, digits: number): number {
   const factor = 10 ** digits
   return Math.round(value * factor) / factor
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

   // Fold every reference-overlay value into the raw domain so a target line beyond the data always
   // stays on-canvas (the data rescales to fit it). Done before the yMin/yMax overrides below, which
   // still win when the author has pinned an explicit floor/ceiling.
   for (const overlay of options.overlays ?? []) {
      if (overlay.kind !== 'reference') continue
      const value = overlay.value
      if (value === undefined || !Number.isFinite(value)) continue
      if (value > dataMax) dataMax = value
      if (value < dataMin) dataMin = value
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

/**
 * Single-series bars: one rect per category, capped at 24px and centered in its band.
 *
 * Coloring is UNIFORM by default (every bar wears the one series' resolved base color, so a plain
 * simple-bar chart is byte-identical to before per-bar color existed). A per-category override in
 * `categoryColors[categoryIndex]` recolors just that one bar — the same `categoryColors` array the
 * radial families use for per-slice color, here defaulting to the uniform base instead of a palette
 * slot per index.
 */
function renderSingleBars(
   labels: string[],
   series: GraphSeries,
   categoryColors: (string | undefined)[] | undefined,
   xBand: { center(index: number): number; bandwidth: number },
   yScale: (value: number) => number,
   baselineY: number,
   theme: GraphTheme,
   showValues: boolean,
   barWidthFraction: number,
): string {
   const baseColor = resolveSeriesColor(0, series.color, theme)
   // The band-capped base thickness is what the bar draws at full width today; the fraction then
   // scales it down (at 1, the default, the bar is unchanged), so the control always has an effect
   // even for wide bands where the 24px cap already governs.
   const cappedBase = Math.min(xBand.bandwidth, MAX_BAR_THICKNESS)
   const barWidth = cappedBase * barWidthFraction
   const parts: string[] = []
   for (let index = 0; index < labels.length; index++) {
      const value = series.values[index]
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      const valueY = yScale(value)
      const rectY = Math.min(baselineY, valueY)
      const rectHeight = Math.abs(valueY - baselineY)
      const rectX = xBand.center(index) - barWidth / 2
      // Per-bar override wins; otherwise the uniform series base color (default -> byte-identical).
      const override = categoryColors?.[index]
      const color = override && override.trim() !== '' ? override : baseColor
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
   barWidthFraction: number,
): string {
   const seriesCount = series.length
   const subStep = xBand.bandwidth / seriesCount
   // Base sub-bar thickness (full sub-slot minus the 2px surface gap, capped) is today's width; the
   // fraction scales it down (at 1, the default, it is unchanged), floored at 1px so it stays drawn.
   const cappedBase = Math.min(subStep - SURFACE_GAP, MAX_BAR_THICKNESS)
   const barWidth = Math.max(1, cappedBase * barWidthFraction)
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
   barWidthFraction: number,
): string {
   // Band-capped base thickness (today's width) scaled by the fraction (unchanged at 1, the default).
   const cappedBase = Math.min(xBand.bandwidth, MAX_BAR_THICKNESS)
   const barWidth = cappedBase * barWidthFraction
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

// ####################
// # BAR PEAK LINE     #
// ####################

/**
 * Draw a line through each drawn series' bar-top peaks — a bar+line combo — for the bar-family
 * chart types only. Reuses `buildPointRuns` (defined below, in the LINE/AREA section) so `null`
 * gaps break the line exactly like a line chart does, and reuses the same round-capped polyline
 * draw. Called AFTER the bar marks push their pieces (see `renderCartesian`), so it sits visually
 * on top of the bars.
 *
 *   - bar (single series): the line follows the one drawn series' bar tops (band center x).
 *   - bar-grouped: one line PER drawn series, each through that series' own sub-bars (its own x
 *     offset within each category's band — the same `bandStart + subStep*seriesIndex + subStep/2`
 *     center {@link renderGroupedBars} places its rects at).
 *   - bar-stacked: ONE line through each category's cumulative stack top (the total across every
 *     drawn series), colored with the topmost (last) series' color since that is the segment the
 *     line visually rides along.
 */
function renderBarPeakLines(
   type: GraphSpec['type'],
   labels: string[],
   series: GraphSeries[],
   xBand: { start(index: number): number; center(index: number): number; bandwidth: number },
   yScale: (value: number) => number,
   theme: GraphTheme,
): string {
   if (series.length === 0) return ''

   if (type === 'bar-stacked') {
      const topSeriesIndex = series.length - 1
      const color = resolveSeriesColor(topSeriesIndex, series[topSeriesIndex].color, theme)
      const stackedTotals = computeStackedTotals(labels, series)
      const totalsSeries: GraphSeries = { name: '', values: stackedTotals }
      return renderOnePeakLine(labels, totalsSeries, xBand, yScale, color)
   }

   if (type === 'bar-grouped') {
      const seriesCount = series.length
      const subStep = xBand.bandwidth / seriesCount
      const parts: string[] = []
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
         const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
         const perSeriesXBand = {
            center: (categoryIndex: number): number =>
               xBand.start(categoryIndex) + subStep * seriesIndex + subStep / 2,
         }
         parts.push(renderOnePeakLine(labels, series[seriesIndex], perSeriesXBand, yScale, color))
      }
      return element('g', {}, parts.join(''))
   }

   // 'bar' (single series): the same band-center x every renderSingleBars rect already sits at.
   const color = resolveSeriesColor(0, series[0].color, theme)
   return renderOnePeakLine(labels, series[0], xBand, yScale, color)
}

/**
 * Per-category cumulative total across every drawn series, for the bar-stacked peak line. A
 * missing/malformed cell contributes zero (mirrors how {@link renderStackedBars} treats it — the
 * cursor simply does not move for that series), matching the "bar treats a gap as zero" semantics
 * documented on {@link GraphSeries}. A category is a gap (`null`, breaking the line) only when
 * EVERY series is missing there — the stack has no drawn segment at all to trace a peak through.
 */
function computeStackedTotals(labels: string[], series: GraphSeries[]): (number | null)[] {
   const totals: (number | null)[] = []
   for (let categoryIndex = 0; categoryIndex < labels.length; categoryIndex++) {
      let total = 0
      let sawFiniteValue = false
      for (const oneSeries of series) {
         const value = oneSeries.values[categoryIndex]
         if (value === null || value === undefined || !Number.isFinite(value)) continue
         total += value
         sawFiniteValue = true
      }
      totals.push(sawFiniteValue ? total : null)
   }
   return totals
}

/**
 * Draw one peak-line series as a round-capped polyline per contiguous run (breaking across `null`
 * gaps), reusing {@link buildPointRuns}. No point markers — kept visually distinct from a full
 * line chart, per the bar-peak-line display option's intent.
 */
function renderOnePeakLine(
   labels: string[],
   series: GraphSeries,
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   color: string,
): string {
   const runs = buildPointRuns(labels, series, xBand, yScale)
   const parts: string[] = []
   for (const run of runs) {
      if (run.points.length < 2) continue // a lone peak has nothing to connect to
      const pointsAttribute = run.points
         .map(point => `${roundForPath(point.x)},${roundForPath(point.y)}`)
         .join(' ')
      parts.push(selfClosingElement('polyline', {
         points: pointsAttribute,
         fill: 'none',
         stroke: color,
         'stroke-width': BAR_PEAK_LINE_STROKE_WIDTH,
         'stroke-linejoin': 'round',
         'stroke-linecap': 'round',
      }))
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

/** Line series: one polyline per contiguous run, round-capped, plus optional point markers. */
function renderLineSeries(
   labels: string[],
   series: GraphSeries[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   theme: GraphTheme,
   lineStrokeWidth: number,
   showPoints: boolean,
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
            'stroke-width': lineStrokeWidth,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
         }))
      }
      if (showPoints) parts.push(renderMarkers(runs, series[seriesIndex].name, color, theme))
   }
   return element('g', {}, parts.join(''))
}

/** Area series: a filled polygon to the baseline, plus the line and optional point markers. */
function renderAreaSeries(
   labels: string[],
   series: GraphSeries[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   baselineY: number,
   theme: GraphTheme,
   lineStrokeWidth: number,
   showPoints: boolean,
   areaFillOpacity: number,
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
            'fill-opacity': areaFillOpacity,
            stroke: 'none',
         }))
         if (run.points.length > 1) {
            const linePoints = run.points.map(point => `${roundForPath(point.x)},${roundForPath(point.y)}`).join(' ')
            parts.push(selfClosingElement('polyline', {
               points: linePoints,
               fill: 'none',
               stroke: color,
               'stroke-width': lineStrokeWidth,
               'stroke-linejoin': 'round',
               'stroke-linecap': 'round',
            }))
         }
      }
      if (showPoints) parts.push(renderMarkers(runs, series[seriesIndex].name, color, theme))
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

/** Clamp a value into [min, max]; a non-finite input falls back to the min (defensive). */
function clamp(value: number, min: number, max: number): number {
   if (!Number.isFinite(value)) return min
   return Math.min(max, Math.max(min, value))
}

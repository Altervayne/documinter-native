/*
 * The cartesian rendering core (bar / bar-grouped / bar-stacked / line / area), plus the
 * function / scatter / histogram renderers and every statistical overlay. Each render function
 * returns inner SVG markup; index.ts wraps it. Numeric scaling is delegated to scale.ts and all
 * text/margin math to layout.ts; nothing here measures the DOM.
 *
 * Mark specs: bars capped at 24px with a 2px surface gap, 2px round-capped lines, >=8px markers
 * with a 2px surface ring, area fills at ~10% opacity, and a legend whenever there is >1 series.
 */

import type { GraphSpec, GraphTheme, GraphSeries, Overlay, FunctionDomain, ScatterSeries, EquationSeries } from './types'
import {
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
   GRAPH_DEFAULT_OVERLAY_SIGMA,
   GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW,
   GRAPH_DEFAULT_TREND_DEGREE,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
   FUNCTION_MIN_SAMPLES,
   FUNCTION_MAX_SAMPLES,
   LOG_SCALE_UNSUPPORTED_TYPES,
} from './types'
import { MAX_SERIES, resolveSeriesColor } from './palette'
import {
   mean as meanOf, median as medianOf, linearRegression, linearRegressionXY,
   stddev as stddevOf, extent as extentOf, movingAverage,
   evaluatePolynomial, polynomialFit, exponentialFit, logarithmicFit, powerFit,
} from './stats'
import type { Point } from './stats'
import { linearScale, niceTicks, logScale, niceLogTicks, bandScale } from './scale'
import { compileExpression, evaluate } from './expr'
import type { CompiledExpression } from './expr'
import { computeHistogramBins } from './histogram'
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

// Per-type option clamp bounds: an unset option resolves to its GRAPH_DEFAULT_* fallback, then
// clamps to these so a hand-edited fence can never produce a broken chart.
const MIN_BAR_WIDTH_FRACTION = 0.1
const MAX_BAR_WIDTH_FRACTION = 1
const MIN_LINE_WIDTH = 0.5
const MAX_LINE_WIDTH = 12
const MIN_FILL_OPACITY = 0
const MAX_FILL_OPACITY = 1

// Overlay styling: dashed so an overlay never reads as a gridline or a data line, ~1.5px between
// the 1px grid and the 2px data stroke.
const OVERLAY_STROKE_WIDTH = 1.5
const OVERLAY_DASH_LINE = '6 4'    // mean / median / reference horizontals
const OVERLAY_DASH_TREND = '5 3'   // trendline / sampled curve / moving average, a touch tighter
const OVERLAY_LABEL_HALO_WIDTH = 3 // surface-color halo behind a label, via paint-order:stroke
const OVERLAY_LABEL_GAP = 4        // px the label sits off its line

// Summary band (stddev / range): a low-opacity fill so it reads as a soft region behind the data,
// with faint dashed edge lines marking the two boundaries.
const OVERLAY_BAND_FILL_OPACITY = 0.12
const OVERLAY_BAND_EDGE_OPACITY = 0.5

// A non-linear fitted curve is sampled into a clipped polyline (a straight segment fits only the
// linear case). ~80 points reads smooth at the canvas width without bloating the SVG.
const TREND_CURVE_SAMPLE_COUNT = 80

// Bar-peak-line stroke weight, matching GRAPH_DEFAULT_LINE_WIDTH so a bar+line combo reads like the
// line chart's own default weight.
const BAR_PEAK_LINE_STROKE_WIDTH = 2

const LEGEND_SWATCH_SIZE = 12
const LEGEND_SWATCH_TEXT_GAP = 6
const LEGEND_ROW_HEIGHT = LEGEND_FONT_SIZE + 8

// Custom-origin ("textbook" / four-quadrant) axes, function/scatter only.
const TEXTBOOK_TICK_MARK_HALF_LENGTH = 4 // half-length of a tick straddling a crossing axis line
const TEXTBOOK_TICK_LABEL_GAP = 4        // px between a tick mark and its number label
// A tick label within this many px of the OTHER crossing axis is the origin's own label, dropped so
// the two zero labels never collide. An off-domain origin lands no tick this close, so none is dropped.
const AXIS_CROSSING_LABEL_SKIP_PX = 1

// The value axis's resolved mode, threaded through every helper that needs to know whether a value
// <= 0 is plottable (log is undefined at <= 0). See the VALUE DOMAIN section for the policy.
type AxisMode = 'linear' | 'log'

/** Opacity of a log-scale MINOR (1-2-5) gridline, fainter than a major line so it reads as a density
 *  cue only. */
const MINOR_GRIDLINE_OPACITY = 0.5

// Asymptote heuristic: two adjacent finite samples of opposite sign, at least one's magnitude this
// many times the y-domain half-range, are treated as straddling an asymptote (tan(x), 1/x), not a
// genuine crossing. Pragmatic, not symbolic limit analysis.
const ASYMPTOTE_MAGNITUDE_MULTIPLIER = 4

// Equation overlay: sample count across the host's category-index domain [0, labelCount-1].
const EQUATION_OVERLAY_SAMPLE_COUNT = 120
// A fixed palette slot for the equation curve, never a data series' hue (an arbitrary f(x) is not
// "series 6"): the validated palette's violet slot, stable via resolveSeriesColor's wrap-around.
const EQUATION_OVERLAY_PALETTE_SLOT = 6

// ####################
// # PUBLIC RENDERER  #
// ####################

/** Render a cartesian graph spec to inner SVG markup. Assumes non-empty data (index.ts screens
 *  empty specs and emits a placeholder). */
export function renderCartesian(spec: GraphSpec, theme: GraphTheme): string {
   const { type, data, options } = spec
   const labels = data.labels
   const cappedSeries = data.series.slice(0, MAX_SERIES)

   // A plain `bar` renders the first series only; grouped/stacked read every capped series.
   const drawnSeries: GraphSeries[] = type === 'bar' ? cappedSeries.slice(0, 1) : cappedSeries

   // Reference overlays auto-extend the domain (before nice-ticks) so a target line outside the data
   // range stays visible. Mean/trend are data-derived, so they need no extension.
   //
   // Log policy: `bar-stacked` never gets a log axis, so it skips the unfolded probe. Every other
   // type is log-eligible only when its raw domain (before the zero-baseline fold and yMin/yMax
   // overrides) is strictly positive; a domain touching zero or negative falls back to the ordinary
   // zero-folded linear domain, never a clamp, never NaN geometry.
   let axisMode: AxisMode = 'linear'
   let domainMin: number
   let domainMax: number
   if (options.yScale === 'log' && !LOG_SCALE_UNSUPPORTED_TYPES.has(type)) {
      const [unfoldedMin, unfoldedMax] = computeValueDomain(type, labels, drawnSeries, options, false)
      if (isPositiveFiniteDomain(unfoldedMin, unfoldedMax)) {
         axisMode = 'log'
         domainMin = unfoldedMin
         domainMax = unfoldedMax
      } else {
         ;[domainMin, domainMax] = computeValueDomain(type, labels, drawnSeries, options, true)
      }
   } else {
      ;[domainMin, domainMax] = computeValueDomain(type, labels, drawnSeries, options, true)
   }

   let niceMin: number
   let niceMax: number
   let ticks: number[]
   let minorTicks: number[]
   if (axisMode === 'log') {
      const niceLog = niceLogTicks(domainMin, domainMax, TARGET_TICK_COUNT)
      niceMin = niceLog.niceMin
      niceMax = niceLog.niceMax
      ticks = niceLog.ticks
      minorTicks = niceLog.minorTicks
   } else {
      const niceLinear = niceTicks(domainMin, domainMax, TARGET_TICK_COUNT)
      niceMin = niceLinear.niceMin
      niceMax = niceLinear.niceMax
      ticks = niceLinear.ticks
      minorTicks = []
   }
   const tickLabels = ticks.map(formatNumber)

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
   const yScale = axisMode === 'log'
      ? logScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
      : linearScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
   const xBand = bandScale(labels.length, [plot.x, plot.x + plot.width])
   // The x-axis baseline: the zero-crossing on a linear axis, or the axis floor (niceMin) on a log
   // axis, where zero does not exist. Bars grow from the floor in log mode, not an implied zero.
   const baselineValue = axisMode === 'log' ? niceMin : Math.min(niceMax, Math.max(niceMin, 0))
   const baselineY = yScale(baselineValue)

   // Resolve per-type options: unset => GRAPH_DEFAULT_*, then clamped.
   const barWidthFraction = clamp(
      options.barWidth ?? GRAPH_DEFAULT_BAR_WIDTH, MIN_BAR_WIDTH_FRACTION, MAX_BAR_WIDTH_FRACTION)
   const lineStrokeWidth = clamp(
      options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH)
   const showPoints = options.showPoints ?? GRAPH_DEFAULT_SHOW_POINTS
   const areaFillOpacity = clamp(
      options.areaFillOpacity ?? GRAPH_DEFAULT_AREA_FILL_OPACITY, MIN_FILL_OPACITY, MAX_FILL_OPACITY)

   // ====== assemble ======
   const pieces: string[] = []
   pieces.push(renderGridlines(ticks, yScale, tickLabels, plot, theme, minorTicks))
   pieces.push(renderAxes(plot, baselineY, theme))
   pieces.push(renderCategoryLabels(labels, xBand, plot, theme))

   if (type === 'bar') {
      pieces.push(renderSingleBars(labels, drawnSeries[0], data.categoryColors, xBand, yScale, baselineY, theme, options.showValues ?? false, barWidthFraction, axisMode))
   } else if (type === 'bar-grouped') {
      pieces.push(renderGroupedBars(labels, drawnSeries, xBand, yScale, baselineY, theme, options.showValues ?? false, barWidthFraction, axisMode))
   } else if (type === 'bar-stacked') {
      pieces.push(renderStackedBars(labels, drawnSeries, xBand, yScale, theme, barWidthFraction))
   } else if (type === 'area') {
      pieces.push(renderAreaSeries(labels, drawnSeries, xBand, yScale, baselineY, theme, lineStrokeWidth, showPoints, areaFillOpacity, axisMode))
   } else {
      // 'line'
      pieces.push(renderLineSeries(labels, drawnSeries, xBand, yScale, theme, lineStrokeWidth, showPoints, axisMode))
   }

   // The bar-top peak line traces the bars already drawn, so it draws right after them, on top,
   // before the overlays. Bar family only.
   if ((type === 'bar' || type === 'bar-grouped' || type === 'bar-stacked') && options.barPeakLine === true) {
      pieces.push(renderBarPeakLines(type, labels, drawnSeries, xBand, yScale, theme, axisMode))
   }

   // Overlays draw after the data marks (on top), reusing the same scales.
   if (options.overlays && options.overlays.length > 0) {
      pieces.push(renderOverlays(
         options.overlays, labels, drawnSeries, xBand, yScale, plot, niceMin, niceMax, theme))
   }

   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))
   if (legendWanted) pieces.push(renderLegend(drawnSeries, legendLayout, layout, theme))

   return element('g', {}, pieces.join(''))
}

// #####################
// # FUNCTION PLOT     #
// #####################

/** Render a `function`-type spec (sampled equation curves over a continuous numeric domain) to
 *  inner SVG markup, reusing `renderLineSeries`/`buildPointRuns` via {@link buildContinuousXAdapter}
 *  instead of a categorical band. Never throws: bad input degrades to an empty curve set. */
export function renderFunctionPlot(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   const { equations, xMin, xMax, sampleXPositions, rawValueLists } = sampleFunctionEquations(spec)
   // Only used as the per-point tooltip label (point markers default off for function charts).
   const sampleLabels = sampleXPositions.map(formatNumber)

   // y-domain: autoscale to the finite sampled range, no forced zero baseline (an arbitrary f(x)
   // like "100 + 0.001*x" should not be crushed against a forced zero the way bar/line data is).
   const [domainMin, domainMax] = computeFunctionValueDomain(rawValueLists, options)

   // `function` never zero-folds, so domainMin/Max are already the unfolded bounds a log-eligibility
   // check needs. Log is undefined at <= 0, so an out-of-range domain falls back to linear.
   const axisMode: AxisMode = options.yScale === 'log' && isPositiveFiniteDomain(domainMin, domainMax)
      ? 'log' : 'linear'

   let niceMin: number
   let niceMax: number
   let ticks: number[]
   let minorTicks: number[]
   if (axisMode === 'log') {
      const niceLog = niceLogTicks(domainMin, domainMax, TARGET_TICK_COUNT)
      niceMin = niceLog.niceMin
      niceMax = niceLog.niceMax
      ticks = niceLog.ticks
      minorTicks = niceLog.minorTicks
   } else {
      const niceLinear = niceTicks(domainMin, domainMax, TARGET_TICK_COUNT)
      niceMin = niceLinear.niceMin
      niceMax = niceLinear.niceMax
      ticks = niceLinear.ticks
      minorTicks = []
   }
   const tickLabels = ticks.map(formatNumber)

   // Domain errors are already null from evaluate() and break the polyline via the null-gap path.
   // The asymptote heuristic additionally breaks a run between two finite-but-huge, opposite-signed
   // samples (tan(x), 1/x near zero) to avoid a near-vertical spike. A no-op on a log-eligible domain.
   const gappedValueLists = rawValueLists.map(
      values => applyAsymptoteGaps(values, niceMin, niceMax))

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

   // The x-axis always stays linear here; only the value (y) axis switches to log.
   const yScale = axisMode === 'log'
      ? logScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
      : linearScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
   // A vertical `reference` overlay widens the drawn x-axis domain (not the sampling domain, which
   // stays [xMin, xMax]) so a target line beyond the sampled range stays on-canvas.
   const [axisXMin, axisXMax] = foldReferenceOverlaysIntoDomain(xMin, xMax, options.overlays, 'vertical')
   const xScale = linearScale([axisXMin, axisXMax], [plot.x, plot.x + plot.width])
   const xAdapter = buildContinuousXAdapter(sampleXPositions, xScale)
   const baselineValue = axisMode === 'log' ? niceMin : Math.min(niceMax, Math.max(niceMin, 0))
   const baselineY = yScale(baselineValue)

   const lineStrokeWidth = clamp(
      options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH)
   // Point markers default OFF for function charts (a dense sampled curve is visual noise), a local
   // default distinct from GRAPH_DEFAULT_SHOW_POINTS.
   const showPoints = options.showPoints ?? false

   // A custom axisOrigin draws crossing "textbook" axes instead of edge axes, but only on a linear
   // value axis (ignored under a log scale).
   const axisOrigin = options.axisOrigin
   const pieces: string[] = []
   if (axisOrigin !== undefined && axisMode !== 'log') {
      pieces.push(renderTextbookAxes(axisOrigin, ticks, axisXMin, axisXMax, xScale, yScale, plot, theme))
   } else {
      pieces.push(renderGridlines(ticks, yScale, tickLabels, plot, theme, minorTicks))
      pieces.push(renderAxes(plot, baselineY, theme))
      pieces.push(renderNumericXAxisLabels(axisXMin, axisXMax, xScale, plot, theme))
   }
   pieces.push(renderLineSeries(sampleLabels, drawnSeries, xAdapter, yScale, theme, lineStrokeWidth, showPoints, axisMode))
   // Only reference overlays apply to a function chart (no discrete series to average/fit); the
   // others are skipped.
   if (options.overlays && options.overlays.length > 0) {
      pieces.push(renderFunctionReferenceOverlays(
         options.overlays, plot, xScale, yScale, axisXMin, axisXMax, niceMin, niceMax, theme))
   }
   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))
   if (legendWanted) pieces.push(renderLegend(drawnSeries, legendLayout, layout, theme))

   return element('g', {}, pieces.join(''))
}

/** Resolve a (possibly absent/partial/malformed) {@link FunctionDomain} to finite, ordered bounds +
 *  a clamped sample count: a non-finite field falls back to the default, an inverted range is
 *  swapped, a degenerate range is nudged open by 1. */
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

/** Resolve a `function` chart's numeric domain and sample every equation across it, the shared
 *  source of truth `renderFunctionPlot` and {@link computeFunctionYDomain} both build on so they
 *  never drift. An uncompileable expression contributes an all-null value list. */
function sampleFunctionEquations(spec: GraphSpec): {
   equations: EquationSeries[]
   xMin: number
   xMax: number
   sampleXPositions: number[]
   rawValueLists: (number | null)[][]
} {
   const equations = (spec.functionPlot?.equations ?? []).slice(0, MAX_SERIES)
   const { xMin, xMax, samples } = resolveFunctionDomain(spec.functionPlot?.domain)
   const sampleXPositions = sampleXValuesAcrossDomain(xMin, xMax, samples)
   const rawValueLists: (number | null)[][] = equations.map(equation => {
      const compiled = compileExpression(equation.expression)
      if (compiled === null) return sampleXPositions.map(() => null)
      return sampleXPositions.map(x => evaluate(compiled, x))
   })
   return { equations, xMin, xMax, sampleXPositions, rawValueLists }
}

/** A `function` chart's raw (pre-nice-tick) sampled y-domain, exactly what `renderFunctionPlot`
 *  resolves for its own axis-mode decision. Exported so `graphEdit.ts`'s log-scale fallback notice
 *  tests eligibility without re-implementing the expression-sampling logic. */
export function computeFunctionYDomain(spec: GraphSpec): [number, number] {
   const { rawValueLists } = sampleFunctionEquations(spec)
   return computeFunctionValueDomain(rawValueLists, spec.options ?? {})
}

/** The raw y-domain for a function chart: the min/max over every finite sampled value, with no
 *  folded-in zero baseline (an arbitrary f(x) should not be crushed against zero). Falls back to
 *  [0, 1] when nothing finite was sampled. `yMin`/`yMax` overrides still win. */
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
   // Fold every horizontal reference value in so a y = target line beyond the sampled range stays
   // on-canvas. Before the yMin/yMax overrides, which still win.
   const [foldedMin, foldedMax] = foldReferenceOverlaysIntoDomain(dataMin, dataMax, options.overlays)
   const min = options.yMin !== undefined ? options.yMin : foldedMin
   const max = options.yMax !== undefined ? options.yMax : foldedMax
   return [min, max]
}

/** Break the run between two adjacent finite samples of opposite sign where at least one magnitude
 *  >= {@link ASYMPTOTE_MAGNITUDE_MULTIPLIER} x the y-domain half-range, by nulling the second. A
 *  pragmatic threshold, not an exact discontinuity detector. */
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
// # SCATTER PLOT      #
// #####################

/** Render a `scatter`-type spec (real (x, y) point pairs, both axes autoscaled from the data) to
 *  inner SVG markup. Points are drawn directly at `xScale(point.x)`/`yScale(point.y)`, no band
 *  adapter, since scatter points share no category index. Never throws: bad points draw nothing. */
export function renderScatterPlot(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   const series = (spec.scatterPlot?.series ?? []).slice(0, MAX_SERIES)

   // Autoscale x AND y across every finite point, no forced zero baseline. A vertical reference
   // widens x, a horizontal reference widens y (both before the yMin/yMax overrides, which still win).
   const rawDomain = computeScatterPointDomain(series)
   const [foldedXMin, foldedXMax] = foldReferenceOverlaysIntoDomain(
      rawDomain.xMin, rawDomain.xMax, options.overlays, 'vertical')
   const xNice = niceTicks(foldedXMin, foldedXMax, TARGET_TICK_COUNT)
   const [foldedYMin, foldedYMax] = foldReferenceOverlaysIntoDomain(
      rawDomain.yMin, rawDomain.yMax, options.overlays)
   const resolvedYMin = options.yMin !== undefined ? options.yMin : foldedYMin
   const resolvedYMax = options.yMax !== undefined ? options.yMax : foldedYMax

   // Axis mode is Y only; x stays linear. resolvedYMin/Max are already the unfolded bounds the
   // log-eligibility check needs; a domain touching zero or negative falls back to linear.
   const axisMode: AxisMode = options.yScale === 'log' && isPositiveFiniteDomain(resolvedYMin, resolvedYMax)
      ? 'log' : 'linear'

   let yNiceMin: number
   let yNiceMax: number
   let yTicks: number[]
   let yMinorTicks: number[]
   if (axisMode === 'log') {
      const niceLog = niceLogTicks(resolvedYMin, resolvedYMax, TARGET_TICK_COUNT)
      yNiceMin = niceLog.niceMin
      yNiceMax = niceLog.niceMax
      yTicks = niceLog.ticks
      yMinorTicks = niceLog.minorTicks
   } else {
      const niceLinear = niceTicks(resolvedYMin, resolvedYMax, TARGET_TICK_COUNT)
      yNiceMin = niceLinear.niceMin
      yNiceMax = niceLinear.niceMax
      yTicks = niceLinear.ticks
      yMinorTicks = []
   }
   const tickLabels = yTicks.map(formatNumber)

   // renderLegend wants GraphSeries-shaped input; scatter series carry no `values`, so a synthetic
   // list with empty values is built for the legend only.
   const legendWanted = options.legend !== false && series.length > 1
   const legendSeries: GraphSeries[] = series.map(oneSeries => ({
      name: oneSeries.name, color: oneSeries.color, values: [],
   }))
   const legendLabels = legendSeries.map(oneSeries => oneSeries.name)
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

   // The x-axis is never log here; only the value (y) axis switches.
   const yScale = axisMode === 'log'
      ? logScale([yNiceMin, yNiceMax], [plot.y + plot.height, plot.y])
      : linearScale([yNiceMin, yNiceMax], [plot.y + plot.height, plot.y])
   const xScale = linearScale([xNice.niceMin, xNice.niceMax], [plot.x, plot.x + plot.width])
   const baselineValue = axisMode === 'log' ? yNiceMin : Math.min(yNiceMax, Math.max(yNiceMin, 0))
   const baselineY = yScale(baselineValue)

   // A custom axisOrigin draws crossing "textbook" axes, but only on a linear value axis.
   const axisOrigin = options.axisOrigin
   const pieces: string[] = []
   if (axisOrigin !== undefined && axisMode !== 'log') {
      pieces.push(renderTextbookAxes(
         axisOrigin, yTicks, xNice.niceMin, xNice.niceMax, xScale, yScale, plot, theme))
   } else {
      pieces.push(renderGridlines(yTicks, yScale, tickLabels, plot, theme, yMinorTicks))
      pieces.push(renderAxes(plot, baselineY, theme))
      pieces.push(renderNumericXAxisLabels(xNice.niceMin, xNice.niceMax, xScale, plot, theme))
   }
   pieces.push(renderScatterPoints(series, xScale, yScale, theme, axisMode))

   // Overlays draw after the data marks (on top), reusing the same scales.
   if (options.overlays && options.overlays.length > 0) {
      pieces.push(renderScatterOverlays(
         options.overlays, series, xScale, yScale, plot,
         xNice.niceMin, xNice.niceMax, yNiceMin, yNiceMax, theme))
   }

   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))
   if (legendWanted) pieces.push(renderLegend(legendSeries, legendLayout, layout, theme))

   return element('g', {}, pieces.join(''))
}

/** The raw x AND y domain over every finite point, independently, with no folded-in zero baseline.
 *  Falls back to `[0, 1]` on each axis when nothing finite was plotted. */
function computeScatterPointDomain(series: ScatterSeries[]): {
   xMin: number
   xMax: number
   yMin: number
   yMax: number
} {
   let xMin = Infinity
   let xMax = -Infinity
   let yMin = Infinity
   let yMax = -Infinity
   for (const oneSeries of series) {
      for (const point of oneSeries.points) {
         if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
         if (point.x < xMin) xMin = point.x
         if (point.x > xMax) xMax = point.x
         if (point.y < yMin) yMin = point.y
         if (point.y > yMax) yMax = point.y
      }
   }
   if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) { xMin = 0; xMax = 1 }
   if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1 }
   return { xMin, xMax, yMin, yMax }
}

/** Draw every series' points as filled circles (the same marker spec every point-marker uses),
 *  directly at `xScale(point.x)`/`yScale(point.y)`. A non-finite point is skipped defensively. */
function renderScatterPoints(
   series: ScatterSeries[],
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   theme: GraphTheme,
   axisMode: AxisMode,
): string {
   const parts: string[] = []
   for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const oneSeries = series[seriesIndex]
      const color = resolveSeriesColor(seriesIndex, oneSeries.color, theme)
      for (const point of oneSeries.points) {
         // On a log y-axis a point at y <= 0 has no position; skip it (defensive, unreachable once
         // the axis actually is log since eligibility already required every finite y positive).
         if (!Number.isFinite(point.x) || !isPlottableValue(point.y, axisMode)) continue
         parts.push(element('circle', {
            cx: xScale(point.x),
            cy: yScale(point.y),
            r: MARKER_RADIUS,
            fill: color,
            stroke: theme.ink.surface,
            'stroke-width': SURFACE_GAP,
         }, titleElement(`${oneSeries.name} (${formatNumber(point.x)}, ${formatNumber(point.y)})`)))
      }
   }
   return element('g', {}, parts.join(''))
}

// ============ scatter statistical overlays ============
// Reuses the same overlay machinery a categorical chart draws with; only mean/trend need a
// scatter-specific computation, since a scatter series carries raw (x, y) points, not a
// category-aligned `values` array.

/**
 * Draw every statistical overlay over a scatter plot, mirroring {@link renderOverlays}'s per-kind
 * dispatch. mean/median read the series' point Y-values, trend fits {@link linearRegressionXY} over
 * the raw points across the full x-domain, reference reuses {@link renderReferenceOverlay}.
 * `equation` needs a categorical index axis scatter lacks, so it draws nothing here. Never throws.
 */
function renderScatterOverlays(
   overlays: Overlay[],
   series: ScatterSeries[],
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   plot: OverlayPlot,
   xNiceMin: number,
   xNiceMax: number,
   yNiceMin: number,
   yNiceMax: number,
   theme: GraphTheme,
): string {
   const singleSeries = series.length <= 1
   const parts: string[] = []

   for (const overlay of overlays) {
      if (overlay.kind === 'reference') {
         // Scatter supports both a horizontal (y = value) and a vertical (x = value) reference.
         parts.push(renderReferenceOverlayOriented(
            overlay, plot, xScale, yScale, xNiceMin, xNiceMax, yNiceMin, yNiceMax, theme))
         continue
      }
      if (overlay.kind === 'equation') continue // categorical-axis only, no scatter analog

      // Computed kinds: resolve the target series, fanning out for 'all'.
      const targetIndices = overlay.series === 'all'
         ? series.map((_oneSeries, index) => index)
         : [typeof overlay.series === 'number' ? overlay.series : 0]
      for (const seriesIndex of targetIndices) {
         if (seriesIndex < 0 || seriesIndex >= series.length) continue
         const oneSeries = series[seriesIndex]
         const color = resolveSeriesColor(seriesIndex, oneSeries.color, theme)
         if (overlay.kind === 'trend') {
            parts.push(renderScatterTrendOverlay(
               overlay, oneSeries, xScale, yScale, plot, xNiceMin, xNiceMax, color, theme))
         } else if (overlay.kind === 'stddev') {
            parts.push(renderStddevBandOverlay(
               overlay, oneSeries.points.map(point => point.y), oneSeries.name,
               plot, yScale, yNiceMin, yNiceMax, color, singleSeries, theme))
         } else if (overlay.kind === 'range') {
            parts.push(renderRangeBandOverlay(
               overlay, oneSeries.points.map(point => point.y), oneSeries.name,
               plot, yScale, yNiceMin, yNiceMax, color, singleSeries, theme))
         } else if (overlay.kind === 'movingAverage') {
            const sorted = oneSeries.points
               .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
               .slice()
               .sort((left, right) => left.x - right.x)
            const pixelPoints = movingAveragePixelPoints(
               sorted.map(point => point.y), overlay.window, index => xScale(sorted[index].x), yScale)
            parts.push(renderMovingAverageOverlay(
               overlay, pixelPoints, oneSeries.name, overlay.window, plot, color, singleSeries, theme))
         } else {
            parts.push(renderScatterStatLineOverlay(
               overlay, oneSeries, plot, yScale, yNiceMin, yNiceMax, color, singleSeries, theme))
         }
      }
   }
   return element('g', {}, parts.join(''))
}

/** A per-series mean/median line for scatter: like {@link renderStatLineOverlay}, but computed over
 *  the series' own point Y-values. */
function renderScatterStatLineOverlay(
   overlay: Overlay,
   oneSeries: ScatterSeries,
   plot: OverlayPlot,
   yScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   color: string,
   singleSeries: boolean,
   theme: GraphTheme,
): string {
   const kind: 'mean' | 'median' = overlay.kind === 'median' ? 'median' : 'mean'
   const pointYValues = oneSeries.points.map(point => point.y)
   const stat = kind === 'median' ? medianOf(pointYValues) : meanOf(pointYValues)
   if (stat === null || stat < niceMin || stat > niceMax) return ''
   const lineY = yScale(stat)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultStatLabel(kind, oneSeries.name, stat, singleSeries)
   return horizontalOverlay(lineY, label, plot, color, OVERLAY_DASH_LINE, theme)
}

/** A per-series trendline for scatter: {@link linearRegressionXY} fits the raw `(x, y)` points and
 *  the line is drawn across the full x-domain, clipped to the plot band. A series with fewer than 2
 *  finite points, or all points sharing one x, draws nothing. Non-linear fits sample a curve. */
function renderScatterTrendOverlay(
   overlay: Overlay,
   oneSeries: ScatterSeries,
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   plot: OverlayPlot,
   xNiceMin: number,
   xNiceMax: number,
   color: string,
   theme: GraphTheme,
): string {
   const fitType = overlay.fit ?? 'linear'

   if (fitType === 'linear') {
      const fit = linearRegressionXY(oneSeries.points)
      if (fit === null) return '' // fewer than 2 finite points, or an undefined (vertical) slope

      const startX = xScale(xNiceMin)
      const endX = xScale(xNiceMax)
      const startY = yScale(fit.slope * xNiceMin + fit.intercept)
      const endY = yScale(fit.slope * xNiceMax + fit.intercept)

      // Analytic clamp to the plot band (no SVG clipPath: a fixed id would collide across the many
      // chart SVGs inlined into one export).
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
      // Anchor the label at the clipped right end, nudged in so it never spills past the plot edge.
      const labelText = overlayLabel(
         Math.min(clipped.x2, plot.x + plot.width) - OVERLAY_LABEL_GAP,
         clipped.y2 - OVERLAY_LABEL_GAP,
         'end',
         label,
         theme)
      return element('g', {}, line + labelText)
   }

   // Non-linear: fit over the raw points, then sample the fitted curve across the x-domain.
   const trend = computeTrendFit(fitType, overlay.degree, oneSeries.points)
   if (trend === null) return ''
   const runs = sampleTrendCurveRuns(
      trend.predict, xNiceMin, xNiceMax, value => xScale(value), yScale, plot)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : nonLinearTrendLabel(trend.equationLabel, trend.rSquared, overlay.showEquation ?? false)
   return drawTrendCurveRuns(runs, label, plot, color, theme)
}

// #####################
// # HISTOGRAM         #
// #####################

/** Render a `histogram`-type spec (a binned frequency distribution) to inner SVG markup. Bars are
 *  contiguous (zero inter-bar gap, the defining look) over a continuous numeric x-axis of bin edges;
 *  y = count always draws from a zero baseline. No legend (a single dataset has nothing to
 *  distinguish it from). Never throws: too few samples degrade to an empty plot. */
export function renderHistogram(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   const histogramData = spec.histogramData
   const samples = histogramData?.samples ?? []
   const { edges, counts } = computeHistogramBins(samples, histogramData?.bins)

   // y-domain: frequency counts from a zero baseline (a count is never negative).
   let maxCount = 0
   let minPositiveCount = Infinity
   for (const count of counts) {
      if (count > maxCount) maxCount = count
      if (count > 0 && count < minPositiveCount) minPositiveCount = count
   }

   // A count domain folds in zero, but zero has no position on a log axis, so the log-eligibility
   // candidate anchors the floor at the smallest positive bin count instead. No positive bin leaves
   // minPositiveCount as Infinity, which safely fails the eligibility check.
   const logDomainMinCandidate = options.yMin !== undefined && options.yMin > 0 ? options.yMin : minPositiveCount
   const logDomainMaxCandidate = options.yMax !== undefined ? options.yMax : maxCount
   const axisMode: AxisMode = options.yScale === 'log' && isPositiveFiniteDomain(logDomainMinCandidate, logDomainMaxCandidate)
      ? 'log' : 'linear'

   let domainMin: number
   let domainMax: number
   if (axisMode === 'log') {
      domainMin = logDomainMinCandidate
      domainMax = logDomainMaxCandidate
   } else {
      domainMin = options.yMin !== undefined ? options.yMin : 0
      domainMax = options.yMax !== undefined ? options.yMax : maxCount
   }

   let niceMin: number
   let niceMax: number
   let ticks: number[]
   let minorTicks: number[]
   if (axisMode === 'log') {
      const niceLog = niceLogTicks(domainMin, domainMax, TARGET_TICK_COUNT)
      niceMin = niceLog.niceMin
      niceMax = niceLog.niceMax
      ticks = niceLog.ticks
      minorTicks = niceLog.minorTicks
   } else {
      const niceLinear = niceTicks(domainMin, domainMax, TARGET_TICK_COUNT)
      niceMin = niceLinear.niceMin
      niceMax = niceLinear.niceMax
      ticks = niceLinear.ticks
      minorTicks = []
   }
   const tickLabels = ticks.map(formatNumber)

   // x-domain: the bin edges themselves, falling back to [0, 1] when nothing survived so the scale
   // never divides by zero.
   const xMin = edges.length > 0 ? edges[0] : 0
   const xMax = edges.length > 0 ? edges[edges.length - 1] : 1

   const layout = computeCartesianLayout({
      hasTitle: Boolean(options.title),
      xCaption: options.xLabel,
      yCaption: options.yLabel,
      yTickLabels: tickLabels,
      legendRowCount: 0,
   })
   const { plot } = layout

   // ====== scales ======
   const yScale = axisMode === 'log'
      ? logScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
      : linearScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
   const xScale = linearScale([xMin, xMax], [plot.x, plot.x + plot.width])
   const baselineValue = axisMode === 'log' ? niceMin : Math.min(niceMax, Math.max(niceMin, 0))
   const baselineY = yScale(baselineValue)

   const color = resolveSeriesColor(0, histogramData?.color, theme)

   // ====== assemble ======
   const pieces: string[] = []
   pieces.push(renderGridlines(ticks, yScale, tickLabels, plot, theme, minorTicks))
   pieces.push(renderAxes(plot, baselineY, theme))
   pieces.push(renderNumericXAxisLabels(xMin, xMax, xScale, plot, theme))
   pieces.push(renderHistogramBars(
      edges, counts, xScale, yScale, baselineY, color, options.showValues ?? false, theme, axisMode))
   pieces.push(renderAxisCaptions(options.xLabel, options.yLabel, layout, theme))
   if (options.title) pieces.push(renderVisibleTitle(options.title, theme))

   return element('g', {}, pieces.join(''))
}

/** Draw one contiguous rect per bin (edges touch), with a thin surface stroke so neighbouring bins
 *  still read as distinct bars without opening a gap in the data. */
function renderHistogramBars(
   edges: number[],
   counts: number[],
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   baselineY: number,
   color: string,
   showValues: boolean,
   theme: GraphTheme,
   axisMode: AxisMode,
): string {
   const parts: string[] = []
   for (let binIndex = 0; binIndex < counts.length; binIndex++) {
      const count = counts[binIndex]
      // A zero bin has no position on a log axis; skip it rather than compute a collapsed rect.
      if (axisMode === 'log' && count <= 0) continue
      const leftX = xScale(edges[binIndex])
      const rightX = xScale(edges[binIndex + 1])
      const valueY = yScale(count)
      const rectY = Math.min(baselineY, valueY)
      const rectHeight = Math.abs(valueY - baselineY)
      const rectWidth = Math.max(0, rightX - leftX)
      const tooltip = `${formatNumber(edges[binIndex])}-${formatNumber(edges[binIndex + 1])}: ${formatNumber(count)}`
      parts.push(element('rect', {
         x: leftX,
         y: rectY,
         width: rectWidth,
         height: rectHeight,
         fill: color,
         stroke: theme.ink.surface,
         'stroke-width': 1,
      }, titleElement(tooltip)))
      if (showValues && count > 0) {
         parts.push(valueLabel((leftX + rightX) / 2, rectY - 4, formatNumber(count), theme))
      }
   }
   return element('g', {}, parts.join(''))
}

// #####################
// # STATISTIC OVERLAYS #
// #####################

/** A plot rect passed around the overlay helpers (matches the layout's PlotRect shape). */
interface OverlayPlot { x: number; y: number; width: number; height: number }

/** Draw every statistical overlay over the plot. Per-series kinds expand `series: 'all'` to one mark
 *  per drawn series; an index not among them is skipped. Reference is a per-chart horizontal in
 *  neutral ink. Never throws: degenerate data simply draws nothing. */
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
         // A vertical reference has no meaning on a categorical band x-axis; only function/scatter
         // draw those. A horizontal reference draws normally.
         if ((overlay.orientation ?? 'horizontal') === 'vertical') continue
         parts.push(renderReferenceOverlay(overlay, plot, yScale, niceMin, niceMax, theme))
         continue
      }
      if (overlay.kind === 'equation') {
         parts.push(renderEquationOverlay(overlay, labels, xBand, yScale, plot, niceMin, niceMax, theme))
         continue
      }
      // Computed kinds: resolve the target series, fanning out for 'all'.
      const targetIndices = overlay.series === 'all'
         ? drawnSeries.map((_series, index) => index)
         : [typeof overlay.series === 'number' ? overlay.series : 0]
      for (const seriesIndex of targetIndices) {
         if (seriesIndex < 0 || seriesIndex >= drawnSeries.length) continue
         const oneSeries = drawnSeries[seriesIndex]
         const color = resolveSeriesColor(seriesIndex, oneSeries.color, theme)
         if (overlay.kind === 'trend') {
            parts.push(renderTrendOverlay(
               overlay, oneSeries, labels, xBand, yScale, plot, color, theme))
         } else if (overlay.kind === 'stddev') {
            parts.push(renderStddevBandOverlay(
               overlay, oneSeries.values, oneSeries.name, plot, yScale, niceMin, niceMax, color, singleSeries, theme))
         } else if (overlay.kind === 'range') {
            parts.push(renderRangeBandOverlay(
               overlay, oneSeries.values, oneSeries.name, plot, yScale, niceMin, niceMax, color, singleSeries, theme))
         } else if (overlay.kind === 'movingAverage') {
            const pixelPoints = movingAveragePixelPoints(
               oneSeries.values, overlay.window, index => xBand.center(index), yScale)
            parts.push(renderMovingAverageOverlay(
               overlay, pixelPoints, oneSeries.name, overlay.window, plot, color, singleSeries, theme))
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
   // The domain was auto-extended to include this value; the clip guards a hand-pinned yMin/yMax
   // that excludes it.
   if (value < niceMin || value > niceMax) return ''
   const lineY = yScale(value)
   const label = overlay.label && overlay.label !== '' ? overlay.label : formatNumber(value)
   return horizontalOverlay(lineY, label, plot, theme.ink.text, OVERLAY_DASH_LINE, theme)
}

/** A per-chart vertical reference line at x = `overlay.value`, the x-axis mirror of
 *  {@link renderReferenceOverlay}, for the continuous-x types only. Off-domain is skipped. */
function renderVerticalReferenceOverlay(
   overlay: Overlay,
   plot: OverlayPlot,
   xScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   theme: GraphTheme,
): string {
   const value = overlay.value
   if (value === undefined || !Number.isFinite(value)) return ''
   if (value < niceMin || value > niceMax) return ''
   const lineX = xScale(value)
   const label = overlay.label && overlay.label !== '' ? overlay.label : formatNumber(value)
   return verticalOverlay(lineX, label, plot, theme.ink.text, OVERLAY_DASH_LINE, theme)
}

/** Draw one reference overlay dispatched on its {@link Overlay.orientation}: `'vertical'` as x =
 *  value, anything else as the y = value horizontal. Shared by the scatter and function passes. */
function renderReferenceOverlayOriented(
   overlay: Overlay,
   plot: OverlayPlot,
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   xNiceMin: number,
   xNiceMax: number,
   yNiceMin: number,
   yNiceMax: number,
   theme: GraphTheme,
): string {
   if ((overlay.orientation ?? 'horizontal') === 'vertical') {
      return renderVerticalReferenceOverlay(overlay, plot, xScale, xNiceMin, xNiceMax, theme)
   }
   return renderReferenceOverlay(overlay, plot, yScale, yNiceMin, yNiceMax, theme)
}

/** Draw the reference overlays over a `function` chart. Only the `reference` kind is meaningful
 *  (there is no discrete series to average/fit); every other kind is skipped. Both orientations
 *  supported via the shared dispatcher. */
function renderFunctionReferenceOverlays(
   overlays: Overlay[],
   plot: OverlayPlot,
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   xNiceMin: number,
   xNiceMax: number,
   yNiceMin: number,
   yNiceMax: number,
   theme: GraphTheme,
): string {
   const parts: string[] = []
   for (const overlay of overlays) {
      if (overlay.kind !== 'reference') continue
      parts.push(renderReferenceOverlayOriented(
         overlay, plot, xScale, yScale, xNiceMin, xNiceMax, yNiceMin, yNiceMax, theme))
   }
   return element('g', {}, parts.join(''))
}

/** A chart-level `f(x)` curve, sampled across the host's category-index domain `[0, labelCount - 1]`
 *  via {@link interpolateBandCenter} for fractional indices. Never auto-extends the y-domain (an
 *  arbitrary expression must not squash the real data); every segment is clipped to the plot band.
 *  A blank/uncompileable expression, or fewer than 2 categories, draws nothing. */
function renderEquationOverlay(
   overlay: Overlay,
   labels: string[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   plot: OverlayPlot,
   niceMin: number,
   niceMax: number,
   theme: GraphTheme,
): string {
   const expressionSource = overlay.expression
   if (expressionSource === undefined || expressionSource.trim() === '') return ''
   const compiled = compileExpression(expressionSource)
   if (compiled === null) return ''

   const lastIndex = labels.length - 1
   if (lastIndex <= 0) return '' // a single category has no index range to sample a curve across

   const runs = computeEquationOverlayRuns(compiled, lastIndex, xBand, yScale, plot, niceMin, niceMax)
      .filter(run => run.length >= 2) // a lone point cannot form a polyline
   if (runs.length === 0) return ''

   const color = resolveSeriesColor(EQUATION_OVERLAY_PALETTE_SLOT, undefined, theme)
   const parts: string[] = []
   for (const run of runs) {
      const pointsAttribute = run.map(point => `${roundForPath(point.x)},${roundForPath(point.y)}`).join(' ')
      parts.push(selfClosingElement('polyline', {
         points: pointsAttribute,
         fill: 'none',
         stroke: color,
         'stroke-width': OVERLAY_STROKE_WIDTH,
         'stroke-dasharray': OVERLAY_DASH_TREND,
         'stroke-linejoin': 'round',
         'stroke-linecap': 'round',
      }))
   }

   // Anchor the label at the last drawn point; the expression itself is the default label.
   const lastRun = runs[runs.length - 1]
   const lastPoint = lastRun[lastRun.length - 1]
   const label = overlay.label && overlay.label !== '' ? overlay.label : expressionSource
   parts.push(overlayLabel(
      Math.min(lastPoint.x, plot.x + plot.width) - OVERLAY_LABEL_GAP,
      lastPoint.y - OVERLAY_LABEL_GAP,
      'end',
      label,
      theme))

   return element('g', {}, parts.join(''))
}

/** Sample a compiled expression across `[0, lastIndex]` at {@link EQUATION_OVERLAY_SAMPLE_COUNT}
 *  points, apply the asymptote heuristic, then clip each segment to the plot band so the curve reads
 *  as truly clipped rather than stopping at the last in-range sample. */
function computeEquationOverlayRuns(
   compiled: CompiledExpression,
   lastIndex: number,
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   plot: OverlayPlot,
   niceMin: number,
   niceMax: number,
): { x: number; y: number }[][] {
   const sampleCount = EQUATION_OVERLAY_SAMPLE_COUNT
   const step = lastIndex / (sampleCount - 1)

   const rawValues: (number | null)[] = []
   for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      rawValues.push(evaluate(compiled, sampleIndex * step))
   }
   const gappedValues = applyAsymptoteGaps(rawValues, niceMin, niceMax)

   // Map each finite sample to a pixel point (a null stays a gap), then let the shared clip-runner
   // trim every segment to the plot band.
   const pixelPoints: ({ x: number; y: number } | null)[] = gappedValues.map((value, sampleIndex) =>
      value === null ? null : { x: interpolateBandCenter(xBand, sampleIndex * step), y: yScale(value) })
   return clipPixelRunsToBand(pixelPoints, plot)
}

/** Trim a sequence of pixel points (a `null` breaks the line) into runs clipped to the plot band,
 *  one segment at a time via {@link clipSegmentToBand}. A fully-outside segment breaks the run, a
 *  partial one is trimmed to the boundary crossing. Shared by the equation overlay, the
 *  moving-average polyline, and the non-linear trend curve. */
function clipPixelRunsToBand(
   pixelPoints: ({ x: number; y: number } | null)[],
   plot: OverlayPlot,
): { x: number; y: number }[][] {
   const runs: { x: number; y: number }[][] = []
   let currentRun: { x: number; y: number }[] | null = null
   let previousPoint: { x: number; y: number } | null = null

   for (const currentPoint of pixelPoints) {
      if (currentPoint === null) {
         currentRun = null
         previousPoint = null
         continue
      }
      if (previousPoint === null) {
         // First finite sample after a gap: nothing to connect to yet.
         previousPoint = currentPoint
         continue
      }

      const clipped = clipSegmentToBand(
         previousPoint.x, previousPoint.y, currentPoint.x, currentPoint.y, plot.y, plot.y + plot.height)
      if (clipped === null) {
         // The whole segment sits off-canvas: break here, like a null-gap.
         currentRun = null
      } else if (currentRun === null) {
         currentRun = [{ x: clipped.x1, y: clipped.y1 }, { x: clipped.x2, y: clipped.y2 }]
         runs.push(currentRun)
      } else {
         // Continuing the run: the clipped start already matches the last point (same previousPoint),
         // so only the new end is appended.
         currentRun.push({ x: clipped.x2, y: clipped.y2 })
      }

      previousPoint = currentPoint
   }

   return runs
}

/** Interpolate a fractional category index to a pixel x by blending the two adjacent band centers.
 *  The categorical x-axis has no continuous scale, so this is how an equation overlay's sampled
 *  curve rides the same band positions the host's bars/lines sit on. */
function interpolateBandCenter(
   xBand: { center(index: number): number },
   fractionalIndex: number,
): number {
   const lowerIndex = Math.floor(fractionalIndex)
   const upperIndex = Math.ceil(fractionalIndex)
   if (lowerIndex === upperIndex) return xBand.center(lowerIndex)
   const lowerCenter = xBand.center(lowerIndex)
   const upperCenter = xBand.center(upperIndex)
   const fraction = fractionalIndex - lowerIndex
   return lowerCenter + (upperCenter - lowerCenter) * fraction
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
   // Re-derive a literal-typed `kind`: the caller's narrowing does not carry across the boundary,
   // and defaultStatLabel wants the narrow type.
   const kind: 'mean' | 'median' = overlay.kind === 'median' ? 'median' : 'mean'
   const stat = kind === 'median' ? medianOf(oneSeries.values) : meanOf(oneSeries.values)
   if (stat === null || stat < niceMin || stat > niceMax) return ''
   const lineY = yScale(stat)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultStatLabel(kind, oneSeries.name, stat, singleSeries)
   return horizontalOverlay(lineY, label, plot, color, OVERLAY_DASH_LINE, theme)
}

/** A per-series trendline. A linear fit draws a single sloped segment clipped to the plot rect; a
 *  non-linear fit is sampled across the category-index domain into a clipped dashed polyline. */
function renderTrendOverlay(
   overlay: Overlay,
   oneSeries: GraphSeries,
   labels: string[],
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   plot: OverlayPlot,
   color: string,
   theme: GraphTheme,
): string {
   const lastIndex = labels.length - 1
   const fitType = overlay.fit ?? 'linear'

   if (fitType === 'linear') {
      const fit = linearRegression(oneSeries.values)
      if (fit === null) return '' // fewer than 2 finite points: no line to draw

      const startX = xBand.center(0)
      const endX = xBand.center(lastIndex)
      const startY = yScale(fit.intercept)
      const endY = yScale(fit.intercept + fit.slope * lastIndex)

      // Analytic clamp to the plot band (no SVG clipPath: a fixed id would collide across the many
      // chart SVGs inlined into one export).
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
      // Anchor the label at the clipped right end, nudged in so it never spills past the plot edge.
      const labelText = overlayLabel(
         Math.min(clipped.x2, plot.x + plot.width) - OVERLAY_LABEL_GAP,
         clipped.y2 - OVERLAY_LABEL_GAP,
         'end',
         label,
         theme)
      return element('g', {}, line + labelText)
   }

   // Non-linear: fit over (index, value) points, then sample the curve across the index domain.
   if (lastIndex <= 0) return '' // a single category has no index range to sample across
   const points = indexValuePoints(oneSeries.values)
   const trend = computeTrendFit(fitType, overlay.degree, points)
   if (trend === null) return ''
   const runs = sampleTrendCurveRuns(
      trend.predict, 0, lastIndex, index => interpolateBandCenter(xBand, index), yScale, plot)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : nonLinearTrendLabel(trend.equationLabel, trend.rSquared, overlay.showEquation ?? false)
   return drawTrendCurveRuns(runs, label, plot, color, theme)
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

/** Draw a full-height vertical dashed overlay at `lineX` with a top-anchored haloed label (the
 *  x-axis mirror of {@link horizontalOverlay}). */
function verticalOverlay(
   lineX: number,
   label: string,
   plot: OverlayPlot,
   color: string,
   dash: string,
   theme: GraphTheme,
): string {
   const line = selfClosingElement('line', {
      x1: lineX,
      y1: plot.y,
      x2: lineX,
      y2: plot.y + plot.height,
      stroke: color,
      'stroke-width': OVERLAY_STROKE_WIDTH,
      'stroke-dasharray': dash,
      'stroke-linecap': 'round',
   })
   // Anchor the label at the top of the line so it clears the x-axis number labels along the bottom.
   const labelText = overlayLabel(
      lineX + OVERLAY_LABEL_GAP,
      plot.y + TICK_FONT_SIZE,
      'start',
      label,
      theme)
   return element('g', {}, line + labelText)
}

/** A small overlay label in primary ink (never a series hue, illegible as text), wearing a
 *  surface-color halo via `paint-order:stroke` so it stays readable over gridlines and marks. */
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

// ================================================================
// # ANALYTICAL OVERLAYS (bands, moving average, non-linear trends)
// ================================================================
// These share the styling of the mean/trend originals above; only their computation differs. The
// band kinds add one new primitive (a filled horizontal region).

/** Collect a value series' finite cells as (index, value) points, for a category-index curve fit. */
function indexValuePoints(values: readonly (number | null)[]): Point[] {
   const points: Point[] = []
   for (let index = 0; index < values.length; index++) {
      const value = values[index]
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      points.push({ x: index, y: value })
   }
   return points
}

/** Resolve a polynomial trend's degree to a sane integer in 2..5 (unset => GRAPH_DEFAULT_TREND_DEGREE). */
function clampTrendDegree(degree: number | undefined): number {
   const resolved = degree ?? GRAPH_DEFAULT_TREND_DEGREE
   if (!Number.isFinite(resolved)) return GRAPH_DEFAULT_TREND_DEGREE
   return Math.min(5, Math.max(2, Math.round(resolved)))
}

/** Resolve a stddev band's sigma multiplier (unset/non-positive => GRAPH_DEFAULT_OVERLAY_SIGMA). */
function clampOverlaySigma(sigma: number | undefined): number {
   const resolved = sigma ?? GRAPH_DEFAULT_OVERLAY_SIGMA
   return Number.isFinite(resolved) && resolved > 0 ? resolved : GRAPH_DEFAULT_OVERLAY_SIGMA
}

/** A resolved non-linear trend fit: a sampler, its formatted equation, and its R^2. */
interface TrendCurveFit {
   predict: (x: number) => number
   equationLabel: string
   rSquared: number
}

/** Fit a non-linear trend model (polynomial/exponential/logarithmic/power) to `points`, returning a
 *  sampler + equation label + R^2, or null when it cannot be fit. Linear trends never reach here. */
function computeTrendFit(
   fitType: Exclude<NonNullable<Overlay['fit']>, 'linear'>,
   degree: number | undefined,
   points: readonly Point[],
): TrendCurveFit | null {
   if (fitType === 'polynomial') {
      const fit = polynomialFit(points, clampTrendDegree(degree))
      if (fit === null) return null
      return {
         predict: x => evaluatePolynomial(fit.coefficients, x),
         equationLabel: formatPolynomialEquation(fit.coefficients),
         rSquared: fit.rSquared,
      }
   }
   if (fitType === 'exponential') {
      const fit = exponentialFit(points)
      if (fit === null) return null
      return {
         predict: x => fit.a * Math.exp(fit.b * x),
         equationLabel: formatExponentialEquation(fit.a, fit.b),
         rSquared: fit.rSquared,
      }
   }
   if (fitType === 'logarithmic') {
      const fit = logarithmicFit(points)
      if (fit === null) return null
      return {
         predict: x => fit.a + fit.b * Math.log(x),
         equationLabel: formatLogarithmicEquation(fit.a, fit.b),
         rSquared: fit.rSquared,
      }
   }
   // 'power'
   const fit = powerFit(points)
   if (fit === null) return null
   return {
      predict: x => fit.a * Math.pow(x, fit.b),
      equationLabel: formatPowerEquation(fit.a, fit.b),
      rSquared: fit.rSquared,
   }
}

/** Format a polynomial (ascending-power coefficients) as `y = c2x^2 + c1x + c0`, rounded to 3 digits. */
function formatPolynomialEquation(coefficients: readonly number[]): string {
   const terms: string[] = []
   for (let power = coefficients.length - 1; power >= 0; power--) {
      const coefficient = roundToDigits(coefficients[power], 3)
      const magnitude = formatNumber(Math.abs(coefficient))
      const suffix = power === 0 ? '' : power === 1 ? 'x' : `x^${power}`
      const body = `${magnitude}${suffix}`
      if (terms.length === 0) {
         terms.push(coefficient < 0 ? `-${body}` : body)
      } else {
         terms.push(coefficient < 0 ? `- ${body}` : `+ ${body}`)
      }
   }
   return `y = ${terms.join(' ')}`
}

/** Format an exponential fit as `y = a e^(bx)`. */
function formatExponentialEquation(a: number, b: number): string {
   return `y = ${formatNumber(roundToDigits(a, 3))} e^(${formatNumber(roundToDigits(b, 3))}x)`
}

/** Format a logarithmic fit as `y = a + b ln(x)`. */
function formatLogarithmicEquation(a: number, b: number): string {
   const sign = b < 0 ? '-' : '+'
   return `y = ${formatNumber(roundToDigits(a, 3))} ${sign} ${formatNumber(roundToDigits(Math.abs(b), 3))} ln(x)`
}

/** Format a power fit as `y = a x^b`. */
function formatPowerEquation(a: number, b: number): string {
   return `y = ${formatNumber(roundToDigits(a, 3))} x^${formatNumber(roundToDigits(b, 3))}`
}

/** The non-linear trend label: `R² 0.94`, with the fitted equation prepended when `showEquation`. */
function nonLinearTrendLabel(equationLabel: string, rSquared: number, showEquation: boolean): string {
   const rSquaredText = `R² ${formatNumber(roundToDigits(rSquared, 3))}`
   return showEquation ? `${equationLabel} · ${rSquaredText}` : rSquaredText
}

/** Sample a fitted curve across `[xStart, xEnd]` into clipped pixel runs. `xToPixel` maps a data x
 *  to a pixel x (band-center interpolation for a categorical chart, `xScale` for a scatter); a
 *  non-finite prediction becomes a gap. */
function sampleTrendCurveRuns(
   predict: (x: number) => number,
   xStart: number,
   xEnd: number,
   xToPixel: (x: number) => number,
   yScale: (value: number) => number,
   plot: OverlayPlot,
): { x: number; y: number }[][] {
   if (!(xEnd > xStart)) return []
   const step = (xEnd - xStart) / (TREND_CURVE_SAMPLE_COUNT - 1)
   const pixelPoints: ({ x: number; y: number } | null)[] = []
   for (let sampleIndex = 0; sampleIndex < TREND_CURVE_SAMPLE_COUNT; sampleIndex++) {
      const xValue = xStart + sampleIndex * step
      const value = predict(xValue)
      if (!Number.isFinite(value)) { pixelPoints.push(null); continue }
      pixelPoints.push({ x: xToPixel(xValue), y: yScale(value) })
   }
   return clipPixelRunsToBand(pixelPoints, plot)
}

/** Draw clipped pixel runs as dashed series-hued polylines with the haloed label at the last point.
 *  Runs shorter than 2 points draw nothing. Shared by the non-linear trend curve and the
 *  moving-average polyline. */
function drawTrendCurveRuns(
   runs: { x: number; y: number }[][],
   label: string,
   plot: OverlayPlot,
   color: string,
   theme: GraphTheme,
): string {
   const drawnRuns = runs.filter(run => run.length >= 2)
   if (drawnRuns.length === 0) return ''
   const parts: string[] = []
   for (const run of drawnRuns) {
      const pointsAttribute = run.map(point => `${roundForPath(point.x)},${roundForPath(point.y)}`).join(' ')
      parts.push(selfClosingElement('polyline', {
         points: pointsAttribute,
         fill: 'none',
         stroke: color,
         'stroke-width': OVERLAY_STROKE_WIDTH,
         'stroke-dasharray': OVERLAY_DASH_TREND,
         'stroke-linejoin': 'round',
         'stroke-linecap': 'round',
      }))
   }
   const lastRun = drawnRuns[drawnRuns.length - 1]
   const lastPoint = lastRun[lastRun.length - 1]
   parts.push(overlayLabel(
      Math.min(lastPoint.x, plot.x + plot.width) - OVERLAY_LABEL_GAP,
      lastPoint.y - OVERLAY_LABEL_GAP,
      'end',
      label,
      theme))
   return element('g', {}, parts.join(''))
}

/** A filled horizontal summary band spanning the plot width between two values, at low opacity in
 *  the series hue, with faint dashed edge lines and a haloed label. Clamped to the visible domain;
 *  a band wholly outside draws nothing. */
function renderBandOverlay(
   lowValue: number,
   highValue: number,
   label: string,
   plot: OverlayPlot,
   yScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   color: string,
   theme: GraphTheme,
): string {
   if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return ''
   const low = Math.min(lowValue, highValue)
   const high = Math.max(lowValue, highValue)
   const visibleLow = Math.max(low, niceMin)
   const visibleHigh = Math.min(high, niceMax)
   if (visibleHigh <= visibleLow) return '' // the whole band sits outside the visible domain
   const topY = yScale(visibleHigh)
   const bottomY = yScale(visibleLow)
   const rectY = Math.min(topY, bottomY)
   const rectHeight = Math.abs(bottomY - topY)

   const parts: string[] = []
   parts.push(selfClosingElement('rect', {
      x: plot.x,
      y: rectY,
      width: plot.width,
      height: rectHeight,
      fill: color,
      'fill-opacity': OVERLAY_BAND_FILL_OPACITY,
      stroke: 'none',
   }))
   // Edge lines only where a boundary falls inside the visible domain, else a clamped-off edge would
   // draw a stray line at the axis limit.
   if (high <= niceMax && high >= niceMin) parts.push(bandEdgeLine(yScale(high), plot, color))
   if (low >= niceMin && low <= niceMax) parts.push(bandEdgeLine(yScale(low), plot, color))
   parts.push(overlayLabel(
      plot.x + plot.width - OVERLAY_LABEL_GAP,
      rectY + TICK_FONT_SIZE,
      'end',
      label,
      theme))
   return element('g', {}, parts.join(''))
}

/** A faint dashed boundary line for a summary band (recessive, so the fill carries the band). */
function bandEdgeLine(lineY: number, plot: OverlayPlot, color: string): string {
   return selfClosingElement('line', {
      x1: plot.x,
      y1: lineY,
      x2: plot.x + plot.width,
      y2: lineY,
      stroke: color,
      'stroke-width': 1,
      'stroke-opacity': OVERLAY_BAND_EDGE_OPACITY,
      'stroke-dasharray': OVERLAY_DASH_LINE,
      'stroke-linecap': 'round',
   })
}

/** A std-dev band at mean +/- sigma*stddev, as a filled region. Nothing when the mean or stddev is
 *  undefined (fewer than 2 finite values). */
function renderStddevBandOverlay(
   overlay: Overlay,
   values: readonly (number | null)[],
   seriesName: string,
   plot: OverlayPlot,
   yScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   color: string,
   singleSeries: boolean,
   theme: GraphTheme,
): string {
   const meanValue = meanOf(values)
   const standardDeviation = stddevOf(values)
   if (meanValue === null || standardDeviation === null) return ''
   const sigma = clampOverlaySigma(overlay.sigma)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultStddevLabel(seriesName, sigma, singleSeries)
   return renderBandOverlay(
      meanValue - sigma * standardDeviation, meanValue + sigma * standardDeviation,
      label, plot, yScale, niceMin, niceMax, color, theme)
}

/** A min-max band spanning a value list's full extent, as a filled region. Nothing when there is no
 *  finite value to bound. */
function renderRangeBandOverlay(
   overlay: Overlay,
   values: readonly (number | null)[],
   seriesName: string,
   plot: OverlayPlot,
   yScale: (value: number) => number,
   niceMin: number,
   niceMax: number,
   color: string,
   singleSeries: boolean,
   theme: GraphTheme,
): string {
   const range = extentOf(values)
   if (range === null) return ''
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultRangeLabel(seriesName, singleSeries)
   return renderBandOverlay(range.min, range.max, label, plot, yScale, niceMin, niceMax, color, theme)
}

/** `±1σ`, or `Revenue · ±1σ` when multi-series. */
function defaultStddevLabel(seriesName: string, sigma: number, singleSeries: boolean): string {
   const stat = `±${formatNumber(sigma)}σ`
   return singleSeries || seriesName === '' ? stat : `${seriesName} · ${stat}`
}

/** `min-max`, or `Revenue · min-max` when multi-series. */
function defaultRangeLabel(seriesName: string, singleSeries: boolean): string {
   const stat = 'min-max'
   return singleSeries || seriesName === '' ? stat : `${seriesName} · ${stat}`
}

/** `moving avg 3`, or `Revenue · moving avg 3` when multi-series. */
function defaultMovingAverageLabel(seriesName: string, window: number, singleSeries: boolean): string {
   const stat = `moving avg ${formatNumber(window)}`
   return singleSeries || seriesName === '' ? stat : `${seriesName} · ${stat}`
}

/** Map a value list's trailing moving average to pixel points (a gap where undefined). `indexToPixelX`
 *  positions each point (band center for a categorical chart, `xScale(sortedX)` for a scatter). */
function movingAveragePixelPoints(
   values: readonly (number | null)[],
   window: number | undefined,
   indexToPixelX: (index: number) => number,
   yScale: (value: number) => number,
): ({ x: number; y: number } | null)[] {
   const averaged = movingAverage(values, window ?? GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW)
   return averaged.map((value, index) =>
      value === null || !Number.isFinite(value) ? null : { x: indexToPixelX(index), y: yScale(value) })
}

/** A trailing moving-average polyline: clip the pre-mapped pixel points to the plot and draw them
 *  with the trend curve's dashed look. Nothing when fewer than 2 averaged points fall inside. */
function renderMovingAverageOverlay(
   overlay: Overlay,
   pixelPoints: ({ x: number; y: number } | null)[],
   seriesName: string,
   window: number | undefined,
   plot: OverlayPlot,
   color: string,
   singleSeries: boolean,
   theme: GraphTheme,
): string {
   const runs = clipPixelRunsToBand(pixelPoints, plot)
   const resolvedWindow = Number.isFinite(window)
      ? Math.max(2, Math.floor(window as number))
      : GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultMovingAverageLabel(seriesName, resolvedWindow, singleSeries)
   return drawTrendCurveRuns(runs, label, plot, color, theme)
}

/** Clip the segment (x1,y1)-(x2,y2) to the band [bandTop, bandBottom] (x already sits within the
 *  plot). Returns the trimmed endpoints, or null when the segment lies wholly above or below.
 *  Pure line-parameter math, no SVG clipPath. */
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
 * The raw value domain for a chart type before nice-ticking. `options.yMin`/`yMax` still override
 * at the end. `foldZeroBaseline` true pre-seeds the domain at 0 (bars grow from 0, the ordinary
 * linear domain); false takes it purely from the finite data extremes (the "unfolded" probe
 * renderCartesian uses to test log-eligibility). `bar-stacked` sums per category and is always
 * called with `foldZeroBaseline: true`.
 */
function computeValueDomain(
   type: GraphSpec['type'],
   labels: string[],
   series: GraphSeries[],
   options: GraphSpec['options'],
   foldZeroBaseline: boolean,
): [number, number] {
   let dataMin = foldZeroBaseline ? 0 : Infinity
   let dataMax = foldZeroBaseline ? 0 : -Infinity

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

   // An unfolded pass that found nothing finite still needs a finite fallback so +/-Infinity never
   // leaks into the fold/override math below.
   if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      dataMin = 0
      dataMax = 0
   }

   // Fold every reference value in so a target line beyond the data stays on-canvas. Before the
   // yMin/yMax overrides, which still win.
   const [foldedMin, foldedMax] = foldReferenceOverlaysIntoDomain(dataMin, dataMax, options.overlays)

   const min = options.yMin !== undefined ? options.yMin : foldedMin
   const max = options.yMax !== undefined ? options.yMax : foldedMax
   return [min, max]
}

// ================================================================
// # LOG-SCALE ELIGIBILITY + PER-DATUM PLOTTABILITY (shared helper)
// ================================================================

/** Whether a resolved (min, max) domain is strictly positive and finite: the condition every render
 *  function uses to decide whether a log value axis is usable for a chart's data. */
function isPositiveFiniteDomain(min: number, max: number): boolean {
   return Number.isFinite(min) && Number.isFinite(max) && min > 0
}

/** Whether a single datum can be plotted on `axisMode`'s axis: finite, and strictly positive on a
 *  log axis. A failing value is treated like a missing cell. A defensive backstop, since the whole
 *  domain is already checked before 'log' is chosen. */
function isPlottableValue(value: number | null | undefined, axisMode: AxisMode): value is number {
   if (value === null || value === undefined || !Number.isFinite(value)) return false
   if (axisMode === 'log' && value <= 0) return false
   return true
}

/** Fold every finite `reference` value of the given `orientation` into a raw `[dataMin, dataMax]`
 *  domain, so a target line outside the data range still lands on-canvas. `'horizontal'` (default)
 *  extends the y-domain, `'vertical'` the x-domain; a reference of the other orientation is ignored.
 *  Shared by the categorical, scatter, and function domains. */
function foldReferenceOverlaysIntoDomain(
   dataMin: number,
   dataMax: number,
   overlays: Overlay[] | undefined,
   orientation: 'horizontal' | 'vertical' = 'horizontal',
): [number, number] {
   let min = dataMin
   let max = dataMax
   for (const overlay of overlays ?? []) {
      if (overlay.kind !== 'reference') continue
      if ((overlay.orientation ?? 'horizontal') !== orientation) continue
      const value = overlay.value
      if (value === undefined || !Number.isFinite(value)) continue
      if (value > max) max = value
      if (value < min) min = value
   }
   return [min, max]
}

// #####################
// # AXES & GRIDLINES  #
// #####################

/** Horizontal hairline gridlines at each nice tick, labelled at the left, plus optional unlabeled
 *  minor gridlines (the log scale's 2x/5x ticks; empty on a linear axis). */
function renderGridlines(
   ticks: number[],
   yScale: (value: number) => number,
   tickLabels: string[],
   plot: { x: number; y: number; width: number; height: number },
   theme: GraphTheme,
   minorTicks: number[] = [],
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
   for (const minorTick of minorTicks) {
      const tickY = yScale(minorTick)
      parts.push(selfClosingElement('line', {
         x1: plot.x,
         y1: tickY,
         x2: plot.x + plot.width,
         y2: tickY,
         stroke: theme.ink.grid,
         'stroke-width': 1,
         'stroke-opacity': MINOR_GRIDLINE_OPACITY,
      }))
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

/**
 * Draw "textbook" (custom-origin, four-quadrant) axes for a `function`/`scatter` chart: the y-axis
 * at `xScale(origin.x)` and the x-axis at `yScale(origin.y)`, crossing at the origin, with ticks
 * riding the crossing lines. Replaces the standard gridlines/axes/x-labels trio when an
 * {@link GraphOptions.axisOrigin} is set. Light gridlines stay on both axes; each bold axis clamps
 * to the nearest plot edge when the origin is off-domain; the origin's own zero label is dropped on
 * each axis so the two never collide. Linear axes only. `yTicks` are the value ticks; the x ticks
 * are recomputed here as {@link renderNumericXAxisLabels} does.
 */
function renderTextbookAxes(
   origin: { x: number; y: number },
   yTicks: number[],
   xAxisMin: number,
   xAxisMax: number,
   xScale: (value: number) => number,
   yScale: (value: number) => number,
   plot: { x: number; y: number; width: number; height: number },
   theme: GraphTheme,
): string {
   const plotLeft = plot.x
   const plotRight = plot.x + plot.width
   const plotTop = plot.y
   const plotBottom = plot.y + plot.height

   // x-tick positions computed as renderNumericXAxisLabels does, so the labels land the same.
   const xNice = niceTicks(xAxisMin, xAxisMax, TARGET_TICK_COUNT)
   const xTicks = xNice.ticks.filter(tick => tick >= xAxisMin && tick <= xAxisMax)

   // The bold crossing axes, each clamped to the nearest plot edge for an off-domain origin.
   const verticalAxisX = clamp(xScale(origin.x), plotLeft, plotRight)
   const horizontalAxisY = clamp(yScale(origin.y), plotTop, plotBottom)

   const parts: string[] = []

   // Light gridlines at every tick, both axes.
   for (const tick of yTicks) {
      const gridY = yScale(tick)
      parts.push(selfClosingElement('line', {
         x1: plotLeft, y1: gridY, x2: plotRight, y2: gridY,
         stroke: theme.ink.grid, 'stroke-width': 1,
      }))
   }
   for (const tick of xTicks) {
      const gridX = xScale(tick)
      parts.push(selfClosingElement('line', {
         x1: gridX, y1: plotTop, x2: gridX, y2: plotBottom,
         stroke: theme.ink.grid, 'stroke-width': 1,
      }))
   }

   // The two bold crossing axes.
   parts.push(selfClosingElement('line', {
      x1: verticalAxisX, y1: plotTop, x2: verticalAxisX, y2: plotBottom,
      stroke: theme.ink.axis, 'stroke-width': 1,
   }))
   parts.push(selfClosingElement('line', {
      x1: plotLeft, y1: horizontalAxisY, x2: plotRight, y2: horizontalAxisY,
      stroke: theme.ink.axis, 'stroke-width': 1,
   }))

   // y-axis tick marks + labels, riding the vertical axis (labels to its left).
   for (const tick of yTicks) {
      const tickY = yScale(tick)
      // Drop the origin's own row so the two zero labels never collide at the crossing.
      if (Math.abs(tickY - horizontalAxisY) < AXIS_CROSSING_LABEL_SKIP_PX) continue
      parts.push(selfClosingElement('line', {
         x1: verticalAxisX - TEXTBOOK_TICK_MARK_HALF_LENGTH, y1: tickY,
         x2: verticalAxisX + TEXTBOOK_TICK_MARK_HALF_LENGTH, y2: tickY,
         stroke: theme.ink.axis, 'stroke-width': 1,
      }))
      parts.push(textElement({
         x: verticalAxisX - TEXTBOOK_TICK_MARK_HALF_LENGTH - TEXTBOOK_TICK_LABEL_GAP,
         y: tickY,
         'text-anchor': 'end',
         'dominant-baseline': 'central',
         'font-size': TICK_FONT_SIZE,
         'font-variant-numeric': 'tabular-nums',
         fill: theme.ink.textMuted,
      }, formatNumber(tick)))
   }

   // x-axis tick marks + labels, riding the horizontal axis (labels below it).
   for (const tick of xTicks) {
      const tickX = xScale(tick)
      // Drop the origin's own column for the same reason.
      if (Math.abs(tickX - verticalAxisX) < AXIS_CROSSING_LABEL_SKIP_PX) continue
      parts.push(selfClosingElement('line', {
         x1: tickX, y1: horizontalAxisY - TEXTBOOK_TICK_MARK_HALF_LENGTH,
         x2: tickX, y2: horizontalAxisY + TEXTBOOK_TICK_MARK_HALF_LENGTH,
         stroke: theme.ink.axis, 'stroke-width': 1,
      }))
      parts.push(textElement({
         x: tickX,
         y: horizontalAxisY + TEXTBOOK_TICK_MARK_HALF_LENGTH + TICK_FONT_SIZE,
         'text-anchor': 'middle',
         'font-size': TICK_FONT_SIZE,
         'font-variant-numeric': 'tabular-nums',
         fill: theme.ink.textMuted,
      }, formatNumber(tick)))
   }

   return element('g', {}, parts.join(''))
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

/** Single-series bars: one rect per category, capped at 24px and centered in its band. Uniform base
 *  color by default; a `categoryColors[categoryIndex]` override recolors just that one bar. */
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
   axisMode: AxisMode = 'linear',
): string {
   const baseColor = resolveSeriesColor(0, series.color, theme)
   // The band-capped base thickness scaled by the fraction, so the control still bites on a wide
   // band where the 24px cap already governs.
   const cappedBase = Math.min(xBand.bandwidth, MAX_BAR_THICKNESS)
   const barWidth = cappedBase * barWidthFraction
   const parts: string[] = []
   for (let index = 0; index < labels.length; index++) {
      const value = series.values[index]
      if (!isPlottableValue(value, axisMode)) continue
      const valueY = yScale(value)
      const rectY = Math.min(baselineY, valueY)
      const rectHeight = Math.abs(valueY - baselineY)
      const rectX = xBand.center(index) - barWidth / 2
      // Per-bar override wins; otherwise the uniform series base color.
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
   axisMode: AxisMode = 'linear',
): string {
   const seriesCount = series.length
   const subStep = xBand.bandwidth / seriesCount
   // Sub-slot minus the 2px surface gap, capped, scaled by the fraction, floored at 1px so it draws.
   const cappedBase = Math.min(subStep - SURFACE_GAP, MAX_BAR_THICKNESS)
   const barWidth = Math.max(1, cappedBase * barWidthFraction)
   const parts: string[] = []
   for (let categoryIndex = 0; categoryIndex < labels.length; categoryIndex++) {
      const bandStart = xBand.start(categoryIndex)
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
         const value = series[seriesIndex].values[categoryIndex]
         if (!isPlottableValue(value, axisMode)) continue
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
 * Draw a line through each series' bar-top peaks (a bar+line combo), bar family only. Reuses
 * `buildPointRuns` so `null` gaps break the line, and draws on top of the bars.
 *   - bar: one line through the drawn series' bar tops (band center x).
 *   - bar-grouped: one line per series, each through that series' own sub-bars.
 *   - bar-stacked: one line through each category's cumulative stack top, colored with the topmost
 *     series' color since that is the segment it rides along.
 */
function renderBarPeakLines(
   type: GraphSpec['type'],
   labels: string[],
   series: GraphSeries[],
   xBand: { start(index: number): number; center(index: number): number; bandwidth: number },
   yScale: (value: number) => number,
   theme: GraphTheme,
   axisMode: AxisMode = 'linear',
): string {
   if (series.length === 0) return ''

   if (type === 'bar-stacked') {
      // bar-stacked never renders on a log axis, so axisMode is always linear here.
      const topSeriesIndex = series.length - 1
      const color = resolveSeriesColor(topSeriesIndex, series[topSeriesIndex].color, theme)
      const stackedTotals = computeStackedTotals(labels, series)
      const totalsSeries: GraphSeries = { name: '', values: stackedTotals }
      return renderOnePeakLine(labels, totalsSeries, xBand, yScale, color, axisMode)
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
         parts.push(renderOnePeakLine(labels, series[seriesIndex], perSeriesXBand, yScale, color, axisMode))
      }
      return element('g', {}, parts.join(''))
   }

   // 'bar': the same band-center x every renderSingleBars rect sits at.
   const color = resolveSeriesColor(0, series[0].color, theme)
   return renderOnePeakLine(labels, series[0], xBand, yScale, color, axisMode)
}

/** Per-category cumulative total across every series, for the bar-stacked peak line. A missing cell
 *  contributes zero; a category is a gap (breaking the line) only when every series is missing there. */
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

/** Draw one peak-line series as a round-capped polyline per contiguous run, via {@link buildPointRuns}.
 *  No point markers, keeping it distinct from a full line chart. */
function renderOnePeakLine(
   labels: string[],
   series: GraphSeries,
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   color: string,
   axisMode: AxisMode = 'linear',
): string {
   const runs = buildPointRuns(labels, series, xBand, yScale, axisMode)
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

/** Split a series into contiguous point runs, dropping null/malformed cells (and, on a log axis,
 *  non-positive ones) as gaps that break the run. */
function buildPointRuns(
   labels: string[],
   series: GraphSeries,
   xBand: { center(index: number): number },
   yScale: (value: number) => number,
   axisMode: AxisMode = 'linear',
): PointRun[] {
   const runs: PointRun[] = []
   let current: PointRun | null = null
   for (let index = 0; index < labels.length; index++) {
      const value = series.values[index]
      if (!isPlottableValue(value, axisMode)) {
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
   axisMode: AxisMode = 'linear',
): string {
   const parts: string[] = []
   for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
      const runs = buildPointRuns(labels, series[seriesIndex], xBand, yScale, axisMode)
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
   axisMode: AxisMode = 'linear',
): string {
   const parts: string[] = []
   for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const color = resolveSeriesColor(seriesIndex, series[seriesIndex].color, theme)
      const runs = buildPointRuns(labels, series[seriesIndex], xBand, yScale, axisMode)
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
   // Color each swatch by SERIES INDEX, not by name: names can be blank or duplicated (scatter
   // defaults to blank), which would collapse every swatch onto the last series' color.
   const firstRowY = layout.canvasHeight - layout.margin.bottom + 30
   let legendItemIndex = 0
   for (let rowIndex = 0; rowIndex < legendLayout.rows.length; rowIndex++) {
      const row = legendLayout.rows[rowIndex]
      const rowWidth = rowWidthOf(row)
      const rowLeft = (layout.canvasWidth - rowWidth) / 2
      const rowY = firstRowY + rowIndex * LEGEND_ROW_HEIGHT
      for (const item of row) {
         const swatchX = rowLeft + item.offsetX
         const color = resolveSeriesColor(legendItemIndex, series[legendItemIndex]?.color, theme)
         legendItemIndex++
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

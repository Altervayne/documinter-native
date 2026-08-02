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

import type { GraphSpec, GraphTheme, GraphSeries, Overlay, FunctionDomain, ScatterSeries, EquationSeries } from './types'
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
   LOG_SCALE_UNSUPPORTED_TYPES,
} from './types'
import { MAX_SERIES, resolveSeriesColor } from './palette'
import { mean as meanOf, median as medianOf, linearRegression, linearRegressionXY } from './stats'
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

// ====== custom-origin ("textbook" / four-quadrant) axes, function/scatter only ======
// The half-length of a tick mark drawn straddling a crossing axis line (so a tick reads the same on
// either side of the axis, classic math-plot style). ~4px matches the recessive gridline weight.
const TEXTBOOK_TICK_MARK_HALF_LENGTH = 4
// Gap in px between a tick mark's end and its number label on the crossing axes.
const TEXTBOOK_TICK_LABEL_GAP = 4
// A tick label whose pixel position sits within this many px of the OTHER crossing axis is the
// origin's own label, dropped so the two zero labels never collide at the crossing (the standard
// "no redundant origin number" convention). When the origin sits off-domain (its axis clamped to a
// plot edge), no tick lands this close, so nothing is dropped, exactly the graceful behavior wanted.
const AXIS_CROSSING_LABEL_SKIP_PX = 1

// ====== value (y) axis mode, linear vs. log (2026-08-02) ======
// One shared type alias for the value axis's resolved mode, threaded through every drawing helper
// below that needs to know "is a value <= 0 actually plottable here" (log is undefined at <= 0).
// See the VALUE DOMAIN section further down for the full per-type eligibility policy.
type AxisMode = 'linear' | 'log'

/** Opacity of a log-scale MINOR (1-2-5) gridline, fainter than a major gridline/tick, purely a
 *  density cue, so it never competes with the labeled major lines. */
const MINOR_GRIDLINE_OPACITY = 0.5

// ====== function-plot discontinuity heuristic ======
// Two adjacent finite samples with OPPOSITE sign, where at least one's magnitude is this many
// times the resolved y-domain's half-range, are treated as straddling an asymptote (tan(x), 1/x)
// rather than a genuine crossing, a pragmatic sign-change + magnitude heuristic (not symbolic
// limit analysis), per docs/reference/graph_equation_study.md Q4.
const ASYMPTOTE_MAGNITUDE_MULTIPLIER = 4

// ====== equation overlay (f(x) drawn over an existing cartesian chart) ======
// Sample count across the host chart's category-index domain [0, labelCount-1]; >=100 keeps a
// sampled curve reading as smooth at the chart's canvas size (mirrors FUNCTION_DEFAULT_SAMPLES'
// order of magnitude for the standalone `function` chart type, applied here to a usually-narrower
// index range instead of a numeric xMin/xMax span).
const EQUATION_OVERLAY_SAMPLE_COUNT = 120
// A fixed, distinct palette slot for the equation curve, NEVER a data series' own hue (an
// arbitrary f(x) is not "series 6"; this just reuses the validated 8-hue palette's violet slot as
// a stable, always-the-same color via the existing resolveSeriesColor wrap-around).
const EQUATION_OVERLAY_PALETTE_SLOT = 6

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

   // ====== value domain + axis mode (linear vs. log) + nice ticks ======
   // Reference overlays AUTO-EXTEND the domain (before nice-ticks) so a target line outside the data
   // range is always visible, the data rescales to fit it. Mean/trend are data-derived (already
   // inside the domain), so they need no extension.
   //
   // LOG SCALE POLICY (see docs/reports/2026-08-02-graph-log-scale.md): `bar-stacked` never gets a
   // log axis (zero-baseline stacking has no analog where zero doesn't exist), the UNFOLDED domain
   // probe below is skipped entirely for it, so it takes the exact ORIGINAL single-call path,
   // byte-identical to before this feature. Every other type here is log-ELIGIBLE, but only when the
   // data's own raw domain (BEFORE the usual zero-baseline fold, BEFORE yMin/yMax overrides) is
   // strictly positive; log is undefined at <= 0, so a domain that touches zero or goes negative
   // silently, safely falls back to the ordinary zero-folded linear domain, never a clamp-to-floor,
   // never NaN geometry. When `options.yScale` is absent or `'linear'`, this resolves to the exact
   // same single `computeValueDomain(…, true)` call this renderer has always made.
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
   // The x-axis baseline: the zero-crossing for a linear axis (bars grow from 0), or the axis FLOOR
   // (niceMin, the smallest decade) for a log axis, since zero does not exist on a log scale. Bars
   // drawn against this baseline therefore grow from the axis floor in log mode, not an implied zero.
   const baselineValue = axisMode === 'log' ? niceMin : Math.min(niceMax, Math.max(niceMin, 0))
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

   // The bar-top peak line is a DISPLAY option (traces the raw bars already drawn), so it is drawn
   // right after the bar marks, on top of them, and before the statistic overlays below. Bar
   // family only; a `line`/`area`/radial spec silently ignores the option.
   if ((type === 'bar' || type === 'bar-grouped' || type === 'bar-stacked') && options.barPeakLine === true) {
      pieces.push(renderBarPeakLines(type, labels, drawnSeries, xBand, yScale, theme, axisMode))
   }

   // Overlays draw AFTER the data marks (z-order: on top of the data), reusing the same scales.
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

/**
 * Render a `function`-type graph spec (sampled equation curves over a continuous numeric domain)
 * to its inner SVG markup. Reuses the EXISTING, unmodified `renderLineSeries`/`buildPointRuns`
 * (via the {@link buildContinuousXAdapter} adapter from continuousAxis.ts) instead of a categorical
 * `BandScale`; the categorical `bar`/`bar-grouped`/`bar-stacked`/`line`/`area` paths above are
 * completely untouched by this function. Never throws on bad/empty input, an uncompileable
 * equation, an empty equation list, or a degenerate domain all degrade to a graceful chart with an
 * empty (or partially empty) curve set, never an exception.
 */
export function renderFunctionPlot(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   const { equations, xMin, xMax, sampleXPositions, rawValueLists } = sampleFunctionEquations(spec)
   // Used only as buildPointRuns'/renderMarkers' per-point tooltip label (point markers default OFF
   // for function charts, see below), formatted x-values read sensibly if points are ever enabled.
   const sampleLabels = sampleXPositions.map(formatNumber)

   // ====== y-domain: autoscale to the finite sampled range, NO forced zero baseline ======
   // (an arbitrary f(x), e.g. "100 + 0.001*x", should not be crushed against a forced-zero domain
   // the way bar/line-over-real-data charts are, see docs/reference/graph_equation_study.md Q4/6).
   const [domainMin, domainMax] = computeFunctionValueDomain(rawValueLists, options)

   // ====== axis mode (linear vs. log) ======
   // `function` never zero-folds its domain (see above), so `domainMin`/`domainMax` are already the
   // exact "unfolded" bounds a log-eligibility check needs, no second domain pass required, unlike
   // the bar/line/area path in renderCartesian. Same policy: log is undefined at <= 0, so an
   // out-of-range domain (e.g. an equation that dips to/through zero) silently falls back to linear.
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

   // ====== discontinuity handling ======
   // True domain errors (sqrt(-1), 1/0, ...) are already `null` from evaluate() and fall straight
   // into the existing null-gap-breaks-the-polyline mechanism below with zero new code. The
   // asymptote heuristic additionally breaks a run between two finite-but-huge, opposite-signed
   // adjacent samples (tan(x), 1/x near zero) that would otherwise draw a near-vertical spike. A
   // log-eligible domain (niceMin > 0 by construction) can never contain an opposite-signed pair, so
   // this heuristic is naturally a no-op in that case, no special-casing needed here.
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

   // ====== scales ======
   // linearScale is the SAME generic affine map the y-axis already uses; reused as-is for x, per
   // the study's Q2 finding (no new scale primitive needed for a continuous x-axis). The x-axis
   // ALWAYS stays linear here, only the value (y) axis switches to log, per the feature's scope.
   const yScale = axisMode === 'log'
      ? logScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
      : linearScale([niceMin, niceMax], [plot.y + plot.height, plot.y])
   // A VERTICAL `reference` overlay auto-extends the drawn X-AXIS domain, NOT the sampling domain
   // (the curve is still sampled over [xMin, xMax]); the axis just widens so a target line beyond the
   // sampled range stays on-canvas, with the curve occupying its own sub-range of the wider axis. A
   // no-op (thus byte-identical) for a function carrying no vertical reference.
   const [axisXMin, axisXMax] = foldReferenceOverlaysIntoDomain(xMin, xMax, options.overlays, 'vertical')
   const xScale = linearScale([axisXMin, axisXMax], [plot.x, plot.x + plot.width])
   const xAdapter = buildContinuousXAdapter(sampleXPositions, xScale)
   const baselineValue = axisMode === 'log' ? niceMin : Math.min(niceMax, Math.max(niceMin, 0))
   const baselineY = yScale(baselineValue)

   const lineStrokeWidth = clamp(
      options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH)
   // Point markers default OFF for function charts (a sampled curve of dozens/hundreds of points is
   // visual noise, unlike a small genuine categorical series), a LOCAL default distinct from
   // GRAPH_DEFAULT_SHOW_POINTS (true), which stays correct for real bar/line/area data.
   const showPoints = options.showPoints ?? false

   // ====== assemble ======
   // A custom {@link GraphOptions.axisOrigin} draws crossing "textbook" axes instead of edge axes,
   // but only on a LINEAR value axis (ignored under a log scale, see the feature's log policy).
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
   // Reference overlays (both orientations) draw over the curve. Other overlay kinds do not apply to
   // a function chart (no discrete series to average/fit; an f(x) overlay would duplicate the plot),
   // so renderFunctionReferenceOverlays skips them. Absent/empty ⇒ nothing drawn, byte-identical.
   if (options.overlays && options.overlays.length > 0) {
      pieces.push(renderFunctionReferenceOverlays(
         options.overlays, plot, xScale, yScale, axisXMin, axisXMax, niceMin, niceMax, theme))
   }
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
 * Resolve a `function` chart's numeric domain and sample every one of its equations across it,
 * the SHARED, single source of truth `renderFunctionPlot` builds its curves from AND
 * {@link computeFunctionYDomain} builds its log-scale eligibility check from, so the two can never
 * silently drift out of sync (an uncompileable expression contributes an all-null value list, same
 * "invalid never breaks the chart" contract every other graph/math parser here honors).
 */
function sampleFunctionEquations(spec: GraphSpec): {
   equations: EquationSeries[]
   xMin: number
   xMax: number
   sampleXPositions: number[]
   rawValueLists: (number | null)[][]
} {
   // v1 caps the number of drawn equations at the palette size, same cap every other series-based
   // chart type already uses.
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

/**
 * Compute a `function` chart's raw (pre-nice-tick) sampled y-domain, EXACTLY the domain
 * `renderFunctionPlot` resolves for its own axis-mode (linear vs. log) decision (same
 * `sampleFunctionEquations` + `computeFunctionValueDomain` pipeline, honoring any `yMin`/`yMax`
 * override). Exported so `graphEdit.ts`'s `logScaleWouldFallBackToLinear` can test log-scale
 * eligibility for a `function` chart's in-editor fallback notice WITHOUT re-implementing (and
 * risking drifting from) the expression-sampling logic, this is the one place that logic lives.
 */
export function computeFunctionYDomain(spec: GraphSpec): [number, number] {
   const { rawValueLists } = sampleFunctionEquations(spec)
   return computeFunctionValueDomain(rawValueLists, spec.options ?? {})
}

/**
 * The raw (pre-nice-tick) y-domain for a function chart: the min/max across every FINITE sampled
 * value of every equation, with NO folded-in zero baseline (decision 6, bars/lines-over-real-data
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
   // Fold every HORIZONTAL reference-overlay value into the raw domain so a y = target line beyond
   // the sampled range stays on-canvas, mirroring the categorical/scatter y-fold, and a no-op (thus
   // byte-identical) for a function chart carrying no horizontal reference. Done before the yMin/yMax
   // overrides, which still win when the author has pinned an explicit floor/ceiling.
   const [foldedMin, foldedMax] = foldReferenceOverlaysIntoDomain(dataMin, dataMax, options.overlays)
   const min = options.yMin !== undefined ? options.yMin : foldedMin
   const max = options.yMax !== undefined ? options.yMax : foldedMax
   return [min, max]
}

/**
 * Apply the asymptote heuristic: break the run between two adjacent FINITE samples that have
 * opposite sign AND at least one magnitude >= {@link ASYMPTOTE_MAGNITUDE_MULTIPLIER} x the
 * resolved y-domain's half-range, by nulling the second of the pair. This is deliberately a
 * pragmatic threshold, not an exact discontinuity detector (a pathological function could still
 * fool it), see docs/reference/graph_equation_study.md Q4 for the documented rationale. A `null`
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
// # SCATTER PLOT      #
// #####################

/**
 * Render a `scatter`-type graph spec (real (x, y) point pairs, no sampled curve, no shared domain)
 * to its inner SVG markup. Unlike `function`, a scatter chart needs BOTH axes autoscaled from the
 * data (there is no user-chosen domain), so the x-range gets the SAME nice-tick treatment the
 * y-range already gets elsewhere in this file, niceTicks once per axis, using `niceMin`/`niceMax`
 * as the actual scale range (not just the tick-label positions), which also gives points sitting
 * at the extreme edges of the data some visual breathing room instead of drawing flush against the
 * plot boundary. Points are drawn directly at `xScale(point.x)`/`yScale(point.y)`, no
 * `buildPointRuns`/`{center(index)}` adapter needed, since scatter points have no shared sample/
 * category index to align across series (v1 is points-only; a per-series trendline is a deferred
 * fast-follow). Never throws on bad/empty input, an empty series list, a series with no points,
 * or non-finite point coordinates all degrade to a graceful chart with nothing drawn for the
 * affected point(s), never an exception.
 */
export function renderScatterPlot(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   // v1 caps the number of drawn series at the palette size, same cap every other series-based
   // chart type already uses.
   const series = (spec.scatterPlot?.series ?? []).slice(0, MAX_SERIES)

   // ====== domain: autoscale x AND y across every finite point, no forced zero baseline ======
   const rawDomain = computeScatterPointDomain(series)
   // A VERTICAL `reference` overlay auto-extends the X-domain (mirrors the horizontal reference's
   // y-fold below) so a target line beyond the plotted points always stays on-canvas. A no-op when
   // there are no vertical references, so a scatter without one nice-ticks its x exactly as before.
   const [foldedXMin, foldedXMax] = foldReferenceOverlaysIntoDomain(
      rawDomain.xMin, rawDomain.xMax, options.overlays, 'vertical')
   const xNice = niceTicks(foldedXMin, foldedXMax, TARGET_TICK_COUNT)
   // A `reference` overlay auto-extends the Y-domain (mirrors computeValueDomain's fold for the
   // categorical cartesian types) so a target line beyond the plotted points always stays on-canvas.
   // Done before the yMin/yMax overrides, which still win when the author has pinned an explicit
   // floor/ceiling. Mean/trend are data-derived (already inside the domain), so they need no fold.
   const [foldedYMin, foldedYMax] = foldReferenceOverlaysIntoDomain(
      rawDomain.yMin, rawDomain.yMax, options.overlays)
   const resolvedYMin = options.yMin !== undefined ? options.yMin : foldedYMin
   const resolvedYMax = options.yMax !== undefined ? options.yMax : foldedYMax

   // ====== axis mode (linear vs. log), Y ONLY; the x-axis stays linear/continuous either way ======
   // Scatter never zero-folds its y-domain (see above), so `resolvedYMin`/`resolvedYMax` are already
   // the exact "unfolded" bounds a log-eligibility check needs. Same policy as every other type: log
   // is undefined at <= 0, so a domain touching zero or negative silently falls back to linear.
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

   // ====== legend reservation ======
   // renderLegend/layoutLegend want GraphSeries-shaped input (name + color); scatter series carry
   // no `values`, so a minimal synthetic GraphSeries list (empty values) is built for the legend
   // only, mirroring renderFunctionPlot's `drawnSeries` construction from its equations.
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

   // ====== scales ======
   // linearScale/niceTicks are the SAME generic primitives the y-axis already uses; reused as-is
   // for x, per the study's Q2 finding (no new scale primitive needed for a continuous x-axis). The
   // x-axis is NEVER log here, only the value (y) axis switches, per the feature's scope.
   const yScale = axisMode === 'log'
      ? logScale([yNiceMin, yNiceMax], [plot.y + plot.height, plot.y])
      : linearScale([yNiceMin, yNiceMax], [plot.y + plot.height, plot.y])
   const xScale = linearScale([xNice.niceMin, xNice.niceMax], [plot.x, plot.x + plot.width])
   const baselineValue = axisMode === 'log' ? yNiceMin : Math.min(yNiceMax, Math.max(yNiceMin, 0))
   const baselineY = yScale(baselineValue)

   // ====== assemble ======
   // A custom {@link GraphOptions.axisOrigin} draws crossing "textbook" axes instead of the edge
   // axes, but only on a LINEAR value axis (a custom origin is a linear concept; under a log scale
   // it is ignored and the standard log axis is drawn, per the feature's log policy).
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

   // Overlays draw AFTER the data marks (z-order: on top of the data), reusing the same scales.
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

/**
 * The raw (pre-nice-tick) x AND y domain across every FINITE point of every series, the min/max
 * of `point.x` and `point.y` independently, with NO folded-in zero baseline (matching the
 * `function` type's autoscale policy: an arbitrary scatter of real-world (x, y) data should not be
 * crushed against a forced-zero domain on either axis). Falls back to `[0, 1]` on each axis when
 * nothing finite was plotted (every series empty, or every point non-finite).
 */
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

/**
 * Draw every series' points as small filled circles (the same >=8px-diameter marker spec, radius
 * {@link MARKER_RADIUS}, {@link SURFACE_GAP}-wide surface ring, every other mark-with-a-point-
 * marker already uses in this file), directly at `xScale(point.x)`/`yScale(point.y)`. A non-finite
 * point is skipped defensively (the domain computation above already excludes it, so this is a
 * belt-and-suspenders guard, not the expected path).
 */
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
         // On a log y-axis, a point at y <= 0 has no representable position (log is undefined there)
         //, skip it, same "never NaN geometry" defense every other log-aware drawing loop uses. In
         // practice unreachable when the axis actually IS log (eligibility already required every
         // finite y across every series to be positive), a pure belt-and-suspenders guard.
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
// Reuses the SAME overlay machinery a categorical cartesian chart draws with (dashed styling, the
// haloed ink label, the analytic plot-rect clip, `resolveSeriesColor`), only mean/trend need a
// scatter-specific computation, since a scatter series has no category-aligned `values` array to
// feed `mean`/`median`/`linearRegression` with; it carries raw `(x, y)` points instead.

/**
 * Draw every statistical overlay over a scatter plot. Mirrors {@link renderOverlays}'s per-kind
 * dispatch: mean/median resolve their target series' stat from the series' own point Y-values,
 * trend fits {@link linearRegressionXY} over the series' raw `(x, y)` points (NOT the categorical
 * index-based {@link linearRegression}) and draws the fitted line across the chart's FULL x-domain,
 * and reference reuses {@link renderReferenceOverlay} verbatim (it only needs `plot`/`yScale`/
 * `niceMin`/`niceMax`, none of which differ for scatter). `series: 'all'` fans out to one mark per
 * drawn series; an index not among the drawn series is skipped. `equation` is chart-level but tied
 * to the categorical index axis scatter doesn't have, so it draws nothing here (a natural
 * fast-follow, not built in v1, see docs). Never throws, a series with too few points for a
 * requested statistic simply draws nothing.
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
         // Continuous-x scatter supports BOTH a horizontal (y = value) and a vertical (x = value)
         // reference; the oriented dispatcher picks the right one (default/absent ⇒ horizontal).
         parts.push(renderReferenceOverlayOriented(
            overlay, plot, xScale, yScale, xNiceMin, xNiceMax, yNiceMin, yNiceMax, theme))
         continue
      }
      if (overlay.kind === 'equation') continue // chart-level, categorical-axis only, no scatter analog yet

      // Computed kinds (mean / median / trend): resolve the target series, fanning out for 'all'.
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
         } else {
            parts.push(renderScatterStatLineOverlay(
               overlay, oneSeries, plot, yScale, yNiceMin, yNiceMax, color, singleSeries, theme))
         }
      }
   }
   return element('g', {}, parts.join(''))
}

/**
 * A per-series mean/median line for scatter: same visual as {@link renderStatLineOverlay}, but the
 * statistic is computed over the target series' own point Y-values (a scatter series carries
 * `points`, not a category-aligned `values` array).
 */
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

/**
 * A per-series linear trendline for scatter: {@link linearRegressionXY} fits the target series' raw
 * `(x, y)` points directly (unlike the categorical {@link linearRegression}, which fits a value
 * series against its own index). The fitted line is drawn across the chart's FULL x-domain
 * (`xNiceMin`..`xNiceMax`), mirroring how the cartesian trend spans the whole category axis rather
 * than stopping at one series' own data range, then analytically clipped to the plot's vertical
 * band with the SAME `clipSegmentToBand` helper (no SVG clipPath). A series with fewer than 2
 * finite points, or every point sharing the same x (an undefined/vertical slope), draws nothing
 * (`linearRegressionXY` returns null for both).
 */
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
   const fit = linearRegressionXY(oneSeries.points)
   if (fit === null) return '' // fewer than 2 finite points, or an undefined (vertical) slope

   const startX = xScale(xNiceMin)
   const endX = xScale(xNiceMax)
   const startY = yScale(fit.slope * xNiceMin + fit.intercept)
   const endY = yScale(fit.slope * xNiceMax + fit.intercept)

   // Analytic clamp to the plot rect (NO SVG clipPath, a fixed id would collide across the many
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

// #####################
// # HISTOGRAM         #
// #####################

/**
 * Render a `histogram`-type graph spec (a binned frequency distribution over raw numeric samples)
 * to its inner SVG markup. Bars are drawn CONTIGUOUS (zero inter-bar gap, the defining look of a
 * histogram, unlike every other bar family in this file, which always leaves a
 * {@link SURFACE_GAP} between neighbours) over a continuous numeric x-axis of bin edges, reusing
 * the SAME continuous-x foundation (`renderNumericXAxisLabels`) `function`/`scatter` introduced.
 * Unlike those two, y = frequency COUNT always draws from a ZERO baseline (a count is never
 * negative, so, unlike `function`'s/`scatter`'s no-forced-zero autoscale, a zero baseline is
 * always meaningful here, exactly like the ordinary bar/line-over-real-data types). A single
 * dataset has no meaningful legend (there is nothing to distinguish it FROM), so none is drawn;
 * the optional dataset name surfaces only in the chart's accessible `<desc>` (see index.ts's
 * `describeChart`), never as a drawn legend box. Never throws on bad/empty input, fewer than one
 * finite sample degrades to a graceful empty plot (axes with no bars), never an exception.
 */
export function renderHistogram(spec: GraphSpec, theme: GraphTheme): string {
   const options = spec.options ?? {}
   const histogramData = spec.histogramData
   const samples = histogramData?.samples ?? []
   const { edges, counts } = computeHistogramBins(samples, histogramData?.bins)

   // ====== y-domain: frequency counts from a ZERO baseline (a count is never negative) ======
   let maxCount = 0
   let minPositiveCount = Infinity
   for (const count of counts) {
      if (count > maxCount) maxCount = count
      if (count > 0 && count < minPositiveCount) minPositiveCount = count
   }

   // ====== axis mode (linear vs. log) ======
   // A histogram's ordinary domain always folds in the zero baseline (a count is never negative,
   // see below), but zero itself is not representable on a log axis. So the log-eligibility candidate
   // anchors the floor at the smallest POSITIVE bin count instead of zero (an empty/zero-count bin
   // has no position on a log axis at all, renderHistogramBars simply skips drawing it in that
   // case). No positive bin at all (an all-empty histogram, or every bin genuinely at zero) has
   // `minPositiveCount` stay `Infinity`, which safely fails the eligibility check below.
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

   // ====== x-domain: the bin edges themselves (an empty result, no finite sample survived,
   // falls back to [0, 1] so the scale never divides by zero) ======
   const xMin = edges.length > 0 ? edges[0] : 0
   const xMax = edges.length > 0 ? edges[edges.length - 1] : 1

   // ====== layout (no legend reservation: a single dataset has nothing to distinguish itself from) ======
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

/**
 * Draw one CONTIGUOUS rect per bin, zero inter-bar gap, so adjacent bars' edges exactly touch
 * (the defining visual difference from every other bar family here). A thin surface-colored
 * stroke outlines each bar so neighbouring bins still read as distinct bars despite touching
 * edges, without opening an actual gap in the underlying data.
 */
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
      // A zero/empty bin has no representable position on a log axis (log is undefined at <= 0),
      // skip drawing it entirely rather than computing a NaN/collapsed rect. Bar family's own
      // isPlottableValue isn't reused here since a histogram count is always a plain number, never
      // null/undefined; the log-only half of that same check is inlined directly.
      if (axisMode === 'log' && count <= 0) continue
      const leftX = xScale(edges[binIndex])
      const rightX = xScale(edges[binIndex + 1])
      const valueY = yScale(count)
      const rectY = Math.min(baselineY, valueY)
      const rectHeight = Math.abs(valueY - baselineY)
      const rectWidth = Math.max(0, rightX - leftX)
      const tooltip = `${formatNumber(edges[binIndex])}–${formatNumber(edges[binIndex + 1])}: ${formatNumber(count)}`
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

/**
 * Draw every statistical overlay over the plot. Reuses the computed `yScale` / `xBand` / `plot`.
 * Per-series kinds (mean / median / trend) expand `series: 'all'` to one mark per drawn series
 * (each echoing that series' hue); a specific index that is not among the drawn series is skipped.
 * Reference is a single per-chart horizontal in neutral ink. Never throws on degenerate data, a
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
         // A VERTICAL reference (x = value) has no meaning on a categorical band x-axis, the
         // continuous-x types (function/scatter) draw those; here it is silently skipped. A
         // horizontal (default, orientation-less) reference draws exactly as before.
         if ((overlay.orientation ?? 'horizontal') === 'vertical') continue
         parts.push(renderReferenceOverlay(overlay, plot, yScale, niceMin, niceMax, theme))
         continue
      }
      if (overlay.kind === 'equation') {
         parts.push(renderEquationOverlay(overlay, labels, xBand, yScale, plot, niceMin, niceMax, theme))
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
               overlay, oneSeries, labels, xBand, yScale, plot, color, theme))
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

/**
 * A per-chart VERTICAL reference line: a neutral-ink dashed line at the constant x = `overlay.value`,
 * spanning the plot height, the x-axis mirror of {@link renderReferenceOverlay}, for the continuous-x
 * types (`function`/`scatter`) only. Off-domain (an x outside the nice x-range) is skipped, the same
 * defensive clip the horizontal reference uses; the x-domain was auto-extended to include this value
 * (see {@link foldReferenceOverlaysIntoDomain} with orientation `'vertical'`), so that is normally a
 * no-op guard.
 */
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

/**
 * Draw one reference overlay dispatched on its {@link Overlay.orientation}: a `'vertical'` reference
 * as an x = value line ({@link renderVerticalReferenceOverlay}, for the continuous-x types), any other
 * (including the default, orientation-less) as the ordinary y = value horizontal line
 * ({@link renderReferenceOverlay}). Shared by the scatter AND function overlay passes so both handle
 * the two orientations identically.
 */
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

/**
 * Draw the reference overlays over a `function` chart. A function chart has no discrete data series
 * to average or fit a trendline through, and an `equation` overlay would just duplicate the plotted
 * curve, so ONLY the `reference` kind is meaningful here; every other kind is skipped. Both
 * orientations are supported (horizontal y = value and vertical x = value) via the shared oriented
 * dispatcher, using the function chart's own resolved x-axis and y value domains.
 */
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

/**
 * A chart-level `f(x)` curve, sampled across the host chart's category-index domain
 * `[0, labelCount - 1]` (the SAME x-range the drawn data marks already sit on), reusing the
 * existing `xBand.center(index)` positioning by INTERPOLATING between two adjacent band centers
 * for a fractional sample index (see {@link interpolateBandCenter}). Never auto-extends the
 * y-domain (an arbitrary expression must not squash the real data), instead, every sampled
 * segment is analytically clipped to the plot's vertical band with the SAME `clipSegmentToBand`
 * line-parameter math the trend overlay already uses (NO SVG `clipPath`, per the existing
 * multi-chart-per-export constraint). An uncompileable/blank expression, or a chart with fewer
 * than 2 categories (no index range to sample across), draws nothing, never throws.
 */
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

   // Anchor the label at the last drawn point of the last visible run (mirrors the trend overlay's
   // "label at the clipped right end"); the expression itself is the default label.
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

/**
 * Sample a compiled expression across the fractional index domain `[0, lastIndex]` at
 * {@link EQUATION_OVERLAY_SAMPLE_COUNT} evenly spaced points, reusing the `function` chart's own
 * asymptote heuristic ({@link applyAsymptoteGaps}) for domain-error / near-asymptote gaps, then
 * walks the sampled pixel segments through {@link clipSegmentToBand} ONE SEGMENT AT A TIME, the
 * exact technique {@link renderTrendOverlay} already uses for its single sloped segment, just
 * applied per-segment here since an arbitrary f(x) is not a single straight line. A segment fully
 * outside the plot's vertical band breaks the run (mirrors a null-gap break); a partially-outside
 * segment is trimmed to the boundary-crossing point, so the curve reads as truly clipped to the
 * plot rect rather than stopping at the last in-range SAMPLE.
 */
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

   const runs: { x: number; y: number }[][] = []
   let currentRun: { x: number; y: number }[] | null = null
   let previousPoint: { x: number; y: number } | null = null

   for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const value = gappedValues[sampleIndex]
      if (value === null) {
         currentRun = null
         previousPoint = null
         continue
      }
      const fractionalIndex = sampleIndex * step
      const currentPoint = { x: interpolateBandCenter(xBand, fractionalIndex), y: yScale(value) }

      if (previousPoint === null) {
         // First finite sample after a gap: nothing to connect to yet (mirrors buildPointRuns,
         // which needs two points before a polyline exists).
         previousPoint = currentPoint
         continue
      }

      const clipped = clipSegmentToBand(
         previousPoint.x, previousPoint.y, currentPoint.x, currentPoint.y, plot.y, plot.y + plot.height)
      if (clipped === null) {
         // The whole segment sits off-canvas vertically: break here, exactly like a null-gap.
         currentRun = null
      } else if (currentRun === null) {
         currentRun = [{ x: clipped.x1, y: clipped.y1 }, { x: clipped.x2, y: clipped.y2 }]
         runs.push(currentRun)
      } else {
         // Continuing the same run: the clipped start already matches the run's last point (both
         // derive from the same shared, un-clipped previousPoint), so only the new end is appended.
         currentRun.push({ x: clipped.x2, y: clipped.y2 })
      }

      previousPoint = currentPoint
   }

   return runs
}

/**
 * Interpolate a FRACTIONAL category index to a pixel x by linearly blending the two adjacent
 * integer band centers (`center(floor(index))` -> `center(ceil(index))`), the categorical
 * x-axis has no continuous scale of its own (unlike the `function` chart type's numeric domain),
 * so this is how an equation overlay's densely-sampled curve rides the SAME band positions the
 * host chart's bars/lines already sit on.
 */
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
   // `overlay.kind` is narrowed to 'mean' | 'median' by the caller's dispatch, but that narrowing
   // does not carry across the function boundary, re-derive a literal-typed `kind` here so it can
   // be passed to defaultStatLabel's narrower parameter type without a widening error.
   const kind: 'mean' | 'median' = overlay.kind === 'median' ? 'median' : 'mean'
   const stat = kind === 'median' ? medianOf(oneSeries.values) : meanOf(oneSeries.values)
   if (stat === null || stat < niceMin || stat > niceMax) return ''
   const lineY = yScale(stat)
   const label = overlay.label && overlay.label !== ''
      ? overlay.label
      : defaultStatLabel(kind, oneSeries.name, stat, singleSeries)
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
   theme: GraphTheme,
): string {
   const fit = linearRegression(oneSeries.values)
   if (fit === null) return '' // fewer than 2 finite points: no line to draw

   const lastIndex = labels.length - 1
   const startX = xBand.center(0)
   const endX = xBand.center(lastIndex)
   const startY = yScale(fit.intercept)
   const endY = yScale(fit.intercept + fit.slope * lastIndex)

   // Analytic clamp to the plot rect (NO SVG clipPath, a fixed id would collide across the many
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

/** Draw a full-height vertical dashed overlay at `lineX` with a top-anchored haloed label (the
 *  x-axis mirror of {@link horizontalOverlay}, used by the vertical reference line). */
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
   // Anchor the label at the TOP of the line, nudged right/down so it clears the plot's top edge and
   // does not collide with the x-axis number labels running along the bottom.
   const labelText = overlayLabel(
      lineX + OVERLAY_LABEL_GAP,
      plot.y + TICK_FONT_SIZE,
      'start',
      label,
      theme)
   return element('g', {}, line + labelText)
}

/**
 * A small overlay label in PRIMARY ink (never a series hue, a light categorical color is illegible
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
 * segment lies above or below the band. Pure line-parameter math, no SVG clipPath needed.
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
 * Compute the raw value domain for a chart type before nice-ticking. `options.yMin`/`yMax` still
 * override at the end regardless of `foldZeroBaseline`.
 *
 * `foldZeroBaseline` controls whether the domain starts pre-seeded at 0 (the ORIGINAL, pre-log-
 * scale-feature behavior: bars grow from 0, extended to any negative data, pass `true` to get
 * the exact byte-identical linear domain this renderer has always computed) or purely from the
 * actual finite data extremes with NO zero pre-seed (pass `false`, this is the "unfolded" probe
 * renderCartesian uses to test whether a chart's own data is strictly positive, i.e. log-eligible,
 * BEFORE deciding whether to actually render on a log axis; see the LOG SCALE POLICY comment in
 * `renderCartesian`). Stacked charts sum per category (positive and negative stacks kept
 * separate), `bar-stacked` is excluded from the log feature entirely (see
 * `LOG_SCALE_UNSUPPORTED_TYPES`), so it is only ever called here with `foldZeroBaseline: true`,
 * keeping its per-category running-sum logic exactly as it always was.
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

   // An unfolded pass that found no finite value at all (should not normally happen, a chart with
   // truly nothing to plot never reaches this renderer, see index.ts's hasRenderableData) still needs
   // a finite fallback rather than leaving ±Infinity to leak into the overlay-fold/override math below.
   if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      dataMin = 0
      dataMax = 0
   }

   // Fold every reference-overlay value into the raw domain so a target line beyond the data always
   // stays on-canvas (the data rescales to fit it). Done before the yMin/yMax overrides below, which
   // still win when the author has pinned an explicit floor/ceiling.
   const [foldedMin, foldedMax] = foldReferenceOverlaysIntoDomain(dataMin, dataMax, options.overlays)

   const min = options.yMin !== undefined ? options.yMin : foldedMin
   const max = options.yMax !== undefined ? options.yMax : foldedMax
   return [min, max]
}

// ================================================================
// # LOG-SCALE ELIGIBILITY + PER-DATUM PLOTTABILITY (shared helper)
// ================================================================

/** Whether a resolved (min, max) domain is strictly positive and finite, the sole condition every
 *  per-type render function here uses to decide "is a log value axis actually usable for this
 *  chart's data" (log is undefined at <= 0). Shared so every chart type's eligibility test reads
 *  identically rather than re-deriving the same two comparisons four different ways. */
function isPositiveFiniteDomain(min: number, max: number): boolean {
   return Number.isFinite(min) && Number.isFinite(max) && min > 0
}

/**
 * Whether a single datum can be plotted on `axisMode`'s axis: finite, and, on a log axis,
 * strictly positive. A value that fails this check is treated exactly like a missing/malformed
 * cell: a line/area run breaks there, a bar/point is simply not drawn for it. This is a defensive
 * BACKSTOP, not the expected path: {@link isPositiveFiniteDomain} is checked against the WHOLE
 * chart's domain before 'log' is ever chosen, so an individual non-positive datum can only slip
 * through via something outside that domain check (e.g. a stray overlay/reference value), never
 * the chart's own plotted series/points.
 */
function isPlottableValue(value: number | null | undefined, axisMode: AxisMode): value is number {
   if (value === null || value === undefined || !Number.isFinite(value)) return false
   if (axisMode === 'log' && value <= 0) return false
   return true
}

/**
 * Fold every finite `reference` overlay value of the requested `orientation` into a raw
 * `[dataMin, dataMax]` axis domain, so a target line drawn outside the data range still ends up
 * on-canvas once nice-ticking runs. Shared by the categorical cartesian y-domain
 * ({@link computeValueDomain}), the scatter chart's continuous y- AND x-domains, and the function
 * chart's y- AND x-domains, the fold logic depends only on the raw min/max and the overlay list,
 * not on category vs. continuous data.
 *
 * `orientation` selects WHICH references extend THIS axis: a `'horizontal'` reference (y = value,
 * the default when a reference carries no orientation, so pre-orientation specs stay byte-identical)
 * extends the Y-domain; a `'vertical'` reference (x = value) extends the X-domain. A reference of the
 * other orientation is ignored here, so a vertical target never stretches the y-axis and vice versa.
 */
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

/**
 * Horizontal hairline gridlines at each nice tick, with the tick value labelled at the left, plus
 * optional unlabeled MINOR gridlines (log scale's intra-decade 2x/5x ticks, empty for a linear
 * axis, so this is a no-op loop and the output stays byte-identical to before this parameter existed).
 */
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
 * Draw "textbook" (custom-origin, four-quadrant) axes for a CONTINUOUS-X/CONTINUOUS-Y chart
 * (`function`/`scatter`): the y-axis is the vertical line at `xScale(origin.x)` and the x-axis the
 * horizontal line at `yScale(origin.y)`, crossing at the origin, with tick marks + number labels
 * riding the crossing lines instead of the plot edges. This one helper REPLACES the standard
 * `renderGridlines` + `renderAxes` + `renderNumericXAxisLabels` trio for those two types when an
 * {@link GraphOptions.axisOrigin} is set. Details:
 *   - LIGHT GRIDLINES stay at every tick position on BOTH axes (graph-paper readability); the bold
 *     crossing axes are drawn on top of them. (Standard mode draws only horizontal gridlines; the
 *     vertical ones are a deliberate textbook-mode enhancement, active only when this path is.)
 *   - The two bold axes are each CLAMPED to the nearest plot edge when the origin falls outside the
 *     visible domain, so an off-domain origin degrades to an edge axis rather than drawing off-canvas.
 *     The tick labels still sit at their true data positions regardless.
 *   - The tick label sitting on the OTHER crossing axis (the origin's own zero) is DROPPED on each
 *     axis so the two zero labels never collide (see {@link AXIS_CROSSING_LABEL_SKIP_PX}).
 * LINEAR axes only, the caller never invokes this on a log value axis (a custom origin is a linear
 * concept; see `renderFunctionPlot`/`renderScatterPlot`, which fall back to the standard edge axes
 * under a log scale). `yTicks` are the linear value ticks; the x ticks are recomputed here from the
 * axis x-range exactly as {@link renderNumericXAxisLabels} does, so the labels sit where they would.
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

   // The x-axis tick positions, computed exactly like renderNumericXAxisLabels (same niceTicks + the
   // same in-range filter), so the textbook x-labels land where the standard bottom labels would.
   const xNice = niceTicks(xAxisMin, xAxisMax, TARGET_TICK_COUNT)
   const xTicks = xNice.ticks.filter(tick => tick >= xAxisMin && tick <= xAxisMax)

   // The bold crossing axes, each clamped to the nearest plot edge for an off-domain origin.
   const verticalAxisX = clamp(xScale(origin.x), plotLeft, plotRight)
   const horizontalAxisY = clamp(yScale(origin.y), plotTop, plotBottom)

   const parts: string[] = []

   // ====== light gridlines at every tick, both axes (graph-paper readability) ======
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

   // ====== the two bold crossing axes ======
   parts.push(selfClosingElement('line', {
      x1: verticalAxisX, y1: plotTop, x2: verticalAxisX, y2: plotBottom,
      stroke: theme.ink.axis, 'stroke-width': 1,
   }))
   parts.push(selfClosingElement('line', {
      x1: plotLeft, y1: horizontalAxisY, x2: plotRight, y2: horizontalAxisY,
      stroke: theme.ink.axis, 'stroke-width': 1,
   }))

   // ====== y-axis tick marks + labels, riding the vertical axis (labels to its left) ======
   for (const tick of yTicks) {
      const tickY = yScale(tick)
      // Drop the origin's own row (the tick sitting on the horizontal axis) so the two zero labels
      // never collide at the crossing.
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

   // ====== x-axis tick marks + labels, riding the horizontal axis (labels below it) ======
   for (const tick of xTicks) {
      const tickX = xScale(tick)
      // Drop the origin's own column (the tick sitting on the vertical axis) for the same reason.
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

/**
 * Single-series bars: one rect per category, capped at 24px and centered in its band.
 *
 * Coloring is UNIFORM by default (every bar wears the one series' resolved base color, so a plain
 * simple-bar chart is byte-identical to before per-bar color existed). A per-category override in
 * `categoryColors[categoryIndex]` recolors just that one bar, the same `categoryColors` array the
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
   axisMode: AxisMode = 'linear',
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
      if (!isPlottableValue(value, axisMode)) continue
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
   axisMode: AxisMode = 'linear',
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
 * Draw a line through each drawn series' bar-top peaks, a bar+line combo, for the bar-family
 * chart types only. Reuses `buildPointRuns` (defined below, in the LINE/AREA section) so `null`
 * gaps break the line exactly like a line chart does, and reuses the same round-capped polyline
 * draw. Called AFTER the bar marks push their pieces (see `renderCartesian`), so it sits visually
 * on top of the bars.
 *
 *   - bar (single series): the line follows the one drawn series' bar tops (band center x).
 *   - bar-grouped: one line PER drawn series, each through that series' own sub-bars (its own x
 *     offset within each category's band, the same `bandStart + subStep*seriesIndex + subStep/2`
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
   axisMode: AxisMode = 'linear',
): string {
   if (series.length === 0) return ''

   if (type === 'bar-stacked') {
      // bar-stacked never renders on a log axis (see LOG_SCALE_UNSUPPORTED_TYPES), `axisMode` here
      // is always 'linear' in practice; the summed totals are passed through unchanged either way.
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

   // 'bar' (single series): the same band-center x every renderSingleBars rect already sits at.
   const color = resolveSeriesColor(0, series[0].color, theme)
   return renderOnePeakLine(labels, series[0], xBand, yScale, color, axisMode)
}

/**
 * Per-category cumulative total across every drawn series, for the bar-stacked peak line. A
 * missing/malformed cell contributes zero (mirrors how {@link renderStackedBars} treats it, the
 * cursor simply does not move for that series), matching the "bar treats a gap as zero" semantics
 * documented on {@link GraphSeries}. A category is a gap (`null`, breaking the line) only when
 * EVERY series is missing there, the stack has no drawn segment at all to trace a peak through.
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
 * gaps), reusing {@link buildPointRuns}. No point markers, kept visually distinct from a full
 * line chart, per the bar-peak-line display option's intent.
 */
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

/**
 * Split a series into contiguous point runs, dropping null/malformed cells (they become gaps),
 * and, on a log axis, non-positive cells too (log is undefined at <= 0, so such a cell is treated
 * exactly like a missing one: it breaks the run rather than being drawn).
 */
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
   // Color each swatch by its SERIES INDEX, not by name. The legend items are laid out in input
   // series order, so a running counter maps swatch -> series positionally. Keying by name (the old
   // approach) collapses every swatch onto the last series' color whenever names are empty or
   // duplicated, e.g. scatter series names default to blank. A running index is collision-proof.
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

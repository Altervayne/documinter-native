/*
 * The graph block's data model + resolved theme shape. Pure types plus a few frozen constants,
 * imports nothing. The renderer consumes a GraphSpec + a GraphTheme resolved for ONE target theme
 * (light OR dark), so the same code serves the in-app preview and the baked HTML export.
 */

// #########
// # TYPES #
// #########

export type GraphType =
   | 'bar'
   | 'bar-grouped'
   | 'bar-stacked'
   | 'line'
   | 'area'
   | 'pie'
   | 'donut'
   | 'function'
   | 'scatter'
   | 'histogram'

/**
 * One named series, positionally aligned to {@link GraphData.labels}. A missing/blank/malformed
 * cell parses to `null`: line & area draw a gap, bar & pie treat it as zero.
 */
export interface GraphSeries {
   name: string
   values: (number | null)[]
   /** Per-series color override (hex). Wins over the palette slot. */
   color?: string
}

/** Category labels (rows) x named series (columns). */
export interface GraphData {
   labels: string[]
   series: GraphSeries[]
   /**
    * Per-category color overrides, aligned to {@link labels} (sparse allowed). Honored by the
    * single-series families: a radial slice's default is a palette slot per index, a simple bar's
    * default is the one series' uniform base color. The multi-series cartesian families color by
    * series and ignore this.
    */
   categoryColors?: (string | undefined)[]
}

// #####################
// # STATISTIC OVERLAYS #
// #####################

/**
 * The computed reference marks drawable over a CARTESIAN plot (radial ignores overlays). `equation`
 * and `reference` are chart-level (no target series); the rest target a series. `equation` never
 * auto-extends the y-axis: an out-of-range portion is clipped to the plot rect, not stretched to fit.
 */
export type OverlayKind =
   | 'mean'
   | 'median'
   | 'trend'
   | 'reference'
   | 'equation'
   | 'stddev'
   | 'range'
   | 'movingAverage'

/**
 * One computed reference mark. Every field is optional-with-a-default, so a bare `{ kind: 'mean' }`
 * is valid and serializes lean.
 */
export interface Overlay {
   kind: OverlayKind
   /**
    * Target series for the computed kinds (mean/median/trend): an index, or `'all'` to fan out one
    * mark per drawn series. Defaults to 0. Ignored by `reference` and `equation`.
    */
   series?: number | 'all'
   /** The constant y for a `reference` overlay. Ignored by every other kind. */
   value?: number
   /**
    * `reference` only: the axis the line sits on. `'horizontal'` (default) is y = {@link value},
    * available on every cartesian type. `'vertical'` is x = {@link value}, drawn only where the
    * x-axis is continuous (`function`/`scatter`); the categorical types skip it.
    */
   orientation?: 'horizontal' | 'vertical'
   /** Label override; falls back to a computed default per kind. */
   label?: string
   /** Trend only: append the fitted equation to the label (R^2 shows regardless). Default false. */
   showEquation?: boolean
   /** `stddev` band only: the sigma multiplier (band spans mean +/- {@link sigma} * stddev).
    *  Default {@link GRAPH_DEFAULT_OVERLAY_SIGMA}. */
   sigma?: number
   /** `movingAverage` only: the trailing window length. Default
    *  {@link GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW}, clamped to >= 2 by the renderer. */
   window?: number
   /** `trend` only: the fit model. Absent means `'linear'` (byte-identical to before this field).
    *  `'polynomial'` additionally reads {@link degree}. */
   fit?: 'linear' | 'polynomial' | 'exponential' | 'logarithmic' | 'power'
   /** `trend` + `fit === 'polynomial'` only: the degree. Default {@link GRAPH_DEFAULT_TREND_DEGREE},
    *  clamped to 2..5 by the renderer. */
   degree?: number
   /** The `equation` overlay's source text in one variable `x`, compiled via `graph/expr.ts`. An
    *  uncompileable/undefined result draws nothing. */
   expression?: string
}

/** Presentation options; all optional, all with render defaults living in the renderer so a fresh
 *  graph serializes lean. */
export interface GraphOptions {
   /** Chart title, also the SVG root <title>. */
   title?: string
   /** X-axis caption (cartesian only). */
   xLabel?: string
   /** Y-axis caption (cartesian only). */
   yLabel?: string
   /** Legend visibility. Undefined shows it when there is more than one series; a single series
    *  never gets a legend box. */
   legend?: boolean
   /** Draw direct value labels on marks. Default false. */
   showValues?: boolean
   /** Donut inner-radius fraction, 0..0.9. Donut only, default 0.55. */
   donutHole?: number
   /** Y-axis floor. Default 0 (bars grow from a baseline). */
   yMin?: number
   /** Y-axis ceiling. Default the nice-max of the data. */
   yMax?: number
   /** Bar thickness as a fraction (0..1) of the category band. Bar family only. Undefined =
    *  {@link GRAPH_DEFAULT_BAR_WIDTH}, still capped at the 24px max thickness. */
   barWidth?: number
   /** Line/area stroke width in px. Line & area only. Undefined = {@link GRAPH_DEFAULT_LINE_WIDTH}. */
   lineWidth?: number
   /** Draw circle markers at each datum. Line & area only. Undefined = {@link GRAPH_DEFAULT_SHOW_POINTS}. */
   showPoints?: boolean
   /** Area fill alpha (0..1). Area only. Undefined = {@link GRAPH_DEFAULT_AREA_FILL_OPACITY}. */
   areaFillOpacity?: number
   /** Statistical overlays (CARTESIAN only; radial ignores this). */
   overlays?: Overlay[]
   /** Draw a line through each series' bar-top peaks (a bar+line combo). Bar family only. This traces
    *  the raw data already on the bars, so it is unrelated to {@link overlays}. */
   barPeakLine?: boolean
   /**
    * The value-axis scale. Undefined means `'linear'`. `'log'` requests a base-10 log value axis,
    * not offered for the radial types or `bar-stacked` (see {@link supportsLogScale}). Log is
    * undefined at <= 0: when a chart's data touches zero or goes negative, `'log'` falls back to
    * linear for that render, never a clamp-to-floor, never NaN geometry.
    */
   yScale?: 'linear' | 'log'
   /**
    * A custom axis origin for the "textbook" / four-quadrant look, the continuous-x types
    * (`function`/`scatter`) only. Absent draws the axes along the plot edges; present draws them
    * crossing at (x, y). It never changes the visible extent (yMin/yMax and the x-domain still set
    * the range), only where the axes are drawn, and is clamped to the nearest edge when off-domain.
    * Ignored for every other type, and disabled whenever {@link yScale} resolves to `'log'`.
    */
   axisOrigin?: { x: number; y: number }
}

// ###########################
// # LOG SCALE APPLICABILITY #
// ###########################

/** Chart types the value-axis log scale is never offered for: the radial types have no value axis,
 *  and `bar-stacked`'s zero-baseline stacking has no analog on an axis where zero doesn't exist. */
export const LOG_SCALE_UNSUPPORTED_TYPES: ReadonlySet<GraphType> = new Set<GraphType>(['pie', 'donut', 'bar-stacked'])

/** Whether `type` can render its value axis on a log scale. */
export function supportsLogScale(type: GraphType): boolean {
   return !LOG_SCALE_UNSUPPORTED_TYPES.has(type)
}

// ####################
// # OPTION DEFAULTS  #
// ####################

/**
 * The render defaults for the per-type options above, kept as one source of truth so three
 * consumers agree: the renderer falls back to these, the serializer drops a token whose value
 * equals its default, and the editor seeds its controls from them.
 */
export const GRAPH_DEFAULT_BAR_WIDTH = 1          // fraction 0..1 of the category band
export const GRAPH_DEFAULT_LINE_WIDTH = 2         // stroke width in px
export const GRAPH_DEFAULT_SHOW_POINTS = true     // markers drawn at each datum
export const GRAPH_DEFAULT_AREA_FILL_OPACITY = 0.1 // area fill alpha 0..1

export const GRAPH_DEFAULT_OVERLAY_SIGMA = 1          // stddev band multiplier (mean +/- sigma*sd)
export const GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW = 3  // trailing moving-average window length
export const GRAPH_DEFAULT_TREND_DEGREE = 2           // polynomial trend degree (clamped 2..5)

// ###########################
// # FUNCTION PLOT (EQUATION) #
// ###########################

/** One named equation curve on a `function` chart. */
export interface EquationSeries {
   name: string
   /** Source text in one variable x. Compiled by the renderer via `graph/expr.ts`; an uncompileable
    *  expression draws nothing rather than being rejected. */
   expression: string
   /** Per-equation color override, same semantics as {@link GraphSeries.color}. */
   color?: string
}

/** The numeric domain a `function` chart samples over, shared by every equation on the chart. */
export interface FunctionDomain {
   xMin: number
   xMax: number
   /** Sample count across [xMin, xMax], inclusive of both ends. Clamped to
    *  {@link FUNCTION_MIN_SAMPLES}..{@link FUNCTION_MAX_SAMPLES} by the renderer. */
   samples: number
}

/** The `function`-type payload. Present when `type === 'function'`; `data` stays
 *  `{ labels: [], series: [] }` for this type so GraphSpec's shape stays uniform. */
export interface FunctionPlot {
   domain: FunctionDomain
   equations: EquationSeries[]
}

/** The fence/renderer defaults for an unset {@link FunctionDomain}, one source of truth so the
 *  renderer's domain resolution and the fence's lean-serialization rule agree. */
export const FUNCTION_DEFAULT_X_MIN = -10
export const FUNCTION_DEFAULT_X_MAX = 10
export const FUNCTION_DEFAULT_SAMPLES = 200
export const FUNCTION_MIN_SAMPLES = 20
export const FUNCTION_MAX_SAMPLES = 2000

// ##################
// # SCATTER PLOT   #
// ##################

/** One (x, y) point on a `scatter` chart. */
export interface ScatterPoint {
   x: number
   y: number
}

/** One named series of (x, y) points on a `scatter` chart. `points` replaces `values` since a
 *  scatter point carries its own x AND y rather than sitting at a shared category index. */
export interface ScatterSeries {
   name: string
   /** Per-series color override, same semantics as {@link GraphSeries.color}. */
   color?: string
   points: ScatterPoint[]
}

/** The `scatter`-type payload. Present when `type === 'scatter'`; `data` stays empty. Unlike
 *  `function`, both x and y ranges are autoscaled from the plotted points. */
export interface ScatterPlot {
   series: ScatterSeries[]
}

// ##################
// # HISTOGRAM      #
// ##################

/** The `histogram`-type payload. Present when `type === 'histogram'`; `data` stays empty. A
 *  histogram has no series axis, so this carries a flat sample list. */
export interface HistogramData {
   /** The raw numeric samples to bin (NOT pre-aggregated counts). Non-finite entries are filtered by
    *  `computeHistogramBins`, never by the model. */
   samples: number[]
   /** Manual bin-count override, clamped to [{@link HISTOGRAM_MIN_BINS}, {@link HISTOGRAM_MAX_BINS}]
    *  by the binning function. Undefined => automatic count via Sturges' rule. */
   bins?: number
   /** Dataset name. Surfaces only in the accessible `<desc>`, never as a drawn legend box (a single
    *  dataset has nothing to distinguish it from). */
   name?: string
   /** Color override, same semantics as {@link GraphSeries.color}. */
   color?: string
}

/** The bin-count clamp bounds, shared by the binning function, the fence parser, and the editor. */
export const HISTOGRAM_MIN_BINS = 1
export const HISTOGRAM_MAX_BINS = 50

// ##########################
// # TABLE LINK (LIVE SOURCE) #
// ##########################

/**
 * A live link from a graph to a document `table` block, identifying it by its durable
 * {@link Block.handle}. Present means the graph's `data` is a materialized snapshot resolved from
 * the table, refreshed whenever the table edits. The pure renderer never sees this; the block
 * resolves the link to concrete `data` first. Only the tabular chart types can be linked.
 */
export interface GraphSource {
   handle: string
   /** Which table column supplies the labels (orient `columns`) or series names (orient `rows`).
    *  Default 0; an out-of-range value is clamped back to 0 by the resolver. */
   labelColumn?: number
   /** `columns` (default): each non-label column is a series. `rows`: each row is a series and the
    *  header row supplies the labels (the transpose). */
   orient?: 'columns' | 'rows'
}

/** The full spec stored on a graph block. */
export interface GraphSpec {
   type: GraphType
   data: GraphData
   options: GraphOptions
   /** Present means the graph is linked to a table (see {@link GraphSource}); `data` is then a
    *  materialized snapshot. Only the tabular chart types carry a source. */
   source?: GraphSource
   /** Only used when type === 'function'. */
   functionPlot?: FunctionPlot
   /** Only used when type === 'scatter'. */
   scatterPlot?: ScatterPlot
   /** Only used when type === 'histogram'. */
   histogramData?: HistogramData
}

// ###############
// # THEME SHAPE #
// ###############

/** The ink/chrome tokens the renderer paints non-data elements with, as literal hex resolved for
 *  one target theme. Text NEVER wears a series color (a light categorical hue is illegible as text);
 *  identity comes from the colored mark beside the label. */
export interface GraphInk {
   /** Primary text: title, in-slice labels on dark fills. */
   text: string
   /** Secondary text: legend labels, value labels. */
   textSecondary: string
   /** Muted text: axis tick labels, axis captions. */
   textMuted: string
   axis: string
   grid: string
   /** Chart surface color, also used for the 2px gaps and marker rings. */
   surface: string
}

/** A theme resolved for ONE target theme. The renderer reads only this and never branches on
 *  light-vs-dark, so the theme is the single switch between preview and export. */
export interface GraphTheme {
   ink: GraphInk
   /** The categorical series palette, assigned in fixed slot order (see palette.ts). */
   palette: string[]
}

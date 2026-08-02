/**
 * types.ts, the pure data model + theme shape for the home-grown graph block.
 *
 * PURE TYPES + a couple of frozen theme constants. Imports NOTHING (no React, no DOM,
 * no charting library). The renderer (index.ts + cartesian.ts + radial.ts) consumes a
 * GraphSpec plus a resolved GraphTheme and produces a self-contained SVG string, exactly
 * the way the math block turns `latex` into a self-contained MathML string.
 *
 * The theme is resolved for ONE target theme (light OR dark), so the same renderer serves
 * the in-app preview AND the baked HTML export just by passing a different GraphTheme.
 */

// #########
// # TYPES #
// #########

/**
 * The chart types the v1 renderer supports. Five rendering cores:
 *   - cartesian:          bar, bar-grouped, bar-stacked, line, area
 *   - radial:             pie, donut
 *   - continuous-x plot:  function (sampled equation curves over a numeric domain)
 *   - continuous-x/y plot: scatter (real (x, y) point pairs, reusing the SAME continuous-x
 *                          foundation `function` introduced, plus an analogous continuous y)
 *   - binned frequency:   histogram (raw numeric samples binned into contiguous, zero-gap bars
 *                          over a continuous numeric x-axis of bin edges, reuses the SAME
 *                          continuous-x foundation, but with a bar renderer, not a line renderer)
 */
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
 * One named series of numbers, positionally aligned to {@link GraphData.labels}.
 * A missing / blank / malformed cell parses to `null`: line & area draw a gap, bar &
 * pie treat it as zero. An optional `color` overrides the palette slot for this series
 * (lets an author match series colors to their document; the palette is only the default).
 */
export interface GraphSeries {
   name: string
   values: (number | null)[]
   /** Optional per-series color override (hex). Takes precedence over the palette slot. */
   color?: string
}

/** The tabular data: category labels (rows) x one or more named series (columns). */
export interface GraphData {
   labels: string[]
   series: GraphSeries[]
   /**
    * Optional per-category color overrides, positionally aligned to {@link labels} (sparse is
    * allowed, an `undefined`/missing slot means "no override, use the default"). Honored by the
    * SINGLE-SERIES families, where each label maps to one colored mark:
    *   - RADIAL (pie/donut): each label is a slice; the default (no override) is a palette slot per
    *     index (multicolor).
    *   - SIMPLE BAR: each label is a bar; the default is the ONE series' uniform base color, so an
    *     override recolors just that bar while an un-overridden chart stays uniform.
    * The multi-series cartesian families (grouped/stacked bar, line, area) color by series, not by
    * category, and ignore this field. This mirrors the per-series {@link GraphSeries.color} hook,
    * one axis over.
    */
   categoryColors?: (string | undefined)[]
}

// #####################
// # STATISTIC OVERLAYS #
// #####################

/**
 * The computed reference marks an author can draw over a CARTESIAN plot (radial ignores overlays):
 *   - mean:      a horizontal line at a target series' arithmetic mean.
 *   - median:    a horizontal line at a target series' median (RESERVED, not yet wired to the
 *                editor, but the render + serialization paths handle it so it is a one-line follow).
 *   - trend:     a linear least-squares trendline for a target series, labelled with its R^2.
 *   - reference: a horizontal line at a per-chart constant y (a target / threshold), no series.
 *   - equation:  an f(x) curve plotted over the host chart's existing category-index x-range,
 *                CHART-LEVEL like `reference` (no target series, an arbitrary expression belongs
 *                to no series). Reuses the same home-grown `graph/expr.ts` evaluator the `function`
 *                chart type samples with. Never auto-extends the y-axis (unlike `reference`): an
 *                out-of-range portion of the curve is analytically clipped to the plot rect instead
 *                of stretching the domain to fit it (see cartesian.ts's `renderEquationOverlay`).
 */
export type OverlayKind = 'mean' | 'median' | 'trend' | 'reference' | 'equation'

/**
 * One computed reference mark drawn over a cartesian plot. Every field is optional-with-a-default,
 * so a bare `{ kind: 'mean' }` is valid and serializes lean.
 */
export interface Overlay {
   kind: OverlayKind
   /**
    * The target series for the computed kinds (mean / median / trend): a series index, or `'all'`
    * to fan out one mark per drawn series (each echoing that series' hue). Defaults to 0. Ignored
    * by `reference` and `equation` (both are chart-level constants/curves, belonging to no series).
    */
   series?: number | 'all'
   /** The constant y for a `reference` overlay (required in effect). Ignored by every other kind. */
   value?: number
   /**
    * `reference` only: which axis the constant line is drawn on.
    *   - `'horizontal'` (the default when absent): a line at y = {@link value}, auto-extending the
    *     Y-domain, the ORIGINAL, only behavior before this field, available on every cartesian type.
    *   - `'vertical'`: a line at x = {@link value}, spanning the plot height, auto-extending the
    *     X-domain, meaningful only where the x-axis is continuous, so the CONTINUOUS-X types
    *     (`function` / `scatter`) draw it and the categorical cartesian types (bar family / line /
    *     area) skip it (a vertical x = const has no meaning on a categorical band axis).
    * Absent ⇒ `'horizontal'`, so an existing reference overlay round-trips byte-identically. Ignored
    * by every non-`reference` kind.
    */
   orientation?: 'horizontal' | 'vertical'
   /** Optional label override; falls back to a computed default per kind (see cartesian.ts). */
   label?: string
   /** Trend only: append `y = m*x + b` to the label (R^2 is shown regardless). Default false. */
   showEquation?: boolean
   /**
    * The `equation` overlay's raw source text in one variable `x`, e.g. `"sin(x) * 2"`, compiled
    * via `graph/expr.ts`'s `compileExpression`, the SAME evaluator + "uncompileable/undefined
    * draws nothing, never breaks the chart" contract the `function` chart type's equations use.
    * Ignored by every other kind.
    */
   expression?: string
}

/**
 * Presentation options; all optional, all with sensible render defaults living in the
 * renderer (not the stored spec) so a freshly inserted graph serializes lean.
 */
export interface GraphOptions {
   /** Chart title, also the SVG root <title> (accessible name). */
   title?: string
   /** X-axis caption (cartesian only). */
   xLabel?: string
   /** Y-axis caption (cartesian only). */
   yLabel?: string
   /**
    * Legend visibility. Undefined defaults to "show when there is more than one series".
    * An explicit `false` always hides it; a single series never gets a legend box (the
    * title names the one color), matching the dataviz mark spec.
    */
   legend?: boolean
   /** Draw direct value labels on marks. Default false (label selectively). */
   showValues?: boolean
   /** Donut inner-radius fraction, 0..0.9. Donut only, default 0.55. */
   donutHole?: number
   /** Optional y-axis floor. Default 0 (bars grow from a baseline). */
   yMin?: number
   /** Optional y-axis ceiling. Default the nice-max of the data. */
   yMax?: number
   /**
    * Bar thickness as a FRACTION (0..1) of the category band (for grouped bars, of each series'
    * sub-slot within the band). Bar family only (bar / bar-grouped / bar-stacked). Undefined =
    * {@link GRAPH_DEFAULT_BAR_WIDTH} (1 = fill the band, still capped at the 24px max thickness),
    * i.e. identical to the pre-option behavior.
    */
   barWidth?: number
   /**
    * Line / area stroke width in PX. Line & area only. Undefined = {@link GRAPH_DEFAULT_LINE_WIDTH}
    * (2px), the pre-option stroke width.
    */
   lineWidth?: number
   /**
    * Whether to draw circle markers at each datum. Line & area only. Undefined =
    * {@link GRAPH_DEFAULT_SHOW_POINTS} (true, markers were always drawn before this option).
    */
   showPoints?: boolean
   /**
    * Area fill alpha (0..1). Area only. Undefined = {@link GRAPH_DEFAULT_AREA_FILL_OPACITY} (0.1),
    * the pre-option fill opacity.
    */
   areaFillOpacity?: number
   /**
    * Statistical overlays drawn over the plot (CARTESIAN only; radial ignores this field). Absent
    * or empty = no overlays, so a graph that has none is byte-identical to before this feature.
    */
   overlays?: Overlay[]
   /**
    * Draw a line through each drawn series' bar-top peaks (a bar+line combo). Bar family only
    * (bar / bar-grouped / bar-stacked); ignored elsewhere. Undefined/false = off, the pre-option
    * behavior. This is a DISPLAY option (it traces the raw data already on the bars), not a
    * computed statistic, so it is unrelated to {@link overlays}.
    */
   barPeakLine?: boolean
   /**
    * The VALUE axis (y for every type here; x stays categorical/continuous either way) scale.
    * Undefined = `'linear'`, the pre-option behavior (byte-identical output). `'log'` requests a
    * base-10 logarithmic value axis, meaningful for `line` / `area` / `scatter` / `function` /
    * `histogram` / `bar` / `bar-grouped` (see {@link supportsLogScale}); NOT offered for the
    * radial types (`pie`/`donut`, which have no value axis at all) or `bar-stacked` (zero-baseline
    * stacking is mathematically incompatible with a log axis, there is no such thing as summing
    * segments "from zero" on a scale where zero doesn't exist). The editor gates the toggle by
    * {@link supportsLogScale} so an author can't pick an invalid combination; the renderer ALSO
    * defensively ignores `'log'` for an unsupported type (a hand-edited fence can still set it).
    *
    * Log is undefined at <= 0. This library's chosen policy (see graph/cartesian.ts's per-type
    * axis-mode resolution + docs/reports/2026-08-02-graph-log-scale.md): when a chart's own data
    * touches zero or goes negative, `'log'` silently, safely FALLS BACK TO LINEAR for that render
    *, never a clamp-to-floor, never NaN geometry. The editor surfaces a small in-editor note when
    * this fallback is active (see `lib/graphEdit.ts`'s `logScaleWouldFallBackToLinear`).
    */
   yScale?: 'linear' | 'log'
   /**
    * A CUSTOM AXIS ORIGIN for the classic "textbook" / four-quadrant plot look, the CONTINUOUS-X
    * types (`function` / `scatter`) ONLY (both axes numeric). Absent ⇒ the axes are drawn along the
    * plot EDGES exactly as before this option (byte-identical output). Present ⇒ the axes are drawn
    * CROSSING at (x, y): the y-axis is the vertical line at `xScale(x)` and the x-axis the horizontal
    * line at `yScale(y)`, with tick marks + number labels riding those crossing lines instead of the
    * edges, all four quadrants supported. The origin does NOT change the visible extent, `yMin`/
    * `yMax` (and each type's x-domain) still set the range; the origin only moves where the axes are
    * drawn WITHIN it, and is clamped to the nearest edge when it falls outside the visible domain.
    *
    * Never offered for the categorical (bar family / line / area), radial (`pie`/`donut`), or
    * `histogram` types, the renderer simply ignores it there. A custom origin is a LINEAR-axis
    * concept, so it is also disabled whenever {@link yScale} resolves to `'log'` on that chart (the
    * standard log value axis is drawn instead, see graph/cartesian.ts's function/scatter renderers).
    */
   axisOrigin?: { x: number; y: number }
}

// ###########################
// # LOG SCALE APPLICABILITY #
// ###########################

/**
 * Chart types the value-axis log scale is NEVER offered for: the radial types (`pie`/`donut` have
 * no value axis to begin with, {@link GraphOptions.yScale} is simply meaningless there) and
 * `bar-stacked` (summing positive/negative segments "from zero" has no analog on an axis where
 * zero doesn't exist). Every other type in {@link GraphType} supports it. Shared by the editor
 * (gates the toggle) and the renderer (defensively re-checks it for a hand-edited fence).
 */
export const LOG_SCALE_UNSUPPORTED_TYPES: ReadonlySet<GraphType> = new Set<GraphType>(['pie', 'donut', 'bar-stacked'])

/** Whether `type` can render its value axis on a log scale (see {@link LOG_SCALE_UNSUPPORTED_TYPES}). */
export function supportsLogScale(type: GraphType): boolean {
   return !LOG_SCALE_UNSUPPORTED_TYPES.has(type)
}

// ####################
// # OPTION DEFAULTS  #
// ####################

/**
 * The render defaults for the per-type presentation options above, kept as ONE source of truth so
 * three consumers agree: the renderer falls back to these when an option is unset, the serializer
 * drops a token whose value equals its default (keeping the fence lean), and the editor seeds its
 * range / toggle controls from them. Units are documented on each matching {@link GraphOptions}
 * field. An unset option therefore renders, serializes, and edits exactly as before this feature.
 */
export const GRAPH_DEFAULT_BAR_WIDTH = 1          // fraction 0..1 of the category band
export const GRAPH_DEFAULT_LINE_WIDTH = 2         // stroke width in px
export const GRAPH_DEFAULT_SHOW_POINTS = true     // markers drawn at each datum
export const GRAPH_DEFAULT_AREA_FILL_OPACITY = 0.1 // area fill alpha 0..1

// ###########################
// # FUNCTION PLOT (EQUATION) #
// ###########################

/**
 * One named equation curve on a `function` chart. Mirrors {@link GraphSeries}' name+color shape
 * so the same palette / color-picker machinery applies unchanged.
 */
export interface EquationSeries {
   name: string
   /** Raw source text in one variable x, e.g. "sin(x) + 0.5*x". Compiled by the renderer via
    *  `graph/expr.ts`; an uncompileable expression draws nothing for this curve (never breaks
    *  the chart) rather than being rejected at the model level. */
   expression: string
   /** Optional per-equation color override, same semantics as {@link GraphSeries.color}. */
   color?: string
}

/**
 * The numeric domain a `function` chart samples over, one shared domain for every equation on
 * the chart (equations differ in formula, not in range).
 */
export interface FunctionDomain {
   xMin: number
   xMax: number
   /** Sample count across [xMin, xMax], inclusive of both ends. Clamped to a sane range
    *  ({@link FUNCTION_MIN_SAMPLES}..{@link FUNCTION_MAX_SAMPLES}) by the renderer so a
    *  hand-edited fence can never request a pathological sample count. */
   samples: number
}

/**
 * The `function`-type payload, additive and sibling to `data`/`options`. Present + meaningful
 * only when `type === 'function'`; `data` stays `{ labels: [], series: [] }` for this type (kept
 * present, not made optional, so GraphSpec's shape stays uniform across every type, simpler than
 * making `data` itself optional).
 */
export interface FunctionPlot {
   domain: FunctionDomain
   equations: EquationSeries[]
}

/**
 * The sane fence/renderer defaults for an unset {@link FunctionDomain}, one source of truth so
 * the renderer's domain resolution and the fence serializer's "only emit when it differs from the
 * default" lean-serialization rule agree exactly (mirrors the `GRAPH_DEFAULT_*` pattern above).
 */
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

/**
 * One named series of (x, y) points on a `scatter` chart. Mirrors {@link GraphSeries}' name+color
 * shape so the same palette / color-picker machinery applies unchanged; `points` replaces
 * `values` since a scatter point has no aligned category index to sit at, each point carries its
 * own x AND y, rather than a value positioned at a shared category/sample index.
 */
export interface ScatterSeries {
   name: string
   /** Optional per-series color override, same semantics as {@link GraphSeries.color}. */
   color?: string
   points: ScatterPoint[]
}

/**
 * The `scatter`-type payload, additive and sibling to `data`/`options`/`functionPlot`. Present +
 * meaningful only when `type === 'scatter'`; `data` stays `{ labels: [], series: [] }` for this
 * type, matching the `function` type's convention (keeps GraphSpec's shape uniform across every
 * type). Unlike `function`, there is no shared domain, the x AND y ranges are both autoscaled
 * from the plotted points themselves (see `graph/cartesian.ts`'s `renderScatterPlot`). v1 is
 * points-only: a per-series trendline is a deferred fast-follow, NOT built here.
 */
export interface ScatterPlot {
   series: ScatterSeries[]
}

// ##################
// # HISTOGRAM      #
// ##################

/**
 * The `histogram`-type payload, additive and sibling to `data`/`options`/`functionPlot`/
 * `scatterPlot`. Present + meaningful only when `type === 'histogram'`; `data` stays
 * `{ labels: [], series: [] }` for this type, matching the `function`/`scatter` convention (keeps
 * GraphSpec's shape uniform across every type). Unlike `scatter`, there is only ONE dataset (a
 * histogram has no series axis, every sample belongs to the same distribution), so this carries
 * a flat sample list rather than a list of named series.
 */
export interface HistogramData {
   /** The raw numeric samples to bin (NOT pre-aggregated bin counts). Non-finite entries are
    *  filtered out by the binning function (`graph/histogram.ts`'s `computeHistogramBins`), never
    *  by the model itself, the "never breaks the chart" contract every other graph payload here
    *  honors. */
   samples: number[]
   /** Manual bin-count override, clamped to [{@link HISTOGRAM_MIN_BINS}, {@link HISTOGRAM_MAX_BINS}]
    *  by the binning function. Undefined => an automatic bin count via Sturges' rule. */
   bins?: number
   /** Optional dataset name. A legend is not meaningful for a single dataset (there is nothing to
    *  distinguish it FROM), so this surfaces minimally, only in the chart's accessible `<desc>`
    *  (see `graph/index.ts`'s `describeChart`), never as a drawn legend box. */
   name?: string
   /** Optional color override, same semantics as {@link GraphSeries.color}. */
   color?: string
}

/** The bin-count clamp bounds, shared by the binning function, the fence parser, and the editor's
 *  manual bin-count control, one source of truth so a hand-edited fence or a typed bin count can
 *  never request a pathological (zero, negative, or absurdly large) number of bins. */
export const HISTOGRAM_MIN_BINS = 1
export const HISTOGRAM_MAX_BINS = 50

// ##########################
// # TABLE LINK (LIVE SOURCE) #
// ##########################

/**
 * A live link from a graph to a document `table` block, identifying the table by its durable
 * {@link Block.handle} (the one per-block identity that survives a `.mint`/`.md` round-trip, see
 * docs/reference/graph_table_linking_study.md). Present on {@link GraphSpec.source} ⇒ the graph is
 * LINKED: its `data` is a materialized SNAPSHOT resolved from the referenced table (not authored),
 * refreshed live whenever the table edits. Absent ⇒ the graph owns its `data` exactly as before
 * this feature (byte-identical). The pure renderer NEVER sees this field, the block resolves the
 * link to concrete `data` first (see GraphBlock / graphTableData.ts's `resolveGraphSpec`).
 *
 * Only the TABULAR chart types (bar family / line / area / pie / donut) can be linked; the
 * continuous-x types (`function`/`scatter`/`histogram`) carry no category×series grid to map a
 * table onto, so they never attach a `source`.
 */
export interface GraphSource {
   /** The referenced table block's {@link Block.handle}. */
   handle: string
   /**
    * Which table column supplies the category labels (orient `columns`) or the series names
    * (orient `rows`). Default 0. An out-of-range value (a reshaped, narrower table) is clamped
    * back to 0 by the resolver rather than throwing, the "never breaks the chart" contract.
    */
   labelColumn?: number
   /**
    * Table orientation. `columns` (default): each non-label COLUMN becomes a series (the fence's
    * own pipe-table convention). `rows`: each ROW becomes a series and the header row supplies the
    * category labels (the transpose, for tables laid out the other way).
    */
   orient?: 'columns' | 'rows'
}

/** The full spec stored on a graph block: type + data + presentation options. */
export interface GraphSpec {
   type: GraphType
   data: GraphData
   options: GraphOptions
   /**
    * Present ⇒ this graph is LINKED to a document table (see {@link GraphSource}); `data` is then a
    * materialized snapshot of the resolved table data, kept current by a debounced write-back so it
    * still serializes + survives a dangling link. Absent ⇒ the graph owns its `data` (byte-identical
    * to before this feature). Only the tabular chart types ever carry a source.
    */
   source?: GraphSource
   /** Only used when type === 'function'. Absent/empty on every other type, a spec that has
    *  never been a function chart stays byte-identical to today. */
   functionPlot?: FunctionPlot
   /** Only used when type === 'scatter'. Absent/empty on every other type, a spec that has
    *  never been a scatter chart stays byte-identical to today. */
   scatterPlot?: ScatterPlot
   /** Only used when type === 'histogram'. Absent/empty on every other type, a spec that has
    *  never been a histogram chart stays byte-identical to today. */
   histogramData?: HistogramData
}

// ###############
// # THEME SHAPE #
// ###############

/**
 * The ink / chrome tokens the renderer paints non-data elements with. Text NEVER wears a
 * series color (a light categorical hue is illegible as text); identity comes from the
 * colored mark beside the label. These are literal hex resolved for one target theme.
 */
export interface GraphInk {
   /** Primary text: title, in-slice labels on dark fills. */
   text: string
   /** Secondary text: legend labels, value labels. */
   textSecondary: string
   /** Muted text: axis tick labels, axis captions. */
   textMuted: string
   /** Baseline / axis line color. */
   axis: string
   /** Hairline gridline color (recessive). */
   grid: string
   /** Chart surface color, used for the 2px gaps and marker rings ("white doing the separating"). */
   surface: string
}

/**
 * A theme resolved for ONE target theme (light or dark). The renderer reads only this,
 * it never branches on light-vs-dark itself, so passing LIGHT_GRAPH_THEME vs
 * DARK_GRAPH_THEME (or a custom build) is the single switch between preview and export.
 */
export interface GraphTheme {
   ink: GraphInk
   /** The categorical series palette, assigned in fixed slot order (see palette.ts). */
   palette: string[]
}

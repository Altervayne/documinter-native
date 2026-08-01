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
 * The chart types the v1 renderer supports. Two rendering cores:
 *   - cartesian: bar, bar-grouped, bar-stacked, line, area
 *   - radial:    pie, donut
 * `scatter` is deliberately deferred (a second data model + continuous x-axis); the union
 * is written so a future `| 'scatter'` slots in without touching the existing members.
 */
export type GraphType =
   | 'bar'
   | 'bar-grouped'
   | 'bar-stacked'
   | 'line'
   | 'area'
   | 'pie'
   | 'donut'
// v1.1: | 'scatter'

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
}

/** The full spec stored on a graph block: type + data + presentation options. */
export interface GraphSpec {
   type: GraphType
   data: GraphData
   options: GraphOptions
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
 * A theme resolved for ONE target theme (light or dark). The renderer reads only this —
 * it never branches on light-vs-dark itself, so passing LIGHT_GRAPH_THEME vs
 * DARK_GRAPH_THEME (or a custom build) is the single switch between preview and export.
 */
export interface GraphTheme {
   ink: GraphInk
   /** The categorical series palette, assigned in fixed slot order (see palette.ts). */
   palette: string[]
}

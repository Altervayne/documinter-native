/**
 * index.ts, the public entry point for the home-grown graph renderer.
 *
 * `renderGraphToSvg(spec, theme)` is the ONLY export a caller needs: it dispatches to the
 * cartesian or radial core, wraps the result in a self-contained, responsive `<svg>` (viewBox
 * + width:100%), and adds the accessible root `<title>`/`<desc>`. It mirrors the math block's
 * `renderLatexToMathML`: a pure, synchronous function producing a self-contained markup string
 * with zero runtime and zero external fonts, safe to inline verbatim into the HTML export.
 *
 * It NEVER throws on bad or empty data — an empty/degenerate spec renders a graceful empty-state
 * placeholder SVG (the same "invalid never breaks the document" contract the math block honors).
 *
 * This barrel also re-exports the layer's types, themes, and the palette so consumers import
 * from `lib/graph` rather than reaching into individual files.
 */

import type { GraphSpec, GraphTheme, GraphType } from './types'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './layout'
import { renderCartesian, renderFunctionPlot, renderScatterPlot, renderHistogram } from './cartesian'
import { renderRadial } from './radial'
import { titleElement, descElement, textElement, element } from './svg'

// The system sans stack the chart text renders in, so the export ships no font asset. Font
// names use SINGLE quotes because this string sits inside a double-quoted `style="…"` attribute
// on the root <svg>; double quotes here would prematurely close the attribute.
const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif"

// The radial chart types (everything else is cartesian).
const RADIAL_TYPES = new Set<GraphType>(['pie', 'donut'])

/**
 * Render a graph spec to a complete, self-contained SVG string for the given resolved theme.
 * Pure, synchronous, deterministic, and total (never throws): unrenderable data yields a
 * placeholder rather than an exception. Colors are baked as literal theme hex, so the output
 * needs no runtime, no external font, and no CSS variables — inline it straight into an export.
 */
export function renderGraphToSvg(spec: GraphSpec, theme: GraphTheme): string {
   if (!hasRenderableData(spec)) {
      return renderEmptyState(spec, theme)
   }

   const body = spec.type === 'function'
      ? renderFunctionPlot(spec, theme)
      : spec.type === 'scatter'
         ? renderScatterPlot(spec, theme)
         : spec.type === 'histogram'
            ? renderHistogram(spec, theme)
            : RADIAL_TYPES.has(spec.type)
               ? renderRadial(spec, theme)
               : renderCartesian(spec, theme)

   const accessibleTitle = spec.options.title ?? `${humanType(spec.type)} chart`
   const accessibleDesc = describeChart(spec)

   return wrapSvg(accessibleTitle, accessibleDesc, body)
}

// #####################
// # EMPTY / VALIDITY  #
// #####################

/**
 * Whether a spec has anything to draw. A `function` chart uses a completely different payload
 * (`functionPlot`, not `data`) — it is renderable as soon as it names at least one equation with a
 * non-blank expression string (whether that expression actually COMPILES is a renderer-level
 * concern, handled gracefully per-equation, not a reason to fall back to the empty-state chart).
 * A `scatter` chart likewise uses its own payload (`scatterPlot`) — it is renderable as soon as
 * at least one series carries at least one point (whether that point's coordinates are finite is
 * a renderer-level concern, handled per-point, not a reason to fall back to the empty-state chart).
 * A `histogram` chart uses its own payload (`histogramData`) — it is renderable as soon as the
 * sample list is non-empty (whether any of those samples are FINITE is a renderer-level concern:
 * `computeHistogramBins` filters them and the renderer draws a graceful empty plot — axes with no
 * bars — rather than falling back to this top-level empty-state chart).
 * Every other type: at least one label, at least one series, and at least one finite numeric cell
 * across those series. Anything less renders the empty-state.
 */
function hasRenderableData(spec: GraphSpec): boolean {
   if (spec.type === 'function') {
      const equations = spec.functionPlot?.equations ?? []
      return equations.some(equation => equation.expression.trim() !== '')
   }
   if (spec.type === 'scatter') {
      const series = spec.scatterPlot?.series ?? []
      return series.some(oneSeries => oneSeries.points.length > 0)
   }
   if (spec.type === 'histogram') {
      const samples = spec.histogramData?.samples ?? []
      return samples.length > 0
   }
   const { labels, series } = spec.data
   if (!labels || labels.length === 0) return false
   if (!series || series.length === 0) return false
   for (const oneSeries of series) {
      for (const value of oneSeries.values) {
         if (value !== null && value !== undefined && Number.isFinite(value)) return true
      }
   }
   return false
}

/** A minimal placeholder SVG for empty/degenerate data — never breaks the surrounding document. */
function renderEmptyState(spec: GraphSpec, theme: GraphTheme): string {
   const title = spec.options.title ?? 'Empty graph'
   const note = textElement({
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 14,
      fill: theme.ink.textMuted,
   }, 'No data to chart')
   return wrapSvg(title, 'Empty graph with no data.', element('g', {}, note))
}

// #####################
// # SVG ENVELOPE      #
// #####################

/**
 * Wrap inner markup in the responsive `<svg>` root with the accessible title/desc. `role="img"`
 * + `<title>` + `<desc>` give the chart an accessible name and summary; the viewBox + inline
 * `width:100%;height:auto` make it scale to its column with no runtime resize.
 */
function wrapSvg(accessibleTitle: string, accessibleDesc: string, body: string): string {
   const open =
      `<svg xmlns="http://www.w3.org/2000/svg" role="img"` +
      ` viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}"` +
      ` style="width:100%;height:auto;font-family:${FONT_STACK}">`
   return `${open}${titleElement(accessibleTitle)}${descElement(accessibleDesc)}${body}</svg>`
}

// #####################
// # A11Y DESCRIPTIONS #
// #####################

/** A human-readable name for a chart type, for the accessible title/desc. */
function humanType(type: GraphType): string {
   switch (type) {
      case 'bar':         return 'Bar'
      case 'bar-grouped': return 'Grouped bar'
      case 'bar-stacked': return 'Stacked bar'
      case 'line':        return 'Line'
      case 'area':        return 'Area'
      case 'pie':         return 'Pie'
      case 'donut':       return 'Donut'
      case 'function':    return 'Function'
      case 'scatter':     return 'Scatter'
      case 'histogram':   return 'Histogram'
   }
}

/**
 * A one-line accessible summary of what the chart plots. Returned RAW (unescaped); the
 * `<desc>` builder escapes it, so escaping here would double-encode.
 */
function describeChart(spec: GraphSpec): string {
   const name = humanType(spec.type).toLowerCase()
   if (spec.type === 'function') {
      const equationCount = spec.functionPlot?.equations.length ?? 0
      const equationWord = equationCount === 1 ? 'equation' : 'equations'
      return `${name} chart plotting ${equationCount} ${equationWord}.`
   }
   if (spec.type === 'scatter') {
      const series = spec.scatterPlot?.series ?? []
      const pointCount = series.reduce((sum, oneSeries) => sum + oneSeries.points.length, 0)
      const pointWord = pointCount === 1 ? 'point' : 'points'
      // "series" is invariant English singular/plural, so no word-choice branch is needed here.
      return `${name} chart plotting ${pointCount} ${pointWord} across ${series.length} series.`
   }
   if (spec.type === 'histogram') {
      const finiteSampleCount = (spec.histogramData?.samples ?? [])
         .filter(sample => Number.isFinite(sample)).length
      const sampleWord = finiteSampleCount === 1 ? 'sample' : 'samples'
      const datasetName = spec.histogramData?.name
      const suffix = datasetName ? ` (${datasetName})` : ''
      return `${name} chart binning ${finiteSampleCount} ${sampleWord}${suffix}.`
   }
   const labelCount = spec.data.labels.length
   const seriesCount = spec.data.series.length
   if (RADIAL_TYPES.has(spec.type)) {
      const sliceWord = labelCount === 1 ? 'slice' : 'slices'
      return `${name} chart with ${labelCount} ${sliceWord}.`
   }
   const categoryWord = labelCount === 1 ? 'category' : 'categories'
   return `${name} chart with ${seriesCount} series across ${labelCount} ${categoryWord}.`
}

// #####################
// # RE-EXPORTS        #
// #####################

export type {
   GraphType,
   GraphSeries,
   GraphData,
   GraphOptions,
   GraphSpec,
   GraphSource,
   GraphTheme,
   GraphInk,
   Overlay,
   OverlayKind,
   EquationSeries,
   FunctionDomain,
   FunctionPlot,
   ScatterPoint,
   ScatterSeries,
   ScatterPlot,
   HistogramData,
} from './types'

export {
   mean,
   median,
   linearRegression,
   linearRegressionXY,
} from './stats'

export type {
   LinearFit,
   Point,
} from './stats'

export {
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
   FUNCTION_MIN_SAMPLES,
   FUNCTION_MAX_SAMPLES,
   HISTOGRAM_MIN_BINS,
   HISTOGRAM_MAX_BINS,
} from './types'

export {
   compileExpression,
   evaluate,
   evaluateExpression,
} from './expr'

export type {
   CompiledExpression,
} from './expr'

export {
   computeHistogramBins,
} from './histogram'

export type {
   HistogramBins,
} from './histogram'

export {
   GRAPH_SERIES_LIGHT,
   GRAPH_SERIES_DARK,
   MAX_SERIES,
   LIGHT_GRAPH_THEME,
   DARK_GRAPH_THEME,
   resolveSeriesColor,
   relativeLuminance,
   readableTextOn,
} from './palette'

export {
   linearScale,
   niceTicks,
   bandScale,
} from './scale'

export type {
   NiceScale,
   BandScale,
} from './scale'

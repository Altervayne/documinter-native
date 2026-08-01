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
import { renderCartesian } from './cartesian'
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

   const body = RADIAL_TYPES.has(spec.type)
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
 * Whether a spec has anything to draw: at least one label, at least one series, and at least
 * one finite numeric cell across those series. Anything less renders the empty-state.
 */
function hasRenderableData(spec: GraphSpec): boolean {
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
   }
}

/**
 * A one-line accessible summary of what the chart plots. Returned RAW (unescaped); the
 * `<desc>` builder escapes it, so escaping here would double-encode.
 */
function describeChart(spec: GraphSpec): string {
   const labelCount = spec.data.labels.length
   const seriesCount = spec.data.series.length
   const name = humanType(spec.type).toLowerCase()
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
   GraphTheme,
   GraphInk,
} from './types'

export {
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
} from './types'

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

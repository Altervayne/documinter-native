/*
 * The ` ```graph ` fence serializer / parser. A graph block round-trips through a fenced payload:
 * chart type and options ride the info string as `key=value` tokens, the data rides the body as a
 * Markdown pipe table (reusing `parsePipeTableRow`). The `type=` token is load-bearing and rides
 * both `.mint` and `.md`. Both directions are total: a partial spec or a malformed fence degrades
 * gracefully rather than throwing.
 */

import type {
   GraphSpec, GraphType, GraphSeries, GraphOptions, Overlay,
   EquationSeries, FunctionDomain, ScatterSeries, HistogramData, GraphSource,
} from './graph'
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
} from './graph'
import { parsePipeTableRow } from './markdown'
import { serializeInfoValue, unquoteInfoValue, tokenizeInfoString } from './fenceInfoString'

// #############
// # CONSTANTS #
// #############

/** Every chart type the v1 renderer accepts; the parse default when the `type=` token is bad. */
const VALID_GRAPH_TYPES: ReadonlySet<GraphType> = new Set<GraphType>([
   'bar', 'bar-grouped', 'bar-stacked', 'line', 'area', 'pie', 'donut', 'function', 'scatter', 'histogram',
])

const DEFAULT_GRAPH_TYPE: GraphType = 'bar'

// ###################################
// # PRIVATE HELPERS, INFO STRING #
// ###################################
// Tokenizing/quoting lives in the shared `fenceInfoString.ts`; this file keeps only the
// graph-specific parsing.

/** Parsed pieces of a graph fence info string. */
interface ParsedInfo {
   type:                GraphType
   options:             GraphOptions
   colorOverrides:      (string | undefined)[]
   sliceColorOverrides: (string | undefined)[]
   /** `xmin=`/`xmax=`/`samples=` (function only); an undefined field means "use the default". */
   functionDomain:      { xMin?: number; xMax?: number; samples?: number }
   /** `bins=`/`name=` (histogram only); undefined `bins` = auto (Sturges), undefined `name` = none. */
   histogramMeta:       { bins?: number; name?: string }
   /** `source=`/`labelCol=`/`orient=` (live table link, tabular only). `handle` undefined = not
    *  linked; the mapping fields matter only when `handle` is set. */
   source:              { handle?: string; labelColumn?: number; orient?: 'columns' | 'rows' }
}

// Overlay token grammar: one `overlay=` per Overlay (the fence's one repeated key).
//   mean:<series>   median:<series>   trend:<series>[:<fitFlag>][:eq]
//   stddev:<series>[:<sigma>]   range:<series>   ma:<series>[:<window>]
//   ref:<value>[:<label>]   vref:<value>[:<label>]   (ref = horizontal, vref = vertical)
//   eq:<expression>
// <series> is a slot index or `all`. A trend's <fitFlag> is poly2..poly5 / exp / log / pow (absent =
// linear); it and `eq` are order-independent, and `poly<N>` encodes fit='polynomial' + degree=N.
// sigma/window are emitted only when non-default. An equation's <expression> is taken verbatim after
// the first colon: expr.ts's grammar has no `:`, so the split is unambiguous.

/** Serialize a series target (index or the literal `all`) to its token segment. */
function serializeSeriesToken(series: number | 'all' | undefined): string {
   return series === 'all' ? 'all' : String(series ?? 0)
}

/** Parse a series-target token segment back to an index or `'all'`, defaulting a bad one to 0. */
function parseSeriesToken(token: string | undefined): number | 'all' {
   if (token === 'all') return 'all'
   const parsed = Number(token)
   return Number.isFinite(parsed) ? parsed : 0
}

/** The trend fit flag emitted for a non-linear fit (linear emits nothing); `poly<N>` carries the
 *  degree, clamped to 2..5. Returns '' for a linear (or absent) fit so the caller appends nothing. */
function serializeTrendFitFlag(overlay: Overlay): string {
   switch (overlay.fit) {
      case 'polynomial': {
         const degree = Math.min(5, Math.max(2, Math.round(overlay.degree ?? GRAPH_DEFAULT_TREND_DEGREE)))
         return `poly${degree}`
      }
      case 'exponential': return 'exp'
      case 'logarithmic': return 'log'
      case 'power':       return 'pow'
      default:            return '' // 'linear' or absent: no flag, back-compat with old trend tokens
   }
}

/** Read a trend fit flag segment onto an overlay (order-independent; unknown flags left as linear). */
function applyTrendFitFlag(overlay: Overlay, flag: string): void {
   if (flag === 'exp') { overlay.fit = 'exponential'; return }
   if (flag === 'log') { overlay.fit = 'logarithmic'; return }
   if (flag === 'pow') { overlay.fit = 'power'; return }
   const polyMatch = /^poly([2-5])$/.exec(flag)
   if (polyMatch) {
      overlay.fit = 'polynomial'
      overlay.degree = Number(polyMatch[1])
   }
}

/** Serialize one overlay to its token VALUE (before quoting), or null if it can't round-trip. */
function serializeOverlay(overlay: Overlay): string | null {
   if (overlay.kind === 'reference') {
      if (overlay.value === undefined || !Number.isFinite(overlay.value)) return null
      // A vertical reference rides `vref:`, a horizontal one keeps `ref:`, so an old `ref:` fence
      // still parses back to horizontal.
      const prefix = overlay.orientation === 'vertical' ? 'vref' : 'ref'
      const base = `${prefix}:${overlay.value}`
      return overlay.label && overlay.label !== '' ? `${base}:${overlay.label}` : base
   }
   if (overlay.kind === 'equation') {
      if (overlay.expression === undefined || overlay.expression.trim() === '') return null
      return `eq:${overlay.expression}`
   }
   const seriesToken = serializeSeriesToken(overlay.series)
   if (overlay.kind === 'stddev') {
      const sigma = overlay.sigma ?? GRAPH_DEFAULT_OVERLAY_SIGMA
      return sigma !== GRAPH_DEFAULT_OVERLAY_SIGMA ? `stddev:${seriesToken}:${sigma}` : `stddev:${seriesToken}`
   }
   if (overlay.kind === 'range') {
      return `range:${seriesToken}`
   }
   if (overlay.kind === 'movingAverage') {
      const window = overlay.window ?? GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW
      return window !== GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW ? `ma:${seriesToken}:${window}` : `ma:${seriesToken}`
   }
   // mean / median / trend: a series target, with trend carrying the optional fit + `eq` flags.
   let token = `${overlay.kind}:${seriesToken}`
   if (overlay.kind === 'trend') {
      const fitFlag = serializeTrendFitFlag(overlay)
      if (fitFlag !== '') token += `:${fitFlag}`
      if (overlay.showEquation) token += ':eq'
   }
   return token
}

/** Parse one overlay token VALUE back to an Overlay; null for an unknown kind or a bad reference. */
function parseOverlay(raw: string): Overlay | null {
   const segments = raw.split(':')
   const kindToken = segments[0]
   if (kindToken === 'ref' || kindToken === 'vref') {
      const value = Number(segments[1])
      if (!Number.isFinite(value)) return null
      const label = segments.slice(2).join(':')
      const overlay: Overlay = { kind: 'reference', value }
      if (kindToken === 'vref') overlay.orientation = 'vertical'
      if (label !== '') overlay.label = label
      return overlay
   }
   if (kindToken === 'eq') {
      // Rejoin on ':' defensively, so a hand-edited stray colon does not truncate the expression.
      const expression = segments.slice(1).join(':')
      if (expression === '') return null // no expression: not a valid overlay
      return { kind: 'equation', expression }
   }
   if (kindToken === 'stddev') {
      const overlay: Overlay = { kind: 'stddev', series: parseSeriesToken(segments[1]) }
      const sigma = Number(segments[2])
      if (segments[2] !== undefined && Number.isFinite(sigma)) overlay.sigma = sigma
      return overlay
   }
   if (kindToken === 'range') {
      return { kind: 'range', series: parseSeriesToken(segments[1]) }
   }
   if (kindToken === 'ma') {
      const overlay: Overlay = { kind: 'movingAverage', series: parseSeriesToken(segments[1]) }
      const window = Number(segments[2])
      if (segments[2] !== undefined && Number.isFinite(window)) overlay.window = window
      return overlay
   }
   if (kindToken === 'mean' || kindToken === 'median' || kindToken === 'trend') {
      const overlay: Overlay = { kind: kindToken, series: parseSeriesToken(segments[1]) }
      if (kindToken === 'trend') {
         const flags = segments.slice(2)
         if (flags.includes('eq')) overlay.showEquation = true
         for (const flag of flags) {
            if (flag === 'eq') continue
            applyTrendFitFlag(overlay, flag)
         }
      }
      return overlay
   }
   return null // unknown kind: skip (tolerant, forward-compatible)
}

/** Parse the info string into a chart type, options, and the color-override lists. Unknown tokens
 *  are ignored (forward-compatible); a missing/invalid `type=` falls back to the default. */
function parseInfoString(fenceInfo: string): ParsedInfo {
   const tokens  = tokenizeInfoString(fenceInfo)
   // tokens[0] is the `graph` tag itself; options start at index 1.
   const options: GraphOptions = {}
   let type: GraphType = DEFAULT_GRAPH_TYPE
   let colorOverrides: (string | undefined)[] = []
   let sliceColorOverrides: (string | undefined)[] = []
   // `overlay=` is the fence's one repeated key: every occurrence pushes onto this, attached to
   // options.overlays only if non-empty.
   const pendingOverlays: Overlay[] = []
   const functionDomain: { xMin?: number; xMax?: number; samples?: number } = {}
   const histogramMeta: { bins?: number; name?: string } = {}
   const source: { handle?: string; labelColumn?: number; orient?: 'columns' | 'rows' } = {}

   for (const token of tokens.slice(1)) {
      const equalsIndex = token.indexOf('=')
      if (equalsIndex === -1) continue
      const key   = token.slice(0, equalsIndex)
      const value = unquoteInfoValue(token.slice(equalsIndex + 1))

      switch (key) {
         case 'type':
            if (VALID_GRAPH_TYPES.has(value as GraphType)) type = value as GraphType
            break
         case 'title':
            if (value !== '') options.title = value
            break
         case 'x':
            if (value !== '') options.xLabel = value
            break
         case 'y':
            if (value !== '') options.yLabel = value
            break
         case 'legend':
            if (value === 'on')  options.legend = true
            if (value === 'off') options.legend = false
            break
         case 'values':
            if (value === 'on')  options.showValues = true
            if (value === 'off') options.showValues = false
            break
         case 'hole': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) options.donutHole = parsed
            break
         }
         case 'ymin': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) options.yMin = parsed
            break
         }
         case 'ymax': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) options.yMax = parsed
            break
         }
         case 'yScale':
            // Only 'log' is meaningful; 'linear' is the default and never rides the fence.
            if (value === 'log') options.yScale = 'log'
            break
         case 'origin': {
            // `origin=x,y`. Both fields must parse finite; a malformed value is dropped (edge axes).
            const segments = value.split(',')
            if (segments.length === 2) {
               const originX = Number(segments[0])
               const originY = Number(segments[1])
               if (Number.isFinite(originX) && Number.isFinite(originY)) {
                  options.axisOrigin = { x: originX, y: originY }
               }
            }
            break
         }
         case 'xmin': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) functionDomain.xMin = parsed
            break
         }
         case 'xmax': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) functionDomain.xMax = parsed
            break
         }
         case 'samples': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) functionDomain.samples = parsed
            break
         }
         case 'bins': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) histogramMeta.bins = parsed
            break
         }
         case 'name':
            if (value !== '') histogramMeta.name = value
            break
         // ============ live table link (tabular types only) ============
         case 'source':
            if (value !== '') source.handle = value
            break
         case 'labelCol': {
            const parsed = Number(value)
            if (Number.isInteger(parsed)) source.labelColumn = parsed
            break
         }
         case 'orient':
            if (value === 'rows' || value === 'columns') source.orient = value
            break
         case 'barWidth': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) options.barWidth = parsed
            break
         }
         case 'lineWidth': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) options.lineWidth = parsed
            break
         }
         case 'points':
            if (value === 'on')  options.showPoints = true
            if (value === 'off') options.showPoints = false
            break
         case 'peakline':
            if (value === 'on')  options.barPeakLine = true
            if (value === 'off') options.barPeakLine = false
            break
         case 'areaOpacity': {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) options.areaFillOpacity = parsed
            break
         }
         case 'colors':
            colorOverrides = value.split(',').map(slot => {
               const trimmed = slot.trim()
               return trimmed === '' ? undefined : trimmed
            })
            break
         case 'sliceColors':
            sliceColorOverrides = value.split(',').map(slot => {
               const trimmed = slot.trim()
               return trimmed === '' ? undefined : trimmed
            })
            break
         case 'overlay': {
            const overlay = parseOverlay(value)
            if (overlay !== null) pendingOverlays.push(overlay)
            break
         }
         default:
            break
      }
   }

   if (pendingOverlays.length > 0) options.overlays = pendingOverlays

   return { type, options, colorOverrides, sliceColorOverrides, functionDomain, histogramMeta, source }
}

/** Serialize the presentation options + type into the ordered `key=value` token list. */
function serializeInfoTokens(spec: GraphSpec): string[] {
   const tokens: string[] = [`type=${spec.type}`]
   const options = spec.options ?? {}

   // Live table link (tabular only): `source=<handle>` rides right after `type=`. The mapping tokens
   // are emitted only when non-default. The body stays the materialized snapshot, so a `.md` viewer
   // or a dangling link still shows the last-known data.
   if (spec.source && spec.source.handle) {
      tokens.push(`source=${serializeInfoValue(spec.source.handle)}`)
      if (spec.source.labelColumn !== undefined && spec.source.labelColumn !== 0)
         tokens.push(`labelCol=${spec.source.labelColumn}`)
      if (spec.source.orient === 'rows')
         tokens.push('orient=rows')
   }

   if (options.title !== undefined && options.title !== '')
      tokens.push(`title=${serializeInfoValue(options.title)}`)

   // Domain tokens (function only), emitted only when non-default so an untouched fence stays lean.
   if (spec.type === 'function') {
      const domain = spec.functionPlot?.domain
      const xMin = domain?.xMin ?? FUNCTION_DEFAULT_X_MIN
      const xMax = domain?.xMax ?? FUNCTION_DEFAULT_X_MAX
      const samples = domain?.samples ?? FUNCTION_DEFAULT_SAMPLES
      if (xMin !== FUNCTION_DEFAULT_X_MIN) tokens.push(`xmin=${xMin}`)
      if (xMax !== FUNCTION_DEFAULT_X_MAX) tokens.push(`xmax=${xMax}`)
      if (samples !== FUNCTION_DEFAULT_SAMPLES) tokens.push(`samples=${samples}`)
   }

   // `bins=`/`name=` (histogram only), emitted only when set (never a computed bin count, only a
   // manual override).
   if (spec.type === 'histogram') {
      const histogramData = spec.histogramData
      if (histogramData?.bins !== undefined) tokens.push(`bins=${histogramData.bins}`)
      if (histogramData?.name !== undefined && histogramData.name !== '')
         tokens.push(`name=${serializeInfoValue(histogramData.name)}`)
   }

   if (options.xLabel !== undefined && options.xLabel !== '')
      tokens.push(`x=${serializeInfoValue(options.xLabel)}`)
   if (options.yLabel !== undefined && options.yLabel !== '')
      tokens.push(`y=${serializeInfoValue(options.yLabel)}`)
   if (options.legend !== undefined)
      tokens.push(`legend=${options.legend ? 'on' : 'off'}`)
   if (options.showValues === true)
      tokens.push('values=on')
   if (options.donutHole !== undefined)
      tokens.push(`hole=${options.donutHole}`)
   if (options.yMin !== undefined)
      tokens.push(`ymin=${options.yMin}`)
   if (options.yMax !== undefined)
      tokens.push(`ymax=${options.yMax}`)
   // Only the non-default 'log' rides the fence; absent means linear.
   if (options.yScale === 'log')
      tokens.push('yScale=log')
   // Custom axis origin (`origin=x,y`), emitted only when set. No spaces, so no quoting needed.
   if (options.axisOrigin !== undefined
      && Number.isFinite(options.axisOrigin.x) && Number.isFinite(options.axisOrigin.y))
      tokens.push(`origin=${options.axisOrigin.x},${options.axisOrigin.y}`)

   // Per-type options ride the fence only when set and different from the render default.
   if (options.barWidth !== undefined && options.barWidth !== GRAPH_DEFAULT_BAR_WIDTH)
      tokens.push(`barWidth=${options.barWidth}`)
   if (options.lineWidth !== undefined && options.lineWidth !== GRAPH_DEFAULT_LINE_WIDTH)
      tokens.push(`lineWidth=${options.lineWidth}`)
   if (options.showPoints !== undefined && options.showPoints !== GRAPH_DEFAULT_SHOW_POINTS)
      tokens.push(`points=${options.showPoints ? 'on' : 'off'}`)
   if (options.areaFillOpacity !== undefined && options.areaFillOpacity !== GRAPH_DEFAULT_AREA_FILL_OPACITY)
      tokens.push(`areaOpacity=${options.areaFillOpacity}`)
   // barPeakLine is off by default, so it is emitted only when true.
   if (options.barPeakLine === true)
      tokens.push('peakline=on')

   // Statistical overlays ride repeated `overlay=` tokens, one per overlay.
   for (const overlay of options.overlays ?? []) {
      const serialized = serializeOverlay(overlay)
      if (serialized === null) continue
      tokens.push(`overlay=${serializeInfoValue(serialized)}`)
   }

   // Per-series color overrides ride one `colors=` token in series order (empty slot = no override),
   // emitted only when at least one series carries a color. `scatter` reads from `scatterPlot`,
   // `histogram` from a synthetic one-item list built from `histogramData.color`.
   const colorSourceSeries = spec.type === 'scatter'
      ? (spec.scatterPlot?.series ?? [])
      : spec.type === 'histogram'
         ? (spec.histogramData ? [{ name: spec.histogramData.name ?? '', color: spec.histogramData.color }] : [])
         : (spec.data?.series ?? [])
   if (colorSourceSeries.some(oneSeries => oneSeries.color !== undefined && oneSeries.color !== '')) {
      // Always double-quote the list so the token reads as one value even if a slot carries something exotic.
      const slots = colorSourceSeries.map(oneSeries => oneSeries.color ?? '')
      tokens.push(`colors="${slots.join(',')}"`)
   }

   // Per-category color overrides ride one `sliceColors=` token in label order (empty slot = no
   // override), for the single-series types, emitted only when at least one category is colored.
   const labels = spec.data?.labels ?? []
   const categoryColors = spec.data?.categoryColors
   if (categoryColors && categoryColors.some(color => color !== undefined && color !== '')) {
      const slots = labels.map((_label, index) => categoryColors[index] ?? '')
      tokens.push(`sliceColors="${slots.join(',')}"`)
   }

   return tokens
}

// ###################################
// # PRIVATE HELPERS, PIPE-TABLE BODY #
// ###################################

/** Escape a literal pipe so it survives inside a pipe-table cell, matching the table block. */
function escapePipeCell(text: string): string {
   return text.replace(/\|/g, '\\|')
}

/** Whether a parsed row is a Markdown table separator (each cell is dashes, optional colons). */
function isSeparatorRow(cells: string[]): boolean {
   return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.trim()))
}

/** Parse a data cell into a `number | null`: a blank/non-numeric cell becomes `null`, and whitespace
 *  and thousands-grouping commas are stripped first. Exported so `graphTableData.ts` reuses the exact
 *  same numeric-parse semantics. */
export function parseNumericCell(raw: string | undefined): number | null {
   if (raw === undefined) return null
   const cleaned = raw.trim().replace(/\s+/g, '').replace(/,/g, '')
   if (cleaned === '') return null
   const parsed = Number(cleaned)
   return Number.isFinite(parsed) ? parsed : null
}

/** Parse the pipe-table body into GraphData: the first column is the labels, each remaining column a
 *  named series. A separator row after the header is skipped. Never throws; an unusable body yields
 *  empty data. */
function parseTableBody(body: string): { labels: string[]; series: GraphSeries[] } {
   const rows = body.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('|'))

   if (rows.length === 0) return { labels: [], series: [] }

   const headerCells = parsePipeTableRow(rows[0])
   const seriesNames = headerCells.slice(1)

   // Skip an optional separator row directly after the header.
   let bodyStart = 1
   if (rows.length > 1 && isSeparatorRow(parsePipeTableRow(rows[1]))) bodyStart = 2

   const labels: string[]           = []
   const seriesValues: (number | null)[][] = seriesNames.map(() => [])

   for (const row of rows.slice(bodyStart)) {
      const cells = parsePipeTableRow(row)
      labels.push(cells[0] ?? '')
      seriesNames.forEach((_name, seriesIndex) => {
         seriesValues[seriesIndex].push(parseNumericCell(cells[seriesIndex + 1]))
      })
   }

   const series: GraphSeries[] = seriesNames.map((name, seriesIndex) => ({
      name,
      values: seriesValues[seriesIndex],
   }))

   return { labels, series }
}

/** Parse the `function` body, `| Name | Expression | Color |`, into an {@link EquationSeries} list.
 *  A row with a blank Expression is skipped rather than kept as a dead equation. Never throws. */
function parseEquationTableBody(body: string): EquationSeries[] {
   const rows = body.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('|'))

   if (rows.length === 0) return []

   // Skip the header row; skip an optional separator row after it.
   let bodyStart = 1
   if (rows.length > 1 && isSeparatorRow(parsePipeTableRow(rows[1]))) bodyStart = 2

   const equations: EquationSeries[] = []
   for (const row of rows.slice(bodyStart)) {
      const cells = parsePipeTableRow(row)
      const expression = (cells[1] ?? '').trim()
      if (expression === '') continue // never a dead equation
      const equation: EquationSeries = { name: cells[0] ?? '', expression }
      const color = cells[2]?.trim()
      if (color) equation.color = color
      equations.push(equation)
   }
   return equations
}

/** Serialize an {@link EquationSeries} list to the `function` type's pipe-table body. */
function serializeEquationTableBody(equations: EquationSeries[]): string {
   const headerRow    = '| Name | Expression | Color |'
   const separatorRow = '| ---- | ---------- | ----- |'
   const bodyRows = equations.map(equation => {
      const cells = [
         escapePipeCell(equation.name ?? ''),
         escapePipeCell(equation.expression ?? ''),
         equation.color ?? '',
      ]
      return `| ${cells.join(' | ')} |`
   })
   return [headerRow, separatorRow, ...bodyRows].join('\n')
}

/** Parse the `scatter` long-format body, `| Series | X | Y |` one row per point, into a
 *  {@link ScatterSeries} list, grouping rows by their `Series` cell in first-seen order. A row with a
 *  non-finite X or Y is skipped. Never throws. A series with zero points cannot round-trip through
 *  this format, an accepted degradation the editor's keep->=1-point invariant never hits. */
function parseScatterTableBody(body: string): ScatterSeries[] {
   const rows = body.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('|'))

   if (rows.length === 0) return []

   // Skip the header row; skip an optional separator row after it.
   let bodyStart = 1
   if (rows.length > 1 && isSeparatorRow(parsePipeTableRow(rows[1]))) bodyStart = 2

   const seriesOrder: string[] = []
   const pointsByName = new Map<string, { x: number; y: number }[]>()

   for (const row of rows.slice(bodyStart)) {
      const cells = parsePipeTableRow(row)
      const seriesName = (cells[0] ?? '').trim()
      const xValue = Number((cells[1] ?? '').trim())
      const yValue = Number((cells[2] ?? '').trim())
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue // malformed row: skip
      if (!pointsByName.has(seriesName)) {
         pointsByName.set(seriesName, [])
         seriesOrder.push(seriesName)
      }
      pointsByName.get(seriesName)!.push({ x: xValue, y: yValue })
   }

   return seriesOrder.map(name => ({ name, points: pointsByName.get(name) ?? [] }))
}

/** Serialize a {@link ScatterSeries} list to the `scatter` long-format body, one row per point. A
 *  series with zero points contributes no rows (see the parse-side note). */
function serializeScatterTableBody(series: ScatterSeries[]): string {
   const headerRow    = '| Series | X | Y |'
   const separatorRow = '| ------ | - | - |'
   const bodyRows: string[] = []
   for (const oneSeries of series) {
      const seriesName = escapePipeCell(oneSeries.name ?? '')
      for (const point of oneSeries.points) {
         // Skip a non-finite point, else it would write a literal "NaN" cell into the fence.
         if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
         bodyRows.push(`| ${seriesName} | ${point.x} | ${point.y} |`)
      }
   }
   return [headerRow, separatorRow, ...bodyRows].join('\n')
}

/** Parse a free-form blob into a finite `number[]`, tolerating commas, whitespace, semicolons, and
 *  any other separator. The histogram's "paste a pile of numbers" input, shared by the fence body
 *  and the editor's textarea. Non-finite tokens are silently skipped. */
export function parseHistogramSamplesText(text: string): number[] {
   const tokens = text.split(/[\s,;]+/).filter(token => token !== '')
   const samples: number[] = []
   for (const token of tokens) {
      const parsed = Number(token)
      if (Number.isFinite(parsed)) samples.push(parsed)
   }
   return samples
}

/** Serialize a histogram's samples to the fence body as a compact comma-separated list (not a
 *  per-sample pipe table, which would bloat for hundreds of samples). */
function serializeHistogramBody(samples: number[]): string {
   return samples.map(sample => String(sample)).join(', ')
}

/** Serialize GraphData to the pipe-table body: header + separator + one row per label. */
function serializeTableBody(spec: GraphSpec): string {
   const labels = spec.data?.labels ?? []
   const series = spec.data?.series ?? []

   // First header cell is the label column, left blank (the model carries no name for it).
   const headerCells = ['', ...series.map(oneSeries => escapePipeCell(oneSeries.name ?? ''))]
   const headerRow    = `| ${headerCells.join(' | ')} |`
   const separatorRow = `| ${headerCells.map(() => '---').join(' | ')} |`

   const bodyRows = labels.map((label, rowIndex) => {
      const cells = [
         escapePipeCell(label ?? ''),
         ...series.map(oneSeries => {
            const value = oneSeries.values?.[rowIndex]
            return value === null || value === undefined ? '' : String(value)
         }),
      ]
      return `| ${cells.join(' | ')} |`
   })

   return [headerRow, separatorRow, ...bodyRows].join('\n')
}

// ################
// # PUBLIC API #
// ################

/** Serialize a GraphSpec to its fence pieces: the info string (with the leading `graph` tag) and the
 *  body. The caller wraps them in the fence. Same output in both `.mint` and `.md`. */
export function graphSpecToFence(spec: GraphSpec): { info: string; body: string } {
   return {
      info: serializeInfoTokens(spec).join(' '),
      body: spec.type === 'function'
         ? serializeEquationTableBody(spec.functionPlot?.equations ?? [])
         : spec.type === 'scatter'
            ? serializeScatterTableBody(spec.scatterPlot?.series ?? [])
            : spec.type === 'histogram'
               ? serializeHistogramBody(spec.histogramData?.samples ?? [])
               : serializeTableBody(spec),
   }
}

/** Parse a `graph` fence (info string + body) back into a GraphSpec. Total: a malformed or partial
 *  fence degrades to the default type with whatever data could be read. */
export function fenceToGraphSpec(fenceInfo: string, body: string): GraphSpec {
   const { type, options, colorOverrides, sliceColorOverrides, functionDomain, histogramMeta, source } = parseInfoString(fenceInfo)

   if (type === 'function') {
      const domain: FunctionDomain = {
         xMin:    functionDomain.xMin    ?? FUNCTION_DEFAULT_X_MIN,
         xMax:    functionDomain.xMax    ?? FUNCTION_DEFAULT_X_MAX,
         samples: functionDomain.samples ?? FUNCTION_DEFAULT_SAMPLES,
      }
      return {
         type,
         data: { labels: [], series: [] },
         options,
         functionPlot: { domain, equations: parseEquationTableBody(body) },
      }
   }

   if (type === 'scatter') {
      const parsedSeries = parseScatterTableBody(body)
      // Apply the per-series color overrides positionally, as the generic path does for data.series.
      const coloredSeries = parsedSeries.map((oneSeries, seriesIndex) => {
         const override = colorOverrides[seriesIndex]
         return override ? { ...oneSeries, color: override } : oneSeries
      })
      return {
         type,
         data: { labels: [], series: [] },
         options,
         scatterPlot: { series: coloredSeries },
      }
   }

   if (type === 'histogram') {
      const samples = parseHistogramSamplesText(body)
      const histogramData: HistogramData = { samples }
      if (histogramMeta.bins !== undefined) histogramData.bins = histogramMeta.bins
      if (histogramMeta.name !== undefined) histogramData.name = histogramMeta.name
      // The single-slot colors= token carries this type's one dataset color at slot 0.
      const colorOverride = colorOverrides[0]
      if (colorOverride) histogramData.color = colorOverride
      return {
         type,
         data: { labels: [], series: [] },
         options,
         histogramData,
      }
   }

   const { labels, series } = parseTableBody(body)

   // Apply the per-series color overrides positionally onto the parsed series.
   const coloredSeries: GraphSeries[] = series.map((oneSeries, seriesIndex) => {
      const override = colorOverrides[seriesIndex]
      return override ? { ...oneSeries, color: override } : oneSeries
   })

   const data: { labels: string[]; series: GraphSeries[]; categoryColors?: (string | undefined)[] } = {
      labels,
      series: coloredSeries,
   }
   // Apply the per-slice color overrides in label order, only when at least one slot carries a
   // color, so a never-colored spec round-trips without a stray `categoryColors` key.
   if (sliceColorOverrides.some(color => color !== undefined)) {
      data.categoryColors = labels.map((_label, index) => sliceColorOverrides[index])
   }

   const spec: GraphSpec = { type, data, options }

   // A live table link attaches only on the tabular path (function/scatter/histogram returned above).
   // Mapping fields ride along only when non-default, mirroring serialization.
   if (source.handle !== undefined) {
      const graphSource: GraphSource = { handle: source.handle }
      if (source.labelColumn !== undefined && source.labelColumn !== 0) graphSource.labelColumn = source.labelColumn
      if (source.orient === 'rows') graphSource.orient = source.orient
      spec.source = graphSource
   }

   return spec
}

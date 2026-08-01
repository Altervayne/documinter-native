/**
 * graphFence.ts, the ` ```graph ` fence serializer / parser for the graph block.
 *
 * A graph block round-trips losslessly through a fenced payload shaped exactly like the study
 * ratified: chart type + presentation options ride the fence INFO STRING as `key=value` tokens
 * (mirroring the math block's `scale=` precedent), and the data rides the fence BODY as a
 * Markdown pipe table (labels column + one column per named series, reusing the same
 * `parsePipeTableRow` the table block parses with).
 *
 * The `type=` token is load-bearing and is emitted in BOTH `.mint` and `.md` (a graph fence is
 * Documint-specific in either format, so there is no GitHub-compat reason to strip it) — this is
 * the deliberate divergence from the math block, whose `scale=` is dropped in portable Markdown.
 *
 * Both directions are total: `graphSpecToFence` never throws on a partial spec, and
 * `fenceToGraphSpec` never throws on a malformed fence (it degrades to the default type + empty
 * data), so a hand-edited file can never break the document.
 */

import type {
   GraphSpec, GraphType, GraphSeries, GraphOptions, Overlay,
   EquationSeries, FunctionDomain, ScatterSeries, HistogramData,
} from './graph'
import {
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
} from './graph'
import { parsePipeTableRow } from './markdown'

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

/** Whether a scalar must be double-quoted on the info string (spaces, quotes, or empty). */
function infoValueNeedsQuote(value: string): boolean {
   return value === '' || /[\s"]/.test(value)
}

/** Serialize one info-string value, double-quoting + escaping only when necessary. */
function serializeInfoValue(value: string): string {
   if (!infoValueNeedsQuote(value)) return value
   return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** Unescape a value that arrived double-quoted (drops the quotes, resolves `\"` and `\\`). */
function unquoteInfoValue(raw: string): string {
   if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw
   const inner = raw.slice(1, -1)
   let result = ''
   let index  = 0
   while (index < inner.length) {
      if (inner[index] === '\\' && index + 1 < inner.length) {
         result += inner[index + 1]
         index += 2
      } else {
         result += inner[index]
         index++
      }
   }
   return result
}

/**
 * Split a fence info string into whitespace-separated tokens, keeping a double-quoted region
 * (including any escaped quotes inside it) as part of a single token. So
 * `graph type=bar title="Quarterly revenue"` tokenizes to
 * `['graph', 'type=bar', 'title="Quarterly revenue"']`, not on the space inside the title.
 */
function tokenizeInfoString(info: string): string[] {
   const source = info.trim()
   const tokens: string[] = []
   let index = 0

   while (index < source.length) {
      // Skip run of whitespace between tokens.
      while (index < source.length && /\s/.test(source[index])) index++
      if (index >= source.length) break

      let token = ''
      while (index < source.length && !/\s/.test(source[index])) {
         if (source[index] === '"') {
            // Consume the whole quoted region, quotes and escapes included, so an inner
            // space does not end the token.
            token += source[index]
            index++
            while (index < source.length && source[index] !== '"') {
               if (source[index] === '\\' && index + 1 < source.length) {
                  token += source[index] + source[index + 1]
                  index += 2
               } else {
                  token += source[index]
                  index++
               }
            }
            if (index < source.length) { token += source[index]; index++ } // closing quote
         } else {
            token += source[index]
            index++
         }
      }
      tokens.push(token)
   }
   return tokens
}

/** Parsed pieces of a graph fence info string. */
interface ParsedInfo {
   type:                GraphType
   options:             GraphOptions
   colorOverrides:      (string | undefined)[]
   sliceColorOverrides: (string | undefined)[]
   /** `xmin=`/`xmax=`/`samples=` tokens (function type only); undefined field = "use the default"
    *  (applied by the caller, since the default depends on nothing this parser knows about). */
   functionDomain:      { xMin?: number; xMax?: number; samples?: number }
   /** `bins=`/`name=` tokens (histogram type only); undefined `bins` = "auto (Sturges)", undefined
    *  `name` = "no dataset name". Harmlessly parsed-but-unused for every other type. */
   histogramMeta:       { bins?: number; name?: string }
}

// ============ overlay token grammar (compact, colon-separated, quote-safe) ============
// One `overlay=` token per Overlay (a REPEATED key — the only one in the fence). Grammar:
//   mean:<series>            median:<series>            trend:<series>[:eq]
//   ref:<value>[:<label>]
//   eq:<expression>
// where <series> is a slot index or the literal `all`. A reference label may contain spaces (and
// colons), so the whole token is double-quoted by serializeInfoValue when it needs it. An
// equation's <expression> is taken VERBATIM as everything after the first colon (never split
// further) — the expr.ts grammar (docs/reference/graph_equation_study.md) has NO `:` operator or
// token anywhere (numbers, `x`, `pi`/`e`, `+ - * / ^`, parens, commas, function names), so the
// `eq:` prefix split is unambiguous by construction; an expression containing whitespace or a
// literal `"` is still double-quoted by serializeInfoValue like every other token, no new
// escaping needed.

/** Serialize one overlay to its token VALUE (before quoting), or null if it can't round-trip. */
function serializeOverlay(overlay: Overlay): string | null {
   if (overlay.kind === 'reference') {
      if (overlay.value === undefined || !Number.isFinite(overlay.value)) return null
      const base = `ref:${overlay.value}`
      return overlay.label && overlay.label !== '' ? `${base}:${overlay.label}` : base
   }
   if (overlay.kind === 'equation') {
      if (overlay.expression === undefined || overlay.expression.trim() === '') return null
      return `eq:${overlay.expression}`
   }
   // Computed kinds carry a series target (index or 'all'); trend carries the optional `eq` flag.
   const seriesToken = overlay.series === 'all' ? 'all' : String(overlay.series ?? 0)
   let token = `${overlay.kind}:${seriesToken}`
   if (overlay.kind === 'trend' && overlay.showEquation) token += ':eq'
   return token
}

/** Parse one overlay token VALUE back to an Overlay; null for an unknown kind or a bad reference. */
function parseOverlay(raw: string): Overlay | null {
   const segments = raw.split(':')
   const kindToken = segments[0]
   if (kindToken === 'ref') {
      const value = Number(segments[1])
      if (!Number.isFinite(value)) return null
      const label = segments.slice(2).join(':')
      const overlay: Overlay = { kind: 'reference', value }
      if (label !== '') overlay.label = label
      return overlay
   }
   if (kindToken === 'eq') {
      // Rejoin on ':' defensively (the grammar guarantees no ':' inside an expression, but this
      // keeps a hand-edited fence total rather than silently truncating at a stray colon).
      const expression = segments.slice(1).join(':')
      if (expression === '') return null // no expression: nothing to plot, not a valid overlay
      return { kind: 'equation', expression }
   }
   if (kindToken === 'mean' || kindToken === 'median' || kindToken === 'trend') {
      const seriesToken = segments[1]
      let series: number | 'all'
      if (seriesToken === 'all') {
         series = 'all'
      } else {
         const parsed = Number(seriesToken)
         series = Number.isFinite(parsed) ? parsed : 0
      }
      const overlay: Overlay = { kind: kindToken, series }
      if (kindToken === 'trend' && segments.slice(2).includes('eq')) overlay.showEquation = true
      return overlay
   }
   return null // unknown kind: skip (tolerant, forward-compatible)
}

/**
 * Parse the info string (the whole `graph …` line after the backticks) into a chart type,
 * presentation options, and the per-series color-override list. Unknown tokens are ignored
 * (forward-compatible); a missing / invalid `type=` falls back to the default type.
 */
function parseInfoString(fenceInfo: string): ParsedInfo {
   const tokens  = tokenizeInfoString(fenceInfo)
   // tokens[0] is the `graph` tag itself; options start at index 1.
   const options: GraphOptions = {}
   let type: GraphType = DEFAULT_GRAPH_TYPE
   let colorOverrides: (string | undefined)[] = []
   let sliceColorOverrides: (string | undefined)[] = []
   // `overlay=` is the fence's one REPEATED key: every occurrence pushes onto this array (instead of
   // assigning), which is attached to options.overlays only if non-empty (so a graph with none keeps
   // the field absent and round-trips unchanged).
   const pendingOverlays: Overlay[] = []
   const functionDomain: { xMin?: number; xMax?: number; samples?: number } = {}
   const histogramMeta: { bins?: number; name?: string } = {}

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

   return { type, options, colorOverrides, sliceColorOverrides, functionDomain, histogramMeta }
}

/** Serialize the presentation options + type into the ordered `key=value` token list. */
function serializeInfoTokens(spec: GraphSpec): string[] {
   const tokens: string[] = [`type=${spec.type}`]
   const options = spec.options ?? {}

   if (options.title !== undefined && options.title !== '')
      tokens.push(`title=${serializeInfoValue(options.title)}`)

   // Domain tokens (function type only), emitted only when they differ from the sane defaults so
   // an untouched function chart's fence stays lean — same pattern barWidth=/lineWidth=/etc. follow.
   if (spec.type === 'function') {
      const domain = spec.functionPlot?.domain
      const xMin = domain?.xMin ?? FUNCTION_DEFAULT_X_MIN
      const xMax = domain?.xMax ?? FUNCTION_DEFAULT_X_MAX
      const samples = domain?.samples ?? FUNCTION_DEFAULT_SAMPLES
      if (xMin !== FUNCTION_DEFAULT_X_MIN) tokens.push(`xmin=${xMin}`)
      if (xMax !== FUNCTION_DEFAULT_X_MAX) tokens.push(`xmax=${xMax}`)
      if (samples !== FUNCTION_DEFAULT_SAMPLES) tokens.push(`samples=${samples}`)
   }

   // `bins=`/`name=` tokens (histogram type only), emitted only when actually set — `bins` absent
   // means "auto (Sturges)" (never emit a computed bin count, only a manual override), and `name`
   // absent means "no dataset name" (there being no meaningful default to compare against, unlike
   // barWidth=/lineWidth=/etc., these are simple presence checks, not default-diff checks).
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

   // Per-type presentation options ride the info string ONLY when set AND different from the
   // render default (an at-default value renders identically without a token, keeping the fence
   // lean). Defaults are the single source of truth in graph/types.ts.
   if (options.barWidth !== undefined && options.barWidth !== GRAPH_DEFAULT_BAR_WIDTH)
      tokens.push(`barWidth=${options.barWidth}`)
   if (options.lineWidth !== undefined && options.lineWidth !== GRAPH_DEFAULT_LINE_WIDTH)
      tokens.push(`lineWidth=${options.lineWidth}`)
   if (options.showPoints !== undefined && options.showPoints !== GRAPH_DEFAULT_SHOW_POINTS)
      tokens.push(`points=${options.showPoints ? 'on' : 'off'}`)
   if (options.areaFillOpacity !== undefined && options.areaFillOpacity !== GRAPH_DEFAULT_AREA_FILL_OPACITY)
      tokens.push(`areaOpacity=${options.areaFillOpacity}`)
   // barPeakLine is a plain boolean display toggle (no GRAPH_DEFAULT_* — off is the render default),
   // mirroring showValues: emitted only when true, so an untouched graph stays byte-lean.
   if (options.barPeakLine === true)
      tokens.push('peakline=on')

   // Statistical overlays ride REPEATED `overlay=` tokens, one per overlay, emitted only when
   // present (a graph with none emits nothing and round-trips identically). Labels with spaces are
   // double-quoted by serializeInfoValue, so no new escaping machinery is needed.
   for (const overlay of options.overlays ?? []) {
      const serialized = serializeOverlay(overlay)
      if (serialized === null) continue
      tokens.push(`overlay=${serializeInfoValue(serialized)}`)
   }

   // Per-series color overrides ride ONE `colors=` token in series order, empty slot = no
   // override. Emitted only when at least one series actually carries a color. `scatter` reads its
   // series list from `scatterPlot` (not `data.series`, which stays empty for this type) — the
   // SAME token grammar every other type uses, just a different source array. `histogram` has only
   // ONE dataset (no series axis at all), so it rides the same single-slot `colors="…"` token via a
   // synthetic one-item list built from `histogramData.color`.
   const colorSourceSeries = spec.type === 'scatter'
      ? (spec.scatterPlot?.series ?? [])
      : spec.type === 'histogram'
         ? (spec.histogramData ? [{ name: spec.histogramData.name ?? '', color: spec.histogramData.color }] : [])
         : (spec.data?.series ?? [])
   if (colorSourceSeries.some(oneSeries => oneSeries.color !== undefined && oneSeries.color !== '')) {
      // Always double-quote the colors list, even though it holds no spaces, so the token reads
      // clearly as one value and stays robust if a slot ever carries something exotic.
      const slots = colorSourceSeries.map(oneSeries => oneSeries.color ?? '')
      tokens.push(`colors="${slots.join(',')}"`)
   }

   // Per-category color overrides ride ONE `sliceColors=` token in LABEL order, empty slot = no
   // override. Honored by the single-series types (radial slices + simple-bar bars); the token rides
   // both formats losslessly and is emitted only when at least one category actually carries a color.
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

/**
 * Parse a single data cell into a `number | null`. Blank / non-numeric cells (`—`, `n/a`, an
 * empty cell) become `null` (a gap the renderer handles per type). Numbers are read forgivingly:
 * surrounding whitespace and thousands-grouping commas are stripped before parsing.
 */
function parseNumericCell(raw: string | undefined): number | null {
   if (raw === undefined) return null
   const cleaned = raw.trim().replace(/\s+/g, '').replace(/,/g, '')
   if (cleaned === '') return null
   const parsed = Number(cleaned)
   return Number.isFinite(parsed) ? parsed : null
}

/**
 * Parse the pipe-table body into GraphData. The first column holds the category labels; each
 * remaining column is one named series (header cell = series name, body cells = numeric values).
 * A separator row (if present) after the header is skipped. Never throws — an unusable body
 * yields empty data.
 */
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

/**
 * Parse the `function` type's pipe-table body — `| Name | Expression | Color |`, one row per
 * equation — into an {@link EquationSeries} list. Never throws: an unusable body yields an empty
 * list, and a row with a blank Expression cell (the load-bearing field) is skipped rather than
 * kept as a dead equation, so a hand-edited fence can never produce an equation with nothing to
 * plot.
 */
function parseEquationTableBody(body: string): EquationSeries[] {
   const rows = body.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('|'))

   if (rows.length === 0) return []

   // Skip the header row; skip an optional separator row directly after it.
   let bodyStart = 1
   if (rows.length > 1 && isSeparatorRow(parsePipeTableRow(rows[1]))) bodyStart = 2

   const equations: EquationSeries[] = []
   for (const row of rows.slice(bodyStart)) {
      const cells = parsePipeTableRow(row)
      const expression = (cells[1] ?? '').trim()
      if (expression === '') continue // malformed/empty row: skip, never a dead equation
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

/**
 * Parse the `scatter` type's LONG-FORMAT pipe-table body — `| Series | X | Y |`, one row per POINT
 * (not per series) — into a {@link ScatterSeries} list. Rows are grouped back into series by their
 * `Series` cell text, preserving FIRST-SEEN series order (so an author's series ordering survives
 * even though the long format interleaves points from different series across rows). Never throws:
 * an unusable body yields an empty list, and a row whose X or Y cell is not a finite number is
 * skipped rather than kept as a broken point, so a hand-edited fence can never produce a point with
 * nothing to plot. NOTE: a series with zero points has no row to reconstruct it from and so cannot
 * round-trip through this format — an accepted, documented degradation (the editor's keep->=1-point
 * invariant means this only affects a hand-crafted fence, never an author using the UI).
 */
function parseScatterTableBody(body: string): ScatterSeries[] {
   const rows = body.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('|'))

   if (rows.length === 0) return []

   // Skip the header row; skip an optional separator row directly after it.
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

/**
 * Serialize a {@link ScatterSeries} list to the `scatter` type's LONG-FORMAT pipe-table body: one
 * row per POINT (`SeriesName | x | y`), series emitted in order with every one of their points in
 * order. A series with zero points contributes no rows (see the parse-side note above — an
 * accepted, editor-unreachable degradation, not a round-trip bug for anything the UI can produce).
 */
function serializeScatterTableBody(series: ScatterSeries[]): string {
   const headerRow    = '| Series | X | Y |'
   const separatorRow = '| ------ | - | - |'
   const bodyRows: string[] = []
   for (const oneSeries of series) {
      const seriesName = escapePipeCell(oneSeries.name ?? '')
      for (const point of oneSeries.points) {
         // Skip a non-finite (blank-seeded, never filled) point — the parser skips it too, so it is
         // never a real datum; emitting it would write a literal "NaN" cell into the fence.
         if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
         bodyRows.push(`| ${seriesName} | ${point.x} | ${point.y} |`)
      }
   }
   return [headerRow, separatorRow, ...bodyRows].join('\n')
}

/**
 * Parse a free-form blob of text into a finite `number[]`, tolerating commas, whitespace (including
 * newlines), semicolons, and any other separator/garbage between numbers — the histogram type's
 * "paste a pile of numbers" input, both for the fence body AND the editor's raw-samples textarea
 * (this is the SAME parser both call, so what you paste into the editor is byte-identical to what a
 * hand-edited fence body parses to). Tokens that do not parse to a finite number (an empty run
 * between separators, a stray word, `NaN`/`Infinity` spelled out, …) are silently skipped — never
 * thrown, matching the "garbage ignored, never breaks the chart" contract every other graph parser
 * here honors.
 */
export function parseHistogramSamplesText(text: string): number[] {
   const tokens = text.split(/[\s,;]+/).filter(token => token !== '')
   const samples: number[] = []
   for (const token of tokens) {
      const parsed = Number(token)
      if (Number.isFinite(parsed)) samples.push(parsed)
   }
   return samples
}

/**
 * Serialize a histogram's raw sample list to the fence body: a COMPACT comma-separated number
 * list (not a per-sample pipe table — for potentially hundreds of samples, a flat list is far more
 * compact and just as readable in a hand-edited `.mint`/`.md` file).
 */
function serializeHistogramBody(samples: number[]): string {
   return samples.map(sample => String(sample)).join(', ')
}

/** Serialize GraphData to the pipe-table body: header + separator + one row per label. */
function serializeTableBody(spec: GraphSpec): string {
   const labels = spec.data?.labels ?? []
   const series = spec.data?.series ?? []

   // First header cell names the label column; the model carries no name for it, so it stays
   // blank (it is discarded on re-parse). Remaining header cells are the series names.
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

/**
 * Serialize a GraphSpec to its fence pieces: the full info string (including the leading `graph`
 * tag) and the pipe-table body. The caller wraps them in the ``` … ``` fence. Same output in
 * both `.mint` and `.md` — the `type=` token is load-bearing and rides both.
 */
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

/**
 * Parse a `graph` fence (its whole info string + its body) back into a GraphSpec. Total: a
 * malformed or partial fence degrades to the default type with whatever data could be read
 * (possibly empty), never an exception.
 */
export function fenceToGraphSpec(fenceInfo: string, body: string): GraphSpec {
   const { type, options, colorOverrides, sliceColorOverrides, functionDomain, histogramMeta } = parseInfoString(fenceInfo)

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
      // Apply the per-series color overrides positionally onto the parsed series, same mechanism
      // the generic path below uses for data.series.
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
      // The single-slot colors= token (see serializeInfoTokens' colorSourceSeries) carries this
      // type's one dataset color at slot 0, same mechanism scatter/data.series use per series.
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
   // Apply the per-category (per-slice) color overrides in label order, but ONLY when at least one
   // slot carries a color — an all-empty token leaves the field absent so a never-colored spec
   // round-trips to an identical object (no stray `categoryColors` key).
   if (sliceColorOverrides.some(color => color !== undefined)) {
      data.categoryColors = labels.map((_label, index) => sliceColorOverrides[index])
   }

   return { type, data, options }
}

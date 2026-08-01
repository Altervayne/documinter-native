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

import type { GraphSpec, GraphType, GraphSeries, GraphOptions } from './graph'
import {
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
} from './graph'
import { parsePipeTableRow } from './markdown'

// #############
// # CONSTANTS #
// #############

/** Every chart type the v1 renderer accepts; the parse default when the `type=` token is bad. */
const VALID_GRAPH_TYPES: ReadonlySet<GraphType> = new Set<GraphType>([
   'bar', 'bar-grouped', 'bar-stacked', 'line', 'area', 'pie', 'donut',
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
         default:
            break
      }
   }

   return { type, options, colorOverrides, sliceColorOverrides }
}

/** Serialize the presentation options + type into the ordered `key=value` token list. */
function serializeInfoTokens(spec: GraphSpec): string[] {
   const tokens: string[] = [`type=${spec.type}`]
   const options = spec.options ?? {}

   if (options.title !== undefined && options.title !== '')
      tokens.push(`title=${serializeInfoValue(options.title)}`)
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

   // Per-series color overrides ride ONE `colors=` token in series order, empty slot = no
   // override. Emitted only when at least one series actually carries a color.
   const series = spec.data?.series ?? []
   if (series.some(oneSeries => oneSeries.color !== undefined && oneSeries.color !== '')) {
      // Always double-quote the colors list, even though it holds no spaces, so the token reads
      // clearly as one value and stays robust if a slot ever carries something exotic.
      const slots = series.map(oneSeries => oneSeries.color ?? '')
      tokens.push(`colors="${slots.join(',')}"`)
   }

   // Per-category (per-slice) color overrides ride ONE `sliceColors=` token in LABEL order, empty
   // slot = no override. Radial-only in effect, but the token rides both formats losslessly; it is
   // emitted only when at least one slice actually carries a color.
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
      body: serializeTableBody(spec),
   }
}

/**
 * Parse a `graph` fence (its whole info string + its body) back into a GraphSpec. Total: a
 * malformed or partial fence degrades to the default type with whatever data could be read
 * (possibly empty), never an exception.
 */
export function fenceToGraphSpec(fenceInfo: string, body: string): GraphSpec {
   const { type, options, colorOverrides, sliceColorOverrides } = parseInfoString(fenceInfo)
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

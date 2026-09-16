/*
 * The pure table<->graph data mapping, both directions total: graphDataFromTable turns table cells
 * into GraphData, tableFromGraphData reverses it. Reuses graphFence.ts's `parseNumericCell` so an
 * extracted table and a hand-typed fence agree on what counts as a number. Also home to the
 * live-link resolver (`collectTableSources`/`resolveGraphSpec`/`graphDataEquals`) and the
 * linkable-tables catalog for the "Link to a table..." picker.
 */

import type { Block, InlineContent, Section, Side } from '../types'
import type { GraphData, GraphSeries, GraphSpec } from './graph'
import { parseNumericCell } from './graphFence'

// #####################
// # PRIVATE HELPERS #
// #####################

/** Flatten a table cell's rich text down to plain text (formatting is dropped, not converted). */
function cellPlainText(content: InlineContent | undefined): string {
   if (!content) return ''
   return content.map(run => run.text).join('')
}

/** Wrap a plain string back into InlineContent, honoring the "no empty runs" invariant. */
function textToInlineContent(text: string): InlineContent {
   return text === '' ? [] : [{ text }]
}

// ################
// # PUBLIC API #
// ################

/** The mapping options, the same a live link carries on {@link GraphSource}. Both optional; omitting
 *  them yields the default mapping (label column 0, series = columns). */
export interface GraphDataFromTableOptions {
   /** Which column supplies labels (orient `columns`) or series names (orient `rows`). Default 0;
    *  an out-of-range value clamps back to 0. */
   labelColumn?: number
   /** `columns` (default): non-label columns become series. `rows`: rows become series and the
    *  header row supplies the labels (the transpose). */
   orient?: 'columns' | 'rows'
}

/** Table -> graph. By default the first column is the labels and every other column is a named
 *  series; rich text is flattened. {@link GraphDataFromTableOptions} chooses a different label column
 *  or the `rows` transpose. Total: an empty table yields empty data, a ragged one treats a missing
 *  cell as blank, an out-of-range `labelColumn` clamps to 0. */
export function graphDataFromTable(
   richHeaders: InlineContent[],
   richRows: InlineContent[][],
   options?: GraphDataFromTableOptions,
): GraphData {
   const orient      = options?.orient ?? 'columns'
   const labelColumn = options?.labelColumn ?? 0

   // Fast path: the default mapping (label column 0, series = columns), its own branch so the
   // generalized path below can never affect it.
   if (orient === 'columns' && labelColumn === 0) {
      const headerTexts = richHeaders.map(cellPlainText)
      const seriesNames  = headerTexts.slice(1)

      const labels: string[] = []
      const seriesValues: (number | null)[][] = seriesNames.map(() => [])

      for (const row of richRows) {
         labels.push(cellPlainText(row[0]))
         seriesNames.forEach((_seriesName, seriesIndex) => {
            seriesValues[seriesIndex].push(parseNumericCell(cellPlainText(row[seriesIndex + 1])))
         })
      }

      const series: GraphSeries[] = seriesNames.map((seriesName, seriesIndex) => ({
         name:   seriesName,
         values: seriesValues[seriesIndex],
      }))

      return { labels, series }
   }

   // General path: arbitrary label column and/or `rows` orientation.
   const headerTexts = richHeaders.map(cellPlainText)
   const rowTexts    = richRows.map(row => row.map(cellPlainText))

   // Column count spans the header AND the widest row, so a ragged table still resolves.
   const columnCount = Math.max(headerTexts.length, ...rowTexts.map(row => row.length), 0)

   let resolvedLabelColumn = labelColumn
   if (!Number.isInteger(resolvedLabelColumn) || resolvedLabelColumn < 0 || resolvedLabelColumn >= columnCount) {
      resolvedLabelColumn = 0
   }

   // Every column except the label column, in order: these carry the plotted numbers.
   const valueColumns: number[] = []
   for (let column = 0; column < columnCount; column++) {
      if (column !== resolvedLabelColumn) valueColumns.push(column)
   }

   if (orient === 'rows') {
      // Transpose: the header row supplies the labels, each body row becomes a series named by its
      // label-column cell.
      const labels = valueColumns.map(column => headerTexts[column] ?? '')
      const series: GraphSeries[] = rowTexts.map(row => ({
         name:   row[resolvedLabelColumn] ?? '',
         values: valueColumns.map(column => parseNumericCell(row[column])),
      }))
      return { labels, series }
   }

   // Columns orientation, non-zero label column: labels from that column, every other column a series.
   const labels = rowTexts.map(row => row[resolvedLabelColumn] ?? '')
   const series: GraphSeries[] = valueColumns.map(column => ({
      name:   headerTexts[column] ?? '',
      values: rowTexts.map(row => parseNumericCell(row[column])),
   }))
   return { labels, series }
}

/** Graph -> table. Reverses `graphDataFromTable`: a blank label-column header plus each series' name,
 *  then one body row per category (a null value becomes a blank cell). Total: empty GraphData yields
 *  a single blank-header column and no rows. */
export function tableFromGraphData(data: GraphData): { richHeaders: InlineContent[]; richRows: InlineContent[][] } {
   const richHeaders: InlineContent[] = [
      textToInlineContent(''),
      ...data.series.map(oneSeries => textToInlineContent(oneSeries.name ?? '')),
   ]

   const richRows: InlineContent[][] = data.labels.map((label, rowIndex) => [
      textToInlineContent(label ?? ''),
      ...data.series.map(oneSeries => {
         const value = oneSeries.values?.[rowIndex]
         return textToInlineContent(value === null || value === undefined ? '' : String(value))
      }),
   ])

   return { richHeaders, richRows }
}

// #########################
// # LIVE LINK RESOLVER #
// #########################

/** One referenced table's raw cells, keyed by handle in a {@link GraphTableCatalog}. */
export interface LinkedTableSource {
   richHeaders: InlineContent[]
   richRows:    InlineContent[][]
}

/** A document-wide `handle -> table cells` map, the resolver's lookup. Built by
 *  {@link collectTableSources}. */
export type GraphTableCatalog = Map<string, LinkedTableSource>

/** Walk a block array (recursing into container columns) and collect every handled `table` block
 *  into a `handle -> cells` map. First occurrence of a handle wins, so resolution is deterministic
 *  even if a handle is duplicated. */
export function collectTableSources(blocks: Block[]): GraphTableCatalog {
   const catalog: GraphTableCatalog = new Map()
   function visit(block: Block): void {
      if (block.type === 'table' && block.handle && !catalog.has(block.handle)) {
         catalog.set(block.handle, {
            richHeaders: block.richHeaders ?? [],
            richRows:    block.richRows ?? [],
         })
      }
      for (const inner of block.left  ?? []) visit(inner)
      for (const inner of block.right ?? []) visit(inner)
   }
   for (const block of blocks) visit(block)
   return catalog
}

// #####################################################
// # LINKABLE TABLES, the "Link to a table..." picker's catalog #
// #####################################################

/** Where a table block lives, for routing a mutation back at it: a top-level table goes through
 *  `updateBlock`, a container-nested one through `containerMutations.updateBlock`. Carrying it here
 *  saves the editor re-walking the block tree to address a pick. */
export interface LinkableTableAddress {
   sectionId: string
   blockId: string
   /** Present only when the table sits inside a container's left/right column. */
   container?: { blockId: string; side: Side }
}

/** One table as the "Link to a table..." picker sees it: identity, addressing, and enough shape for
 *  a preview row. Lists EVERY table, handled or not (an unhandled one is auto-assigned a handle on
 *  pick). */
export interface LinkableTable extends LinkableTableAddress {
   /** Undefined when the table carries no handle yet. */
   handle?: string
   /** Plain-text header row for the picker's preview, not necessarily meaningful as labels; the
    *  picker falls back to a positional caption when every header cell is blank. */
   headerPreview: string[]
   columnCount: number
   rowCount: number
}

/** Walk a document's sections (recursing into container columns) and list EVERY `table` block,
 *  handled or not. Order follows document order, so the picker reads top-to-bottom like the doc. */
export function collectLinkableTables(sections: Section[]): LinkableTable[] {
   const result: LinkableTable[] = []

   function visit(sectionId: string, block: Block, container?: { blockId: string; side: Side }): void {
      if (block.type === 'table') {
         const richHeaders = block.richHeaders ?? []
         result.push({
            sectionId,
            blockId:  block.id,
            container,
            handle:   block.handle,
            headerPreview: richHeaders.map(cellPlainText),
            columnCount:   richHeaders.length,
            rowCount:      (block.richRows ?? []).length,
         })
      }
      for (const inner of block.left  ?? []) visit(sectionId, inner, { blockId: block.id, side: 'left' })
      for (const inner of block.right ?? []) visit(sectionId, inner, { blockId: block.id, side: 'right' })
   }

   for (const section of sections) {
      for (const block of section.blocks) visit(section.id, block)
   }
   return result
}

/** The outcome of resolving a (possibly linked) graph spec into a concrete render spec. */
export interface ResolvedGraphSpec {
   /** A concrete GraphSpec safe for the pure `renderGraphToSvg`: `source` is stripped, and for a
    *  resolved link `data` is the freshly mapped table data. */
   renderSpec: GraphSpec
   /** True only when the spec was linked but its handle was not found; the render falls back to the
    *  snapshot in `spec.data`. */
   dangling: boolean
}

/**
 * Resolve a graph spec against a table catalog, keeping the renderer pure.
 *   - No `source`          -> returned as-is (`dangling: false`).
 *   - `source` + found     -> `data` remapped via {@link graphDataFromTable}, `source` stripped.
 *   - `source` + not found -> dangling: `source` stripped, `data` left as the last-known snapshot.
 * Total. The returned `renderSpec` never carries `source`.
 */
export function resolveGraphSpec(spec: GraphSpec, tables: GraphTableCatalog): ResolvedGraphSpec {
   const source = spec.source
   if (!source) return { renderSpec: spec, dangling: false }

   // Strip the link so the pure renderer never learns about it.
   const { source: _strippedSource, ...withoutSource } = spec

   const entry = tables.get(source.handle)
   if (!entry) {
      // Dangling: fall back to the snapshot already in `data`.
      return { renderSpec: withoutSource, dangling: true }
   }

   const resolvedData = graphDataFromTable(entry.richHeaders, entry.richRows, {
      labelColumn: source.labelColumn,
      orient:      source.orient,
   })
   return { renderSpec: { ...withoutSource, data: resolvedData }, dangling: false }
}

/** Structural equality over the mapped fields of two GraphData (labels + each series' name & values).
 *  Ignores presentation-only fields so the snapshot write-back fires only on a data change and never
 *  clobbers author-set colors. `undefined` on the right always counts as different. */
export function graphDataEquals(next: GraphData, previous: GraphData | undefined): boolean {
   if (!previous) return false
   if (next.labels.length !== previous.labels.length) return false
   for (let index = 0; index < next.labels.length; index++) {
      if (next.labels[index] !== previous.labels[index]) return false
   }
   if (next.series.length !== previous.series.length) return false
   for (let seriesIndex = 0; seriesIndex < next.series.length; seriesIndex++) {
      const nextSeries     = next.series[seriesIndex]
      const previousSeries = previous.series[seriesIndex]
      if (nextSeries.name !== previousSeries.name) return false
      if (nextSeries.values.length !== previousSeries.values.length) return false
      for (let valueIndex = 0; valueIndex < nextSeries.values.length; valueIndex++) {
         if (nextSeries.values[valueIndex] !== previousSeries.values[valueIndex]) return false
      }
   }
   return true
}

/**
 * graphTableData.ts, the pure table<->graph data-mapping transform: the one-shot extract between
 * a table block's cells and a graph's GraphData.
 *
 * Two directions, both pure and total (never throw, never require well-formed input):
 *   graphDataFromTable , table block cells (InlineContent[][])  -> GraphData
 *   tableFromGraphData , GraphData                              -> table block cells
 *
 * The mapping reuses graphFence.ts's own numeric-parse semantics (`parseNumericCell`) so a table
 * extracted to a chart, and a chart's ` ```graph ` fence body parsed from a hand-typed pipe table,
 * agree byte-for-byte on what counts as a number. This module owns no serialization and no block
 * model, it only turns cell content into GraphData and back; the caller (a block action) is
 * responsible for wrapping the result into a `graph` or `table` Block and inserting it.
 *
 * Also home to the live-link resolver (`collectTableSources`/`resolveGraphSpec`/
 * `graphDataEquals`) and the editor's linkable-tables catalog (`collectLinkableTables`/
 * `LinkableTable`), the "Link to a table..." picker's data source.
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

/**
 * The mapping options honored when resolving a table into GraphData, the same options a live link
 * carries on {@link GraphSource}. Both optional; omitting the whole argument (or passing all
 * defaults) yields the default mapping unchanged (label column 0, series = columns).
 */
export interface GraphDataFromTableOptions {
   /** Which column supplies labels (orient `columns`) or series names (orient `rows`). Default 0;
    *  an out-of-range value clamps back to 0 (a reshaped/narrower table never throws). */
   labelColumn?: number
   /** `columns` (default): non-label columns become series. `rows`: rows become series and the
    *  header row supplies the labels (the transpose). */
   orient?: 'columns' | 'rows'
}

/**
 * Table -> graph. By default the first column supplies the category labels and every remaining
 * column becomes one named series (its header cell = the series name, its body cells = numeric
 * values via the SAME `parseNumericCell` the fence uses); Rich text is flattened to plain text.
 * An optional {@link GraphDataFromTableOptions} chooses a different label column and/or the `rows`
 * orientation (transpose). Total: an empty table (no headers, no rows) yields
 * `{ labels: [], series: [] }`; a ragged table (rows shorter than the header) treats a missing cell
 * as blank (label `''`, value `null`); an out-of-range `labelColumn` clamps to 0.
 */
export function graphDataFromTable(
   richHeaders: InlineContent[],
   richRows: InlineContent[][],
   options?: GraphDataFromTableOptions,
): GraphData {
   const orient      = options?.orient ?? 'columns'
   const labelColumn = options?.labelColumn ?? 0

   // ============ Fast path: the default mapping, preserved byte-for-byte ============
   // (label column 0, series = columns). Keeping it as its own branch guarantees every existing
   // caller + test is unaffected by the generalized path below.
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

   // ============ General path: arbitrary label column and/or `rows` orientation ============
   const headerTexts = richHeaders.map(cellPlainText)
   const rowTexts    = richRows.map(row => row.map(cellPlainText))

   // Column count spans the header AND the widest row, so a reshaped/ragged table still resolves.
   const columnCount = Math.max(headerTexts.length, ...rowTexts.map(row => row.length), 0)

   // Clamp the label column into range; out-of-range (a reshaped, narrower table) falls back to 0.
   let resolvedLabelColumn = labelColumn
   if (!Number.isInteger(resolvedLabelColumn) || resolvedLabelColumn < 0 || resolvedLabelColumn >= columnCount) {
      resolvedLabelColumn = 0
   }

   // Every column that is NOT the label column, in order, these carry the plotted numbers.
   const valueColumns: number[] = []
   for (let column = 0; column < columnCount; column++) {
      if (column !== resolvedLabelColumn) valueColumns.push(column)
   }

   if (orient === 'rows') {
      // Transpose: the header row supplies the category labels (skipping the label-column cell),
      // and each body row becomes one series named by its label-column cell.
      const labels = valueColumns.map(column => headerTexts[column] ?? '')
      const series: GraphSeries[] = rowTexts.map(row => ({
         name:   row[resolvedLabelColumn] ?? '',
         values: valueColumns.map(column => parseNumericCell(row[column])),
      }))
      return { labels, series }
   }

   // Columns orientation with a non-zero label column: labels come from that column's cells,
   // every other column becomes a named series.
   const labels = rowTexts.map(row => row[resolvedLabelColumn] ?? '')
   const series: GraphSeries[] = valueColumns.map(column => ({
      name:   headerTexts[column] ?? '',
      values: rowTexts.map(row => parseNumericCell(row[column])),
   }))
   return { labels, series }
}

/**
 * Graph -> table. Reverses `graphDataFromTable`: the header row is a blank label-column header
 * (matching the fence's own convention, the model carries no name for the label column) followed
 * by each series' name; each body row is the category label followed by that row's value per
 * series, rendered as text (a `null`/missing value becomes a blank cell, round-tripping through
 * `parseNumericCell` back to `null`). Total: an empty GraphData yields a single blank-header
 * column and no rows.
 */
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

/**
 * One referenced table's raw cells, keyed by handle in a {@link GraphTableCatalog}. This is the
 * minimal shape the resolver needs, the same fields a `table` Block carries, projected off it.
 */
export interface LinkedTableSource {
   richHeaders: InlineContent[]
   richRows:    InlineContent[][]
}

/** A document-wide `handle -> table cells` map: the resolver a linked graph looks its source up in.
 *  Built once (memoized in the editor, once-per-export in the exporter) by {@link collectTableSources}. */
export type GraphTableCatalog = Map<string, LinkedTableSource>

/**
 * Walk a block array (recursing into container `left`/`right` columns, exactly like the document's
 * handle catalog does) and collect every `table` block that carries a handle into a
 * `handle -> { richHeaders, richRows }` map. FIRST occurrence of a handle wins, so resolution is
 * deterministic even if a handle is accidentally duplicated. Pure; used by both the editor context
 * (over the active document's blocks) and the HTML exporter (over all sections' blocks).
 */
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

/**
 * Where a table block ACTUALLY lives, for routing a mutation back at it. Top-level (no
 * `container`) routes through `DocumentMutations.updateBlock(sectionId, blockId, patch)`; a table
 * nested in a container column routes through
 * `DocumentMutations.containerMutations.updateBlock(sectionId, container.blockId, container.side,
 * blockId, patch)` instead, the container mutation hook's own 5-argument shape. Carrying this here
 * means the editor UI never has to re-walk the block tree to figure out how to address a pick.
 */
export interface LinkableTableAddress {
   sectionId: string
   blockId: string
   /** Present only when the table sits inside a container's left/right column. */
   container?: { blockId: string; side: Side }
}

/**
 * One document table as the "Link to a table..." picker sees it: identity + addressing (so a pick
 * can be turned into a mutation) plus enough of its shape to render a compact preview row. Unlike
 * {@link GraphTableCatalog} (which only ever catalogs HANDLED tables, the resolver's lookup key),
 * this lists EVERY table, handled or not, a handle-less table is exactly the case the picker must
 * still offer (picking it auto-assigns one, see `generateUniqueHandle` in `lib/document.ts`).
 */
export interface LinkableTable extends LinkableTableAddress {
   /** Undefined when the table carries no handle yet. */
   handle?: string
   /** Plain-text header row (rich text flattened), for the picker's preview, NOT necessarily
    *  meaningful as labels (a table may have blank headers); the picker falls back to a positional
    *  caption when every header cell is blank. */
   headerPreview: string[]
   columnCount: number
   rowCount: number
}

/**
 * Walk a document's sections (recursing into container `left`/`right` columns, exactly like
 * {@link collectTableSources}) and list EVERY `table` block, handled or not, as a
 * {@link LinkableTable}. Pure; used by the graph editor's Data tab to populate the "Link to a
 * table..." picker AND the linked-state "change source" control. Order follows document order
 * (section, then block, then container column), so the picker reads top-to-bottom like the doc.
 */
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
   /** A concrete GraphSpec safe to hand to the PURE `renderGraphToSvg`, `source` is always
    *  stripped, and for a live-resolved link `data` is the freshly mapped table data. */
   renderSpec: GraphSpec
   /** True only when the spec was linked but its source handle was NOT found in the catalog, the
    *  render falls back to the materialized snapshot in `spec.data` (never blank, never a throw). */
   dangling: boolean
}

/**
 * Resolve a graph spec against a table catalog, keeping the renderer pure.
 *
 *   - No `source`            -> the spec is returned as-is (self-contained; `dangling: false`).
 *   - `source` + found       -> `data` is remapped from the table via {@link graphDataFromTable}
 *                               (honoring `labelColumn`/`orient`), `source` stripped.
 *   - `source` + NOT found   -> DANGLING: `source` stripped, `data` left as the last-known snapshot,
 *                               `dangling: true` (the caller may surface a "source missing" hint).
 *
 * Total: never throws. The returned `renderSpec` never carries `source`, so the pure renderer, and
 * the export bake, only ever see concrete data.
 */
export function resolveGraphSpec(spec: GraphSpec, tables: GraphTableCatalog): ResolvedGraphSpec {
   const source = spec.source
   if (!source) return { renderSpec: spec, dangling: false }

   // Strip the link so the pure renderer never learns about it, regardless of resolution outcome.
   const { source: _strippedSource, ...withoutSource } = spec

   const entry = tables.get(source.handle)
   if (!entry) {
      // Dangling: fall back to the materialized snapshot already in `data`.
      return { renderSpec: withoutSource, dangling: true }
   }

   const resolvedData = graphDataFromTable(entry.richHeaders, entry.richRows, {
      labelColumn: source.labelColumn,
      orient:      source.orient,
   })
   return { renderSpec: { ...withoutSource, data: resolvedData }, dangling: false }
}

/**
 * Structural equality over the mapped fields of two GraphData (labels + each series' name & values).
 * Deliberately ignores presentation-only fields (`categoryColors`, per-series `color`) so the
 * snapshot write-back in GraphBlock fires only on an actual DATA change, and, by not comparing
 * colors, never clobbers author-set colors when the underlying numbers are unchanged. `undefined`
 * on the right (no prior snapshot) always counts as different.
 */
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

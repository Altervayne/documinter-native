import { describe, it, expect } from 'vitest'
import {
   graphDataFromTable, tableFromGraphData,
   collectTableSources, collectLinkableTables, resolveGraphSpec, graphDataEquals,
} from './graphTableData'
import type { GraphTableCatalog } from './graphTableData'
import type { GraphData, GraphSpec } from './graph'
import type { Block, InlineContent, Section } from '../types'

/** Build a plain-text InlineContent run, the shape every table cell in these tests uses. */
function run(text: string): InlineContent {
   return text === '' ? [] : [{ text }]
}

/** A table Block with a handle, the shape collectTableSources catalogs. */
function tableBlock(handle: string, headers: string[], rows: string[][]): Block {
   return {
      id: `table-${handle}`,
      type: 'table',
      handle,
      richHeaders: headers.map(run),
      richRows: rows.map(cells => cells.map(run)),
   }
}

describe('graphTableData, table -> graph', () => {
   it('maps the first column to labels and remaining columns to named series', () => {
      const richHeaders: InlineContent[] = [run(''), run('Product A'), run('Product B')]
      const richRows: InlineContent[][] = [
         [run('Q1'), run('42'), run('30')],
         [run('Q2'), run('55'), run('38')],
      ]
      expect(graphDataFromTable(richHeaders, richRows)).toEqual<GraphData>({
         labels: ['Q1', 'Q2'],
         series: [
            { name: 'Product A', values: [42, 55] },
            { name: 'Product B', values: [30, 38] },
         ],
      })
   })

   it('parses a non-numeric or blank cell to null (matches the fence parseNumericCell semantics)', () => {
      const richHeaders: InlineContent[] = [run(''), run('Value')]
      const richRows: InlineContent[][] = [
         [run('A'), run('n/a')],
         [run('B'), run('')],
         [run('C'), run('not a number')],
         [run('D'), run('1,234')],
      ]
      expect(graphDataFromTable(richHeaders, richRows)).toEqual<GraphData>({
         labels: ['A', 'B', 'C', 'D'],
         series: [{ name: 'Value', values: [null, null, null, 1234] }],
      })
   })

   it('handles an empty table gracefully', () => {
      expect(graphDataFromTable([], [])).toEqual<GraphData>({ labels: [], series: [] })
   })

   it('handles a table with only a label column (no series)', () => {
      const richHeaders: InlineContent[] = [run('')]
      const richRows: InlineContent[][] = [[run('A')], [run('B')]]
      expect(graphDataFromTable(richHeaders, richRows)).toEqual<GraphData>({
         labels: ['A', 'B'],
         series: [],
      })
   })

   it('treats a ragged row (fewer cells than headers) as blank/null for the missing cells', () => {
      const richHeaders: InlineContent[] = [run(''), run('A'), run('B')]
      const richRows: InlineContent[][] = [
         [run('Row1'), run('1'), run('2')],
         [run('Row2'), run('3')], // missing the B cell entirely
         [], // missing every cell, including the label
      ]
      expect(graphDataFromTable(richHeaders, richRows)).toEqual<GraphData>({
         labels: ['Row1', 'Row2', ''],
         series: [
            { name: 'A', values: [1, 3, null] },
            { name: 'B', values: [2, null, null] },
         ],
      })
   })

   it('flattens rich-text formatting down to plain text', () => {
      const boldRun: InlineContent = [{ text: 'Bold' }, { text: ' label', italic: true }]
      const richHeaders: InlineContent[] = [run(''), run('Series')]
      const richRows: InlineContent[][] = [[boldRun, run('7')]]
      expect(graphDataFromTable(richHeaders, richRows)).toEqual<GraphData>({
         labels: ['Bold label'],
         series: [{ name: 'Series', values: [7] }],
      })
   })
})

describe('graphTableData, graph -> table', () => {
   it('maps GraphData to a blank label header + one header per series, and one row per label', () => {
      const data: GraphData = {
         labels: ['Q1', 'Q2'],
         series: [
            { name: 'Product A', values: [42, 55] },
            { name: 'Product B', values: [30, 38] },
         ],
      }
      const { richHeaders, richRows } = tableFromGraphData(data)
      expect(richHeaders).toEqual([[], [{ text: 'Product A' }], [{ text: 'Product B' }]])
      expect(richRows).toEqual([
         [[{ text: 'Q1' }], [{ text: '42' }], [{ text: '30' }]],
         [[{ text: 'Q2' }], [{ text: '55' }], [{ text: '38' }]],
      ])
   })

   it('renders a null value as a blank cell, not the literal string "null"', () => {
      const data: GraphData = {
         labels: ['A', 'B'],
         series: [{ name: 'Series 1', values: [null, 5] }],
      }
      const { richRows } = tableFromGraphData(data)
      expect(richRows).toEqual([
         [[{ text: 'A' }], []],
         [[{ text: 'B' }], [{ text: '5' }]],
      ])
   })

   it('handles empty GraphData gracefully', () => {
      const { richHeaders, richRows } = tableFromGraphData({ labels: [], series: [] })
      expect(richHeaders).toEqual([[]])
      expect(richRows).toEqual([])
   })

   it('round-trips through graphDataFromTable for a well-formed numeric table', () => {
      const data: GraphData = {
         labels: ['Jan', 'Feb', 'Mar'],
         series: [
            { name: 'Revenue', values: [100, 120, 90] },
            { name: 'Cost', values: [80, null, 60] },
         ],
      }
      const { richHeaders, richRows } = tableFromGraphData(data)
      expect(graphDataFromTable(richHeaders, richRows)).toEqual(data)
   })
})

describe('graphTableData, mapping options (labelColumn / orient)', () => {
   const headers = [run('Region'), run('2025'), run('2026')]
   const rows = [
      [run('North'), run('10'), run('12')],
      [run('South'), run('20'), run('22')],
   ]

   it('picks a non-zero label column: that column becomes labels, the others become series', () => {
      // labelColumn 1 (the "2025" column) supplies labels; columns 0 (Region) and 2 (2026) are series.
      expect(graphDataFromTable(headers, rows, { labelColumn: 1 })).toEqual<GraphData>({
         labels: ['10', '20'],
         series: [
            { name: 'Region', values: [null, null] }, // "North"/"South" are non-numeric ⇒ null
            { name: '2026',   values: [12, 22] },
         ],
      })
   })

   it('transposes with orient=rows: rows become series, the header row supplies labels', () => {
      expect(graphDataFromTable(headers, rows, { orient: 'rows' })).toEqual<GraphData>({
         labels: ['2025', '2026'],
         series: [
            { name: 'North', values: [10, 12] },
            { name: 'South', values: [20, 22] },
         ],
      })
   })

   it('clamps an out-of-range label column back to 0 (never throws on a reshaped table)', () => {
      expect(graphDataFromTable(headers, rows, { labelColumn: 9 })).toEqual(
         graphDataFromTable(headers, rows, { labelColumn: 0 }),
      )
   })

   it('the default options argument is identical to omitting it (stage-1 behavior preserved)', () => {
      expect(graphDataFromTable(headers, rows, { labelColumn: 0, orient: 'columns' }))
         .toEqual(graphDataFromTable(headers, rows))
   })
})

describe('graphTableData, collectTableSources', () => {
   it('catalogs handled table blocks, including inside containers, first-wins on a duplicate handle', () => {
      const blocks: Block[] = [
         tableBlock('sales', ['', 'V'], [['A', '1']]),
         { id: 'no-handle', type: 'table', richHeaders: [run('')], richRows: [] }, // no handle ⇒ skipped
         { id: 'para', type: 'p', richText: [{ text: 'x' }] },
         {
            id: 'container', type: 'container',
            left:  [tableBlock('inner', ['', 'W'], [['B', '2']])],
            right: [tableBlock('sales', ['', 'DUP'], [['Z', '9']])], // duplicate handle ⇒ ignored (first wins)
         },
      ]
      const catalog = collectTableSources(blocks)
      expect([...catalog.keys()].sort()).toEqual(['inner', 'sales'])
      // First "sales" (top-level) wins, not the container's duplicate.
      expect(graphDataFromTable(catalog.get('sales')!.richHeaders, catalog.get('sales')!.richRows))
         .toEqual<GraphData>({ labels: ['A'], series: [{ name: 'V', values: [1] }] })
   })
})

describe('graphTableData, collectLinkableTables', () => {
   function section(id: string, blocks: Block[]): Section {
      return { id, title: id, collapsed: false, blocks }
   }

   it('lists every table, handled or not, in document order', () => {
      const sections: Section[] = [
         section('sec-1', [
            tableBlock('sales', ['', 'V'], [['A', '1'], ['B', '2']]),
            { id: 'no-handle', type: 'table', richHeaders: [run(''), run('W')], richRows: [[run('X'), run('9')]] },
            { id: 'para', type: 'p', richText: [{ text: 'x' }] },
         ]),
      ]
      const linkable = collectLinkableTables(sections)
      expect(linkable).toEqual<ReturnType<typeof collectLinkableTables>>([
         {
            sectionId: 'sec-1', blockId: 'table-sales', container: undefined,
            handle: 'sales', headerPreview: ['', 'V'], columnCount: 2, rowCount: 2,
         },
         {
            sectionId: 'sec-1', blockId: 'no-handle', container: undefined,
            handle: undefined, headerPreview: ['', 'W'], columnCount: 2, rowCount: 1,
         },
      ])
   })

   it('tags a container-nested table with its container address (blockId + side)', () => {
      const sections: Section[] = [
         section('sec-1', [
            {
               id: 'container', type: 'container',
               left:  [tableBlock('inner-left',  ['', 'A'], [])],
               right: [{ id: 'inner-right', type: 'table', richHeaders: [run('')], richRows: [] }],
            },
         ]),
      ]
      const linkable = collectLinkableTables(sections)
      expect(linkable).toEqual([
         {
            sectionId: 'sec-1', blockId: 'table-inner-left',
            container: { blockId: 'container', side: 'left' },
            handle: 'inner-left', headerPreview: ['', 'A'], columnCount: 2, rowCount: 0,
         },
         {
            sectionId: 'sec-1', blockId: 'inner-right',
            container: { blockId: 'container', side: 'right' },
            handle: undefined, headerPreview: [''], columnCount: 1, rowCount: 0,
         },
      ])
   })

   it('returns an empty list for a document with no tables', () => {
      const sections: Section[] = [section('sec-1', [{ id: 'para', type: 'p', richText: [{ text: 'x' }] }])]
      expect(collectLinkableTables(sections)).toEqual([])
   })
})

describe('graphTableData, resolveGraphSpec (live link resolution)', () => {
   const linkedSpec: GraphSpec = {
      type: 'bar',
      // The materialized snapshot (stale on purpose, the live table below has fresher numbers).
      data: { labels: ['A'], series: [{ name: 'V', values: [0] }] },
      options: { title: 'Linked' },
      source: { handle: 'src' },
   }

   it('an unlinked spec is returned as-is, never dangling', () => {
      const spec: GraphSpec = { type: 'bar', data: { labels: ['A'], series: [] }, options: {} }
      const result = resolveGraphSpec(spec, new Map())
      expect(result.dangling).toBe(false)
      expect(result.renderSpec).toBe(spec) // identity: no copy when there is nothing to resolve
   })

   it('a found source remaps data from the table and strips the link', () => {
      const catalog: GraphTableCatalog = collectTableSources([
         tableBlock('src', ['', 'V'], [['A', '11'], ['B', '22']]),
      ])
      const { renderSpec, dangling } = resolveGraphSpec(linkedSpec, catalog)
      expect(dangling).toBe(false)
      expect(renderSpec.source).toBeUndefined()               // the pure renderer never sees the link
      expect(renderSpec.options).toEqual({ title: 'Linked' }) // presentation preserved
      expect(renderSpec.data).toEqual<GraphData>({
         labels: ['A', 'B'],
         series: [{ name: 'V', values: [11, 22] }],
      })
   })

   it('honors the mapping options (labelColumn / orient) when resolving', () => {
      const catalog: GraphTableCatalog = collectTableSources([
         tableBlock('src', ['Region', '2025', '2026'], [['North', '10', '12'], ['South', '20', '22']]),
      ])
      const spec: GraphSpec = { ...linkedSpec, source: { handle: 'src', orient: 'rows' } }
      const { renderSpec } = resolveGraphSpec(spec, catalog)
      expect(renderSpec.data).toEqual<GraphData>({
         labels: ['2025', '2026'],
         series: [
            { name: 'North', values: [10, 12] },
            { name: 'South', values: [20, 22] },
         ],
      })
   })

   it('a dangling source (handle not found) falls back to the materialized snapshot, flagged dangling', () => {
      const { renderSpec, dangling } = resolveGraphSpec(linkedSpec, new Map())
      expect(dangling).toBe(true)
      expect(renderSpec.source).toBeUndefined()          // link stripped even when dangling
      expect(renderSpec.data).toEqual(linkedSpec.data)   // last-known snapshot, not blank
   })
})

describe('graphTableData, graphDataEquals (write-back identity guard)', () => {
   const base: GraphData = { labels: ['A', 'B'], series: [{ name: 'V', values: [1, 2] }] }

   it('is true for structurally equal data and false when a value differs', () => {
      expect(graphDataEquals(base, { labels: ['A', 'B'], series: [{ name: 'V', values: [1, 2] }] })).toBe(true)
      expect(graphDataEquals(base, { labels: ['A', 'B'], series: [{ name: 'V', values: [1, 3] }] })).toBe(false)
   })

   it('is false against an undefined previous snapshot (no prior data)', () => {
      expect(graphDataEquals(base, undefined)).toBe(false)
   })

   it('ignores presentation-only fields (categoryColors / per-series color), comparing only labels + values', () => {
      const withColors: GraphData = {
         labels: ['A', 'B'],
         series: [{ name: 'V', values: [1, 2], color: '#123456' }],
         categoryColors: ['#abcabc', undefined],
      }
      expect(graphDataEquals(base, withColors)).toBe(true)
   })
})

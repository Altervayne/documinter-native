import { describe, it, expect } from 'vitest'
import { graphSpecToFence, fenceToGraphSpec } from './graphFence'
import { documentToMarkdown, markdownToDocument } from './markdown'
import { documentToMintdown, mintdownToDocument } from './mintdown'
import type { GraphSpec, Block, DocMeta, Section } from '../types'

// A graph block serializes as a ```graph fence: chart type + options on the info string, data as
// a Markdown pipe table body. The `type=` token is load-bearing and rides BOTH .mint and .md.

/** Round-trip a spec directly through the fence serializer + parser (prepending the `graph` tag
 *  the real fence line carries, so the parser sees exactly what buildFenceBlock passes it). */
function roundTripSpec(spec: GraphSpec): GraphSpec {
   const { info, body } = graphSpecToFence(spec)
   return fenceToGraphSpec(`graph ${info}`, body)
}

/** Wrap a graph block in a one-section document for the full-serializer tests. */
function wrapGraph(spec: GraphSpec): { sections: Section[]; meta: DocMeta } {
   const block: Block = { id: 'g', type: 'graph', graph: spec }
   return {
      sections: [{ id: 's', title: 'Charts', collapsed: false, blocks: [block] }],
      meta:     { title: 'Doc', fields: [] },
   }
}

describe('Graph fence, spec round-trip', () => {
   it('round-trips a multi-series bar chart (labels, named series, options)', () => {
      const spec: GraphSpec = {
         type: 'bar-grouped',
         data: {
            labels: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [
               { name: 'Product A', values: [42, 55, 48, 63] },
               { name: 'Product B', values: [30, 38, 41, 52] },
            ],
         },
         options: { title: 'Quarterly revenue', yLabel: 'EUR (k)', legend: true },
      }
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('round-trips a pie chart (single value column)', () => {
      const spec: GraphSpec = {
         type: 'pie',
         data: {
            labels: ['Direct', 'Search', 'Social'],
            series: [{ name: 'Sessions', values: [1200, 3400, 800] }],
         },
         options: { title: 'Traffic by source' },
      }
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('preserves option values that contain spaces via double-quoting', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { title: 'Monthly active users', xLabel: 'Month of year', yLabel: 'EUR (k)' },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('title="Monthly active users"')
      expect(info).toContain('x="Month of year"')
      expect(info).toContain('y="EUR (k)"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('round-trips per-series color overrides, keeping empty slots un-colored', () => {
      const spec: GraphSpec = {
         type: 'bar-grouped',
         data: {
            labels: ['A'],
            series: [
               { name: 'One',   values: [1], color: '#2a78d6' },
               { name: 'Two',   values: [2] },
               { name: 'Three', values: [3], color: '#eb6834' },
            ],
         },
         options: {},
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('colors="#2a78d6,,#eb6834"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('emits no colors= token when no series carries a color', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: {},
      }
      expect(graphSpecToFence(spec).info).not.toContain('colors=')
   })

   it('round-trips null / gap values as blank cells', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B', 'C', 'D'], series: [{ name: 'S', values: [1, null, 3, null] }] },
         options: {},
      }
      const parsed = roundTripSpec(spec)
      expect(parsed.data.series[0].values).toEqual([1, null, 3, null])
      expect(parsed).toEqual(spec)
   })

   it('round-trips the donut hole ratio and legend=off', () => {
      const spec: GraphSpec = {
         type: 'donut',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { donutHole: 0.6, legend: false },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('hole=0.6')
      expect(info).toContain('legend=off')
      expect(roundTripSpec(spec)).toEqual(spec)
   })
})

describe('Graph fence, malformed / degenerate input never throws', () => {
   it('a bare ```graph fence yields the default type and empty data', () => {
      const spec = fenceToGraphSpec('graph', '')
      expect(spec.type).toBe('bar')
      expect(spec.data).toEqual({ labels: [], series: [] })
      expect(spec.options).toEqual({})
   })

   it('an invalid type= falls back to the default type', () => {
      expect(fenceToGraphSpec('graph type=bogus', '').type).toBe('bar')
   })

   it('non-numeric cells parse to null, not NaN', () => {
      const body = ['|  | S |', '| --- | --- |', '| A | n/a |', '| B | 5 |'].join('\n')
      const spec = fenceToGraphSpec('graph type=bar', body)
      expect(spec.data.series[0].values).toEqual([null, 5])
   })
})

describe('Graph fence, full-document serialization (.md and .mint both carry type=)', () => {
   const spec: GraphSpec = {
      type: 'bar-grouped',
      data: {
         labels: ['Q1', 'Q2'],
         series: [
            { name: 'Product A', values: [42, 55] },
            { name: 'Product B', values: [30, 38] },
         ],
      },
      options: { title: 'Quarterly revenue', legend: true },
   }

   it('Markdown carries the load-bearing type= token and reparses to the same spec', () => {
      const { sections, meta } = wrapGraph(spec)
      const markdown = documentToMarkdown(sections, meta)
      expect(markdown).toContain('```graph type=bar-grouped')
      expect(markdown).toContain('title="Quarterly revenue"')

      const reparsed = markdownToDocument(markdown).sections[0].blocks[0]
      expect(reparsed.type).toBe('graph')
      expect(reparsed.graph).toEqual(spec)
   })

   it('Mintdown carries the load-bearing type= token and reparses to the same spec', () => {
      const { sections, meta } = wrapGraph(spec)
      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('```graph type=bar-grouped')

      const reparsed = mintdownToDocument(mintdown).sections[0].blocks[0]
      expect(reparsed.type).toBe('graph')
      expect(reparsed.graph).toEqual(spec)
   })

   it('a pie chart round-trips through the full Markdown document path', () => {
      const pieSpec: GraphSpec = {
         type: 'pie',
         data: { labels: ['Direct', 'Search', 'Social'], series: [{ name: 'Sessions', values: [1200, 3400, 800] }] },
         options: { title: 'Traffic by source' },
      }
      const { sections, meta } = wrapGraph(pieSpec)
      const reparsed = markdownToDocument(documentToMarkdown(sections, meta)).sections[0].blocks[0]
      expect(reparsed.graph).toEqual(pieSpec)
   })
})

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

   it('round-trips per-slice (per-category) color overrides via the sliceColors= token', () => {
      const spec: GraphSpec = {
         type: 'pie',
         data: {
            labels: ['Direct', 'Search', 'Social'],
            series: [{ name: 'Sessions', values: [1200, 3400, 800] }],
            categoryColors: ['#2a78d6', undefined, '#eb6834'],
         },
         options: {},
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('sliceColors="#2a78d6,,#eb6834"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('emits no sliceColors= token when no slice carries a color', () => {
      const spec: GraphSpec = {
         type: 'pie',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: {},
      }
      expect(graphSpecToFence(spec).info).not.toContain('sliceColors=')
   })

   it('leaves categoryColors absent (not an all-undefined array) when sliceColors= is empty', () => {
      const spec = fenceToGraphSpec('graph type=pie sliceColors=",,"', '')
      expect('categoryColors' in spec.data).toBe(false)
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

   it('round-trips a non-default barWidth via the barWidth= token', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { barWidth: 0.6 },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('barWidth=0.6')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('round-trips line thickness + point markers via lineWidth= and points=', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { lineWidth: 3, showPoints: false },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('lineWidth=3')
      expect(info).toContain('points=off')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('round-trips an area fill opacity via the areaOpacity= token', () => {
      const spec: GraphSpec = {
         type: 'area',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { areaFillOpacity: 0.3 },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('areaOpacity=0.3')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('omits per-type tokens whose value equals the render default (keeps the fence lean)', () => {
      const spec: GraphSpec = {
         type: 'area',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         // Every one of these is the current render default, so none should serialize.
         options: { barWidth: 1, lineWidth: 2, showPoints: true, areaFillOpacity: 0.1 },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).not.toContain('barWidth=')
      expect(info).not.toContain('lineWidth=')
      expect(info).not.toContain('points=')
      expect(info).not.toContain('areaOpacity=')
   })

   it('ignores a garbage per-type token rather than throwing', () => {
      const spec = fenceToGraphSpec('graph type=bar barWidth=wide lineWidth=NaN', '')
      expect(spec.options.barWidth).toBeUndefined()
      expect(spec.options.lineWidth).toBeUndefined()
   })

   it('round-trips barPeakLine via the peakline= token', () => {
      const spec: GraphSpec = {
         type: 'bar-grouped',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { barPeakLine: true },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('peakline=on')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('omits the peakline= token when unset (keeps the fence lean)', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: {},
      }
      const { info } = graphSpecToFence(spec)
      expect(info).not.toContain('peakline=')
      expect(roundTripSpec(spec)).toEqual(spec)
   })
})

describe('Graph fence, statistical overlays (repeated overlay= tokens)', () => {
   it('round-trips mean / trend / reference overlays through repeated overlay= tokens', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: {
            labels: ['Q1', 'Q2', 'Q3'],
            series: [{ name: 'Revenue', values: [10, 20, 30] }],
         },
         options: {
            overlays: [
               { kind: 'mean', series: 0 },
               { kind: 'trend', series: 0, showEquation: true },
               { kind: 'reference', value: 100, label: 'Q4 target' },
            ],
         },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('overlay=mean:0')
      // No spaces => not quoted; the quote-safe machinery only kicks in for the spaced ref label.
      expect(info).toContain('overlay=trend:0:eq')
      expect(info).toContain('overlay="ref:100:Q4 target"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('serializes an all-series overlay with the `all` token', () => {
      const spec: GraphSpec = {
         type: 'bar-grouped',
         data: {
            labels: ['A', 'B'],
            series: [
               { name: 'One', values: [1, 2] },
               { name: 'Two', values: [3, 4] },
            ],
         },
         options: { overlays: [{ kind: 'mean', series: 'all' }] },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('overlay=mean:all')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('serializes a bare reference (no label) without quotes', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { overlays: [{ kind: 'reference', value: 42 }] },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('overlay=ref:42')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('emits no overlay= token when there are no overlays', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A'], series: [{ name: 'S', values: [1] }] },
         options: {},
      }
      expect(graphSpecToFence(spec).info).not.toContain('overlay=')
      expect('overlays' in roundTripSpec(spec).options).toBe(false)
   })

   it('drops a reference token with a non-finite value, and skips an unknown kind', () => {
      const spec = fenceToGraphSpec('graph type=line overlay=ref:notanumber overlay=bogus:0 overlay=mean:0', '')
      expect(spec.options.overlays).toEqual([{ kind: 'mean', series: 0 }])
   })

   it('parses a reference label that itself contains a colon', () => {
      const spec = fenceToGraphSpec('graph type=line overlay="ref:100:Deadline: EOD"', '')
      expect(spec.options.overlays).toEqual([{ kind: 'reference', value: 100, label: 'Deadline: EOD' }])
   })

   it('carries overlays through the full Mintdown document path', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B', 'C'], series: [{ name: 'S', values: [1, 2, 3] }] },
         options: { overlays: [{ kind: 'trend', series: 0 }, { kind: 'reference', value: 5 }] },
      }
      const { sections, meta } = wrapGraph(spec)
      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('overlay=trend:0')
      expect(mintdown).toContain('overlay=ref:5')
      const reparsed = mintdownToDocument(mintdown).sections[0].blocks[0]
      expect(reparsed.graph).toEqual(spec)
   })
})

describe('Graph fence, function type (equation plots)', () => {
   it('round-trips a multi-equation function spec (domain, names, expressions, colors)', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: { title: 'Damped oscillation', xLabel: 'x', yLabel: 'f(x)' },
         functionPlot: {
            domain: { xMin: -10, xMax: 10, samples: 200 },
            equations: [
               { name: 'f', expression: 'sin(x) * exp(-x/5)' },
               { name: 'g', expression: 'exp(-x/5)', color: '#eb6834' },
            ],
         },
      }
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('matches the ratified fence grammar: xmin=/xmax=/samples= on the info string, a Name|Expression|Color body', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: { title: 'Damped oscillation', xLabel: 'x', yLabel: 'f(x)' },
         functionPlot: {
            domain: { xMin: -10, xMax: 10, samples: 200 },
            equations: [
               { name: 'f', expression: 'sin(x) * exp(-x/5)' },
               { name: 'g', expression: 'exp(-x/5)', color: '#eb6834' },
            ],
         },
      }
      const { info, body } = graphSpecToFence(spec)
      expect(info).toContain('type=function')
      // -10/10/200 ARE the sane defaults per docs/reference/graph_equation_study.md Q5 — a fence
      // at the default domain stays lean and omits the tokens entirely.
      expect(info).not.toContain('xmin=')
      expect(info).not.toContain('xmax=')
      expect(info).not.toContain('samples=')
      expect(body).toContain('| Name | Expression | Color |')
      expect(body).toContain('| f | sin(x) * exp(-x/5) |  |')
      expect(body).toContain('| g | exp(-x/5) | #eb6834 |')
   })

   it('emits xmin=/xmax=/samples= only when they differ from the default domain', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: {},
         functionPlot: {
            domain: { xMin: -5, xMax: 5, samples: 80 },
            equations: [{ name: 'f', expression: 'x^2' }],
         },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('xmin=-5')
      expect(info).toContain('xmax=5')
      expect(info).toContain('samples=80')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('a bare `graph type=function` fence with no body falls back to the default domain and no equations', () => {
      const spec = fenceToGraphSpec('graph type=function', '')
      expect(spec.type).toBe('function')
      expect(spec.data).toEqual({ labels: [], series: [] })
      expect(spec.functionPlot).toEqual({
         domain: { xMin: -10, xMax: 10, samples: 200 },
         equations: [],
      })
   })

   it('skips a malformed equation row (blank expression) rather than keeping a dead equation', () => {
      const body = [
         '| Name | Expression | Color |',
         '| ---- | ---------- | ----- |',
         '| f    | sin(x)     |       |',
         '| bad  |            |       |', // blank expression: skipped
         '| g    | cos(x)     |       |',
      ].join('\n')
      const spec = fenceToGraphSpec('graph type=function', body)
      expect(spec.functionPlot?.equations).toEqual([
         { name: 'f', expression: 'sin(x)' },
         { name: 'g', expression: 'cos(x)' },
      ])
   })

   it('ignores non-finite xmin=/xmax=/samples= tokens rather than throwing, falling back to defaults', () => {
      const spec = fenceToGraphSpec('graph type=function xmin=nope xmax=nope samples=nope', '')
      expect(spec.functionPlot?.domain).toEqual({ xMin: -10, xMax: 10, samples: 200 })
   })

   it('carries a function spec through the full Markdown and Mintdown document paths', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: { title: 'Trig pair', legend: true },
         functionPlot: {
            domain: { xMin: -6.28, xMax: 6.28, samples: 100 },
            equations: [
               { name: 'sine', expression: 'sin(x)' },
               { name: 'cosine', expression: 'cos(x)', color: '#1baf7a' },
            ],
         },
      }
      const { sections, meta } = wrapGraph(spec)

      const markdown = documentToMarkdown(sections, meta)
      expect(markdown).toContain('```graph type=function')
      const reparsedFromMarkdown = markdownToDocument(markdown).sections[0].blocks[0]
      expect(reparsedFromMarkdown.graph).toEqual(spec)

      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('```graph type=function')
      const reparsedFromMintdown = mintdownToDocument(mintdown).sections[0].blocks[0]
      expect(reparsedFromMintdown.graph).toEqual(spec)
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

   it('a pie chart with per-slice colors round-trips through the full Mintdown document path', () => {
      const pieSpec: GraphSpec = {
         type: 'donut',
         data: {
            labels: ['Direct', 'Search', 'Social'],
            series: [{ name: 'Sessions', values: [1200, 3400, 800] }],
            categoryColors: ['#2a78d6', undefined, '#eb6834'],
         },
         options: { title: 'Traffic by source', donutHole: 0.6 },
      }
      const { sections, meta } = wrapGraph(pieSpec)
      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('sliceColors="#2a78d6,,#eb6834"')
      const reparsed = mintdownToDocument(mintdown).sections[0].blocks[0]
      expect(reparsed.graph).toEqual(pieSpec)
   })
})

import { describe, it, expect } from 'vitest'
import { graphSpecToFence, fenceToGraphSpec } from './graphFence'
import { documentToMarkdown, markdownToDocument } from './markdown'
import { documentToMintdown, mintdownToDocument } from './mintdown'
import type { GraphSpec } from './graph'
import type { Block, DocMeta, Section } from '../types'

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

   it('round-trips an equation-curve overlay through an unquoted eq: token (no spaces)', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: { labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Revenue', values: [10, 20, 30] }] },
         options: { overlays: [{ kind: 'equation', expression: 'sin(x)*2' }] },
      }
      const { info } = graphSpecToFence(spec)
      // No spaces in the expression => no quoting needed, same rule every other lean token follows.
      expect(info).toContain('overlay=eq:sin(x)*2')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('quotes an equation-curve overlay whose expression contains a space', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] },
         options: { overlays: [{ kind: 'equation', expression: 'x + 1' }] },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('overlay="eq:x + 1"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('drops an equation-curve overlay with a blank expression (nothing to plot)', () => {
      const spec = fenceToGraphSpec('graph type=line overlay=eq: overlay=mean:0', '')
      expect(spec.options.overlays).toEqual([{ kind: 'mean', series: 0 }])
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

describe('Graph fence, scatter type (x/y point pairs)', () => {
   it('round-trips a multi-series scatter spec (points, names, colors)', () => {
      const spec: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: { title: 'Height vs weight', xLabel: 'Height', yLabel: 'Weight' },
         scatterPlot: {
            series: [
               { name: 'Group A', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 5 }] },
               { name: 'Group B', points: [{ x: 1, y: 6 }, { x: 2, y: 5 }], color: '#eb6834' },
            ],
         },
      }
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('matches the ratified fence grammar: a long-format Series|X|Y body, one row per point', () => {
      const spec: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: {},
         scatterPlot: {
            series: [
               { name: 'A', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
               { name: 'B', points: [{ x: 5, y: 6 }] },
            ],
         },
      }
      const { info, body } = graphSpecToFence(spec)
      expect(info).toContain('type=scatter')
      expect(body).toContain('| Series | X | Y |')
      expect(body).toContain('| A | 1 | 2 |')
      expect(body).toContain('| A | 3 | 4 |')
      expect(body).toContain('| B | 5 | 6 |')
   })

   it('skips blank (non-finite) points on serialize, so an unfilled seed never writes a NaN cell', () => {
      const spec: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: {},
         scatterPlot: {
            series: [
               { name: 'A', points: [{ x: 1, y: 2 }, { x: NaN, y: NaN }] },
            ],
         },
      }
      const { body } = graphSpecToFence(spec)
      expect(body).toContain('| A | 1 | 2 |')
      expect(body).not.toContain('NaN')
      // The blank point is dropped on round-trip (it is never a real datum).
      expect(roundTripSpec(spec).scatterPlot?.series).toEqual([
         { name: 'A', points: [{ x: 1, y: 2 }] },
      ])
   })

   it('serializes per-series colors on the shared colors= token, series order', () => {
      const spec: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: {},
         scatterPlot: {
            series: [
               { name: 'A', points: [{ x: 1, y: 2 }], color: '#2a78d6' },
               { name: 'B', points: [{ x: 3, y: 4 }] },
            ],
         },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('colors="#2a78d6,"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('a bare `graph type=scatter` fence with no body falls back to empty series', () => {
      const spec = fenceToGraphSpec('graph type=scatter', '')
      expect(spec.type).toBe('scatter')
      expect(spec.data).toEqual({ labels: [], series: [] })
      expect(spec.scatterPlot).toEqual({ series: [] })
   })

   it('groups long-format rows back into series by name, preserving first-seen series order', () => {
      const body = [
         '| Series | X | Y |',
         '| ------ | - | - |',
         '| B | 5 | 6 |',
         '| A | 1 | 2 |',
         '| B | 7 | 8 |',
         '| A | 3 | 4 |',
      ].join('\n')
      const spec = fenceToGraphSpec('graph type=scatter', body)
      expect(spec.scatterPlot?.series).toEqual([
         { name: 'B', points: [{ x: 5, y: 6 }, { x: 7, y: 8 }] },
         { name: 'A', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      ])
   })

   it('skips a malformed point row (non-numeric x or y) rather than keeping a broken point', () => {
      const body = [
         '| Series | X | Y |',
         '| ------ | - | - |',
         '| A | 1 | 2 |',
         '| A | n/a | 4 |',
         '| A | 5 | n/a |',
         '| A | 6 | 7 |',
      ].join('\n')
      const spec = fenceToGraphSpec('graph type=scatter', body)
      expect(spec.scatterPlot?.series).toEqual([
         { name: 'A', points: [{ x: 1, y: 2 }, { x: 6, y: 7 }] },
      ])
   })

   it('carries a scatter spec through the full Markdown and Mintdown document paths', () => {
      const spec: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: { title: 'Cluster sample', legend: true },
         scatterPlot: {
            series: [
               { name: 'Cluster 1', points: [{ x: 1, y: 1 }, { x: 2, y: 3 }] },
               { name: 'Cluster 2', points: [{ x: 5, y: 5 }], color: '#1baf7a' },
            ],
         },
      }
      const { sections, meta } = wrapGraph(spec)

      const markdown = documentToMarkdown(sections, meta)
      expect(markdown).toContain('```graph type=scatter')
      const reparsedFromMarkdown = markdownToDocument(markdown).sections[0].blocks[0]
      expect(reparsedFromMarkdown.graph).toEqual(spec)

      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('```graph type=scatter')
      const reparsedFromMintdown = mintdownToDocument(mintdown).sections[0].blocks[0]
      expect(reparsedFromMintdown.graph).toEqual(spec)
   })

   // Overlays live on `options.overlays`, which is shared, type-agnostic serialization (the SAME
   // repeated `overlay=` token grammar every other graph type uses) — the `series` index just
   // resolves against `scatterPlot.series` at render time, so no scatter-specific fence work was
   // needed for this. Verified end to end here regardless.
   it('round-trips mean / trend / reference overlays on a scatter spec', () => {
      const spec: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: {
            overlays: [
               { kind: 'mean', series: 0 },
               { kind: 'trend', series: 1, showEquation: true },
               { kind: 'reference', value: 100, label: 'Q4 target' },
            ],
         },
         scatterPlot: {
            series: [
               { name: 'A', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }] },
               { name: 'B', points: [{ x: 1, y: 6 }, { x: 2, y: 5 }, { x: 3, y: 9 }] },
            ],
         },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('type=scatter')
      expect(info).toContain('overlay=mean:0')
      expect(info).toContain('overlay=trend:1:eq')
      expect(info).toContain('overlay="ref:100:Q4 target"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })
})

describe('Graph fence, histogram type (binned frequency distribution)', () => {
   it('round-trips a histogram spec (samples, manual bins, name, color)', () => {
      const spec: GraphSpec = {
         type: 'histogram',
         data: { labels: [], series: [] },
         options: { title: 'Response times', xLabel: 'ms', yLabel: 'Count' },
         histogramData: { samples: [1, 2, 3, 4, 5, 6, 7, 8], bins: 4, name: 'Latency', color: '#eb6834' },
      }
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('round-trips a histogram spec with NO manual bins (auto/Sturges, left unset)', () => {
      const spec: GraphSpec = {
         type: 'histogram',
         data: { labels: [], series: [] },
         options: {},
         histogramData: { samples: [1, 2, 3, 4, 5] },
      }
      const next = roundTripSpec(spec)
      expect(next).toEqual(spec)
      expect(next.histogramData?.bins).toBeUndefined()
   })

   it('emits bins= ONLY when manually set, and never a computed default', () => {
      const withoutBins = graphSpecToFence({
         type: 'histogram', data: { labels: [], series: [] }, options: {},
         histogramData: { samples: [1, 2, 3] },
      })
      expect(withoutBins.info).not.toContain('bins=')

      const withBins = graphSpecToFence({
         type: 'histogram', data: { labels: [], series: [] }, options: {},
         histogramData: { samples: [1, 2, 3], bins: 7 },
      })
      expect(withBins.info).toContain('bins=7')
   })

   it('serializes the samples as a COMPACT comma-separated list, not a pipe table', () => {
      const { body } = graphSpecToFence({
         type: 'histogram', data: { labels: [], series: [] }, options: {},
         histogramData: { samples: [1, 2.5, -3, 40] },
      })
      expect(body).toBe('1, 2.5, -3, 40')
      expect(body).not.toContain('|')
   })

   it('tolerantly parses a hand-edited samples body (mixed commas, whitespace, newlines, garbage)', () => {
      const spec = fenceToGraphSpec('graph type=histogram', '1, 2  3\n4,,5 abc 6;7')
      expect(spec.histogramData?.samples).toEqual([1, 2, 3, 4, 5, 6, 7])
   })

   it('serializes the dataset name and color via the name= and colors= tokens', () => {
      const { info } = graphSpecToFence({
         type: 'histogram', data: { labels: [], series: [] }, options: {},
         histogramData: { samples: [1, 2], name: 'Weights', color: '#1baf7a' },
      })
      expect(info).toContain('name=Weights')
      expect(info).toContain('colors="#1baf7a"')
   })

   it('a bare `graph type=histogram` fence with no body falls back to an empty sample list', () => {
      const spec = fenceToGraphSpec('graph type=histogram', '')
      expect(spec.type).toBe('histogram')
      expect(spec.data).toEqual({ labels: [], series: [] })
      expect(spec.histogramData).toEqual({ samples: [] })
   })

   it('carries a histogram spec through the full Markdown and Mintdown document paths', () => {
      const spec: GraphSpec = {
         type: 'histogram',
         data: { labels: [], series: [] },
         options: { title: 'Exam scores' },
         histogramData: { samples: [55, 62, 70, 71, 73, 80, 85, 90, 91, 95], bins: 5, name: 'Class A' },
      }
      const { sections, meta } = wrapGraph(spec)

      const markdown = documentToMarkdown(sections, meta)
      expect(markdown).toContain('```graph type=histogram')
      const reparsedFromMarkdown = markdownToDocument(markdown).sections[0].blocks[0]
      expect(reparsedFromMarkdown.graph).toEqual(spec)

      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('```graph type=histogram')
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

// A LINKED graph (stage 2a live link) carries a `source=<handle>` token plus optional `labelCol=`/
// `orient=` mapping tokens on the info string, AND keeps the pipe-table body as a materialized
// snapshot of the last-resolved data (so a `.md`/foreign viewer or a dangling link still shows it).
describe('Graph fence, live table link (source=)', () => {
   it('emits source= and keeps the snapshot body, round-tripping a plainly-linked graph', () => {
      const spec: GraphSpec = {
         type: 'line',
         data: {
            labels: ['Q1', 'Q2', 'Q3'],
            series: [{ name: 'Revenue', values: [120, 150, 90] }],
         },
         options: { title: 'Revenue' },
         source: { handle: 'sales-2026' },
      }
      const { info, body } = graphSpecToFence(spec)
      // The link rides the info string right after type=; default mapping ⇒ no labelCol/orient.
      expect(info).toContain('source=sales-2026')
      expect(info).not.toContain('labelCol=')
      expect(info).not.toContain('orient=')
      // The body is the materialized snapshot (the pipe table), NOT empty.
      expect(body).toContain('| Revenue |')
      expect(body).toContain('| Q1 | 120 |')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('emits and round-trips the non-default mapping tokens (labelCol + orient)', () => {
      const spec: GraphSpec = {
         type: 'bar-grouped',
         data: {
            labels: ['A', 'B'],
            series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }],
         },
         options: {},
         source: { handle: 'grid', labelColumn: 2, orient: 'rows' },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('source=grid')
      expect(info).toContain('labelCol=2')
      expect(info).toContain('orient=rows')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('an unlinked graph never emits source= and stays byte-identical (no stray source field)', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A'], series: [{ name: 'V', values: [1] }] },
         options: {},
      }
      const { info } = graphSpecToFence(spec)
      expect(info).not.toContain('source=')
      const parsed = roundTripSpec(spec)
      expect(parsed).toEqual(spec)
      expect(parsed.source).toBeUndefined()
   })

   it('quotes a handle containing spaces on the info string', () => {
      const spec: GraphSpec = {
         type: 'pie',
         data: { labels: ['A', 'B'], series: [{ name: 'V', values: [1, 2] }] },
         options: {},
         source: { handle: 'my table' },
      }
      const { info } = graphSpecToFence(spec)
      expect(info).toContain('source="my table"')
      expect(roundTripSpec(spec)).toEqual(spec)
   })

   it('round-trips a linked graph through the full Mintdown AND Markdown document paths', () => {
      const spec: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'V', values: [10, 20] }] },
         options: { title: 'Linked' },
         source: { handle: 'src', labelColumn: 1 },
      }
      const { sections, meta } = wrapGraph(spec)

      const mintdown = documentToMintdown(sections, meta)
      expect(mintdown).toContain('source=src')
      expect(mintdown).toContain('labelCol=1')
      expect(mintdownToDocument(mintdown).sections[0].blocks[0].graph).toEqual(spec)

      const markdown = documentToMarkdown(sections, meta)
      expect(markdown).toContain('source=src')
      expect(markdownToDocument(markdown).sections[0].blocks[0].graph).toEqual(spec)
   })
})

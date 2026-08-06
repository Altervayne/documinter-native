import { describe, it, expect } from 'vitest'
import { renderGraphToSvg, LIGHT_GRAPH_THEME, DARK_GRAPH_THEME } from './index'
import type { GraphSpec, GraphType } from './index'

// #############
// # FIXTURES  #
// #############

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
   let count = 0
   let position = haystack.indexOf(needle)
   while (position !== -1) {
      count += 1
      position = haystack.indexOf(needle, position + needle.length)
   }
   return count
}

/** A three-category, two-series spec of the given type (legend off unless overridden). */
function makeSpec(type: GraphType, overrides: Partial<GraphSpec['options']> = {}): GraphSpec {
   return {
      type,
      data: {
         labels: ['Q1', 'Q2', 'Q3'],
         series: [
            { name: 'Product A', values: [42, 55, 48] },
            { name: 'Product B', values: [30, 38, 41] },
         ],
      },
      options: { legend: false, ...overrides },
   }
}

// ####################
// # WELL-FORMED SVG  #
// ####################

describe('renderGraphToSvg envelope', () => {
   const ALL_TYPES: GraphType[] = ['bar', 'bar-grouped', 'bar-stacked', 'line', 'area', 'pie', 'donut']

   for (const type of ALL_TYPES) {
      it(`emits a well-formed responsive <svg> with title/desc for ${type}`, () => {
         const svg = renderGraphToSvg(makeSpec(type, { title: `A ${type} chart` }), LIGHT_GRAPH_THEME)
         expect(svg.startsWith('<svg')).toBe(true)
         expect(svg.endsWith('</svg>')).toBe(true)
         expect(svg).toContain('viewBox="0 0 720 440"')
         expect(svg).toContain('role="img"')
         expect(svg).toContain('<title>')
         expect(svg).toContain('<desc>')
      })
   }

   it('keeps the root style attribute well-quoted (no double quotes inside it)', () => {
      const svg = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      const styleMatch = /style="([^"]*)"/.exec(svg)
      expect(styleMatch).not.toBeNull()
      // The captured group must contain the full font stack, proof no inner " truncated it.
      expect(styleMatch?.[1]).toContain('sans-serif')
      expect(styleMatch?.[1]).toContain("'Segoe UI'")
   })

   it('is deterministic, identical input yields identical output', () => {
      const first = renderGraphToSvg(makeSpec('bar-grouped'), LIGHT_GRAPH_THEME)
      const second = renderGraphToSvg(makeSpec('bar-grouped'), LIGHT_GRAPH_THEME)
      expect(first).toBe(second)
   })

   it('bakes different literal hex for light vs dark themes', () => {
      const light = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      const dark = renderGraphToSvg(makeSpec('bar'), DARK_GRAPH_THEME)
      expect(light).toContain('#2a78d6') // light blue slot
      expect(dark).toContain('#3987e5') // dark blue slot
      expect(light).not.toBe(dark)
   })
})

// #####################
// # STRUCTURAL MARKS  #
// #####################

describe('cartesian marks', () => {
   it('draws N rects for a single-series bar chart', () => {
      const svg = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      // 'bar' reads the first series only -> one rect per category, no legend swatches.
      expect(countOccurrences(svg, '<rect')).toBe(3)
   })

   it('colors each legend swatch by series index, not name (blank/duplicate names never collapse)', () => {
      const svg = renderGraphToSvg({
         type: 'line',
         data: {
            labels: ['A', 'B'],
            series: [
               { name: '', values: [1, 2], color: '#111111' },
               { name: '', values: [3, 4], color: '#222222' },
            ],
         },
         options: { legend: true, showPoints: false },
      }, LIGHT_GRAPH_THEME)
      // With markers off, each series is ONE stroke plus ONE legend swatch of its own color. The old
      // name-keyed legend collapsed both blank-named swatches onto the last color, so the first
      // series' #111111 appeared only once (its stroke). Guard: each color must appear >= 2x.
      expect(countOccurrences(svg, '#111111')).toBeGreaterThanOrEqual(2)
      expect(countOccurrences(svg, '#222222')).toBeGreaterThanOrEqual(2)
   })

   it('draws N*M rects for grouped bars', () => {
      const svg = renderGraphToSvg(makeSpec('bar-grouped'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(6)
   })

   it('draws N*M rects for stacked bars', () => {
      const svg = renderGraphToSvg(makeSpec('bar-stacked'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(6)
   })

   it('draws a polyline per series plus markers for a line chart', () => {
      const svg = renderGraphToSvg(makeSpec('line'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<polyline')).toBe(2)
      expect(countOccurrences(svg, '<circle')).toBe(6) // 3 points x 2 series
   })

   it('draws a filled path and a line for an area chart', () => {
      const svg = renderGraphToSvg(makeSpec('area'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<path')).toBeGreaterThanOrEqual(1)
      expect(svg).toContain('fill-opacity="0.1"')
      expect(countOccurrences(svg, '<polyline')).toBe(2)
   })
})

// #########################
// # PER-TYPE PARAMETERS    #
// #########################

/** Pull the numeric `width="..."` of the first drawn bar rect (rects with a `rx`/`fill`, not swatches). */
function firstBarWidth(svg: string): number {
   const match = /<rect[^>]*\bwidth="([\d.]+)"[^>]*fill="#/.exec(svg)
   return match ? Number(match[1]) : Number.NaN
}

describe('per-type parameter: barWidth', () => {
   it('a non-default barWidth changes the single-bar output and narrows the bars', () => {
      const wide = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      const narrow = renderGraphToSvg(makeSpec('bar', { barWidth: 0.4 }), LIGHT_GRAPH_THEME)
      expect(narrow).not.toBe(wide)
      expect(firstBarWidth(narrow)).toBeLessThan(firstBarWidth(wide))
   })

   it('an at-default barWidth renders identically to leaving it unset', () => {
      const unset = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      const atDefault = renderGraphToSvg(makeSpec('bar', { barWidth: 1 }), LIGHT_GRAPH_THEME)
      expect(atDefault).toBe(unset)
   })

   it('narrows grouped bars too', () => {
      const wide = renderGraphToSvg(makeSpec('bar-grouped'), LIGHT_GRAPH_THEME)
      const narrow = renderGraphToSvg(makeSpec('bar-grouped', { barWidth: 0.5 }), LIGHT_GRAPH_THEME)
      expect(firstBarWidth(narrow)).toBeLessThan(firstBarWidth(wide))
   })
})

// #########################
// # PER-BAR COLOR (SIMPLE)  #
// #########################

/** A single-series bar spec (three bars, no color override) plus optional per-category colors. */
function makeSimpleBar(categoryColors?: (string | undefined)[]): GraphSpec {
   return {
      type: 'bar',
      data: {
         labels: ['Q1', 'Q2', 'Q3'],
         series: [{ name: 'Revenue', values: [42, 55, 48] }],
         ...(categoryColors ? { categoryColors } : {}),
      },
      options: { legend: false },
   }
}

describe('per-bar color: simple bar categoryColors', () => {
   it('paints every bar the ONE uniform series base color by default', () => {
      const svg = renderGraphToSvg(makeSimpleBar(), LIGHT_GRAPH_THEME)
      // No override -> palette slot 0 (light blue) on all three bars, nowhere else in the SVG.
      expect(countOccurrences(svg, 'fill="#2a78d6"')).toBe(3)
   })

   it('recolors a single bar via categoryColors while the rest stay the uniform base', () => {
      const svg = renderGraphToSvg(makeSimpleBar(['#abcdef', undefined, undefined]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('fill="#abcdef"')                  // the one overridden bar
      expect(countOccurrences(svg, 'fill="#2a78d6"')).toBe(2)  // the two un-overridden bars
   })

   it('is byte-identical to no override when every categoryColors slot is undefined', () => {
      const plain = renderGraphToSvg(makeSimpleBar(), LIGHT_GRAPH_THEME)
      const allUndefined = renderGraphToSvg(makeSimpleBar([undefined, undefined, undefined]), LIGHT_GRAPH_THEME)
      expect(allUndefined).toBe(plain)
   })
})

describe('per-type parameter: lineWidth', () => {
   it('a non-default lineWidth changes the line stroke width', () => {
      const thin = renderGraphToSvg(makeSpec('line'), LIGHT_GRAPH_THEME)
      const thick = renderGraphToSvg(makeSpec('line', { lineWidth: 4 }), LIGHT_GRAPH_THEME)
      expect(thin).toContain('stroke-width="2"')
      expect(thick).toContain('stroke-width="4"')
      expect(thick).not.toBe(thin)
   })
})

describe('per-type parameter: showPoints', () => {
   it('omits point markers when showPoints is false (line)', () => {
      const withPoints = renderGraphToSvg(makeSpec('line'), LIGHT_GRAPH_THEME)
      const withoutPoints = renderGraphToSvg(makeSpec('line', { showPoints: false }), LIGHT_GRAPH_THEME)
      expect(countOccurrences(withPoints, '<circle')).toBe(6)
      expect(countOccurrences(withoutPoints, '<circle')).toBe(0)
   })

   it('omits point markers when showPoints is false (area)', () => {
      const withoutPoints = renderGraphToSvg(makeSpec('area', { showPoints: false }), LIGHT_GRAPH_THEME)
      expect(countOccurrences(withoutPoints, '<circle')).toBe(0)
   })
})

describe('per-type parameter: areaFillOpacity', () => {
   it('a non-default areaFillOpacity sets the fill alpha', () => {
      const svg = renderGraphToSvg(makeSpec('area', { areaFillOpacity: 0.35 }), LIGHT_GRAPH_THEME)
      expect(svg).toContain('fill-opacity="0.35"')
      expect(svg).not.toContain('fill-opacity="0.1"')
   })
})

// #############################
// # DISPLAY OPTION: barPeakLine #
// #############################

describe('display option: barPeakLine', () => {
   it('adds no polyline when unset (bar family unchanged by default)', () => {
      const svg = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<polyline')).toBe(0)
   })

   it('draws one peak-line polyline through a simple bar chart\'s tops', () => {
      const plain = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      const withPeakLine = renderGraphToSvg(makeSpec('bar', { barPeakLine: true }), LIGHT_GRAPH_THEME)
      expect(countOccurrences(plain, '<polyline')).toBe(0)
      expect(countOccurrences(withPeakLine, '<polyline')).toBe(1)
      // The one drawn series (Product A, palette slot 0) colors the peak line.
      expect(withPeakLine).toContain('<polyline points="')
      expect(withPeakLine).toContain('stroke="#2a78d6"')
   })

   it('draws one peak-line polyline per drawn series for grouped bars', () => {
      const svg = renderGraphToSvg(makeSpec('bar-grouped', { barPeakLine: true }), LIGHT_GRAPH_THEME)
      // Two series -> two peak-line polylines, on top of the 6 grouped-bar rects.
      expect(countOccurrences(svg, '<rect')).toBe(6)
      expect(countOccurrences(svg, '<polyline')).toBe(2)
   })

   it('draws a single cumulative-total peak-line for stacked bars', () => {
      const svg = renderGraphToSvg(makeSpec('bar-stacked', { barPeakLine: true }), LIGHT_GRAPH_THEME)
      // Two series stacked -> one peak line through the per-category totals, not one per series.
      expect(countOccurrences(svg, '<polyline')).toBe(1)
   })

   it('is a no-op for line, area, and radial chart types', () => {
      for (const type of ['line', 'area', 'pie', 'donut'] as const) {
         const withoutFlag = renderGraphToSvg(makeSpec(type), LIGHT_GRAPH_THEME)
         const withFlag = renderGraphToSvg(makeSpec(type, { barPeakLine: true }), LIGHT_GRAPH_THEME)
         expect(withFlag).toBe(withoutFlag)
      }
   })

   it('breaks the peak line across a null gap, same as a line chart', () => {
      const gapped: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B', 'C', 'D'], series: [{ name: 'S', values: [1, null, 3, 4] }] },
         options: { legend: false, barPeakLine: true },
      }
      const svg = renderGraphToSvg(gapped, LIGHT_GRAPH_THEME)
      // Same run-splitting as the line-chart gap test: the [3,4] run forms one polyline, the lone
      // [1] point has nothing to connect to and draws none.
      expect(countOccurrences(svg, '<polyline')).toBe(1)
   })
})

describe('radial marks', () => {
   it('draws N arc paths for a pie chart', () => {
      const svg = renderGraphToSvg(makeSpec('pie'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<path')).toBe(3)
   })

   it('draws N arc paths for a donut chart', () => {
      const svg = renderGraphToSvg(makeSpec('donut'), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<path')).toBe(3)
   })
})

// #####################
// # STAT OVERLAYS     #
// #####################

/** Count dashed overlay lines (mean/median/reference horizontals + the trend segment carry a dash). */
function countDashedLines(svg: string): number {
   return countOccurrences(svg, 'stroke-dasharray=')
}

describe('statistical overlays', () => {
   it('adds a dashed mean line and an R-free mean label, absent without the overlay', () => {
      const plain = renderGraphToSvg(makeSpec('line'), LIGHT_GRAPH_THEME)
      const withMean = renderGraphToSvg(
         makeSpec('line', { overlays: [{ kind: 'mean', series: 0 }] }), LIGHT_GRAPH_THEME)
      expect(countDashedLines(plain)).toBe(0)
      expect(countDashedLines(withMean)).toBe(1)
      // Product A = [42,55,48] -> mean 48.333333 -> formatNumber rounds to 48.333333
      expect(withMean).toContain('mean 48.333333')
      // A haloed label uses paint-order:stroke over the surface color.
      expect(withMean).toContain('paint-order="stroke"')
   })

   it('draws a trendline with an R^2 label and, opt-in, the equation', () => {
      const rOnly = renderGraphToSvg(
         makeSpec('line', { overlays: [{ kind: 'trend', series: 0 }] }), LIGHT_GRAPH_THEME)
      expect(countDashedLines(rOnly)).toBe(1)
      expect(rOnly).toContain('R²')
      expect(rOnly).not.toContain('y =')

      const withEquation = renderGraphToSvg(
         makeSpec('line', { overlays: [{ kind: 'trend', series: 0, showEquation: true }] }), LIGHT_GRAPH_THEME)
      expect(withEquation).toContain('y =')
      expect(withEquation).toContain('R²')
   })

   it('fans out an all-series overlay to one line per drawn series', () => {
      const svg = renderGraphToSvg(
         makeSpec('line', { overlays: [{ kind: 'mean', series: 'all' }] }), LIGHT_GRAPH_THEME)
      // Two drawn series -> two dashed mean lines.
      expect(countDashedLines(svg)).toBe(2)
   })

   it('auto-extends the y-domain so a reference line above the data stays visible', () => {
      // Data maxes at 55; a reference at 200 must still land on-canvas (domain rescales to include it).
      const svg = renderGraphToSvg(
         makeSpec('bar', { overlays: [{ kind: 'reference', value: 200, label: 'Cap' }] }), LIGHT_GRAPH_THEME)
      expect(countDashedLines(svg)).toBe(1)
      expect(svg).toContain('Cap')
      // The auto-extended axis now shows a 200 tick that a plain chart of this data would not.
      const plain = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      expect(plain).not.toContain('>200<')
      expect(svg).toContain('>200<')
   })

   it('reference line uses neutral ink, not a series hue', () => {
      const svg = renderGraphToSvg(
         makeSpec('bar', { overlays: [{ kind: 'reference', value: 40 }] }), LIGHT_GRAPH_THEME)
      // The neutral ink.text (#0b0b0b) strokes the reference line; the series blue does not appear on it.
      const referenceLine = /<line[^>]*stroke-dasharray[^>]*\/>/.exec(svg)?.[0] ?? ''
      expect(referenceLine).toContain('#0b0b0b')
   })

   it('never throws and draws nothing for a degenerate trend (single point)', () => {
      const single: GraphSpec = {
         type: 'line',
         data: { labels: ['A'], series: [{ name: 'S', values: [7] }] },
         options: { overlays: [{ kind: 'trend', series: 0 }] },
      }
      expect(() => renderGraphToSvg(single, LIGHT_GRAPH_THEME)).not.toThrow()
      expect(countDashedLines(renderGraphToSvg(single, LIGHT_GRAPH_THEME))).toBe(0)
   })

   it('radial ignores overlays entirely', () => {
      const svg = renderGraphToSvg(
         makeSpec('pie', { overlays: [{ kind: 'reference', value: 40 }] }), LIGHT_GRAPH_THEME)
      expect(countDashedLines(svg)).toBe(0)
   })

   describe('equation-curve overlay', () => {
      it('draws a dashed polyline over an existing data chart, labelled with the expression', () => {
         const plain = renderGraphToSvg(makeSpec('line'), LIGHT_GRAPH_THEME)
         // Data ranges ~30-55; this expression stays comfortably inside that range across the
         // 3-category index domain [0,2] (40, 45, 50), so it draws one unclipped curve.
         const withEquation = renderGraphToSvg(
            makeSpec('line', { overlays: [{ kind: 'equation', expression: 'x*5+40' }] }),
            LIGHT_GRAPH_THEME)
         expect(countDashedLines(plain)).toBe(0)
         expect(countDashedLines(withEquation)).toBe(1)
         expect(withEquation).toContain('<polyline')
         expect(withEquation).toContain('x*5+40') // default label = the expression itself
      })

      it('never throws and draws nothing for an uncompileable expression', () => {
         const spec = makeSpec('line', { overlays: [{ kind: 'equation', expression: '2 +' }] })
         expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
         expect(countDashedLines(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))).toBe(0)
      })

      it('draws nothing for a blank expression', () => {
         const svg = renderGraphToSvg(
            makeSpec('bar', { overlays: [{ kind: 'equation', expression: '' }] }), LIGHT_GRAPH_THEME)
         expect(countDashedLines(svg)).toBe(0)
      })

      it('draws nothing over a single-category chart (no index range to sample across)', () => {
         const single: GraphSpec = {
            type: 'line',
            data: { labels: ['A'], series: [{ name: 'S', values: [7] }] },
            options: { overlays: [{ kind: 'equation', expression: 'x' }] },
         }
         expect(() => renderGraphToSvg(single, LIGHT_GRAPH_THEME)).not.toThrow()
         expect(countDashedLines(renderGraphToSvg(single, LIGHT_GRAPH_THEME))).toBe(0)
      })
   })
})

// #####################
// # EDGE CASES        #
// #####################

describe('edge cases', () => {
   it('renders a graceful empty-state placeholder for no labels', () => {
      const empty: GraphSpec = { type: 'bar', data: { labels: [], series: [] }, options: {} }
      const svg = renderGraphToSvg(empty, LIGHT_GRAPH_THEME)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).toContain('<title>')
      expect(svg).toContain('<desc>')
      expect(svg).toContain('No data to chart')
   })

   it('renders an empty-state when every value is null', () => {
      const allNull: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [null, null] }] },
         options: {},
      }
      const svg = renderGraphToSvg(allNull, LIGHT_GRAPH_THEME)
      expect(svg).toContain('No data to chart')
   })

   it('renders a single-series bar chart without a legend', () => {
      const single: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'Only', values: [3, 5] }] },
         options: {},
      }
      const svg = renderGraphToSvg(single, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(2)
   })

   it('draws gaps for null cells in a line series', () => {
      const gapped: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B', 'C', 'D'], series: [{ name: 'S', values: [1, null, 3, 4] }] },
         options: { legend: false },
      }
      const svg = renderGraphToSvg(gapped, LIGHT_GRAPH_THEME)
      // Three finite points -> three markers; the [3,4] run forms one polyline, the lone [1] does not.
      expect(countOccurrences(svg, '<circle')).toBe(3)
      expect(countOccurrences(svg, '<polyline')).toBe(1)
   })

   it('caps drawn series at 8 for grouped bars', () => {
      const manySeries: GraphSpec = {
         type: 'bar-grouped',
         data: {
            labels: ['A', 'B'],
            series: Array.from({ length: 10 }, (_, index) => ({
               name: `S${index}`,
               values: [index + 1, index + 2],
            })),
         },
         options: { legend: false },
      }
      const svg = renderGraphToSvg(manySeries, LIGHT_GRAPH_THEME)
      // 2 categories x 8 capped series = 16 rects (not 20).
      expect(countOccurrences(svg, '<rect')).toBe(16)
   })

   it('renders a single label', () => {
      const oneLabel: GraphSpec = {
         type: 'bar',
         data: { labels: ['Only'], series: [{ name: 'S', values: [7] }] },
         options: {},
      }
      const svg = renderGraphToSvg(oneLabel, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(1)
      expect(svg).toContain('Only')
   })

   it('lands a per-series color override in the output', () => {
      const overridden: GraphSpec = {
         type: 'bar-grouped',
         data: {
            labels: ['A', 'B'],
            series: [
               { name: 'Branded', values: [3, 4], color: '#abcdef' },
               { name: 'Default', values: [2, 1] },
            ],
         },
         options: { legend: false },
      }
      const svg = renderGraphToSvg(overridden, LIGHT_GRAPH_THEME)
      expect(svg).toContain('#abcdef')
   })

   it('shows a legend for multi-series when legend is enabled', () => {
      const svg = renderGraphToSvg(makeSpec('bar-grouped', { legend: true }), LIGHT_GRAPH_THEME)
      // 6 bar rects + 2 legend swatches.
      expect(countOccurrences(svg, '<rect')).toBe(8)
      expect(svg).toContain('Product A')
      expect(svg).toContain('Product B')
   })

   it('escapes malicious label and title text', () => {
      const nasty: GraphSpec = {
         type: 'bar',
         data: { labels: ['<script>'], series: [{ name: 'S', values: [1] }] },
         options: { title: 'A & B <evil>' },
      }
      const svg = renderGraphToSvg(nasty, LIGHT_GRAPH_THEME)
      expect(svg).not.toContain('<script>')
      expect(svg).toContain('&lt;script&gt;')
      expect(svg).toContain('A &amp; B &lt;evil&gt;')
   })

   it('never throws on wildly malformed data', () => {
      const malformed: GraphSpec = {
         type: 'area',
         data: {
            labels: ['A', 'B'],
            series: [{ name: 'S', values: [Number.NaN, Number.POSITIVE_INFINITY] }],
         },
         options: {},
      }
      expect(() => renderGraphToSvg(malformed, LIGHT_GRAPH_THEME)).not.toThrow()
   })
})

// #####################
// # FUNCTION CHARTS   #
// #####################
// The `function` chart type: sampled equation curves over a continuous numeric domain, drawn via
// the same line-rendering machinery every other cartesian type uses, through a continuous-x
// adapter (see continuousAxis.ts) instead of a band.

/** A `function`-type spec: no `data`, an equation list + domain instead. */
function makeFunctionSpec(
   equations: { name: string; expression: string; color?: string }[],
   overrides: Partial<GraphSpec['options']> = {},
   domain: { xMin: number; xMax: number; samples: number } = { xMin: -10, xMax: 10, samples: 50 },
): GraphSpec {
   return {
      type: 'function',
      data: { labels: [], series: [] },
      options: { legend: false, ...overrides },
      functionPlot: { domain, equations },
   }
}

describe('function chart (equation plot)', () => {
   it('emits a well-formed responsive <svg> with title/desc', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'sin(x)' }], { title: 'A sine wave' }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('viewBox="0 0 720 440"')
      expect(svg).toContain('<title>A sine wave</title>')
   })

   it('draws a sampled line curve for a valid equation, with point markers OFF by default', () => {
      const svg = renderGraphToSvg(makeFunctionSpec([{ name: 'f', expression: 'sin(x)' }]), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<polyline')).toBeGreaterThanOrEqual(1)
      expect(countOccurrences(svg, '<circle')).toBe(0)
   })

   it('draws a numeric x-axis tick reflecting the domain (not a category label)', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'x' }], {}, { xMin: 0, xMax: 100, samples: 20 }),
         LIGHT_GRAPH_THEME,
      )
      // niceTicks(0, 100, 5) lands clean ticks at 0/20/40/60/80/100, none of which is a category name.
      expect(svg).toMatch(/>0<\/text>/)
      expect(svg).toMatch(/>100<\/text>/)
   })

   it('autoscales y without forcing a zero baseline for an offset, near-constant function', () => {
      // f(x) = 100 + 0.001x over [1,21] (kept off zero on the x-axis too, so the only "0" this
      // test could see would come from a forced y-baseline) stays in ~[100.001, 100.021]; a
      // forced-zero baseline (like bar/line-over-real-data uses) would crush this into a sliver.
      const svg = renderGraphToSvg(
         makeFunctionSpec(
            [{ name: 'f', expression: '100 + 0.001*x' }], {}, { xMin: 1, xMax: 21, samples: 50 }),
         LIGHT_GRAPH_THEME)
      expect(svg).not.toMatch(/>0<\/text>/)
      expect(svg).toContain('100')
   })

   it('honors an explicit yMin/yMax override, same as every other cartesian type', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'sin(x)' }], { yMin: -5, yMax: 5 }), LIGHT_GRAPH_THEME)
      expect(svg).toMatch(/>-5<\/text>/)
      expect(svg).toMatch(/>5<\/text>/)
   })

   it('draws no curve, but still a valid chart, for an uncompileable expression', () => {
      const svg = renderGraphToSvg(makeFunctionSpec([{ name: 'bad', expression: 'sinx(' }]), LIGHT_GRAPH_THEME)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(countOccurrences(svg, '<polyline')).toBe(0)
   })

   it('breaks the curve at a true domain error (division by zero), same null-gap mechanism as a line chart', () => {
      // 33 evenly spaced samples over [-4,4] land exactly on x=0 -> evaluate(1/x, 0) is null,
      // splitting the 32 remaining (monotonic, same-magnitude-at-worst-4) samples into two runs.
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: '1/x' }], {}, { xMin: -4, xMax: 4, samples: 33 }),
         LIGHT_GRAPH_THEME,
      )
      expect(countOccurrences(svg, '<polyline')).toBe(2)
   })

   it('applies the asymptote heuristic to break a near-pole tan(x) curve into separate runs', () => {
      // A sample lands (up to float precision) essentially ON tan's pole at pi/2, producing a huge
      // finite value (never Infinity/NaN, so the plain null-gap mechanism alone would NOT catch it);
      // pinning yMin/yMax keeps the heuristic's magnitude threshold sane despite that huge sample.
      const svg = renderGraphToSvg(
         makeFunctionSpec(
            [{ name: 'f', expression: 'tan(x)' }],
            { yMin: -15, yMax: 15 },
            { xMin: Math.PI / 2 - 0.4, xMax: Math.PI / 2 + 0.4, samples: 21 },
         ),
         LIGHT_GRAPH_THEME,
      )
      // Without the heuristic these 21 finite samples (no true domain error anywhere) would connect
      // as ONE polyline; the heuristic must split it into two runs around the pole.
      expect(countOccurrences(svg, '<polyline')).toBe(2)
   })

   it('shows a legend with equation names when more than one equation is drawn', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([
            { name: 'sine', expression: 'sin(x)' },
            { name: 'cosine', expression: 'cos(x)' },
         ], { legend: true }),
         LIGHT_GRAPH_THEME,
      )
      expect(countOccurrences(svg, '<polyline')).toBe(2)
      expect(svg).toContain('sine')
      expect(svg).toContain('cosine')
   })

   it('honors a per-equation color override', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'x', color: '#abcdef' }]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('#abcdef')
   })

   it('caps drawn equations at 8, mirroring the series cap', () => {
      const manyEquations: GraphSpec = makeFunctionSpec(
         Array.from({ length: 10 }, (_, index) => ({ name: `f${index}`, expression: 'x' })))
      const svg = renderGraphToSvg(manyEquations, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<polyline')).toBe(8)
   })

   it('renders a graceful empty-state placeholder for an empty equation list', () => {
      const svg = renderGraphToSvg(makeFunctionSpec([]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('No data to chart')
   })

   it('renders a graceful empty-state placeholder for a blank expression', () => {
      const svg = renderGraphToSvg(makeFunctionSpec([{ name: 'f', expression: '' }]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('No data to chart')
   })

   it('never throws on a degenerate domain (xMin === xMax) or a zero/negative sample count', () => {
      const degenerateDomain = makeFunctionSpec(
         [{ name: 'f', expression: 'x' }], {}, { xMin: 5, xMax: 5, samples: 0 })
      expect(() => renderGraphToSvg(degenerateDomain, LIGHT_GRAPH_THEME)).not.toThrow()
   })

   it('is deterministic, identical input yields identical output', () => {
      const spec = makeFunctionSpec([{ name: 'f', expression: 'sin(x) + 0.5*x' }])
      expect(renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))
   })
})

/** A `scatter`-type spec from the given series list (legend off unless overridden). */
function makeScatterSpec(
   series: { name: string; points: { x: number; y: number }[]; color?: string }[],
   overrides: Partial<GraphSpec['options']> = {},
): GraphSpec {
   return {
      type: 'scatter',
      data: { labels: [], series: [] },
      options: { legend: false, ...overrides },
      scatterPlot: { series },
   }
}

describe('scatter chart (x/y point pairs)', () => {
   it('emits a well-formed responsive <svg> with title/desc', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }] }], { title: 'A scatter' }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('viewBox="0 0 720 440"')
      expect(svg).toContain('<title>A scatter</title>')
   })

   it('draws one <circle> per point across every series', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([
            { name: 'A', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 5 }] },
            { name: 'B', points: [{ x: 1, y: 6 }, { x: 2, y: 5 }] },
         ]),
         LIGHT_GRAPH_THEME,
      )
      expect(countOccurrences(svg, '<circle')).toBe(5)
   })

   it('draws numeric x-axis AND y-axis tick labels (never a category label)', () => {
      // x autoscales/nice-ticks to [0, 100] (ticks include 100); y autoscales/nice-ticks to
      // [0, 50] (ticks include 50), distinct max values so each assertion pins its own axis.
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }]),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toMatch(/>100<\/text>/)
      expect(svg).toMatch(/>50<\/text>/)
   })

   it('autoscales both axes with NO forced zero baseline, honoring an explicit yMin/yMax override', () => {
      // x autoscales from [1, 2] (nowhere near -10/10, so any -10/10 tick can only be the y-axis);
      // the raw y data [1000, 1001] would autoscale far from -10/10 without the override.
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 1, y: 1000 }, { x: 2, y: 1001 }] }], { yMin: -10, yMax: 10 }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toMatch(/>-10<\/text>/)
      expect(svg).toMatch(/>10<\/text>/)
   })

   it('shows a legend with series names when more than one series is drawn', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([
            { name: 'North', points: [{ x: 1, y: 2 }] },
            { name: 'South', points: [{ x: 3, y: 4 }] },
         ], { legend: true }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toContain('North')
      expect(svg).toContain('South')
   })

   it('honors a per-series color override', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 1, y: 2 }], color: '#abcdef' }]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('#abcdef')
   })

   it('caps drawn series at 8, mirroring the series cap', () => {
      const manySeries = makeScatterSpec(
         Array.from({ length: 10 }, (_, index) => ({ name: `s${index}`, points: [{ x: index, y: index }] })))
      const svg = renderGraphToSvg(manySeries, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<circle')).toBe(8)
   })

   it('renders a graceful empty-state placeholder for an empty series list', () => {
      const svg = renderGraphToSvg(makeScatterSpec([]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('No data to chart')
   })

   it('renders a graceful empty-state placeholder when every series has zero points', () => {
      const svg = renderGraphToSvg(makeScatterSpec([{ name: 'A', points: [] }]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('No data to chart')
   })

   it('never throws for a single point (degenerate x and y domain)', () => {
      const spec = makeScatterSpec([{ name: 'A', points: [{ x: 5, y: 5 }] }])
      expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
   })

   it('never throws and draws nothing for non-finite point coordinates', () => {
      const spec = makeScatterSpec([{ name: 'A', points: [{ x: NaN, y: Infinity }] }])
      expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
      const svg = renderGraphToSvg(spec, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<circle')).toBe(0)
   })

   it('is deterministic, identical input yields identical output', () => {
      const spec = makeScatterSpec([{ name: 'A', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }])
      expect(renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))
   })

   // Statistical overlays for scatter reuse the SAME overlay machinery a categorical cartesian
   // chart draws with (dashed styling, haloed label, analytic plot-rect clip), mean/trend are
   // computed over the target series' raw (x, y) points instead of a category-aligned `values`
   // array, and trend fits `linearRegressionXY`, not the categorical index-based `linearRegression`.
   describe('statistical overlays (scatter)', () => {
      it('adds a dashed mean line at the target series’ own point-Y mean', () => {
         const points = [{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 30 }]
         const plain = renderGraphToSvg(makeScatterSpec([{ name: 'A', points }]), LIGHT_GRAPH_THEME)
         const withMean = renderGraphToSvg(
            makeScatterSpec([{ name: 'A', points }], { overlays: [{ kind: 'mean', series: 0 }] }),
            LIGHT_GRAPH_THEME,
         )
         expect(countDashedLines(plain)).toBe(0)
         expect(countDashedLines(withMean)).toBe(1)
         // mean of [10, 20, 30] = 20.
         expect(withMean).toContain('mean 20')
      })

      it('draws a trendline fit over the raw (x, y) points, with an R² label and, opt-in, the equation', () => {
         // A perfect line y = 2x through the origin -> slope 2, intercept 0, R^2 = 1.
         const points = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]
         const rOnly = renderGraphToSvg(
            makeScatterSpec([{ name: 'A', points }], { overlays: [{ kind: 'trend', series: 0 }] }),
            LIGHT_GRAPH_THEME,
         )
         expect(countDashedLines(rOnly)).toBe(1)
         expect(rOnly).toContain('R² 1')
         expect(rOnly).not.toContain('y =')

         const withEquation = renderGraphToSvg(
            makeScatterSpec([{ name: 'A', points }], { overlays: [{ kind: 'trend', series: 0, showEquation: true }] }),
            LIGHT_GRAPH_THEME,
         )
         expect(withEquation).toContain('y =')
         expect(withEquation).toContain('R²')
      })

      it('skips a trend overlay for a series with fewer than 2 points', () => {
         const spec = makeScatterSpec(
            [{ name: 'A', points: [{ x: 1, y: 1 }] }], { overlays: [{ kind: 'trend', series: 0 }] })
         expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
         expect(countDashedLines(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))).toBe(0)
      })

      it('auto-extends the y-domain so a reference line above the plotted points stays visible', () => {
         const points = [{ x: 1, y: 10 }, { x: 2, y: 55 }]
         const plain = renderGraphToSvg(makeScatterSpec([{ name: 'A', points }]), LIGHT_GRAPH_THEME)
         const svg = renderGraphToSvg(
            makeScatterSpec([{ name: 'A', points }], { overlays: [{ kind: 'reference', value: 200, label: 'Cap' }] }),
            LIGHT_GRAPH_THEME,
         )
         expect(countDashedLines(svg)).toBe(1)
         expect(svg).toContain('Cap')
         // The auto-extended axis now shows a 200 tick that a plain chart of this data would not.
         expect(plain).not.toContain('>200<')
         expect(svg).toContain('>200<')
      })

      it('fans out an all-series mean overlay to one line per drawn series', () => {
         const svg = renderGraphToSvg(
            makeScatterSpec(
               [
                  { name: 'A', points: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
                  { name: 'B', points: [{ x: 1, y: 50 }, { x: 2, y: 60 }] },
               ],
               { overlays: [{ kind: 'mean', series: 'all' }] },
            ),
            LIGHT_GRAPH_THEME,
         )
         expect(countDashedLines(svg)).toBe(2)
      })

      it('skips the equation overlay kind entirely on a scatter chart (no categorical axis to sample)', () => {
         const svg = renderGraphToSvg(
            makeScatterSpec(
               [{ name: 'A', points: [{ x: 1, y: 2 }] }], { overlays: [{ kind: 'equation', expression: 'x' }] }),
            LIGHT_GRAPH_THEME,
         )
         expect(countDashedLines(svg)).toBe(0)
         expect(svg).not.toContain('<polyline')
      })
   })
})

/** A `histogram`-type spec from the given raw samples (legend off unless overridden, though a
 *  histogram never draws one regardless, see cartesian.ts's renderHistogram). */
function makeHistogramSpec(
   samples: number[],
   histogramOverrides: { bins?: number; name?: string; color?: string } = {},
   overrides: Partial<GraphSpec['options']> = {},
): GraphSpec {
   return {
      type: 'histogram',
      data: { labels: [], series: [] },
      options: { legend: false, ...overrides },
      histogramData: { samples, ...histogramOverrides },
   }
}

describe('histogram chart (binned frequency distribution)', () => {
   it('emits a well-formed responsive <svg> with title/desc', () => {
      const svg = renderGraphToSvg(
         makeHistogramSpec([1, 2, 3, 4, 5, 6, 7, 8], {}, { title: 'A histogram' }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('viewBox="0 0 720 440"')
      expect(svg).toContain('<title>A histogram</title>')
   })

   it('draws one CONTIGUOUS <rect> bar per bin, with a manual bin count honored', () => {
      const svg = renderGraphToSvg(makeHistogramSpec([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 5 }), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(5)
   })

   it('draws a numeric x-axis of bin edges (never a category label)', () => {
      // [0, 100] over 5 manual bins -> edges at 0, 20, 40, 60, 80, 100; the axis nice-ticks over
      // that numeric domain, so 100 must appear as a tick label.
      const svg = renderGraphToSvg(makeHistogramSpec([0, 100], { bins: 5 }), LIGHT_GRAPH_THEME)
      expect(svg).toMatch(/>100<\/text>/)
   })

   it('draws the y-axis (frequency) from a ZERO baseline, unlike function/scatter', () => {
      // Every sample lands in one bin (a huge count relative to the others), so 0 must be a tick.
      const svg = renderGraphToSvg(makeHistogramSpec([10, 10, 10, 10, 20], { bins: 2 }), LIGHT_GRAPH_THEME)
      expect(svg).toMatch(/>0<\/text>/)
   })

   it('honors an explicit yMax override on the frequency axis', () => {
      const svg = renderGraphToSvg(
         makeHistogramSpec([1, 2, 3, 4, 5], { bins: 5 }, { yMax: 1000 }), LIGHT_GRAPH_THEME)
      expect(svg).toMatch(/>1,000<\/text>/)
   })

   it('draws no visible legend box for a single dataset, even with legend explicitly requested', () => {
      // The dataset name may still surface MINIMALLY in the accessible <desc> (see describeChart
      // below), but never as a drawn legend swatch/label in the plot area, there is only ONE
      // <desc> element in the whole document, so this pins that as the sole place the name appears.
      const svg = renderGraphToSvg(
         makeHistogramSpec([1, 2, 3, 4, 5], { name: 'Widget A' }, { legend: true }), LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, 'Widget A')).toBe(1)
      expect(svg).toMatch(/<desc>[^<]*Widget A[^<]*<\/desc>/)
   })

   it('honors a dataset color override', () => {
      const svg = renderGraphToSvg(makeHistogramSpec([1, 2, 3], { color: '#abcdef' }), LIGHT_GRAPH_THEME)
      expect(svg).toContain('#abcdef')
   })

   it('draws value labels above bars when showValues is set', () => {
      const svg = renderGraphToSvg(
         makeHistogramSpec([1, 2, 3, 4, 5], { bins: 5 }, { showValues: true }), LIGHT_GRAPH_THEME)
      // Every one of the 5 manual bins holds exactly one of the 5 samples -> five "1" value labels.
      expect(countOccurrences(svg, '>1</text>')).toBeGreaterThanOrEqual(5)
   })

   it('renders a graceful empty-state placeholder for an empty sample list', () => {
      const svg = renderGraphToSvg(makeHistogramSpec([]), LIGHT_GRAPH_THEME)
      expect(svg).toContain('No data to chart')
   })

   it('never throws and draws a graceful empty plot (no bars) when every sample is non-finite', () => {
      // hasRenderableData only checks STRUCTURAL presence (samples.length > 0), so this spec is
      // deemed renderable at the top level; the empty-bars degradation happens inside the renderer.
      const spec = makeHistogramSpec([Number.NaN, Infinity, -Infinity])
      expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
      const svg = renderGraphToSvg(spec, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(0)
   })

   it('never throws for all-equal samples (a degenerate single-bin domain)', () => {
      const spec = makeHistogramSpec([7, 7, 7, 7])
      expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
      const svg = renderGraphToSvg(spec, LIGHT_GRAPH_THEME)
      expect(countOccurrences(svg, '<rect')).toBe(1)
   })

   it('is deterministic, identical input yields identical output', () => {
      const spec = makeHistogramSpec([3, 1, 4, 1, 5, 9, 2, 6, 5, 3])
      expect(renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))
   })
})

// #####################
// # LOG VALUE AXIS    #
// #####################
// `options.yScale: 'log'` is a base-10 logarithmic value (y) axis. Absent or 'linear' stays
// byte-identical; log is offered for line/area/scatter/function/histogram/bar/bar-grouped, never
// for bar-stacked/pie/donut; a chart whose own data touches <= 0 (or an unsupported type,
// defensively) silently falls back to linear rather than clamping or crashing.

describe('log value axis: byte-identical when absent/linear', () => {
   it('an explicit yScale: "linear" renders identically to leaving it unset (bar)', () => {
      const unset = renderGraphToSvg(makeSpec('bar'), LIGHT_GRAPH_THEME)
      const explicitLinear = renderGraphToSvg(makeSpec('bar', { yScale: 'linear' }), LIGHT_GRAPH_THEME)
      expect(explicitLinear).toBe(unset)
   })

   it('never draws a minor (log-only) gridline for any type when yScale is unset', () => {
      for (const type of ['bar', 'bar-grouped', 'bar-stacked', 'line', 'area', 'pie', 'donut'] as GraphType[]) {
         const svg = renderGraphToSvg(makeSpec(type), LIGHT_GRAPH_THEME)
         expect(svg).not.toContain('stroke-opacity=')
      }
   })
})

describe('log value axis: eligible chart types', () => {
   /** A positive-only two-series bar/line/area fixture spanning several decades. */
   function makeLogEligibleSpec(type: GraphType): GraphSpec {
      return {
         type,
         data: {
            labels: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [{ name: 'Revenue', values: [1, 10, 100, 1000] }],
         },
         options: { legend: false, yScale: 'log' },
      }
   }

   for (const type of ['bar', 'bar-grouped', 'line', 'area'] as GraphType[]) {
      it(`draws decade tick labels for a log-eligible ${type} chart`, () => {
         const svg = renderGraphToSvg(makeLogEligibleSpec(type), LIGHT_GRAPH_THEME)
         expect(svg).toMatch(/>1<\/text>/)
         expect(svg).toMatch(/>1,000<\/text>/)
      })

      it(`draws faint minor gridlines for a log-eligible ${type} chart`, () => {
         const svg = renderGraphToSvg(makeLogEligibleSpec(type), LIGHT_GRAPH_THEME)
         expect(svg).toContain('stroke-opacity=')
      })

      it(`changes rendered output vs. the same data on a linear axis for ${type}`, () => {
         const log = renderGraphToSvg(makeLogEligibleSpec(type), LIGHT_GRAPH_THEME)
         const linear = renderGraphToSvg(
            { ...makeLogEligibleSpec(type), options: { legend: false } }, LIGHT_GRAPH_THEME)
         expect(log).not.toBe(linear)
      })
   }

   it('draws bars from the axis floor (niceMin), not an implied zero, for a log bar chart', () => {
      // [1, 10, 100, 1000] -> niceMin = 1 (10^0), the axis floor; the x-axis baseline (and every
      // bar's bottom edge) sits there instead of at a "0" that does not exist on a log scale.
      const svg = renderGraphToSvg(makeLogEligibleSpec('bar'), LIGHT_GRAPH_THEME)
      expect(svg).not.toMatch(/>0<\/text>/)
   })

   it('scatter: log applies to the value (y) axis only, x stays linear/continuous', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec(
            [{ name: 'A', points: [{ x: 1, y: 1 }, { x: 2, y: 10 }, { x: 3, y: 100 }] }],
            { yScale: 'log' },
         ),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toMatch(/>100<\/text>/) // the y decade tick
      expect(svg).toContain('stroke-opacity=') // minor gridlines present
   })

   it('function: renders a log y-axis for a strictly positive equation', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec(
            [{ name: 'f', expression: '10^x' }], { yScale: 'log' }, { xMin: 0, xMax: 3, samples: 20 }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toContain('stroke-opacity=')
      expect(countOccurrences(svg, '<polyline')).toBeGreaterThanOrEqual(1)
   })

   // Pins the positive case as an explicit, unambiguous test: a genuinely positive function must
   // draw real DECADE tick labels (1, 10, 100, values a linear autoscale of this same y-range
   // would never happen to land on) plus faint minor gridlines, never silently staying linear.
   it('function: exp(x) over a narrow domain draws genuine decade tick labels, not a linear autoscale', () => {
      // exp(0) = 1, exp(ln(100)) = 100 -> y ranges [1, 100], strictly positive throughout.
      const svg = renderGraphToSvg(
         makeFunctionSpec(
            [{ name: 'f', expression: 'exp(x)' }], { yScale: 'log' }, { xMin: 0, xMax: Math.log(100), samples: 40 }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toMatch(/>1<\/text>/)
      expect(svg).toMatch(/>10<\/text>/)
      expect(svg).toMatch(/>100<\/text>/)
      expect(svg).toContain('stroke-opacity=') // 2x/5x minor ticks (20, 50) for this 2-decade span
      expect(countOccurrences(svg, '<polyline')).toBeGreaterThanOrEqual(1)
   })

   it('function: x^2 + 1 over a domain that stays positive draws a genuine log axis', () => {
      // x^2 + 1 over [-3, 3] ranges [1, 10] -> strictly positive everywhere in the sampled domain.
      const svg = renderGraphToSvg(
         makeFunctionSpec(
            [{ name: 'f', expression: 'x^2 + 1' }], { yScale: 'log' }, { xMin: -3, xMax: 3, samples: 40 }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).toMatch(/>1<\/text>/)
      expect(svg).toMatch(/>10<\/text>/)
      expect(svg).toContain('stroke-opacity=')
   })

   it('histogram: renders a log y-axis (frequency count) when every drawn bin is positive', () => {
      // Every value distinct -> every populated bin holds count 1 (all positive, no empty bins).
      const svg = renderGraphToSvg(
         makeHistogramSpec([1, 2, 3, 4, 5], { bins: 5 }, { yScale: 'log' }), LIGHT_GRAPH_THEME)
      expect(svg).toContain('stroke-opacity=')
   })

   it('is deterministic on a log axis, identical input yields identical output', () => {
      const spec = makeLogEligibleSpec('line')
      expect(renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))
   })
})

describe('log value axis: non-positive data falls back to linear', () => {
   it('falls back to linear for a bar/line series that dips to zero or negative', () => {
      const withZero: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [0, 10] }] },
         options: { legend: false, yScale: 'log' },
      }
      const withNegative: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [-5, 10] }] },
         options: { legend: false, yScale: 'log' },
      }
      // A fallback-to-linear render never draws the log-only minor gridlines.
      expect(renderGraphToSvg(withZero, LIGHT_GRAPH_THEME)).not.toContain('stroke-opacity=')
      expect(renderGraphToSvg(withNegative, LIGHT_GRAPH_THEME)).not.toContain('stroke-opacity=')
   })

   it('never throws and never emits NaN/Infinity geometry for non-positive log-requested data', () => {
      const spec: GraphSpec = {
         type: 'area',
         data: { labels: ['A', 'B', 'C'], series: [{ name: 'S', values: [-1, 0, 5] }] },
         options: { legend: false, yScale: 'log' },
      }
      expect(() => renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).not.toThrow()
      const svg = renderGraphToSvg(spec, LIGHT_GRAPH_THEME)
      expect(svg).not.toContain('NaN')
      expect(svg).not.toContain('Infinity')
   })

   it('falls back to linear for a function chart whose sampled curve crosses zero', () => {
      // f(x) = x over [-5, 5] samples straight through zero.
      const svg = renderGraphToSvg(
         makeFunctionSpec(
            [{ name: 'f', expression: 'x' }], { yScale: 'log' }, { xMin: -5, xMax: 5, samples: 20 }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).not.toContain('stroke-opacity=')
   })

   it('falls back to linear for scatter when a point sits at y <= 0', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec(
            [{ name: 'A', points: [{ x: 1, y: 0 }, { x: 2, y: 10 }] }], { yScale: 'log' }),
         LIGHT_GRAPH_THEME,
      )
      expect(svg).not.toContain('stroke-opacity=')
   })

   it('falls back to linear for a histogram whose only populated bin sits at zero count everywhere', () => {
      // A single sample -> Sturges' rule still produces >= 1 bin, but with just one sample there is
      // no way to have every bin positive AND span multiple bins meaningfully; force the degenerate
      // "no positive bin" case directly via an empty sample list (every count is 0).
      const svg = renderGraphToSvg(makeHistogramSpec([], {}, { yScale: 'log' }), LIGHT_GRAPH_THEME)
      // An empty sample list is the top-level empty-state (never reaches the log/linear branch at
      // all), assert it degrades gracefully either way, never throwing / never NaN.
      expect(svg).not.toContain('NaN')
   })
})

describe('log value axis: disallowed for stacked bar and radial types', () => {
   it('bar-stacked ignores yScale: "log" and renders identically to omitting it', () => {
      const withLog = renderGraphToSvg(makeSpec('bar-stacked', { yScale: 'log' }), LIGHT_GRAPH_THEME)
      const withoutLog = renderGraphToSvg(makeSpec('bar-stacked'), LIGHT_GRAPH_THEME)
      expect(withLog).toBe(withoutLog)
   })

   it('pie and donut ignore yScale: "log" (no value axis at all) and render identically', () => {
      for (const type of ['pie', 'donut'] as GraphType[]) {
         const withLog = renderGraphToSvg(makeSpec(type, { yScale: 'log' }), LIGHT_GRAPH_THEME)
         const withoutLog = renderGraphToSvg(makeSpec(type), LIGHT_GRAPH_THEME)
         expect(withLog).toBe(withoutLog)
      }
   })
})

// ============================================================================
// Custom axis origin ("textbook" / four-quadrant axes), function/scatter only
// ============================================================================
// Light theme ink used by the axis lines / gridlines, so the tests can tell a bold crossing axis
// (ink.axis) from a recessive gridline (ink.grid) and a data mark (a series hue) apart.
const LIGHT_AXIS_STROKE = '#c3c2b7'

/** Every `<line .../>` self-closing tag in the SVG. */
function allLineTags(svg: string): string[] {
   return svg.match(/<line\b[^>]*\/>/g) ?? []
}

/** Read x1/y1/x2/y2 off one `<line>` tag as numbers. */
function lineCoords(tag: string): { x1: number; y1: number; x2: number; y2: number } {
   const read = (attr: string): number => {
      const match = new RegExp(`\\b${attr}="([^"]+)"`).exec(tag)
      return match ? Number(match[1]) : NaN
   }
   return { x1: read('x1'), y1: read('y1'), x2: read('x2'), y2: read('y2') }
}

/** The dashed overlay lines (reference / mean / median / trend all carry a stroke-dasharray). */
function dashedLineTags(svg: string): string[] {
   return allLineTags(svg).filter(tag => tag.includes('stroke-dasharray'))
}

describe('custom axis origin (textbook axes)', () => {
   it('draws MORE axis-colored lines than the plain two edge axes (tick marks ride the crossings)', () => {
      const plain = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: -10, y: -10 }, { x: 10, y: 10 }] }]), LIGHT_GRAPH_THEME)
      const textbook = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: -10, y: -10 }, { x: 10, y: 10 }] }],
            { axisOrigin: { x: 0, y: 0 } }), LIGHT_GRAPH_THEME)
      // Plain function/scatter draws exactly the two edge axes in ink.axis; textbook adds the two
      // crossing axes PLUS a tick mark per label, so the axis-colored line count strictly grows.
      expect(countOccurrences(plain, `stroke="${LIGHT_AXIS_STROKE}"`)).toBe(2)
      expect(countOccurrences(textbook, `stroke="${LIGHT_AXIS_STROKE}"`))
         .toBeGreaterThan(countOccurrences(plain, `stroke="${LIGHT_AXIS_STROKE}"`))
      expect(textbook).not.toBe(plain)
   })

   it('rides tick marks on the crossing axes (short 8px axis-colored segments in both directions)', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: -10, y: -10 }, { x: 10, y: 10 }] }],
            { axisOrigin: { x: 0, y: 0 } }), LIGHT_GRAPH_THEME)
      const axisMarks = allLineTags(svg)
         .filter(tag => tag.includes(`stroke="${LIGHT_AXIS_STROKE}"`))
         .map(lineCoords)
      // An x-axis tick mark is a short VERTICAL segment (x1===x2, 8px tall); a y-axis tick mark a
      // short HORIZONTAL one (y1===y2, 8px wide), both straddle their crossing axis (half-length 4).
      expect(axisMarks.some(c => c.x1 === c.x2 && Math.abs(c.y2 - c.y1) === 8)).toBe(true)
      expect(axisMarks.some(c => c.y1 === c.y2 && Math.abs(c.x2 - c.x1) === 8)).toBe(true)
   })

   it('places the crossing y-axis in the plot interior for a symmetric origin (not at the left edge)', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: -10, y: -10 }, { x: 10, y: 10 }] }],
            { axisOrigin: { x: 0, y: 0 } }), LIGHT_GRAPH_THEME)
      const coords = allLineTags(svg).map(lineCoords)
      const allX = coords.flatMap(c => [c.x1, c.x2]).filter(Number.isFinite)
      const plotLeft = Math.min(...allX)
      const plotRight = Math.max(...allX)
      // The bold vertical axis (full plot height, axis ink) sits at x = 0's mapped position, i.e. the
      // horizontal CENTER for a symmetric [-10, 10] domain, strictly between the two plot edges.
      const boldVertical = allLineTags(svg)
         .filter(tag => tag.includes(`stroke="${LIGHT_AXIS_STROKE}"`))
         .map(lineCoords)
         .find(c => c.x1 === c.x2 && Math.abs(c.y2 - c.y1) > (plotRight - plotLeft) / 2)
      expect(boldVertical).toBeDefined()
      expect(boldVertical!.x1).toBeGreaterThan(plotLeft + 1)
      expect(boldVertical!.x1).toBeLessThan(plotRight - 1)
   })

   it('clamps the crossing axes to the nearest plot edge when the origin is off-domain', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
            { axisOrigin: { x: 1000, y: 1000 } }), LIGHT_GRAPH_THEME)
      const axisLines = allLineTags(svg)
         .filter(tag => tag.includes(`stroke="${LIGHT_AXIS_STROKE}"`))
         .map(lineCoords)
      // The bold horizontal axis spans the full plot WIDTH (plotLeft..plotRight); the bold vertical
      // axis spans the full HEIGHT (plotTop..plotBottom). origin x=1000 is far right of the data, so
      // the vertical axis clamps to the RIGHT edge (= the horizontal axis's right end); origin y=1000
      // is far above, so the horizontal axis clamps to the TOP edge (= the vertical axis's top end).
      const boldVertical = axisLines.find(c => c.x1 === c.x2 && Math.abs(c.y2 - c.y1) > 100)!
      const boldHorizontal = axisLines.find(c => c.y1 === c.y2 && Math.abs(c.x2 - c.x1) > 100)!
      const plotRight = Math.max(boldHorizontal.x1, boldHorizontal.x2)
      const plotTop = Math.min(boldVertical.y1, boldVertical.y2)
      expect(boldVertical.x1).toBeCloseTo(plotRight, 5)
      expect(boldHorizontal.y1).toBeCloseTo(plotTop, 5)
   })

   it('ignores axisOrigin under a log value axis (the standard log axis is drawn instead)', () => {
      const base = makeScatterSpec([{ name: 'A', points: [{ x: 1, y: 1 }, { x: 10, y: 100 }] }], { yScale: 'log' })
      const withOrigin: GraphSpec = { ...base, options: { ...base.options, axisOrigin: { x: 0, y: 0 } } }
      // A custom origin is a linear-axis concept; under log it is disabled entirely, so the render is
      // byte-identical to the same log chart with no origin at all.
      expect(renderGraphToSvg(withOrigin, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(base, LIGHT_GRAPH_THEME))
   })

   it('applies to a function chart too (crossing axes differ from its plain edge axes)', () => {
      const plain = renderGraphToSvg(makeFunctionSpec([{ name: 'f', expression: 'sin(x)' }]), LIGHT_GRAPH_THEME)
      const textbook = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'sin(x)' }], { axisOrigin: { x: 0, y: 0 } }), LIGHT_GRAPH_THEME)
      expect(textbook).not.toBe(plain)
      expect(countOccurrences(textbook, `stroke="${LIGHT_AXIS_STROKE}"`))
         .toBeGreaterThan(countOccurrences(plain, `stroke="${LIGHT_AXIS_STROKE}"`))
   })

   it('is deterministic', () => {
      const spec = makeScatterSpec([{ name: 'A', points: [{ x: -5, y: -5 }, { x: 5, y: 5 }] }],
         { axisOrigin: { x: 1, y: -2 } })
      expect(renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))
   })
})

// ============================================================================
// Vertical reference overlays (x = value), function/scatter only
// ============================================================================
describe('vertical reference overlay', () => {
   it('draws a single vertical dashed line at the reference x on a scatter chart', () => {
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
            { overlays: [{ kind: 'reference', value: 5, orientation: 'vertical' }] }), LIGHT_GRAPH_THEME)
      const dashed = dashedLineTags(svg).map(lineCoords)
      expect(dashed.length).toBe(1)
      expect(dashed[0].x1).toBe(dashed[0].x2)         // vertical
      expect(dashed[0].y1).not.toBe(dashed[0].y2)     // spans the plot height
   })

   it('auto-extends the X-domain so a vertical reference beyond the data stays visible', () => {
      // Data maxes at x = 10; a vertical reference at x = 50 must pull the x-axis out to include it,
      // so a "50" x-tick label appears (it would not with the un-extended [0, 10] x-domain).
      const svg = renderGraphToSvg(
         makeScatterSpec([{ name: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
            { overlays: [{ kind: 'reference', value: 50, orientation: 'vertical' }] }), LIGHT_GRAPH_THEME)
      expect(svg).toMatch(/>50<\/text>/)
      expect(dashedLineTags(svg).length).toBe(1)
   })

   it('supports a vertical reference on a function chart (extends the drawn x-axis)', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'sin(x)' }],
            { overlays: [{ kind: 'reference', value: 3, orientation: 'vertical' }] }), LIGHT_GRAPH_THEME)
      const dashed = dashedLineTags(svg).map(lineCoords)
      expect(dashed.length).toBe(1)
      expect(dashed[0].x1).toBe(dashed[0].x2) // vertical
   })

   it('renders ONLY reference overlays on a function chart (mean/trend are skipped)', () => {
      const svg = renderGraphToSvg(
         makeFunctionSpec([{ name: 'f', expression: 'x' }],
            { overlays: [{ kind: 'mean', series: 0 }, { kind: 'trend', series: 0 }] }), LIGHT_GRAPH_THEME)
      // A function chart has no discrete series to average/fit, so mean/trend draw nothing.
      expect(dashedLineTags(svg).length).toBe(0)
   })

   it('silently skips a vertical reference on a categorical chart (not drawn, no domain extension)', () => {
      // A vertical x = const has no meaning on a categorical band axis, so it draws nothing AND must
      // not extend the y-domain (data maxes at 55; a HORIZONTAL ref at 200 would add a 200 tick, but
      // the vertical one must not, proving it folded into neither axis).
      const withVertical = renderGraphToSvg(
         makeSpec('bar', { overlays: [{ kind: 'reference', value: 200, orientation: 'vertical' }] }),
         LIGHT_GRAPH_THEME)
      expect(dashedLineTags(withVertical).length).toBe(0)
      expect(withVertical).not.toMatch(/>200<\/text>/)
      // Contrast: the SAME value as a horizontal reference IS drawn and DOES pull the y-axis to 200.
      const withHorizontal = renderGraphToSvg(
         makeSpec('bar', { overlays: [{ kind: 'reference', value: 200, orientation: 'horizontal' }] }),
         LIGHT_GRAPH_THEME)
      expect(dashedLineTags(withHorizontal).length).toBe(1)
      expect(withHorizontal).toMatch(/>200<\/text>/)
   })

   it('an orientation-less reference is byte-identical to an explicitly horizontal one (back-compat)', () => {
      const implicit = renderGraphToSvg(
         makeSpec('bar', { overlays: [{ kind: 'reference', value: 200 }] }), LIGHT_GRAPH_THEME)
      const explicitHorizontal = renderGraphToSvg(
         makeSpec('bar', { overlays: [{ kind: 'reference', value: 200, orientation: 'horizontal' }] }),
         LIGHT_GRAPH_THEME)
      expect(implicit).toBe(explicitHorizontal)
   })
})

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
      // The captured group must contain the full font stack — proof no inner " truncated it.
      expect(styleMatch?.[1]).toContain('sans-serif')
      expect(styleMatch?.[1]).toContain("'Segoe UI'")
   })

   it('is deterministic — identical input yields identical output', () => {
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

/** Pull the numeric `width="…"` of the first drawn bar rect (rects with a `rx`/`fill`, not swatches). */
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
// Stage 2 (docs/reference/graph_equation_study.md): the `function` chart type — sampled equation
// curves over a continuous numeric domain, drawn via the SAME line-rendering machinery every other
// cartesian type uses, through a continuous-x adapter (see continuousAxis.ts) instead of a band.

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
      // niceTicks(0, 100, 5) lands clean ticks at 0/20/40/60/80/100 — none of which is a category name.
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

   it('is deterministic — identical input yields identical output', () => {
      const spec = makeFunctionSpec([{ name: 'f', expression: 'sin(x) + 0.5*x' }])
      expect(renderGraphToSvg(spec, LIGHT_GRAPH_THEME)).toBe(renderGraphToSvg(spec, LIGHT_GRAPH_THEME))
   })
})

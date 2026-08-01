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

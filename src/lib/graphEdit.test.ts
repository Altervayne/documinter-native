/**
 * Unit coverage for the pure graph-editor structural transforms.
 *
 * Focus: the two invariants (rectangular arrays, keep-at-least-one) and the "fresh spec, input
 * untouched" contract. Mirrors mathStructures.test.ts in spirit, a pure-lib safety net that the
 * data-grid UI leans on.
 */

import { describe, it, expect } from 'vitest'
import type { GraphSpec, GraphData } from './graph'
import {
   addCategory,
   removeCategory,
   insertCategoryAt,
   moveCategory,
   setLabel,
   setCategoryColor,
   addSeries,
   removeSeries,
   insertSeriesAt,
   moveSeries,
   setSeriesName,
   setSeriesColor,
   setCell,
   setType,
   setOption,
   addOverlay,
   removeOverlay,
   updateOverlay,
   addEquation,
   removeEquation,
   insertEquationAt,
   moveEquation,
   setEquationField,
   setEquationColor,
   setDomain,
   addScatterSeries,
   removeScatterSeries,
   insertScatterSeriesAt,
   moveScatterSeries,
   setScatterSeriesName,
   setScatterSeriesColor,
   addScatterPoint,
   removeScatterPoint,
   insertScatterPointAt,
   moveScatterPoint,
   setScatterPointField,
   setHistogramSamples,
   setHistogramBins,
   setHistogramName,
   setHistogramColor,
   setSource,
   updateSourceMapping,
   unlinkSource,
   logScaleWouldFallBackToLinear,
} from './graphEdit'
import { FUNCTION_DEFAULT_X_MIN, FUNCTION_DEFAULT_X_MAX, FUNCTION_DEFAULT_SAMPLES, FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES } from './graph'

// A `function`-type fixture, mirroring makeSpec() in spirit but for the equation-editing helpers.
function makeFunctionSpec(): GraphSpec {
   return {
      type: 'function',
      data: { labels: [], series: [] },
      options: { legend: true },
      functionPlot: {
         domain: { xMin: -10, xMax: 10, samples: 200 },
         equations: [
            { name: 'f', expression: 'sin(x)' },
            { name: 'g', expression: 'cos(x)', color: '#123456' },
         ],
      },
   }
}

// A `scatter`-type fixture, mirroring makeFunctionSpec() in spirit but for the point-editing helpers.
function makeScatterSpec(): GraphSpec {
   return {
      type: 'scatter',
      data: { labels: [], series: [] },
      options: { legend: true },
      scatterPlot: {
         series: [
            { name: 'A', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
            { name: 'B', points: [{ x: 5, y: 6 }], color: '#123456' },
         ],
      },
   }
}

// A `histogram`-type fixture, mirroring makeScatterSpec() in spirit but for the sample-editing helpers.
function makeHistogramSpec(): GraphSpec {
   return {
      type: 'histogram',
      data: { labels: [], series: [] },
      options: { legend: true },
      histogramData: { samples: [1, 2, 3, 4, 5], bins: 3, name: 'A', color: '#123456' },
   }
}

// A small, well-formed two-series / three-category fixture rebuilt per test (no shared mutation).
function makeSpec(): GraphSpec {
   return {
      type: 'bar',
      data: {
         labels: ['A', 'B', 'C'],
         series: [
            { name: 'One', values: [1, 2, 3] },
            { name: 'Two', values: [4, 5, 6], color: '#123456' },
         ],
      },
      options: { legend: true },
   }
}

/** Assert every series' values array length matches the label count. */
function expectRectangular(spec: GraphSpec): void {
   for (const series of spec.data.series) {
      expect(series.values.length).toBe(spec.data.labels.length)
   }
}

describe('addCategory', () => {
   it('appends a label and a null across every series, staying rectangular', () => {
      const next = addCategory(makeSpec(), 'D')
      expect(next.data.labels).toEqual(['A', 'B', 'C', 'D'])
      expect(next.data.series[0].values).toEqual([1, 2, 3, null])
      expect(next.data.series[1].values).toEqual([4, 5, 6, null])
      expectRectangular(next)
   })

   it('defaults the new label to empty string', () => {
      const next = addCategory(makeSpec())
      expect(next.data.labels[3]).toBe('')
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      addCategory(spec, 'D')
      expect(spec.data.labels).toEqual(['A', 'B', 'C'])
      expect(spec.data.series[0].values).toEqual([1, 2, 3])
   })
})

describe('removeCategory', () => {
   it('drops the label and the aligned value in every series', () => {
      const next = removeCategory(makeSpec(), 1)
      expect(next.data.labels).toEqual(['A', 'C'])
      expect(next.data.series[0].values).toEqual([1, 3])
      expect(next.data.series[1].values).toEqual([4, 6])
      expectRectangular(next)
   })

   it('is a no-op when only one category remains', () => {
      const single: GraphSpec = {
         type: 'bar',
         data: { labels: ['only'], series: [{ name: 'One', values: [1] }] },
         options: {},
      }
      const next = removeCategory(single, 0)
      expect(next).toBe(single)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeSpec()
      expect(removeCategory(spec, 9)).toBe(spec)
      expect(removeCategory(spec, -1)).toBe(spec)
   })
})

describe('insertCategoryAt', () => {
   it('inserts a fresh empty category at the position, splicing a null into every series', () => {
      const next = insertCategoryAt(makeSpec(), 1)
      expect(next.data.labels).toEqual(['A', '', 'B', 'C'])
      expect(next.data.series[0].values).toEqual([1, null, 2, 3])
      expect(next.data.series[1].values).toEqual([4, null, 5, 6])
      expectRectangular(next)
   })

   it('inserts at the front (index 0)', () => {
      const next = insertCategoryAt(makeSpec(), 0, 'Z')
      expect(next.data.labels).toEqual(['Z', 'A', 'B', 'C'])
      expect(next.data.series[0].values).toEqual([null, 1, 2, 3])
   })

   it('inserting at the label count appends (equivalent to addCategory)', () => {
      const next = insertCategoryAt(makeSpec(), 3, 'D')
      expect(next.data.labels).toEqual(['A', 'B', 'C', 'D'])
      expect(next.data.series[0].values).toEqual([1, 2, 3, null])
   })

   it('keeps categoryColors aligned by splicing an undefined slot at the position', () => {
      const colored = setCategoryColor(makeSpec(), 2, '#222222')
      const next = insertCategoryAt(colored, 1)
      expect(next.data.labels).toEqual(['A', '', 'B', 'C'])
      expect(next.data.categoryColors).toEqual([undefined, undefined, undefined, '#222222'])
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeSpec()
      expect(insertCategoryAt(spec, -1)).toBe(spec)
      expect(insertCategoryAt(spec, 4)).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      insertCategoryAt(spec, 0, 'Z')
      expect(spec.data.labels).toEqual(['A', 'B', 'C'])
   })
})

describe('moveCategory', () => {
   it('reorders labels and every series value in lockstep', () => {
      const next = moveCategory(makeSpec(), 0, 2)
      expect(next.data.labels).toEqual(['B', 'C', 'A'])
      expect(next.data.series[0].values).toEqual([2, 3, 1])
      expect(next.data.series[1].values).toEqual([5, 6, 4])
      expectRectangular(next)
   })

   it('reorders an earlier target too (drag up)', () => {
      const next = moveCategory(makeSpec(), 2, 0)
      expect(next.data.labels).toEqual(['C', 'A', 'B'])
      expect(next.data.series[0].values).toEqual([3, 1, 2])
   })

   it('keeps categoryColors aligned to the labels through the move', () => {
      const colored = setCategoryColor(makeSpec(), 0, '#111111')
      const next = moveCategory(colored, 0, 2)
      expect(next.data.labels).toEqual(['B', 'C', 'A'])
      // The override rode along with category A to its new last position.
      expect(next.data.categoryColors).toEqual([undefined, undefined, '#111111'])
   })

   it('is a no-op when the indices are equal or out of range', () => {
      const spec = makeSpec()
      expect(moveCategory(spec, 1, 1)).toBe(spec)
      expect(moveCategory(spec, -1, 0)).toBe(spec)
      expect(moveCategory(spec, 0, 9)).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      moveCategory(spec, 0, 2)
      expect(spec.data.labels).toEqual(['A', 'B', 'C'])
      expect(spec.data.series[0].values).toEqual([1, 2, 3])
   })
})

describe('setLabel', () => {
   it('replaces the label at the index', () => {
      const next = setLabel(makeSpec(), 1, 'Beta')
      expect(next.data.labels).toEqual(['A', 'Beta', 'C'])
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeSpec()
      expect(setLabel(spec, 9, 'x')).toBe(spec)
   })
})

describe('addSeries', () => {
   it('appends a series backfilled with nulls to the label count', () => {
      const next = addSeries(makeSpec(), 'Three')
      expect(next.data.series).toHaveLength(3)
      expect(next.data.series[2].name).toBe('Three')
      expect(next.data.series[2].values).toEqual([null, null, null])
      expectRectangular(next)
   })

   it('caps at MAX_SERIES (8)', () => {
      let spec = makeSpec()
      // Start with 2, add until the cap, then one past it.
      for (let attempt = 0; attempt < 10; attempt++) {
         spec = addSeries(spec, `S${attempt}`)
      }
      expect(spec.data.series).toHaveLength(8)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      addSeries(spec, 'Three')
      expect(spec.data.series).toHaveLength(2)
   })
})

describe('removeSeries', () => {
   it('removes the series at the index', () => {
      const next = removeSeries(makeSpec(), 0)
      expect(next.data.series).toHaveLength(1)
      expect(next.data.series[0].name).toBe('Two')
   })

   it('is a no-op when only one series remains', () => {
      const single: GraphSpec = {
         type: 'bar',
         data: { labels: ['A'], series: [{ name: 'One', values: [1] }] },
         options: {},
      }
      expect(removeSeries(single, 0)).toBe(single)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeSpec()
      expect(removeSeries(spec, 5)).toBe(spec)
   })
})

describe('insertSeriesAt', () => {
   it('inserts a fresh series backfilled with nulls at the position', () => {
      const next = insertSeriesAt(makeSpec(), 1, 'Mid')
      expect(next.data.series).toHaveLength(3)
      expect(next.data.series[1]).toEqual({ name: 'Mid', values: [null, null, null] })
      expect(next.data.series[0].name).toBe('One')
      expect(next.data.series[2].name).toBe('Two')
      expectRectangular(next)
   })

   it('inserts at the front (index 0)', () => {
      const next = insertSeriesAt(makeSpec(), 0, 'First')
      expect(next.data.series[0].name).toBe('First')
      expect(next.data.series[1].name).toBe('One')
   })

   it('inserting at the series count appends (equivalent to addSeries)', () => {
      const next = insertSeriesAt(makeSpec(), 2, 'Three')
      expect(next.data.series[2].name).toBe('Three')
   })

   it('is a no-op once MAX_SERIES is reached', () => {
      let spec = makeSpec()
      for (let attempt = 0; attempt < 10; attempt++) spec = addSeries(spec, `S${attempt}`)
      expect(spec.data.series).toHaveLength(8)
      expect(insertSeriesAt(spec, 0, 'Over')).toBe(spec)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeSpec()
      expect(insertSeriesAt(spec, -1)).toBe(spec)
      expect(insertSeriesAt(spec, 3)).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      insertSeriesAt(spec, 0, 'First')
      expect(spec.data.series).toHaveLength(2)
   })
})

describe('moveSeries', () => {
   it('reorders the series array', () => {
      const next = moveSeries(makeSpec(), 0, 1)
      expect(next.data.series[0].name).toBe('Two')
      expect(next.data.series[1].name).toBe('One')
      // Each series keeps its own values through the move.
      expect(next.data.series[0].values).toEqual([4, 5, 6])
      expect(next.data.series[1].values).toEqual([1, 2, 3])
   })

   it('is a no-op when the indices are equal or out of range', () => {
      const spec = makeSpec()
      expect(moveSeries(spec, 0, 0)).toBe(spec)
      expect(moveSeries(spec, -1, 1)).toBe(spec)
      expect(moveSeries(spec, 0, 5)).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      moveSeries(spec, 0, 1)
      expect(spec.data.series[0].name).toBe('One')
   })
})

describe('setCategoryColor', () => {
   it('sets a per-category (per-slice) color override, padding the array to the label count', () => {
      const next = setCategoryColor(makeSpec(), 1, '#abcdef')
      expect(next.data.categoryColors).toEqual([undefined, '#abcdef', undefined])
   })

   it('clears the override and drops the whole array once every slot is cleared again', () => {
      const colored = setCategoryColor(makeSpec(), 2, '#abcdef')
      const cleared = setCategoryColor(colored, 2, undefined)
      expect('categoryColors' in cleared.data).toBe(false)
   })

   it('keeps other overrides when clearing one of several', () => {
      let spec = setCategoryColor(makeSpec(), 0, '#111111')
      spec = setCategoryColor(spec, 2, '#222222')
      const cleared = setCategoryColor(spec, 0, undefined)
      expect(cleared.data.categoryColors).toEqual([undefined, undefined, '#222222'])
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeSpec()
      expect(setCategoryColor(spec, 9, '#abcdef')).toBe(spec)
      expect(setCategoryColor(spec, -1, '#abcdef')).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      setCategoryColor(spec, 0, '#abcdef')
      expect(spec.data.categoryColors).toBeUndefined()
   })
})

describe('categoryColors alignment across add / remove category', () => {
   it('addCategory appends an undefined slot so the array stays aligned to labels', () => {
      const colored = setCategoryColor(makeSpec(), 0, '#111111')
      const next = addCategory(colored, 'D')
      expect(next.data.labels).toEqual(['A', 'B', 'C', 'D'])
      expect(next.data.categoryColors).toEqual(['#111111', undefined, undefined, undefined])
   })

   it('removeCategory splices the matching slot out so the array stays aligned to labels', () => {
      const colored = setCategoryColor(makeSpec(), 2, '#222222')
      const next = removeCategory(colored, 0)
      expect(next.data.labels).toEqual(['B', 'C'])
      expect(next.data.categoryColors).toEqual([undefined, '#222222'])
   })

   it('removeCategory drops the array entirely if it removes the last colored slot', () => {
      const colored = setCategoryColor(makeSpec(), 1, '#222222')
      const next = removeCategory(colored, 1)
      expect(next.data.labels).toEqual(['A', 'C'])
      expect('categoryColors' in next.data).toBe(false)
   })
})

describe('setSeriesName', () => {
   it('renames the series at the index', () => {
      const next = setSeriesName(makeSpec(), 0, 'Renamed')
      expect(next.data.series[0].name).toBe('Renamed')
      expect(next.data.series[1].name).toBe('Two')
   })
})

describe('setSeriesColor', () => {
   it('sets a per-series color override', () => {
      const next = setSeriesColor(makeSpec(), 0, '#abcdef')
      expect(next.data.series[0].color).toBe('#abcdef')
   })

   it('clears the override (drops the color key) when passed undefined', () => {
      const next = setSeriesColor(makeSpec(), 1, undefined)
      expect('color' in next.data.series[1]).toBe(false)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      setSeriesColor(spec, 0, '#abcdef')
      expect(spec.data.series[0].color).toBeUndefined()
   })
})

describe('setCell', () => {
   it('sets a numeric value at the cell', () => {
      const next = setCell(makeSpec(), 2, 0, 42)
      expect(next.data.series[0].values).toEqual([1, 2, 42])
   })

   it('sets null for a gap', () => {
      const next = setCell(makeSpec(), 0, 1, null)
      expect(next.data.series[1].values).toEqual([null, 5, 6])
   })

   it('is a no-op for an out-of-range row or series', () => {
      const spec = makeSpec()
      expect(setCell(spec, 9, 0, 1)).toBe(spec)
      expect(setCell(spec, 0, 9, 1)).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      setCell(spec, 0, 0, 99)
      expect(spec.data.series[0].values).toEqual([1, 2, 3])
   })
})

describe('setType', () => {
   it('switches the type while preserving data and options', () => {
      const next = setType(makeSpec(), 'line')
      expect(next.type).toBe('line')
      expect(next.data.labels).toEqual(['A', 'B', 'C'])
      expect(next.options).toEqual({ legend: true })
   })

   it('clears the explicit y-range on a type change so a function y-range never leaks to other charts', () => {
      const pinned = setOption(setOption(makeSpec(), 'yMin', -1000), 'yMax', 1000)
      const next = setType(pinned, 'line')
      expect(next.options.yMin).toBeUndefined()
      expect(next.options.yMax).toBeUndefined()
      expect(next.options.legend).toBe(true) // other options survive
   })

   it('leaves the y-range untouched when the type does not actually change', () => {
      const pinned = setOption(makeSpec(), 'yMax', 50)
      const next = setType(pinned, pinned.type)
      expect(next.options.yMax).toBe(50)
   })

   it('drops a stale yScale: "log" when switching to a type that cannot render it', () => {
      const logged = setOption(makeSpec(), 'yScale', 'log') // makeSpec() is type 'bar', log-eligible
      for (const incompatibleType of ['bar-stacked', 'pie', 'donut'] as const) {
         const next = setType(logged, incompatibleType)
         expect(next.options.yScale).toBeUndefined()
      }
   })

   it('keeps yScale: "log" when switching between two types that both support it', () => {
      const logged = setOption(makeSpec(), 'yScale', 'log')
      const next = setType(logged, 'line')
      expect(next.options.yScale).toBe('log')
   })

   it('leaves yScale untouched when the type does not actually change', () => {
      const logged = setOption(makeSpec(), 'yScale', 'log')
      const next = setType(logged, logged.type)
      expect(next.options.yScale).toBe('log')
   })

   it('drops a stale axisOrigin when switching to a type that cannot render textbook axes', () => {
      const withOrigin = setOption(setType(makeSpec(), 'scatter'), 'axisOrigin', { x: 1, y: 2 })
      for (const incompatibleType of ['bar', 'line', 'pie', 'histogram'] as const) {
         expect(setType(withOrigin, incompatibleType).options.axisOrigin).toBeUndefined()
      }
   })

   it('keeps axisOrigin when switching between the two continuous-x types (function <-> scatter)', () => {
      const withOrigin = setOption(setType(makeSpec(), 'scatter'), 'axisOrigin', { x: 0, y: 0 })
      expect(setType(withOrigin, 'function').options.axisOrigin).toEqual({ x: 0, y: 0 })
   })
})

describe('logScaleWouldFallBackToLinear', () => {
   it('is false when yScale is not "log"', () => {
      expect(logScaleWouldFallBackToLinear(makeSpec())).toBe(false)
      expect(logScaleWouldFallBackToLinear(setOption(makeSpec(), 'yScale', 'linear'))).toBe(false)
   })

   it('is false for a type that cannot support log at all, even if yScale is stray-set to "log"', () => {
      const stacked: GraphSpec = { ...setOption(makeSpec(), 'yScale', 'log'), type: 'bar-stacked' }
      expect(logScaleWouldFallBackToLinear(stacked)).toBe(false)
   })

   it('is false for a positive-only bar/line spec requesting log', () => {
      const spec = setOption(makeSpec(), 'yScale', 'log') // values [1,2,3] / [4,5,6], all positive
      expect(logScaleWouldFallBackToLinear(spec)).toBe(false)
   })

   it('is true for a bar/line spec whose data touches zero or negative', () => {
      const withZero: GraphSpec = {
         type: 'bar',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [0, 5] }] },
         options: { yScale: 'log' },
      }
      const withNegative: GraphSpec = {
         type: 'line',
         data: { labels: ['A', 'B'], series: [{ name: 'S', values: [-1, 5] }] },
         options: { yScale: 'log' },
      }
      expect(logScaleWouldFallBackToLinear(withZero)).toBe(true)
      expect(logScaleWouldFallBackToLinear(withNegative)).toBe(true)
   })

   // Reuses computeFunctionYDomain, the same expression-sampling pipeline renderFunctionPlot's own
   // axis-mode decision runs, so this reflects exactly what the renderer does, with no separately
   // maintained approximation that could drift and silently return the wrong verdict when a
   // sampled curve dips to or through zero.
   it('is false for a function chart whose sampled curve stays strictly positive', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         // exp(x) over [-10, 10] never touches zero.
         functionPlot: { domain: { xMin: -10, xMax: 10, samples: 50 }, equations: [{ name: 'f', expression: 'exp(x)' }] },
      }
      expect(logScaleWouldFallBackToLinear(spec)).toBe(false)
   })

   it('is true for a function chart whose sampled curve crosses zero', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         // f(x) = x over [-10, 10] samples straight through zero.
         functionPlot: { domain: { xMin: -10, xMax: 10, samples: 50 }, equations: [{ name: 'f', expression: 'x' }] },
      }
      expect(logScaleWouldFallBackToLinear(spec)).toBe(true)
   })

   it('is false for a function chart whose domain keeps it strictly positive (x^2 + 1)', () => {
      const spec: GraphSpec = {
         type: 'function',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         functionPlot: { domain: { xMin: -3, xMax: 3, samples: 50 }, equations: [{ name: 'f', expression: 'x^2 + 1' }] },
      }
      expect(logScaleWouldFallBackToLinear(spec)).toBe(false)
   })

   it('reflects a scatter series whose points touch y <= 0', () => {
      const positive: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         scatterPlot: { series: [{ name: 'A', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }] }] },
      }
      const touchesZero: GraphSpec = {
         type: 'scatter',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         scatterPlot: { series: [{ name: 'A', points: [{ x: 1, y: 0 }, { x: 2, y: 4 }] }] },
      }
      expect(logScaleWouldFallBackToLinear(positive)).toBe(false)
      expect(logScaleWouldFallBackToLinear(touchesZero)).toBe(true)
   })

   it('reflects whether a histogram has at least one positive bin count', () => {
      const withData: GraphSpec = {
         type: 'histogram',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         histogramData: { samples: [1, 2, 3, 4, 5] },
      }
      const empty: GraphSpec = {
         type: 'histogram',
         data: { labels: [], series: [] },
         options: { yScale: 'log' },
         histogramData: { samples: [] },
      }
      expect(logScaleWouldFallBackToLinear(withData)).toBe(false)
      expect(logScaleWouldFallBackToLinear(empty)).toBe(true)
   })
})

describe('setOption', () => {
   it('sets an option value', () => {
      const next = setOption(makeSpec(), 'title', 'Sales')
      expect(next.options.title).toBe('Sales')
      expect(next.options.legend).toBe(true)
   })

   it('deletes the key when passed undefined', () => {
      const next = setOption(makeSpec(), 'legend', undefined)
      expect('legend' in next.options).toBe(false)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      setOption(spec, 'title', 'Sales')
      expect(spec.options.title).toBeUndefined()
   })
})

describe('addOverlay', () => {
   it('appends an overlay, creating the array on the first add', () => {
      const next = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      expect(next.options.overlays).toEqual([{ kind: 'mean', series: 0 }])
   })

   it('appends to an existing overlay array in order', () => {
      const one = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      const two = addOverlay(one, { kind: 'reference', value: 5 })
      expect(two.options.overlays).toEqual([
         { kind: 'mean', series: 0 },
         { kind: 'reference', value: 5 },
      ])
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      addOverlay(spec, { kind: 'mean', series: 0 })
      expect(spec.options.overlays).toBeUndefined()
   })
})

describe('removeOverlay', () => {
   it('removes the overlay at the index', () => {
      const withTwo = addOverlay(
         addOverlay(makeSpec(), { kind: 'mean', series: 0 }),
         { kind: 'trend', series: 1 },
      )
      const next = removeOverlay(withTwo, 0)
      expect(next.options.overlays).toEqual([{ kind: 'trend', series: 1 }])
   })

   it('drops the overlays key entirely once the last one is removed', () => {
      const withOne = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      const next = removeOverlay(withOne, 0)
      expect('overlays' in next.options).toBe(false)
   })

   it('is a no-op for an out-of-range index', () => {
      const withOne = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      expect(removeOverlay(withOne, 9)).toBe(withOne)
      expect(removeOverlay(withOne, -1)).toBe(withOne)
   })
})

describe('updateOverlay', () => {
   it('shallow-merges a partial onto the overlay at the index', () => {
      const withOne = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      const next = updateOverlay(withOne, 0, { series: 'all' })
      expect(next.options.overlays).toEqual([{ kind: 'mean', series: 'all' }])
   })

   it('can change the kind and add fields', () => {
      const withOne = addOverlay(makeSpec(), { kind: 'trend', series: 0 })
      const next = updateOverlay(withOne, 0, { showEquation: true })
      expect(next.options.overlays).toEqual([{ kind: 'trend', series: 0, showEquation: true }])
   })

   it('is a no-op for an out-of-range index', () => {
      const withOne = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      expect(updateOverlay(withOne, 5, { series: 1 })).toBe(withOne)
   })

   it('does not mutate the input spec', () => {
      const withOne = addOverlay(makeSpec(), { kind: 'mean', series: 0 })
      updateOverlay(withOne, 0, { series: 'all' })
      expect(withOne.options.overlays).toEqual([{ kind: 'mean', series: 0 }])
   })
})

// ##################################################
// # functionPlot passthrough (withData/setType/setOption)
// ##################################################
// Every generic data/option transform must carry an existing `functionPlot` through unchanged. If
// `withData`/`setType`/`setOption` rebuilt the spec from named fields alone, they would silently
// drop it, wiping an author's equations on the next option toggle (title, legend, and so on) on a
// `function` chart.

describe('functionPlot passthrough', () => {
   it('setOption preserves functionPlot on a function-type spec', () => {
      const next = setOption(makeFunctionSpec(), 'title', 'My curve')
      expect(next.functionPlot).toEqual(makeFunctionSpec().functionPlot)
      expect(next.options.title).toBe('My curve')
   })

   it('setType preserves an existing functionPlot when the type stays function', () => {
      const spec = makeFunctionSpec()
      const next = setType(spec, 'function')
      expect(next.functionPlot).toEqual(spec.functionPlot)
   })

   it('setType seeds a default functionPlot the first time a spec switches to function', () => {
      const next = setType(makeSpec(), 'function')
      expect(next.functionPlot).toBeDefined()
      expect(next.functionPlot?.domain).toEqual({
         xMin: FUNCTION_DEFAULT_X_MIN,
         xMax: FUNCTION_DEFAULT_X_MAX,
         samples: FUNCTION_DEFAULT_SAMPLES,
      })
      expect(next.functionPlot?.equations.length).toBe(1)
   })

   it('setType leaves functionPlot untouched when switching between non-function types', () => {
      const next = setType(makeSpec(), 'line')
      expect(next.functionPlot).toBeUndefined()
   })
})

describe('addEquation', () => {
   it('appends a new blank equation', () => {
      const next = addEquation(makeFunctionSpec())
      expect(next.functionPlot?.equations.length).toBe(3)
      expect(next.functionPlot?.equations[2]).toEqual({ name: 'h', expression: '' })
   })

   it('seeds a default functionPlot when the spec has never been a function chart', () => {
      const next = addEquation(makeSpec())
      expect(next.functionPlot?.equations.length).toBe(2)
      expect(next.functionPlot?.domain).toEqual({
         xMin: FUNCTION_DEFAULT_X_MIN,
         xMax: FUNCTION_DEFAULT_X_MAX,
         samples: FUNCTION_DEFAULT_SAMPLES,
      })
   })

   it('caps at MAX_SERIES equations', () => {
      let spec = makeFunctionSpec()
      for (let count = 0; count < 10; count++) spec = addEquation(spec)
      expect(spec.functionPlot?.equations.length).toBe(8)
   })

   it('does not mutate the input spec', () => {
      const spec = makeFunctionSpec()
      addEquation(spec)
      expect(spec.functionPlot?.equations.length).toBe(2)
   })
})

describe('removeEquation', () => {
   it('removes the equation at the index', () => {
      const next = removeEquation(makeFunctionSpec(), 0)
      expect(next.functionPlot?.equations).toEqual([{ name: 'g', expression: 'cos(x)', color: '#123456' }])
   })

   it('is a no-op when it would remove the last equation', () => {
      const oneEquation: GraphSpec = {
         ...makeFunctionSpec(),
         functionPlot: { domain: { xMin: -10, xMax: 10, samples: 200 }, equations: [{ name: 'f', expression: 'sin(x)' }] },
      }
      const next = removeEquation(oneEquation, 0)
      expect(next.functionPlot?.equations.length).toBe(1)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeFunctionSpec()
      const next = removeEquation(spec, 9)
      expect(next.functionPlot?.equations).toEqual(spec.functionPlot?.equations)
   })
})

describe('setEquationField', () => {
   it('sets the name field', () => {
      const next = setEquationField(makeFunctionSpec(), 0, 'name', 'sine')
      expect(next.functionPlot?.equations[0]).toEqual({ name: 'sine', expression: 'sin(x)' })
   })

   it('sets the expression field, even to an uncompileable value', () => {
      const next = setEquationField(makeFunctionSpec(), 0, 'expression', 'sin(')
      expect(next.functionPlot?.equations[0].expression).toBe('sin(')
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeFunctionSpec()
      const next = setEquationField(spec, 9, 'name', 'nope')
      expect(next.functionPlot?.equations).toEqual(spec.functionPlot?.equations)
   })

   it('does not mutate the input spec', () => {
      const spec = makeFunctionSpec()
      setEquationField(spec, 0, 'name', 'sine')
      expect(spec.functionPlot?.equations[0].name).toBe('f')
   })
})

describe('setEquationColor', () => {
   it('sets a color override', () => {
      const next = setEquationColor(makeFunctionSpec(), 0, '#abcdef')
      expect(next.functionPlot?.equations[0].color).toBe('#abcdef')
   })

   it('clears the override when passed undefined', () => {
      const next = setEquationColor(makeFunctionSpec(), 1, undefined)
      expect('color' in next.functionPlot!.equations[1]).toBe(false)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeFunctionSpec()
      const next = setEquationColor(spec, 9, '#abcdef')
      expect(next.functionPlot?.equations).toEqual(spec.functionPlot?.equations)
   })
})

describe('setDomain', () => {
   it('shallow-merges a partial onto the domain', () => {
      const next = setDomain(makeFunctionSpec(), { xMin: -5 })
      expect(next.functionPlot?.domain).toEqual({ xMin: -5, xMax: 10, samples: 200 })
   })

   it('clamps samples to FUNCTION_MIN_SAMPLES..FUNCTION_MAX_SAMPLES', () => {
      const tooFew = setDomain(makeFunctionSpec(), { samples: 1 })
      expect(tooFew.functionPlot?.domain.samples).toBe(FUNCTION_MIN_SAMPLES)
      const tooMany = setDomain(makeFunctionSpec(), { samples: 999999 })
      expect(tooMany.functionPlot?.domain.samples).toBe(FUNCTION_MAX_SAMPLES)
   })

   it('rounds a fractional sample count', () => {
      const next = setDomain(makeFunctionSpec(), { samples: 150.6 })
      expect(next.functionPlot?.domain.samples).toBe(151)
   })

   it('seeds a default functionPlot when the spec has never been a function chart', () => {
      const next = setDomain(makeSpec(), { xMin: -3 })
      expect(next.functionPlot?.domain.xMin).toBe(-3)
      expect(next.functionPlot?.domain.xMax).toBe(FUNCTION_DEFAULT_X_MAX)
   })

   it('does not mutate the input spec', () => {
      const spec = makeFunctionSpec()
      setDomain(spec, { xMin: -5 })
      expect(spec.functionPlot?.domain.xMin).toBe(-10)
   })
})

describe('insertEquationAt', () => {
   it('inserts a fresh blank equation at the position, shifting later equations down', () => {
      const next = insertEquationAt(makeFunctionSpec(), 1)
      expect(next.functionPlot?.equations.map(equation => equation.name)).toEqual(['f', 'h', 'g'])
      expect(next.functionPlot?.equations[1]).toEqual({ name: 'h', expression: '' })
   })

   it('inserts at the front (index 0)', () => {
      const next = insertEquationAt(makeFunctionSpec(), 0)
      expect(next.functionPlot?.equations[0]).toEqual({ name: 'h', expression: '' })
      expect(next.functionPlot?.equations[1].name).toBe('f')
   })

   it('inserting at the equation count appends (equivalent to addEquation)', () => {
      const next = insertEquationAt(makeFunctionSpec(), 2)
      expect(next.functionPlot?.equations.length).toBe(3)
      expect(next.functionPlot?.equations[2]).toEqual({ name: 'h', expression: '' })
   })

   it('is a no-op once MAX_SERIES is reached', () => {
      let spec = makeFunctionSpec()
      for (let count = 0; count < 10; count++) spec = addEquation(spec)
      expect(spec.functionPlot?.equations.length).toBe(8)
      expect(insertEquationAt(spec, 0).functionPlot?.equations.length).toBe(8)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeFunctionSpec()
      expect(insertEquationAt(spec, -1).functionPlot?.equations).toEqual(spec.functionPlot?.equations)
      expect(insertEquationAt(spec, 3).functionPlot?.equations).toEqual(spec.functionPlot?.equations)
   })

   it('does not mutate the input spec', () => {
      const spec = makeFunctionSpec()
      insertEquationAt(spec, 0)
      expect(spec.functionPlot?.equations.length).toBe(2)
   })
})

describe('moveEquation', () => {
   it('reorders the equations array', () => {
      const next = moveEquation(makeFunctionSpec(), 0, 1)
      expect(next.functionPlot?.equations.map(equation => equation.name)).toEqual(['g', 'f'])
      // Each equation keeps its own fields (color included) through the move.
      expect(next.functionPlot?.equations[0]).toEqual({ name: 'g', expression: 'cos(x)', color: '#123456' })
   })

   it('is a no-op when the indices are equal or out of range', () => {
      const spec = makeFunctionSpec()
      expect(moveEquation(spec, 1, 1).functionPlot?.equations).toEqual(spec.functionPlot?.equations)
      expect(moveEquation(spec, -1, 0).functionPlot?.equations).toEqual(spec.functionPlot?.equations)
      expect(moveEquation(spec, 0, 5).functionPlot?.equations).toEqual(spec.functionPlot?.equations)
   })

   it('does not mutate the input spec', () => {
      const spec = makeFunctionSpec()
      moveEquation(spec, 0, 1)
      expect(spec.functionPlot?.equations[0].name).toBe('f')
   })
})

// ##################################################
// # scatterPlot passthrough (withData/setType/setOption)
// ##################################################
// Every generic data/option transform carries `scatterPlot` through unchanged because
// `withData`/`setType`/`setOption` rebuild the spec via `{ ...spec, ... }`, so this just locks
// that behavior in with its own tests.

describe('scatterPlot passthrough', () => {
   it('setOption preserves scatterPlot on a scatter-type spec', () => {
      const next = setOption(makeScatterSpec(), 'title', 'My scatter')
      expect(next.scatterPlot).toEqual(makeScatterSpec().scatterPlot)
      expect(next.options.title).toBe('My scatter')
   })

   it('setType preserves an existing scatterPlot when the type stays scatter', () => {
      const spec = makeScatterSpec()
      const next = setType(spec, 'scatter')
      expect(next.scatterPlot).toEqual(spec.scatterPlot)
   })

   it('setType seeds a default scatterPlot the first time a spec switches to scatter', () => {
      const next = setType(makeSpec(), 'scatter')
      expect(next.scatterPlot).toEqual({ series: [{ name: '', points: [{ x: 0, y: 0 }] }] })
   })

   it('setType leaves scatterPlot untouched when switching between non-scatter types', () => {
      const next = setType(makeSpec(), 'line')
      expect(next.scatterPlot).toBeUndefined()
   })
})

// ####################################################
// # histogramData passthrough (withData/setType/setOption)
// ####################################################
// Every generic data/option transform carries `histogramData` through unchanged because
// `withData`/`setType`/`setOption` rebuild the spec via `{ ...spec, ... }`, so this just locks
// that behavior in with its own tests.

describe('histogramData passthrough', () => {
   it('setOption preserves histogramData on a histogram-type spec', () => {
      const next = setOption(makeHistogramSpec(), 'title', 'My histogram')
      expect(next.histogramData).toEqual(makeHistogramSpec().histogramData)
      expect(next.options.title).toBe('My histogram')
   })

   it('setType preserves an existing histogramData when the type stays histogram', () => {
      const spec = makeHistogramSpec()
      const next = setType(spec, 'histogram')
      expect(next.histogramData).toEqual(spec.histogramData)
   })

   it('setType seeds a default histogramData the first time a spec switches to histogram', () => {
      const next = setType(makeSpec(), 'histogram')
      expect(next.histogramData).toEqual({ samples: [1, 2, 2, 3, 3, 3, 4, 4, 5] })
   })

   it('setType leaves histogramData untouched when switching between non-histogram types', () => {
      const next = setType(makeSpec(), 'line')
      expect(next.histogramData).toBeUndefined()
   })
})

describe('setHistogramSamples', () => {
   it('replaces the whole raw sample list', () => {
      const next = setHistogramSamples(makeHistogramSpec(), [10, 20, 30])
      expect(next.histogramData?.samples).toEqual([10, 20, 30])
   })

   it('preserves bins/name/color while replacing the samples', () => {
      const next = setHistogramSamples(makeHistogramSpec(), [10, 20, 30])
      expect(next.histogramData).toEqual({ samples: [10, 20, 30], bins: 3, name: 'A', color: '#123456' })
   })

   it('seeds a default histogramData when the spec has never been a histogram chart', () => {
      const next = setHistogramSamples(makeSpec(), [7, 8])
      expect(next.histogramData?.samples).toEqual([7, 8])
   })

   it('accepts an empty sample list (the renderer degrades gracefully, not this transform)', () => {
      const next = setHistogramSamples(makeHistogramSpec(), [])
      expect(next.histogramData?.samples).toEqual([])
   })

   it('does not mutate the input spec', () => {
      const spec = makeHistogramSpec()
      setHistogramSamples(spec, [99])
      expect(spec.histogramData?.samples).toEqual([1, 2, 3, 4, 5])
   })
})

describe('setHistogramBins', () => {
   it('sets a manual bin-count override', () => {
      const next = setHistogramBins(makeHistogramSpec(), 10)
      expect(next.histogramData?.bins).toBe(10)
   })

   it('rounds a fractional bin count', () => {
      const next = setHistogramBins(makeHistogramSpec(), 10.6)
      expect(next.histogramData?.bins).toBe(11)
   })

   it('clamps below HISTOGRAM_MIN_BINS up to 1', () => {
      const next = setHistogramBins(makeHistogramSpec(), 0)
      expect(next.histogramData?.bins).toBe(1)
   })

   it('clamps above HISTOGRAM_MAX_BINS down to 50', () => {
      const next = setHistogramBins(makeHistogramSpec(), 500)
      expect(next.histogramData?.bins).toBe(50)
   })

   it('clears the override (back to auto/Sturges) when passed undefined', () => {
      const next = setHistogramBins(makeHistogramSpec(), undefined)
      expect('bins' in next.histogramData!).toBe(false)
   })

   it('seeds a default histogramData when the spec has never been a histogram chart', () => {
      const next = setHistogramBins(makeSpec(), 6)
      expect(next.histogramData?.bins).toBe(6)
   })
})

describe('setHistogramName', () => {
   it('sets the dataset name', () => {
      const next = setHistogramName(makeHistogramSpec(), 'Renamed')
      expect(next.histogramData?.name).toBe('Renamed')
   })

   it('seeds a default histogramData when the spec has never been a histogram chart', () => {
      const next = setHistogramName(makeSpec(), 'Fresh')
      expect(next.histogramData?.name).toBe('Fresh')
   })

   it('does not mutate the input spec', () => {
      const spec = makeHistogramSpec()
      setHistogramName(spec, 'Renamed')
      expect(spec.histogramData?.name).toBe('A')
   })
})

describe('setHistogramColor', () => {
   it('sets a color override', () => {
      const next = setHistogramColor(makeHistogramSpec(), '#abcdef')
      expect(next.histogramData?.color).toBe('#abcdef')
   })

   it('clears the override when passed undefined', () => {
      const next = setHistogramColor(makeHistogramSpec(), undefined)
      expect('color' in next.histogramData!).toBe(false)
   })

   it('seeds a default histogramData when the spec has never been a histogram chart', () => {
      const next = setHistogramColor(makeSpec(), '#abcdef')
      expect(next.histogramData?.color).toBe('#abcdef')
   })
})

describe('addScatterSeries', () => {
   it('appends a new series seeded with a single origin point', () => {
      const next = addScatterSeries(makeScatterSpec(), 'C')
      expect(next.scatterPlot?.series.length).toBe(3)
      expect(next.scatterPlot?.series[2]).toEqual({ name: 'C', points: [{ x: 0, y: 0 }] })
   })

   it('defaults the name to empty string', () => {
      const next = addScatterSeries(makeScatterSpec())
      expect(next.scatterPlot?.series[2].name).toBe('')
   })

   it('seeds a default scatterPlot when the spec has never been a scatter chart', () => {
      const next = addScatterSeries(makeSpec())
      expect(next.scatterPlot?.series.length).toBe(2)
      expect(next.scatterPlot?.series[0]).toEqual({ name: '', points: [{ x: 0, y: 0 }] })
   })

   it('caps at MAX_SERIES series', () => {
      let spec = makeScatterSpec()
      for (let count = 0; count < 10; count++) spec = addScatterSeries(spec)
      expect(spec.scatterPlot?.series.length).toBe(8)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      addScatterSeries(spec)
      expect(spec.scatterPlot?.series.length).toBe(2)
   })
})

describe('removeScatterSeries', () => {
   it('removes the series at the index', () => {
      const next = removeScatterSeries(makeScatterSpec(), 0)
      expect(next.scatterPlot?.series).toEqual([{ name: 'B', points: [{ x: 5, y: 6 }], color: '#123456' }])
   })

   it('is a no-op when it would remove the last series', () => {
      const oneSeries: GraphSpec = {
         ...makeScatterSpec(),
         scatterPlot: { series: [{ name: 'A', points: [{ x: 1, y: 2 }] }] },
      }
      const next = removeScatterSeries(oneSeries, 0)
      expect(next.scatterPlot?.series.length).toBe(1)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeScatterSpec()
      const next = removeScatterSeries(spec, 9)
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })
})

describe('setScatterSeriesName', () => {
   it('sets the name field', () => {
      const next = setScatterSeriesName(makeScatterSpec(), 0, 'Renamed')
      expect(next.scatterPlot?.series[0].name).toBe('Renamed')
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeScatterSpec()
      const next = setScatterSeriesName(spec, 9, 'nope')
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      setScatterSeriesName(spec, 0, 'Renamed')
      expect(spec.scatterPlot?.series[0].name).toBe('A')
   })
})

describe('setScatterSeriesColor', () => {
   it('sets a color override', () => {
      const next = setScatterSeriesColor(makeScatterSpec(), 0, '#abcdef')
      expect(next.scatterPlot?.series[0].color).toBe('#abcdef')
   })

   it('clears the override when passed undefined', () => {
      const next = setScatterSeriesColor(makeScatterSpec(), 1, undefined)
      expect('color' in next.scatterPlot!.series[1]).toBe(false)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeScatterSpec()
      const next = setScatterSeriesColor(spec, 9, '#abcdef')
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })
})

describe('addScatterPoint', () => {
   it('appends a blank (non-finite) point to the series by default', () => {
      const next = addScatterPoint(makeScatterSpec(), 1)
      expect(next.scatterPlot?.series[1].points).toEqual([{ x: 5, y: 6 }, { x: NaN, y: NaN }])
   })

   it('appends a given point to the series', () => {
      const next = addScatterPoint(makeScatterSpec(), 0, { x: 9, y: 10 })
      expect(next.scatterPlot?.series[0].points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 9, y: 10 }])
   })

   it('is a no-op (scatterPlot merely seeded) for an out-of-range series index', () => {
      const spec = makeScatterSpec()
      const next = addScatterPoint(spec, 9)
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      addScatterPoint(spec, 0)
      expect(spec.scatterPlot?.series[0].points.length).toBe(2)
   })
})

describe('removeScatterPoint', () => {
   it('removes the point at the index', () => {
      const next = removeScatterPoint(makeScatterSpec(), 0, 0)
      expect(next.scatterPlot?.series[0].points).toEqual([{ x: 3, y: 4 }])
   })

   it('is a no-op when it would remove a series last point', () => {
      const next = removeScatterPoint(makeScatterSpec(), 1, 0)
      expect(next.scatterPlot?.series[1].points).toEqual([{ x: 5, y: 6 }])
   })

   it('is a no-op for an out-of-range series index', () => {
      const spec = makeScatterSpec()
      const next = removeScatterPoint(spec, 9, 0)
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('is a no-op for an out-of-range point index', () => {
      const spec = makeScatterSpec()
      const next = removeScatterPoint(spec, 0, 9)
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })
})

describe('setScatterPointField', () => {
   it('sets the x field', () => {
      const next = setScatterPointField(makeScatterSpec(), 0, 1, 'x', 30)
      expect(next.scatterPlot?.series[0].points[1]).toEqual({ x: 30, y: 4 })
   })

   it('sets the y field', () => {
      const next = setScatterPointField(makeScatterSpec(), 0, 1, 'y', 40)
      expect(next.scatterPlot?.series[0].points[1]).toEqual({ x: 3, y: 40 })
   })

   it('is a no-op for an out-of-range series index', () => {
      const spec = makeScatterSpec()
      const next = setScatterPointField(spec, 9, 0, 'x', 1)
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('is a no-op for an out-of-range point index', () => {
      const spec = makeScatterSpec()
      const next = setScatterPointField(spec, 0, 9, 'x', 1)
      expect(next.scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      setScatterPointField(spec, 0, 0, 'x', 99)
      expect(spec.scatterPlot?.series[0].points[0]).toEqual({ x: 1, y: 2 })
   })
})

describe('insertScatterSeriesAt', () => {
   it('inserts a fresh series (one origin point) at the position, shifting later series down', () => {
      const next = insertScatterSeriesAt(makeScatterSpec(), 1)
      expect(next.scatterPlot?.series.map(series => series.name)).toEqual(['A', '', 'B'])
      expect(next.scatterPlot?.series[1]).toEqual({ name: '', points: [{ x: 0, y: 0 }] })
   })

   it('inserts at the front (index 0) with a given name', () => {
      const next = insertScatterSeriesAt(makeScatterSpec(), 0, 'First')
      expect(next.scatterPlot?.series[0]).toEqual({ name: 'First', points: [{ x: 0, y: 0 }] })
      expect(next.scatterPlot?.series[1].name).toBe('A')
   })

   it('inserting at the series count appends (equivalent to addScatterSeries)', () => {
      const next = insertScatterSeriesAt(makeScatterSpec(), 2, 'End')
      expect(next.scatterPlot?.series[2]).toEqual({ name: 'End', points: [{ x: 0, y: 0 }] })
   })

   it('is a no-op once MAX_SERIES is reached', () => {
      let spec = makeScatterSpec()
      for (let count = 0; count < 10; count++) spec = addScatterSeries(spec)
      expect(spec.scatterPlot?.series.length).toBe(8)
      expect(insertScatterSeriesAt(spec, 0).scatterPlot?.series.length).toBe(8)
   })

   it('is a no-op for an out-of-range index', () => {
      const spec = makeScatterSpec()
      expect(insertScatterSeriesAt(spec, -1).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
      expect(insertScatterSeriesAt(spec, 3).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      insertScatterSeriesAt(spec, 0, 'First')
      expect(spec.scatterPlot?.series.length).toBe(2)
   })
})

describe('moveScatterSeries', () => {
   it('reorders the series array', () => {
      const next = moveScatterSeries(makeScatterSpec(), 0, 1)
      expect(next.scatterPlot?.series.map(series => series.name)).toEqual(['B', 'A'])
      // Each series keeps its own points (color included) through the move.
      expect(next.scatterPlot?.series[0]).toEqual({ name: 'B', points: [{ x: 5, y: 6 }], color: '#123456' })
   })

   it('is a no-op when the indices are equal or out of range', () => {
      const spec = makeScatterSpec()
      expect(moveScatterSeries(spec, 1, 1).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
      expect(moveScatterSeries(spec, -1, 0).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
      expect(moveScatterSeries(spec, 0, 5).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      moveScatterSeries(spec, 0, 1)
      expect(spec.scatterPlot?.series[0].name).toBe('A')
   })
})

describe('insertScatterPointAt', () => {
   it('inserts a blank (non-finite) point at the position within the series, shifting later points down', () => {
      const next = insertScatterPointAt(makeScatterSpec(), 0, 1)
      expect(next.scatterPlot?.series[0].points).toEqual([{ x: 1, y: 2 }, { x: NaN, y: NaN }, { x: 3, y: 4 }])
   })

   it('inserts a given point at the front (index 0)', () => {
      const next = insertScatterPointAt(makeScatterSpec(), 0, 0, { x: 9, y: 10 })
      expect(next.scatterPlot?.series[0].points).toEqual([{ x: 9, y: 10 }, { x: 1, y: 2 }, { x: 3, y: 4 }])
   })

   it('inserting at the point count appends (equivalent to addScatterPoint)', () => {
      const next = insertScatterPointAt(makeScatterSpec(), 1, 1, { x: 7, y: 8 })
      expect(next.scatterPlot?.series[1].points).toEqual([{ x: 5, y: 6 }, { x: 7, y: 8 }])
   })

   it('leaves the other series untouched', () => {
      const next = insertScatterPointAt(makeScatterSpec(), 0, 0, { x: 9, y: 10 })
      expect(next.scatterPlot?.series[1].points).toEqual([{ x: 5, y: 6 }])
   })

   it('is a no-op for an out-of-range series or point index', () => {
      const spec = makeScatterSpec()
      expect(insertScatterPointAt(spec, 9, 0).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
      expect(insertScatterPointAt(spec, 0, 9).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      insertScatterPointAt(spec, 0, 0, { x: 9, y: 10 })
      expect(spec.scatterPlot?.series[0].points.length).toBe(2)
   })
})

describe('moveScatterPoint', () => {
   it('reorders the points within one series only', () => {
      const next = moveScatterPoint(makeScatterSpec(), 0, 0, 1)
      expect(next.scatterPlot?.series[0].points).toEqual([{ x: 3, y: 4 }, { x: 1, y: 2 }])
      // The other series is untouched.
      expect(next.scatterPlot?.series[1].points).toEqual([{ x: 5, y: 6 }])
   })

   it('is a no-op when the point indices are equal or out of range', () => {
      const spec = makeScatterSpec()
      expect(moveScatterPoint(spec, 0, 1, 1).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
      expect(moveScatterPoint(spec, 0, -1, 0).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
      expect(moveScatterPoint(spec, 0, 0, 5).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('is a no-op for an out-of-range series index', () => {
      const spec = makeScatterSpec()
      expect(moveScatterPoint(spec, 9, 0, 1).scatterPlot?.series).toEqual(spec.scatterPlot?.series)
   })

   it('does not mutate the input spec', () => {
      const spec = makeScatterSpec()
      moveScatterPoint(spec, 0, 0, 1)
      expect(spec.scatterPlot?.series[0].points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }])
   })
})

// ##############################
// # TABLE LINK EDITOR            #
// ##############################

describe('setSource', () => {
   it('sets source to the default mapping ({ handle }) on an unlinked spec', () => {
      const next = setSource(makeSpec(), 'sales-2026')
      expect(next.source).toEqual({ handle: 'sales-2026' })
   })

   it('overwrites an existing source (re-link / change table)', () => {
      const spec: GraphSpec = { ...makeSpec(), source: { handle: 'old', labelColumn: 1, orient: 'rows' } }
      const next = setSource(spec, 'new-table')
      expect(next.source).toEqual({ handle: 'new-table' })
   })

   it('leaves data untouched', () => {
      const spec = makeSpec()
      const next = setSource(spec, 'sales-2026')
      expect(next.data).toBe(spec.data)
   })

   it('does not mutate the input spec', () => {
      const spec = makeSpec()
      setSource(spec, 'sales-2026')
      expect(spec.source).toBeUndefined()
   })
})

describe('updateSourceMapping', () => {
   it('shallow-merges labelColumn / orient onto the existing source', () => {
      const spec: GraphSpec = { ...makeSpec(), source: { handle: 'sales-2026' } }
      const next = updateSourceMapping(spec, { labelColumn: 2 })
      expect(next.source).toEqual({ handle: 'sales-2026', labelColumn: 2 })
      const next2 = updateSourceMapping(next, { orient: 'rows' })
      expect(next2.source).toEqual({ handle: 'sales-2026', labelColumn: 2, orient: 'rows' })
   })

   it('is a no-op when the spec is not linked', () => {
      const spec = makeSpec()
      expect(updateSourceMapping(spec, { labelColumn: 1 })).toBe(spec)
   })

   it('does not mutate the input spec', () => {
      const spec: GraphSpec = { ...makeSpec(), source: { handle: 'sales-2026' } }
      updateSourceMapping(spec, { labelColumn: 2 })
      expect(spec.source).toEqual({ handle: 'sales-2026' })
   })
})

describe('unlinkSource', () => {
   it('materializes the given snapshot onto data and drops source', () => {
      const spec: GraphSpec = { ...makeSpec(), source: { handle: 'sales-2026', labelColumn: 1 } }
      const snapshot: GraphData = { labels: ['X'], series: [{ name: 'Live', values: [42] }] }
      const next = unlinkSource(spec, snapshot)
      expect(next.source).toBeUndefined()
      expect(next.data).toEqual(snapshot)
   })

   it('is a no-op on source when the spec was never linked (still applies the snapshot)', () => {
      const spec = makeSpec()
      const snapshot: GraphData = { labels: ['X'], series: [{ name: 'Live', values: [42] }] }
      const next = unlinkSource(spec, snapshot)
      expect(next.source).toBeUndefined()
      expect(next.data).toEqual(snapshot)
   })

   it('does not mutate the input spec', () => {
      const spec: GraphSpec = { ...makeSpec(), source: { handle: 'sales-2026' } }
      const snapshot: GraphData = { labels: ['X'], series: [{ name: 'Live', values: [42] }] }
      unlinkSource(spec, snapshot)
      expect(spec.source).toEqual({ handle: 'sales-2026' })
   })
})

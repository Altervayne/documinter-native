/**
 * graphEdit.test.ts, unit coverage for the pure graph-editor structural transforms.
 *
 * Focus: the two invariants (rectangular arrays, keep-at-least-one) and the "fresh spec, input
 * untouched" contract. Mirrors mathStructures.test.ts in spirit — a pure-lib safety net that the
 * data-grid UI leans on.
 */

import { describe, it, expect } from 'vitest'
import type { GraphSpec } from './graph'
import {
   addCategory,
   removeCategory,
   setLabel,
   setCategoryColor,
   addSeries,
   removeSeries,
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
   setEquationField,
   setEquationColor,
   setDomain,
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
// # functionPlot passthrough (the withData/setType/setOption fix)
// ##################################################
// Every generic data/option transform must carry an existing `functionPlot` through unchanged —
// before this fix, `withData`/`setType`/`setOption` rebuilt the spec from named fields and
// silently dropped it, which would have wiped an author's equations on the very next option
// toggle (title, legend, ...) on a `function` chart.

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

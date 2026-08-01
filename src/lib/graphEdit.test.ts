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
   addSeries,
   removeSeries,
   setSeriesName,
   setSeriesColor,
   setCell,
   setType,
   setOption,
} from './graphEdit'

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

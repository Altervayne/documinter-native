import { describe, it, expect } from 'vitest'
import { computeHistogramBins } from './histogram'

// #####################
// # AUTO (STURGES)    #
// #####################

describe('computeHistogramBins, auto bin count (Sturges\' rule)', () => {
   it('resolves ceil(log2(n)) + 1 bins for a representative sample count', () => {
      // n = 8 -> ceil(log2(8)) + 1 = 3 + 1 = 4
      const eightSamples = [1, 2, 3, 4, 5, 6, 7, 8]
      expect(computeHistogramBins(eightSamples).counts.length).toBe(4)
   })

   it('resolves a larger bin count for a larger sample count', () => {
      // n = 100 -> ceil(log2(100)) + 1 = 7 + 1 = 8
      const hundredSamples = Array.from({ length: 100 }, (_unused, index) => index)
      expect(computeHistogramBins(hundredSamples).counts.length).toBe(8)
   })

   it('never exceeds HISTOGRAM_MAX_BINS for a large sample count', () => {
      // The auto-Sturges clamp is a defensive backstop (Sturges alone would need an unrealistic
      // ~5.6e14 samples to exceed 50), so this pins the invariant rather than the clamp firing.
      const manySamples = Array.from({ length: 2000 }, (_unused, index) => index)
      expect(computeHistogramBins(manySamples).counts.length).toBeLessThanOrEqual(50)
   })
})

// #####################
// # MANUAL OVERRIDE   #
// #####################

describe('computeHistogramBins, manual bin-count override', () => {
   it('uses the requested bin count when it is within range', () => {
      const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      expect(computeHistogramBins(samples, 5).counts.length).toBe(5)
   })

   it('rounds a fractional requested bin count', () => {
      const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      expect(computeHistogramBins(samples, 5.4).counts.length).toBe(5)
   })

   it('clamps a requested bin count below HISTOGRAM_MIN_BINS up to 1', () => {
      const samples = [1, 2, 3, 4, 5]
      expect(computeHistogramBins(samples, 0).counts.length).toBe(1)
      expect(computeHistogramBins(samples, -5).counts.length).toBe(1)
   })

   it('clamps a requested bin count above HISTOGRAM_MAX_BINS down to 50', () => {
      const samples = Array.from({ length: 200 }, (_unused, index) => index)
      expect(computeHistogramBins(samples, 500).counts.length).toBe(50)
   })

   it('ignores a non-finite requested bin count, falling back to Sturges', () => {
      const eightSamples = [1, 2, 3, 4, 5, 6, 7, 8]
      const auto = computeHistogramBins(eightSamples)
      expect(computeHistogramBins(eightSamples, Number.NaN)).toEqual(auto)
   })
})

// #####################
// # DEGENERATE INPUT  #
// #####################

describe('computeHistogramBins, degenerate / empty input', () => {
   it('returns an empty result for an empty sample list', () => {
      expect(computeHistogramBins([])).toEqual({ edges: [], counts: [] })
   })

   it('returns an empty result when every sample is non-finite', () => {
      expect(computeHistogramBins([Number.NaN, Infinity, -Infinity])).toEqual({ edges: [], counts: [] })
   })

   it('filters out non-finite entries while keeping the finite ones', () => {
      const result = computeHistogramBins([1, Number.NaN, 2, Infinity, 3], 3)
      expect(result.counts.reduce((sum, count) => sum + count, 0)).toBe(3)
   })

   it('degrades all-equal samples to a single bin holding every sample', () => {
      const result = computeHistogramBins([7, 7, 7, 7], 10) // even a manual override is moot here
      expect(result.counts).toEqual([4])
      expect(result.edges.length).toBe(2)
      expect(result.edges[0]).toBeLessThan(7)
      expect(result.edges[1]).toBeGreaterThan(7)
   })

   it('never throws for any of the degenerate inputs above', () => {
      expect(() => computeHistogramBins([])).not.toThrow()
      expect(() => computeHistogramBins([Number.NaN])).not.toThrow()
      expect(() => computeHistogramBins([1, 1, 1])).not.toThrow()
   })
})

// #####################
// # BIN CORRECTNESS   #
// #####################

describe('computeHistogramBins, edge + count correctness', () => {
   it('produces equal-width bins spanning exactly [min, max]', () => {
      const result = computeHistogramBins([0, 10], 5)
      expect(result.edges).toEqual([0, 2, 4, 6, 8, 10])
   })

   it('counts every finite sample exactly once, including one landing exactly on max', () => {
      // Bins of width 2 over [0, 10]: 0,1 -> bin0; 2,3 -> bin1; ...; 10 (== max) -> last bin (bin4).
      const result = computeHistogramBins([0, 1, 2, 4, 6, 8, 10], 5)
      const total = result.counts.reduce((sum, count) => sum + count, 0)
      expect(total).toBe(7)
      expect(result.counts[4]).toBeGreaterThanOrEqual(1) // the max-value sample landed in the last bin
   })

   it('is deterministic — identical input yields identical output', () => {
      const samples = [3, 1, 4, 1, 5, 9, 2, 6]
      expect(computeHistogramBins(samples, 4)).toEqual(computeHistogramBins(samples, 4))
   })
})

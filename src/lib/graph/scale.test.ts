import { describe, it, expect } from 'vitest'
import { linearScale, niceTicks, logScale, niceLogTicks, bandScale } from './scale'

// ################
// # LINEAR SCALE #
// ################

describe('linearScale', () => {
   it('maps the domain endpoints onto the range endpoints', () => {
      const scale = linearScale([0, 10], [0, 100])
      expect(scale(0)).toBe(0)
      expect(scale(10)).toBe(100)
      expect(scale(5)).toBe(50)
   })

   it('supports an inverted range (SVG y grows downward)', () => {
      const scale = linearScale([0, 10], [200, 0])
      expect(scale(0)).toBe(200)
      expect(scale(10)).toBe(0)
      expect(scale(5)).toBe(100)
   })

   it('maps everything to the range midpoint for a degenerate domain', () => {
      const scale = linearScale([5, 5], [0, 100])
      expect(scale(5)).toBe(50)
      expect(scale(999)).toBe(50)
   })
})

// #############
// # NICE TICKS #
// #############

describe('niceTicks', () => {
   // A tick set is valid when it is ascending, brackets the raw domain, and starts/ends on
   // its own nice bounds.
   function assertWellFormed(ticks: number[], niceMin: number, niceMax: number, rawMin: number, rawMax: number) {
      expect(ticks[0]).toBe(niceMin)
      expect(ticks[ticks.length - 1]).toBe(niceMax)
      expect(niceMin).toBeLessThanOrEqual(rawMin)
      expect(niceMax).toBeGreaterThanOrEqual(rawMax)
      for (let index = 1; index < ticks.length; index++) {
         expect(ticks[index]).toBeGreaterThan(ticks[index - 1])
         expect(Number.isFinite(ticks[index])).toBe(true)
      }
   }

   it('produces clean round ticks for 0..100', () => {
      const scale = niceTicks(0, 100)
      expect(scale.ticks).toEqual([0, 20, 40, 60, 80, 100])
      assertWellFormed(scale.ticks, scale.niceMin, scale.niceMax, 0, 100)
   })

   it('rounds a non-round max up (0..7)', () => {
      const scale = niceTicks(0, 7)
      expect(scale.ticks).toEqual([0, 2, 4, 6, 8])
      assertWellFormed(scale.ticks, scale.niceMin, scale.niceMax, 0, 7)
   })

   it('spans a negative-to-positive domain through zero', () => {
      const scale = niceTicks(-50, 50)
      expect(scale.ticks).toContain(0)
      assertWellFormed(scale.ticks, scale.niceMin, scale.niceMax, -50, 50)
   })

   it('expands an all-equal positive domain toward a zero baseline', () => {
      const scale = niceTicks(5, 5)
      expect(scale.niceMin).toBe(0)
      expect(scale.niceMax).toBeGreaterThanOrEqual(5)
      assertWellFormed(scale.ticks, scale.niceMin, scale.niceMax, 0, 5)
   })

   it('handles an all-zero domain without producing NaN', () => {
      const scale = niceTicks(0, 0)
      expect(scale.ticks[0]).toBe(0)
      expect(scale.step).toBeGreaterThan(0)
      for (const tick of scale.ticks) expect(Number.isFinite(tick)).toBe(true)
   })

   it('expands an all-equal negative domain up to zero', () => {
      const scale = niceTicks(-8, -8)
      expect(scale.niceMax).toBe(0)
      expect(scale.niceMin).toBeLessThanOrEqual(-8)
      assertWellFormed(scale.ticks, scale.niceMin, scale.niceMax, -8, 0)
   })

   it('handles a tiny fractional domain with clean fractional ticks', () => {
      const scale = niceTicks(0, 0.5)
      expect(scale.ticks[0]).toBe(0)
      expect(scale.niceMax).toBeGreaterThanOrEqual(0.5)
      // No binary-float drift like 0.30000000000000004.
      for (const tick of scale.ticks) {
         expect(tick).toBe(Math.round(tick * 1e6) / 1e6)
      }
   })

   it('handles a huge domain', () => {
      const scale = niceTicks(0, 1_000_000)
      assertWellFormed(scale.ticks, scale.niceMin, scale.niceMax, 0, 1_000_000)
      expect(scale.step).toBeGreaterThan(0)
   })

   it('recovers from non-finite input instead of throwing', () => {
      const scale = niceTicks(Number.NaN, Number.POSITIVE_INFINITY)
      expect(Number.isFinite(scale.niceMin)).toBe(true)
      expect(Number.isFinite(scale.niceMax)).toBe(true)
      expect(scale.ticks.length).toBeGreaterThan(0)
   })

   it('swaps a reversed domain', () => {
      const scale = niceTicks(100, 0)
      expect(scale.niceMin).toBeLessThan(scale.niceMax)
   })
})

// #############
// # LOG SCALE #
// #############

describe('logScale', () => {
   it('maps a decade domain onto the range endpoints, and the midpoint decade to the range midpoint', () => {
      const scale = logScale([1, 100], [0, 200])
      expect(scale(1)).toBeCloseTo(0, 6)
      expect(scale(100)).toBeCloseTo(200, 6)
      expect(scale(10)).toBeCloseTo(100, 6) // 10 sits exactly halfway between decades 1 and 100
   })

   it('supports an inverted range (SVG y grows downward)', () => {
      const scale = logScale([1, 1000], [300, 0])
      expect(scale(1)).toBeCloseTo(300, 6)
      expect(scale(1000)).toBeCloseTo(0, 6)
   })

   it('maps everything to the range midpoint for a degenerate (equal) domain', () => {
      const scale = logScale([10, 10], [0, 100])
      expect(scale(10)).toBe(50)
      expect(scale(999)).toBe(50)
   })

   it('never emits NaN/Infinity for a non-positive or non-finite domain bound', () => {
      const scale = logScale([-5, 100], [0, 200])
      expect(Number.isFinite(scale(50))).toBe(true)
      const scaleTwo = logScale([Number.NaN, Number.POSITIVE_INFINITY], [0, 200])
      expect(Number.isFinite(scaleTwo(50))).toBe(true)
   })

   it('never emits NaN/Infinity for a non-positive VALUE at call time (defensive clamp)', () => {
      const scale = logScale([1, 100], [0, 200])
      expect(Number.isFinite(scale(0))).toBe(true)
      expect(Number.isFinite(scale(-5))).toBe(true)
      expect(Number.isFinite(scale(Number.NaN))).toBe(true)
   })

   it('is monotonic across a wide positive domain', () => {
      const scale = logScale([1, 1_000_000], [0, 600])
      expect(scale(10)).toBeGreaterThan(scale(1))
      expect(scale(100)).toBeGreaterThan(scale(10))
      expect(scale(1000)).toBeGreaterThan(scale(100))
   })
})

// #################
// # NICE LOG TICKS #
// #################

describe('niceLogTicks', () => {
   it('rounds a domain out to bracketing decades', () => {
      const scale = niceLogTicks(5, 500)
      expect(scale.niceMin).toBe(1)
      expect(scale.niceMax).toBe(1000)
      expect(scale.niceMin).toBeLessThanOrEqual(5)
      expect(scale.niceMax).toBeGreaterThanOrEqual(500)
   })

   it('produces decade-only major ticks, ascending, bracketing niceMin/niceMax', () => {
      const scale = niceLogTicks(1, 10000)
      expect(scale.ticks).toEqual([1, 10, 100, 1000, 10000])
      for (let index = 1; index < scale.ticks.length; index++) {
         expect(scale.ticks[index]).toBeGreaterThan(scale.ticks[index - 1])
      }
      expect(scale.ticks[0]).toBe(scale.niceMin)
      expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.niceMax)
   })

   it('emits 2x/5x minor ticks per decade for a legible span', () => {
      const scale = niceLogTicks(1, 100)
      expect(scale.minorTicks).toContain(2)
      expect(scale.minorTicks).toContain(5)
      expect(scale.minorTicks).toContain(20)
      expect(scale.minorTicks).toContain(50)
   })

   it('widens a single power-of-10 domain (min === max === a decade) rather than collapsing', () => {
      const scale = niceLogTicks(100, 100)
      expect(scale.niceMin).toBeLessThan(scale.niceMax)
      expect(scale.niceMax).toBe(100)
   })

   it('drops minor ticks once the span is too wide to read them usefully', () => {
      const scale = niceLogTicks(1, 10 ** 9)
      expect(scale.minorTicks.length).toBe(0)
   })

   it('thins major ticks (but always keeps niceMin and niceMax) for a very wide span', () => {
      const scale = niceLogTicks(1, 10 ** 15)
      expect(scale.ticks[0]).toBe(scale.niceMin)
      expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.niceMax)
      // 15 decades thinned down, not one tick per decade (16 ticks) unlabeled-dense.
      expect(scale.ticks.length).toBeLessThan(16)
   })

   it('recovers to a sane default instead of throwing for a non-positive or non-finite domain', () => {
      const zero = niceLogTicks(0, 100)
      expect(Number.isFinite(zero.niceMin)).toBe(true)
      expect(zero.niceMin).toBeGreaterThan(0)
      const negative = niceLogTicks(-5, -1)
      expect(negative.niceMin).toBeGreaterThan(0)
      const nonFinite = niceLogTicks(Number.NaN, Number.POSITIVE_INFINITY)
      expect(Number.isFinite(nonFinite.niceMin)).toBe(true)
      expect(Number.isFinite(nonFinite.niceMax)).toBe(true)
   })

   it('swaps a reversed domain', () => {
      const scale = niceLogTicks(1000, 1)
      expect(scale.niceMin).toBeLessThan(scale.niceMax)
   })

   it('handles a domain fully inside one decade', () => {
      const scale = niceLogTicks(20, 80)
      expect(scale.niceMin).toBe(10)
      expect(scale.niceMax).toBe(100)
   })
})

// ##############
// # BAND SCALE #
// ##############

describe('bandScale', () => {
   it('places ascending, evenly spaced band centers inside the range', () => {
      const band = bandScale(4, [0, 400])
      const centers = [band.center(0), band.center(1), band.center(2), band.center(3)]
      for (let index = 1; index < centers.length; index++) {
         expect(centers[index]).toBeGreaterThan(centers[index - 1])
      }
      expect(centers[0]).toBeGreaterThanOrEqual(0)
      expect(centers[3]).toBeLessThanOrEqual(400)
      // Constant step between adjacent centers.
      const gap = centers[1] - centers[0]
      expect(centers[2] - centers[1]).toBeCloseTo(gap, 6)
   })

   it('gives a positive bandwidth smaller than the step', () => {
      const band = bandScale(5, [0, 500])
      expect(band.bandwidth).toBeGreaterThan(0)
      expect(band.bandwidth).toBeLessThan(band.step)
   })

   it('handles a single band', () => {
      const band = bandScale(1, [0, 400])
      expect(band.bandwidth).toBeGreaterThan(0)
      expect(band.center(0)).toBeGreaterThan(0)
      expect(band.center(0)).toBeLessThan(400)
   })

   it('yields a zero-width band for a zero count instead of dividing by zero', () => {
      const band = bandScale(0, [0, 400])
      expect(band.bandwidth).toBe(0)
      expect(Number.isFinite(band.center(0))).toBe(true)
   })
})

import { describe, it, expect } from 'vitest'
import { linearScale, niceTicks, bandScale } from './scale'

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

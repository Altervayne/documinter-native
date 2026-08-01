import { describe, it, expect } from 'vitest'
import { mean, median, linearRegression, linearRegressionXY } from './stats'

// #########
// # MEAN  #
// #########

describe('mean', () => {
   it('averages the finite values', () => {
      expect(mean([2, 4, 6])).toBe(4)
   })

   it('skips null / undefined / non-finite cells', () => {
      expect(mean([2, null, 4, undefined as unknown as null, Number.NaN, 6])).toBe(4)
   })

   it('returns null when no finite value survives', () => {
      expect(mean([null, Number.NaN])).toBeNull()
      expect(mean([])).toBeNull()
   })

   it('handles negatives', () => {
      expect(mean([-2, 2])).toBe(0)
   })
})

// ###########
// # MEDIAN  #
// ###########

describe('median', () => {
   it('returns the middle value for an odd count', () => {
      expect(median([5, 1, 3])).toBe(3)
   })

   it('averages the two middle values for an even count', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5)
   })

   it('skips gaps and non-finite cells', () => {
      expect(median([3, null, 1, Number.NaN, 2])).toBe(2)
   })

   it('returns null when empty', () => {
      expect(median([null, null])).toBeNull()
   })
})

// ######################
// # LINEAR REGRESSION  #
// ######################

describe('linearRegression (over category index)', () => {
   it('fits a perfect ascending line with R^2 = 1', () => {
      // y = 2*index + 1 at indices 0,1,2,3
      const fit = linearRegression([1, 3, 5, 7])
      expect(fit).not.toBeNull()
      expect(fit?.slope).toBeCloseTo(2, 10)
      expect(fit?.intercept).toBeCloseTo(1, 10)
      expect(fit?.rSquared).toBeCloseTo(1, 10)
      expect(fit?.count).toBe(4)
   })

   it('returns null for fewer than two finite points', () => {
      expect(linearRegression([5])).toBeNull()
      expect(linearRegression([null, 5, null])).toBeNull()
      expect(linearRegression([])).toBeNull()
   })

   it('skips gaps: a null at an index contributes no (index, value) pair', () => {
      // finite points (0,0) and (2,4) -> slope 2, intercept 0 over x in {0,2}
      const fit = linearRegression([0, null, 4])
      expect(fit?.count).toBe(2)
      expect(fit?.slope).toBeCloseTo(2, 10)
      expect(fit?.intercept).toBeCloseTo(0, 10)
   })

   it('defines R^2 = 1 for a flat (constant) series (SS_tot === 0)', () => {
      const fit = linearRegression([5, 5, 5, 5])
      expect(fit).not.toBeNull()
      expect(fit?.slope).toBeCloseTo(0, 10)
      expect(fit?.intercept).toBeCloseTo(5, 10)
      expect(fit?.rSquared).toBe(1)
   })

   it('produces an R^2 below 1 for a noisy series', () => {
      const fit = linearRegression([1, 2, 1.5, 4, 3])
      expect(fit).not.toBeNull()
      expect(fit?.rSquared).toBeLessThan(1)
      expect(fit?.rSquared).toBeGreaterThanOrEqual(0)
   })
})

describe('linearRegressionXY (general form)', () => {
   it('fits explicit points', () => {
      const fit = linearRegressionXY([
         { x: 0, y: 1 },
         { x: 1, y: 3 },
         { x: 2, y: 5 },
      ])
      expect(fit?.slope).toBeCloseTo(2, 10)
      expect(fit?.intercept).toBeCloseTo(1, 10)
   })

   it('returns null when every x is equal (undefined slope)', () => {
      const fit = linearRegressionXY([
         { x: 3, y: 1 },
         { x: 3, y: 9 },
      ])
      expect(fit).toBeNull()
   })

   it('drops non-finite samples before fitting', () => {
      const fit = linearRegressionXY([
         { x: 0, y: 0 },
         { x: Number.NaN, y: 5 },
         { x: 2, y: 4 },
      ])
      expect(fit?.count).toBe(2)
      expect(fit?.slope).toBeCloseTo(2, 10)
   })
})

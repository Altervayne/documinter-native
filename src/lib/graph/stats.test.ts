import { describe, it, expect } from 'vitest'
import {
   mean, median, linearRegression, linearRegressionXY,
   variance, stddev, extent, movingAverage,
   evaluatePolynomial, polynomialFit, exponentialFit, logarithmicFit, powerFit,
} from './stats'

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

// ##########################
// # VARIANCE / STDDEV      #
// ##########################

describe('variance / stddev (sample, n-1)', () => {
   it('computes the sample variance and its square root', () => {
      // [2,4,6]: mean 4, deviations -2/0/2, sum of squares 8, over n-1 = 2 -> variance 4, stddev 2.
      const values = [2, 4, 6]
      expect(variance(values)).toBeCloseTo(4, 10)
      expect(stddev(values)).toBeCloseTo(2, 10)
   })

   it('skips gaps and non-finite cells', () => {
      expect(stddev([2, null, 4, Number.NaN, 6])).toBeCloseTo(2, 10)
   })

   it('returns null for fewer than two finite values', () => {
      expect(variance([5])).toBeNull()
      expect(stddev([5, null])).toBeNull()
      expect(stddev([])).toBeNull()
   })
})

// ##########
// # EXTENT #
// ##########

describe('extent', () => {
   it('returns the min and max of the finite values', () => {
      expect(extent([3, 1, 4, 1, 5, 9, 2])).toEqual({ min: 1, max: 9 })
   })

   it('skips gaps and non-finite cells', () => {
      expect(extent([null, 7, Number.NaN, -2, 3])).toEqual({ min: -2, max: 7 })
   })

   it('returns null when no finite value survives', () => {
      expect(extent([null, Number.NaN])).toBeNull()
      expect(extent([])).toBeNull()
   })
})

// ###################
// # MOVING AVERAGE  #
// ###################

describe('movingAverage (trailing)', () => {
   it('averages the trailing window, nulling the lead-in indices', () => {
      // window 3 over [1,2,3,4,5]: indices 0,1 have no full window -> null; then 2,3,4 average.
      expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
   })

   it('preserves length and skips gaps inside a window', () => {
      // At index 3 the window is [2, null, 4] -> mean of the two finite cells = 3.
      const result = movingAverage([1, 2, null, 4], 3)
      expect(result).toHaveLength(4)
      expect(result[3]).toBeCloseTo(3, 10)
   })

   it('clamps a window below 2 up to 2', () => {
      expect(movingAverage([4, 6, 8], 1)).toEqual([null, 5, 7])
   })

   it('yields null where a full window holds no finite value', () => {
      expect(movingAverage([null, null, null], 2)).toEqual([null, null, null])
   })
})

// ##########################
// # POLYNOMIAL FIT         #
// ##########################

describe('polynomialFit', () => {
   it('recovers a perfect quadratic with R^2 = 1', () => {
      // y = x^2 - 2x + 1 sampled at x = 0..4.
      const points = [0, 1, 2, 3, 4].map(x => ({ x, y: x * x - 2 * x + 1 }))
      const fit = polynomialFit(points, 2)
      expect(fit).not.toBeNull()
      expect(fit?.coefficients[0]).toBeCloseTo(1, 6)  // constant term
      expect(fit?.coefficients[1]).toBeCloseTo(-2, 6) // x term
      expect(fit?.coefficients[2]).toBeCloseTo(1, 6)  // x^2 term
      expect(fit?.rSquared).toBeCloseTo(1, 8)
      expect(evaluatePolynomial(fit!.coefficients, 5)).toBeCloseTo(16, 6)
   })

   it('returns null with fewer than degree+1 distinct x values', () => {
      const points = [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 4 }]
      expect(polynomialFit(points, 2)).toBeNull()
   })

   it('skips non-finite points', () => {
      const points = [
         { x: 0, y: 1 }, { x: Number.NaN, y: 9 }, { x: 1, y: 0 }, { x: 2, y: 1 },
      ]
      // y = x^2 - 2x + 1 at the three finite points, still a perfect quadratic.
      const fit = polynomialFit(points, 2)
      expect(fit?.rSquared).toBeCloseTo(1, 8)
   })
})

// ##########################
// # EXPONENTIAL / LOG / POWER #
// ##########################

describe('exponentialFit (y = a e^(b x))', () => {
   it('recovers a perfect exponential with R^2 = 1', () => {
      // y = 2 * e^(0.5 x)
      const points = [0, 1, 2, 3].map(x => ({ x, y: 2 * Math.exp(0.5 * x) }))
      const fit = exponentialFit(points)
      expect(fit?.a).toBeCloseTo(2, 6)
      expect(fit?.b).toBeCloseTo(0.5, 6)
      expect(fit?.rSquared).toBeCloseTo(1, 8)
   })

   it('drops non-positive y and returns null when too few remain', () => {
      expect(exponentialFit([{ x: 0, y: -1 }, { x: 1, y: 5 }])).toBeNull()
   })
})

describe('logarithmicFit (y = a + b ln x)', () => {
   it('recovers a perfect logarithmic curve', () => {
      // y = 3 + 2 ln(x)
      const points = [1, 2, 3, 4].map(x => ({ x, y: 3 + 2 * Math.log(x) }))
      const fit = logarithmicFit(points)
      expect(fit?.a).toBeCloseTo(3, 6)
      expect(fit?.b).toBeCloseTo(2, 6)
      expect(fit?.rSquared).toBeCloseTo(1, 8)
   })

   it('drops non-positive x and returns null when too few remain', () => {
      expect(logarithmicFit([{ x: 0, y: 1 }, { x: -2, y: 2 }, { x: 1, y: 3 }])).toBeNull()
   })
})

describe('powerFit (y = a x^b)', () => {
   it('recovers a perfect power curve', () => {
      // y = 3 * x^2
      const points = [1, 2, 3, 4].map(x => ({ x, y: 3 * Math.pow(x, 2) }))
      const fit = powerFit(points)
      expect(fit?.a).toBeCloseTo(3, 6)
      expect(fit?.b).toBeCloseTo(2, 6)
      expect(fit?.rSquared).toBeCloseTo(1, 8)
   })

   it('returns null when fewer than two points have x > 0 and y > 0', () => {
      expect(powerFit([{ x: 1, y: 4 }, { x: 2, y: -1 }])).toBeNull()
   })
})

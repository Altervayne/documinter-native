/*
 * The pure statistics behind the graph block's computed overlays. Numbers in, numbers out, no SVG
 * or theme. Every function is null-gap-safe: a null or non-finite cell contributes no point to any
 * statistic, so a bad datum never leaks a NaN into a result.
 */

// #########
// # MEAN  #
// #########

/** The arithmetic mean of the finite values. Null when no finite value survives. */
export function mean(values: readonly (number | null)[]): number | null {
   let sum = 0
   let count = 0
   for (const value of values) {
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      sum += value
      count++
   }
   if (count === 0) return null
   return sum / count
}

// ###########
// # MEDIAN  #
// ###########

/** The median of the finite values (two middle values averaged for an even count). Null when no
 *  finite value survives. */
export function median(values: readonly (number | null)[]): number | null {
   const finite: number[] = []
   for (const value of values) {
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      finite.push(value)
   }
   if (finite.length === 0) return null
   finite.sort((left, right) => left - right)
   const middle = Math.floor(finite.length / 2)
   if (finite.length % 2 === 1) return finite[middle]
   return (finite[middle - 1] + finite[middle]) / 2
}

// ######################
// # LINEAR REGRESSION  #
// ######################

/** One ordinary-least-squares fit: the line `y = slope * x + intercept` plus its goodness of fit. */
export interface LinearFit {
   slope: number
   intercept: number
   /** R^2 in [0, 1] (1 = a perfect fit). */
   rSquared: number
   /** How many finite points the fit was computed over. */
   count: number
}

/** One (x, y) sample for the general XY regression form. */
export interface Point {
   x: number
   y: number
}

/** OLS fit of a value series on its CATEGORY INDEX: a finite cell at `index` contributes `(index,
 *  value)`, a gap contributes nothing (so the fit is not pulled toward a phantom zero). Null when
 *  fewer than 2 finite points survive. */
export function linearRegression(values: readonly (number | null)[]): LinearFit | null {
   const points: Point[] = []
   for (let index = 0; index < values.length; index++) {
      const value = values[index]
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      points.push({ x: index, y: value })
   }
   return linearRegressionXY(points)
}

/**
 * The general ordinary-least-squares fit over explicit `(x, y)` points, the form the scatter
 * chart's trendline reuses. Assumes the caller has already dropped non-finite samples; it still
 * guards defensively.
 *
 * Formulae over the surviving points:
 *   slope     = SUM((x - meanX)(y - meanY)) / SUM((x - meanX)^2)
 *   intercept = meanY - slope * meanX
 *   R^2       = 1 - SS_res / SS_tot,  SS_res = SUM((y - yHat)^2),  SS_tot = SUM((y - meanY)^2)
 *
 * Degenerate guards:
 *   - fewer than 2 points          -> null (no line can be drawn)
 *   - every x equal (SUM((x-meanX)^2) === 0, a vertical/undefined slope) -> null
 *   - SS_tot === 0 (a flat series, every y equal) -> rSquared = 1 (a constant perfectly explains a
 *     constant; this avoids the 0/0 in `1 - SS_res / SS_tot`).
 */
export function linearRegressionXY(points: readonly Point[]): LinearFit | null {
   const finite: Point[] = []
   for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      finite.push(point)
   }
   const count = finite.length
   if (count < 2) return null

   let sumX = 0
   let sumY = 0
   for (const point of finite) {
      sumX += point.x
      sumY += point.y
   }
   const meanX = sumX / count
   const meanY = sumY / count

   let covariance = 0        // SUM((x - meanX)(y - meanY))
   let varianceX = 0         // SUM((x - meanX)^2)
   let totalSumSquares = 0   // SS_tot = SUM((y - meanY)^2)
   for (const point of finite) {
      const deltaX = point.x - meanX
      const deltaY = point.y - meanY
      covariance += deltaX * deltaY
      varianceX += deltaX * deltaX
      totalSumSquares += deltaY * deltaY
   }

   // Every x equal => the slope is undefined (a vertical line has no y = mx + b form).
   if (varianceX === 0) return null

   const slope = covariance / varianceX
   const intercept = meanY - slope * meanX

   // A flat series (SS_tot === 0) is a constant, which the horizontal fit explains perfectly.
   let rSquared: number
   if (totalSumSquares === 0) {
      rSquared = 1
   } else {
      let residualSumSquares = 0 // SS_res = SUM((y - yHat)^2)
      for (const point of finite) {
         const predicted = slope * point.x + intercept
         const residual = point.y - predicted
         residualSumSquares += residual * residual
      }
      rSquared = 1 - residualSumSquares / totalSumSquares
   }

   return { slope, intercept, rSquared, count }
}

// ##########################
// # SPREAD (VARIANCE / SD) #
// ##########################

/** The SAMPLE variance of the finite values (divide by n-1, Bessel's correction). Null when fewer
 *  than 2 finite values survive (n-1 would be zero). */
export function variance(values: readonly (number | null)[]): number | null {
   const finite: number[] = []
   for (const value of values) {
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      finite.push(value)
   }
   if (finite.length < 2) return null
   let sum = 0
   for (const value of finite) sum += value
   const meanValue = sum / finite.length
   let sumSquares = 0
   for (const value of finite) {
      const delta = value - meanValue
      sumSquares += delta * delta
   }
   return sumSquares / (finite.length - 1)
}

/** The SAMPLE standard deviation (sqrt of the sample {@link variance}). Null when variance is null. */
export function stddev(values: readonly (number | null)[]): number | null {
   const varianceValue = variance(values)
   if (varianceValue === null) return null
   return Math.sqrt(varianceValue)
}

// ##########
// # EXTENT #
// ##########

/** The min and max of the finite values. Null when no finite value survives. */
export function extent(values: readonly (number | null)[]): { min: number; max: number } | null {
   let min = Infinity
   let max = -Infinity
   for (const value of values) {
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
   }
   if (!Number.isFinite(min) || !Number.isFinite(max)) return null
   return { min, max }
}

// ###################
// # MOVING AVERAGE  #
// ###################

/** The TRAILING moving average: `output[index]` is the mean of the finite values in the window
 *  ENDING at `index` (slots `index - window + 1 .. index`). Preserves input length and alignment; an
 *  index without a full window behind it, or whose window holds no finite value, is null. `window`
 *  is clamped to >= 2. */
export function movingAverage(values: readonly (number | null)[], window: number): (number | null)[] {
   const size = Number.isFinite(window) ? Math.max(2, Math.floor(window)) : 2
   const result: (number | null)[] = []
   for (let index = 0; index < values.length; index++) {
      if (index < size - 1) {
         result.push(null)
         continue
      }
      let sum = 0
      let count = 0
      for (let offset = 0; offset < size; offset++) {
         const value = values[index - offset]
         if (value === null || value === undefined || !Number.isFinite(value)) continue
         sum += value
         count++
      }
      result.push(count === 0 ? null : sum / count)
   }
   return result
}

// ##########################
// # CURVE FITS (NON-LINEAR) #
// ##########################

/** A least-squares polynomial fit: coefficients in ASCENDING power order (`coefficients[0]` is the
 *  constant term), plus R^2 against the original y. */
export interface PolynomialFit {
   coefficients: number[]
   rSquared: number
}

/** A two-parameter curve fit (`a`, `b`) plus its R^2 on the ORIGINAL y scale, shared by the
 *  exponential / logarithmic / power models. */
export interface CurveFit {
   a: number
   b: number
   rSquared: number
}

/** Evaluate a polynomial (ascending power order) at `x` via Horner's method. */
export function evaluatePolynomial(coefficients: readonly number[], x: number): number {
   let result = 0
   for (let power = coefficients.length - 1; power >= 0; power--) {
      result = result * x + coefficients[power]
   }
   return result
}

/** R^2 for points against an arbitrary prediction function, `1 - SS_res / SS_tot`. A flat set
 *  (SS_tot === 0) returns 1. Lets every non-linear fit report R^2 on the ORIGINAL y scale, not the
 *  log-transformed one it was fit on. */
function coefficientOfDetermination(points: readonly Point[], predict: (x: number) => number): number {
   if (points.length === 0) return 0
   let sumY = 0
   for (const point of points) sumY += point.y
   const meanY = sumY / points.length
   let totalSumSquares = 0
   let residualSumSquares = 0
   for (const point of points) {
      const deltaTotal = point.y - meanY
      totalSumSquares += deltaTotal * deltaTotal
      const residual = point.y - predict(point.x)
      residualSumSquares += residual * residual
   }
   if (totalSumSquares === 0) return 1
   return 1 - residualSumSquares / totalSumSquares
}

/** Solve `matrix * solution = vector` by Gaussian elimination with partial pivoting. Null when the
 *  system is singular or the solution is non-finite, so a degenerate fit draws nothing rather than
 *  NaN geometry. */
function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
   const size = vector.length
   // Augmented copy so the caller's arrays are never mutated.
   const augmented = matrix.map((row, index) => [...row, vector[index]])
   for (let column = 0; column < size; column++) {
      // Partial pivot: swap in the row with the largest magnitude in this column.
      let pivotRow = column
      for (let row = column + 1; row < size; row++) {
         if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row
      }
      if (Math.abs(augmented[pivotRow][column]) < 1e-12) return null // singular
      const swap = augmented[column]
      augmented[column] = augmented[pivotRow]
      augmented[pivotRow] = swap
      for (let row = 0; row < size; row++) {
         if (row === column) continue
         const factor = augmented[row][column] / augmented[column][column]
         for (let cell = column; cell <= size; cell++) {
            augmented[row][cell] -= factor * augmented[column][cell]
         }
      }
   }
   const solution: number[] = []
   for (let index = 0; index < size; index++) {
      solution.push(augmented[index][size] / augmented[index][index])
   }
   if (solution.some(value => !Number.isFinite(value))) return null
   return solution
}

/** Least-squares polynomial fit of `degree` over the finite points, via the normal equations. Null
 *  when there are fewer than `degree + 1` distinct x values, the degree is below 1, or the system is
 *  singular. */
export function polynomialFit(points: readonly Point[], degree: number): PolynomialFit | null {
   if (!Number.isFinite(degree) || degree < 1) return null
   const finite: Point[] = []
   const distinctX = new Set<number>()
   for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      finite.push(point)
      distinctX.add(point.x)
   }
   if (distinctX.size < degree + 1) return null

   const order = degree + 1
   // Power sums SUM(x^k), k in 0..2*degree, feed every entry of the normal-equations matrix.
   const powerSums = new Array(2 * degree + 1).fill(0)
   const rightHandSide = new Array(order).fill(0)
   for (const point of finite) {
      let xPower = 1
      for (let exponent = 0; exponent <= 2 * degree; exponent++) {
         powerSums[exponent] += xPower
         if (exponent < order) rightHandSide[exponent] += point.y * xPower
         xPower *= point.x
      }
   }

   const matrix: number[][] = []
   for (let rowIndex = 0; rowIndex < order; rowIndex++) {
      const row: number[] = []
      for (let columnIndex = 0; columnIndex < order; columnIndex++) {
         row.push(powerSums[rowIndex + columnIndex])
      }
      matrix.push(row)
   }

   const coefficients = solveLinearSystem(matrix, rightHandSide)
   if (coefficients === null) return null
   const rSquared = coefficientOfDetermination(finite, x => evaluatePolynomial(coefficients, x))
   return { coefficients, rSquared }
}

/** Exponential fit `y = a * e^(b*x)`, a linear fit on `(x, ln y)` mapped back. Only points with
 *  `y > 0` take part; null when fewer than 2 usable points survive or the linear fit is degenerate.
 *  R^2 is on the ORIGINAL y scale. */
export function exponentialFit(points: readonly Point[]): CurveFit | null {
   const usable: Point[] = []
   for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.y <= 0) continue
      usable.push(point)
   }
   if (usable.length < 2) return null
   const fit = linearRegressionXY(usable.map(point => ({ x: point.x, y: Math.log(point.y) })))
   if (fit === null) return null
   const b = fit.slope
   const a = Math.exp(fit.intercept)
   if (!Number.isFinite(a) || !Number.isFinite(b)) return null
   const rSquared = coefficientOfDetermination(usable, x => a * Math.exp(b * x))
   return { a, b, rSquared }
}

/** Logarithmic fit `y = a + b * ln(x)`, a linear fit on `(ln x, y)`. Only points with `x > 0` take
 *  part; null when fewer than 2 usable points survive or the linear fit is degenerate. */
export function logarithmicFit(points: readonly Point[]): CurveFit | null {
   const usable: Point[] = []
   for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x <= 0) continue
      usable.push(point)
   }
   if (usable.length < 2) return null
   const fit = linearRegressionXY(usable.map(point => ({ x: Math.log(point.x), y: point.y })))
   if (fit === null) return null
   const a = fit.intercept
   const b = fit.slope
   const rSquared = coefficientOfDetermination(usable, x => a + b * Math.log(x))
   return { a, b, rSquared }
}

/** Power fit `y = a * x^b`, a linear fit on `(ln x, ln y)` mapped back. Only points with `x > 0` AND
 *  `y > 0` take part; null when fewer than 2 usable points survive or the linear fit is degenerate.
 *  R^2 is on the ORIGINAL y scale. */
export function powerFit(points: readonly Point[]): CurveFit | null {
   const usable: Point[] = []
   for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x <= 0 || point.y <= 0) continue
      usable.push(point)
   }
   if (usable.length < 2) return null
   const fit = linearRegressionXY(usable.map(point => ({ x: Math.log(point.x), y: Math.log(point.y) })))
   if (fit === null) return null
   const b = fit.slope
   const a = Math.exp(fit.intercept)
   if (!Number.isFinite(a) || !Number.isFinite(b)) return null
   const rSquared = coefficientOfDetermination(usable, x => a * Math.pow(x, b))
   return { a, b, rSquared }
}

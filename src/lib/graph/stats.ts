/**
 * stats.ts, the pure statistics behind the graph block's computed overlays (mean / median /
 * linear trendline). NO SVG, NO theme, NO React — just numbers in, numbers out, exactly the
 * house pattern of scale.ts: a small, deterministic, thoroughly unit-tested math module that
 * carries the whole numeric correctness of the overlay feature.
 *
 * Every function is NULL-GAP-SAFE: a series carries `(number | null)[]`, and a null (a gap the
 * chart draws as a break) contributes NO point to any statistic. Non-finite values (NaN, +/-Inf)
 * are treated exactly like null, so a bad datum can never leak a NaN into a result.
 */

// #########
// # MEAN  #
// #########

/**
 * The arithmetic mean of the finite values, skipping every null / undefined / non-finite cell.
 * Returns null when no finite value survives (there is no center to draw).
 */
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

/**
 * The median of the finite values (a sorted copy; the two middle values are averaged for an even
 * count). Skips null / undefined / non-finite cells. Returns null when no finite value survives.
 * Reserved for a fast-follow overlay kind — computed and tested now so the render path is ready.
 */
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
   /** The slope `m` of the fitted line. */
   slope: number
   /** The intercept `b` of the fitted line (its value at x = 0). */
   intercept: number
   /** The coefficient of determination R^2 in [0, 1] (1 = a perfect fit). */
   rSquared: number
   /** How many finite points the fit was computed over. */
   count: number
}

/** One (x, y) sample for the general XY regression form. */
export interface Point {
   x: number
   y: number
}

/**
 * Ordinary-least-squares fit of a value series on its CATEGORY INDEX: each finite cell at position
 * `index` contributes the point `(index, value)`, and a null / non-finite cell contributes NOTHING
 * (a gap at index 3 leaves no (3, y) pair, so the fit is not pulled toward a phantom zero). This is
 * the v1 trendline over categorical x; the continuous-x scatter form reuses {@link linearRegressionXY}
 * verbatim later. Returns null when fewer than 2 finite points survive.
 */
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
 * The general ordinary-least-squares fit over explicit `(x, y)` points (the scatter v1.1 reuse
 * point). Assumes the caller has already dropped non-finite samples; it still guards defensively.
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

/**
 * scale.ts, pure scale + nice-tick math for the cartesian graph core.
 *
 * PURE FUNCTIONS, deterministic (no Date, no random). Three concerns:
 *   - linearScale:  an affine domain -> range map (with a degenerate-domain guard)
 *   - niceTicks:    the classic 1/2/5 x 10^n "nice number for graph labels" algorithm
 *   - bandScale:    a categorical (band) scale for the x-axis, d3-style padding
 *
 * Everything here is a clean unit-test target and carries the whole numeric correctness of
 * the cartesian renderer, so it is tested thoroughly and kept free of any rendering concern.
 */

// #################
// # LINEAR SCALE  #
// #################

/**
 * Build an affine map from `domain` [d0, d1] to `range` [r0, r1]. When the domain is
 * degenerate (d0 === d1, which would divide by zero) every input maps to the range midpoint,
 * so a flat dataset still renders somewhere sensible instead of producing NaN.
 */
export function linearScale(
   domain: [number, number],
   range: [number, number],
): (value: number) => number {
   const [domainStart, domainEnd] = domain
   const [rangeStart, rangeEnd] = range
   const domainSpan = domainEnd - domainStart
   if (domainSpan === 0) {
      const midpoint = (rangeStart + rangeEnd) / 2
      return () => midpoint
   }
   const scaleFactor = (rangeEnd - rangeStart) / domainSpan
   return (value: number): number => rangeStart + (value - domainStart) * scaleFactor
}

// ###############
// # NICE TICKS  #
// ###############

/** The result of {@link niceTicks}: a rounded domain plus the tick values inside it. */
export interface NiceScale {
   /** The rounded-down domain minimum (a "nice" multiple of `step`). */
   niceMin: number
   /** The rounded-up domain maximum (a "nice" multiple of `step`). */
   niceMax: number
   /** The chosen "nice" tick step (a 1/2/5 x 10^n value). */
   step: number
   /** The tick values from niceMin to niceMax inclusive, ascending. */
   ticks: number[]
}

/**
 * Round a positive interval to a "nice" number. When `round` is true the nearest nice value
 * is chosen (used for the step); otherwise the ceiling nice value is chosen (used for the
 * range). "Nice" fractions are 1, 2, 5, 10 x 10^exponent — the values that read cleanly on
 * an axis (0, 100, 200… or 0, 250, 500…). This is the Heckbert "nice numbers" routine.
 */
function niceNumber(interval: number, round: boolean): number {
   const exponent = Math.floor(Math.log10(interval))
   const fraction = interval / 10 ** exponent
   let niceFraction: number
   if (round) {
      if (fraction < 1.5) niceFraction = 1
      else if (fraction < 3) niceFraction = 2
      else if (fraction < 7) niceFraction = 5
      else niceFraction = 10
   } else {
      if (fraction <= 1) niceFraction = 1
      else if (fraction <= 2) niceFraction = 2
      else if (fraction <= 5) niceFraction = 5
      else niceFraction = 10
   }
   return niceFraction * 10 ** exponent
}

/**
 * Produce a "nice" domain + evenly spaced clean tick values covering [rawMin, rawMax] with
 * about `targetCount` ticks. Handles the awkward domains explicitly so the renderer never has
 * to: non-finite input (falls back to 0..1), a single value / all-equal domain (expands
 * toward a zero baseline when possible), and negative or zero-crossing domains.
 */
export function niceTicks(rawMin: number, rawMax: number, targetCount = 5): NiceScale {
   let min = rawMin
   let max = rawMax

   // ====== degenerate-input guards ======
   if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0
      max = 1
   }
   if (min > max) {
      const swap = min
      min = max
      max = swap
   }
   if (min === max) {
      // A single value / all-equal domain: expand toward a zero baseline where it makes
      // sense (positive value -> [0, value]; negative -> [value, 0]; zero -> [0, 1]).
      if (min > 0) min = 0
      else if (max < 0) max = 0
      else max = 1
   }
   if (min === max) {
      // Still flat (should not happen after the above) — pad symmetrically as a last resort.
      min -= 1
      max += 1
   }

   const safeTargetCount = Math.max(2, Math.floor(targetCount))

   // ====== nice range + step ======
   const range = niceNumber(max - min, false)
   const step = niceNumber(range / (safeTargetCount - 1), true)
   const niceMin = Math.floor(min / step) * step
   const niceMax = Math.ceil(max / step) * step

   // ====== emit clean tick values ======
   // The number of fractional digits the step needs, so ticks read as clean numbers and do
   // not accumulate binary-float drift (e.g. 0.30000000000000004).
   const fractionDigits = Math.max(0, -Math.floor(Math.log10(step)))
   const ticks: number[] = []
   // A tiny epsilon guards the inclusive upper bound against float rounding at the last tick.
   const epsilon = step / 1e6
   for (let tickValue = niceMin; tickValue <= niceMax + epsilon; tickValue += step) {
      ticks.push(roundToDigits(tickValue, fractionDigits))
   }
   return { niceMin, niceMax, step, ticks }
}

/** Round to a fixed number of fractional digits (kills float drift on tick values). */
function roundToDigits(value: number, digits: number): number {
   const factor = 10 ** digits
   // The `+ 0` normalizes a possible `-0` to `0`.
   return Math.round(value * factor) / factor + 0
}

// ###############
// # BAND SCALE  #
// ###############

/** The result of {@link bandScale}: enough geometry to place N categorical bands. */
export interface BandScale {
   /** Left edge of the band at `index`. */
   start(index: number): number
   /** Center of the band at `index` (where a single bar / line point sits). */
   center(index: number): number
   /** The drawable width of one band (already excludes inner padding). */
   bandwidth: number
   /** The center-to-center distance between adjacent bands. */
   step: number
}

/**
 * A categorical band scale over `range` [start, end] for `count` categories, d3-style. Inner
 * padding is the fraction of a step left as air between bands; outer padding is the air before
 * the first / after the last band (defaults to the inner padding). A zero/negative count
 * yields a zero-width band so callers never divide by zero.
 */
export function bandScale(
   count: number,
   range: [number, number],
   paddingInner = 0.2,
   paddingOuter = paddingInner,
): BandScale {
   const [rangeStart, rangeEnd] = range
   const span = rangeEnd - rangeStart
   if (count <= 0) {
      return {
         start: () => rangeStart,
         center: () => rangeStart,
         bandwidth: 0,
         step: 0,
      }
   }
   const step = span / Math.max(1, count - paddingInner + paddingOuter * 2)
   const bandwidth = step * (1 - paddingInner)
   const firstStart = rangeStart + step * paddingOuter
   return {
      start: (index: number): number => firstStart + step * index,
      center: (index: number): number => firstStart + step * index + bandwidth / 2,
      bandwidth,
      step,
   }
}

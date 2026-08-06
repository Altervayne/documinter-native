/**
 * scale.ts, pure scale + nice-tick math for the cartesian graph core.
 *
 * PURE FUNCTIONS, deterministic (no Date, no random). Four concerns:
 *   - linearScale:  an affine domain -> range map (with a degenerate-domain guard)
 *   - niceTicks:    the classic 1/2/5 x 10^n "nice number for graph labels" algorithm
 *   - logScale:     the logarithmic analog of linearScale (a value -> pixel map over log10 space)
 *   - niceLogTicks: decade-rounded log domain + major (decade) / minor (1-2-5) tick values
 *   - bandScale:    a categorical (band) scale for the x-axis, d3-style padding
 *
 * Everything here is a clean unit-test target and carries the whole numeric correctness of
 * the cartesian renderer, so it is tested thoroughly and kept free of any rendering concern.
 * WHETHER a chart should even use a log scale (the "data touches <= 0" / "chart type doesn't
 * support it" policy) is decided by the caller (see graph/cartesian.ts's per-type domain
 * resolution), this module's job is purely the decade math once that decision is made.
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
 * range). "Nice" fractions are 1, 2, 5, 10 x 10^exponent, the values that read cleanly on
 * an axis (0, 100, 200... or 0, 250, 500...). This is the Heckbert "nice numbers" routine.
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
      // Still flat (should not happen after the above), pad symmetrically as a last resort.
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

// ##############
// # LOG SCALE  #
// ##############

/**
 * Build an affine map from a LOGARITHMIC domain [d0, d1] to a linear pixel `range` [r0, r1], the
 * log-scale analog of {@link linearScale}: values are compared in log10 space, but the OUTPUT is
 * still an ordinary pixel coordinate. The caller is responsible for guaranteeing a strictly
 * positive domain (log is undefined at <= 0, see graph/cartesian.ts's axis-mode resolution,
 * which only ever picks 'log' once the whole data domain has already been checked positive); this
 * function still defends against a stray non-positive/non-finite input rather than emitting
 * NaN/Infinity geometry, matching every other scale helper's total-function contract:
 *   - a non-positive or non-finite domain bound clamps to the smallest positive double, so a
 *     caller that slipped past the upstream eligibility check still gets SOME finite pixel.
 *   - a degenerate (equal, after clamping) domain maps every input to the range midpoint, exactly
 *     like {@link linearScale}'s own flat-domain case.
 *   - a non-positive VALUE at call time (should not happen, see cartesian.ts's
 *     `isPlottableValue`, the primary defense) clamps to the domain floor instead of computing
 *     `Math.log10` of a non-positive number.
 */
export function logScale(
   domain: [number, number],
   range: [number, number],
): (value: number) => number {
   const [domainStart, domainEnd] = domain
   const safeDomainStart = domainStart > 0 && Number.isFinite(domainStart) ? domainStart : Number.MIN_VALUE
   const safeDomainEnd   = domainEnd   > 0 && Number.isFinite(domainEnd)   ? domainEnd   : safeDomainStart
   const logDomainStart = Math.log10(safeDomainStart)
   const logDomainEnd   = Math.log10(safeDomainEnd)
   const [rangeStart, rangeEnd] = range
   const logSpan = logDomainEnd - logDomainStart
   if (logSpan === 0) {
      const midpoint = (rangeStart + rangeEnd) / 2
      return () => midpoint
   }
   const scaleFactor = (rangeEnd - rangeStart) / logSpan
   return (value: number): number => {
      const safeValue = value > 0 && Number.isFinite(value) ? value : safeDomainStart
      return rangeStart + (Math.log10(safeValue) - logDomainStart) * scaleFactor
   }
}

/** The result of {@link niceLogTicks}: a decade-rounded domain plus major + minor tick values. */
export interface NiceLogScale {
   /** The rounded-down domain minimum, the largest power of 10 at or below `rawMin`. */
   niceMin: number
   /** The rounded-up domain maximum, the smallest power of 10 at or above `rawMax`. */
   niceMax: number
   /** Major (decade, i.e. powers of 10) tick values inside [niceMin, niceMax], ascending, thinned
    *  to an even stride when there are too many decades to label legibly (see
    *  {@link LOG_MAX_LABELED_DECADES}), but always including both `niceMin` and `niceMax`. */
   ticks: number[]
   /** Intra-decade minor tick values, 2x and 5x each decade's power of 10, the classic "1-2-5"
    *  log-scale pattern (1, 2, 5, 10, 20, 50, 100, ...), empty once the domain spans too many
    *  decades for them to add anything but visual noise (see {@link LOG_MAX_MINOR_DECADES}). */
   minorTicks: number[]
}

/** Above this many decades, minor (2x/5x) ticks are dropped, denser than useful past this span. */
const LOG_MAX_MINOR_DECADES = 6

/** Above this many decades, major ticks are THINNED to an even stride so labels stay legible. */
const LOG_MAX_LABELED_DECADES = 10

/**
 * Produce a "nice" LOGARITHMIC domain + decade tick values covering [rawMin, rawMax], the log-
 * scale analog of {@link niceTicks}. Bounds are rounded OUT to the nearest power of 10 (`niceMin`
 * down, `niceMax` up), matching linear nice-ticking's "always fully bracket the raw domain"
 * contract. Unlike `niceTicks`, the "step" between major ticks is always exactly one decade by
 * construction (a log axis has no other sensible major-tick spacing); `targetMajorCount` only
 * controls how aggressively a very wide span THINS its major ticks so the axis stays legible.
 *
 * A non-positive / non-finite / degenerate input recovers to the sane default domain [1, 10]
 * rather than producing NaN, the same total-function contract every scale/tick helper here
 * honors. THE CALLER decides whether log is even the right scale for a given chart's data (see
 * graph/cartesian.ts's per-type axis-mode resolution); this function's job is purely the decade-
 * rounding math once that decision has already been made.
 */
export function niceLogTicks(rawMin: number, rawMax: number, targetMajorCount = 5): NiceLogScale {
   let min = rawMin
   let max = rawMax

   // ====== degenerate-input guards ======
   if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
      min = 1
      max = 10
   }
   if (min > max) {
      const swap = min
      min = max
      max = swap
   }

   let minExponent = Math.floor(Math.log10(min))
   let maxExponent = Math.ceil(Math.log10(max))
   // A domain that rounds to a single power of 10 (e.g. min === max === 100) would otherwise
   // collapse to a zero-width [niceMin, niceMax], widen down by one decade, the log-scale analog
   // of niceTicks' "expand an all-equal domain toward a baseline" guard.
   if (minExponent === maxExponent) minExponent -= 1

   const niceMin = 10 ** minExponent
   const niceMax = 10 ** maxExponent
   const decadeCount = maxExponent - minExponent

   // ====== major (decade) ticks, thinned to a legible stride for a very wide span ======
   const majorStride = decadeCount > LOG_MAX_LABELED_DECADES
      ? Math.ceil(decadeCount / Math.max(1, Math.floor(targetMajorCount)))
      : 1
   const ticks: number[] = []
   for (let exponent = minExponent; exponent <= maxExponent; exponent += majorStride) {
      ticks.push(10 ** exponent)
   }
   // A stride can overshoot the top decade; always land on niceMax exactly so the axis's own
   // ceiling is never left unlabeled.
   if (ticks[ticks.length - 1] !== niceMax) ticks.push(niceMax)

   // ====== minor (1-2-5 pattern) ticks: 2x/5x within each decade, only for a legible span ======
   const minorTicks: number[] = []
   if (decadeCount <= LOG_MAX_MINOR_DECADES) {
      for (let exponent = minExponent; exponent < maxExponent; exponent++) {
         const decadeBase = 10 ** exponent
         minorTicks.push(decadeBase * 2, decadeBase * 5)
      }
   }

   return { niceMin, niceMax, ticks, minorTicks }
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

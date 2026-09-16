/*
 * Pure scale + nice-tick math for the graph core: linearScale, niceTicks (1/2/5 x 10^n), logScale,
 * niceLogTicks (decade + 1-2-5 ticks), and bandScale (d3-style categorical bands). WHETHER a chart
 * should use a log scale is the caller's decision (see cartesian.ts); this module is purely the
 * math once that decision is made.
 */

// #################
// # LINEAR SCALE  #
// #################

/** An affine map from `domain` to `range`. A degenerate domain (d0 === d1) maps every input to the
 *  range midpoint instead of dividing by zero. */
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
   niceMin: number
   niceMax: number
   step: number
   ticks: number[]
}

/** Round a positive interval to a "nice" number (1/2/5/10 x 10^n). `round` picks the nearest (for
 *  the step), else the ceiling (for the range). The Heckbert "nice numbers" routine. */
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

/** A "nice" domain + clean tick values covering [rawMin, rawMax] with about `targetCount` ticks.
 *  Awkward domains are handled explicitly: non-finite falls back to 0..1, an all-equal domain
 *  expands toward a zero baseline. */
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
      // Expand an all-equal domain toward a zero baseline (positive -> [0, value], etc.).
      if (min > 0) min = 0
      else if (max < 0) max = 0
      else max = 1
   }
   if (min === max) {
      // Still flat: pad symmetrically as a last resort.
      min -= 1
      max += 1
   }

   const safeTargetCount = Math.max(2, Math.floor(targetCount))

   // ====== nice range + step ======
   const range = niceNumber(max - min, false)
   const step = niceNumber(range / (safeTargetCount - 1), true)
   const niceMin = Math.floor(min / step) * step
   const niceMax = Math.ceil(max / step) * step

   // Round each tick to the digits the step needs, so they read clean without binary-float drift.
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
 * The log-scale analog of {@link linearScale}: values are compared in log10 space, the output is
 * still a pixel coordinate. The caller guarantees a strictly positive domain; this still defends
 * against a stray non-positive/non-finite input rather than emitting NaN geometry (a bad bound
 * clamps to the smallest positive double, a degenerate domain maps to the range midpoint, a
 * non-positive value clamps to the domain floor).
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
   niceMin: number
   niceMax: number
   /** Major (decade) ticks in [niceMin, niceMax], thinned to an even stride past
    *  {@link LOG_MAX_LABELED_DECADES} but always including both bounds. */
   ticks: number[]
   /** Intra-decade 2x/5x minor ticks (the 1-2-5 pattern), empty past {@link LOG_MAX_MINOR_DECADES}. */
   minorTicks: number[]
}

/** Above this many decades, minor (2x/5x) ticks are dropped, denser than useful past this span. */
const LOG_MAX_MINOR_DECADES = 6

/** Above this many decades, major ticks are THINNED to an even stride so labels stay legible. */
const LOG_MAX_LABELED_DECADES = 10

/**
 * The log-scale analog of {@link niceTicks}: bounds rounded out to the nearest power of 10. Major
 * ticks are always one decade apart; `targetMajorCount` only controls how aggressively a very wide
 * span thins them. A non-positive/non-finite/degenerate input recovers to [1, 10] rather than NaN.
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
   // A domain rounding to a single power of 10 would collapse to zero width; widen down one decade.
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
   // A stride can overshoot the top decade; always land on niceMax so the ceiling is labeled.
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
   /** Drawable width of one band (excludes inner padding). */
   bandwidth: number
   /** Center-to-center distance between adjacent bands. */
   step: number
}

/** A d3-style categorical band scale over `range` for `count` categories. Inner padding is the air
 *  between bands, outer padding the air at the ends. A zero/negative count yields a zero-width band. */
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

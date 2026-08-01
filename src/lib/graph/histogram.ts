/**
 * histogram.ts, the pure binning math behind the `histogram` chart type.
 *
 * PURE FUNCTION, deterministic (no Date, no random), no SVG/theme/React — mirrors the house style
 * of scale.ts/stats.ts: a small, thoroughly unit-tested numeric module carrying the whole numeric
 * correctness of the feature. The renderer (graph/cartesian.ts's `renderHistogram`) and the editor
 * (molecules/HistogramEditor.tsx, for its live "effective bin count" readout) both call this
 * directly rather than duplicating any binning logic.
 */

import { HISTOGRAM_MIN_BINS, HISTOGRAM_MAX_BINS } from './types'

// #############
// # CONSTANTS #
// #############

/** The degenerate-domain (all-equal samples) bin half-width: an arbitrary but sane +/-0.5 span
 *  around the single repeated value — just wide enough to read as one real bar on the axis, since
 *  a genuine bin WIDTH is meaningless when every sample is identical. */
const DEGENERATE_BIN_HALF_WIDTH = 0.5

// #############
// # BINNING   #
// #############

/** One computed histogram: the bin edges (length === counts.length + 1, ascending) and each bin's
 *  frequency count (same order, left to right). */
export interface HistogramBins {
   edges: number[]
   counts: number[]
}

/**
 * Bin `samples` into equal-width bins spanning their `[min, max]`. Non-finite entries (NaN,
 * +/-Infinity) are filtered out FIRST — a bad datum contributes to no bin and never breaks the
 * result, the same "invalid never breaks the chart" contract every other graph parser/renderer in
 * this codebase honors. Total, never throws.
 *
 * Bin-count resolution:
 *   - Fewer than 1 finite sample survives -> an EMPTY result (`{ edges: [], counts: [] }`); the
 *     renderer draws a graceful empty plot (axes with no bars) for this, never an exception.
 *   - All finite samples identical (`min === max`) -> ONE degenerate bin spanning
 *     `[value - DEGENERATE_BIN_HALF_WIDTH, value + DEGENERATE_BIN_HALF_WIDTH]` holding every
 *     sample — a real bin count would be meaningless when there is no spread to divide.
 *   - Otherwise: `requestedBins`, when given (a manual override), is rounded and clamped to
 *     [{@link HISTOGRAM_MIN_BINS}, {@link HISTOGRAM_MAX_BINS}]. Left unset, the bin count is
 *     Sturges' rule (`ceil(log2(n)) + 1`), ALSO clamped to the same sane range, so neither a
 *     single sample (Sturges alone would suggest 1) nor a huge sample count can ever produce a
 *     pathological bin count.
 */
export function computeHistogramBins(samples: number[], requestedBins?: number): HistogramBins {
   const finiteSamples = samples.filter(sample => Number.isFinite(sample))
   if (finiteSamples.length < 1) return { edges: [], counts: [] }

   let minValue = finiteSamples[0]
   let maxValue = finiteSamples[0]
   for (const sample of finiteSamples) {
      if (sample < minValue) minValue = sample
      if (sample > maxValue) maxValue = sample
   }

   if (minValue === maxValue) {
      return {
         edges: [minValue - DEGENERATE_BIN_HALF_WIDTH, minValue + DEGENERATE_BIN_HALF_WIDTH],
         counts: [finiteSamples.length],
      }
   }

   const binCount = resolveBinCount(finiteSamples.length, requestedBins)
   const step = (maxValue - minValue) / binCount

   const edges: number[] = []
   for (let edgeIndex = 0; edgeIndex <= binCount; edgeIndex++) {
      edges.push(minValue + edgeIndex * step)
   }

   const counts = new Array<number>(binCount).fill(0)
   for (const sample of finiteSamples) {
      let binIndex = Math.floor((sample - minValue) / step)
      // A sample exactly AT maxValue floors to binCount (one past the last bin); clamp it into the
      // last bin so every finite sample is counted in exactly one bin (the top edge is inclusive).
      if (binIndex >= binCount) binIndex = binCount - 1
      if (binIndex < 0) binIndex = 0
      counts[binIndex]++
   }

   return { edges, counts }
}

/** Resolve the bin count: a manual override (rounded + clamped) or Sturges' rule (also clamped). */
function resolveBinCount(sampleCount: number, requestedBins: number | undefined): number {
   if (requestedBins !== undefined && Number.isFinite(requestedBins)) {
      return clampBinCount(Math.round(requestedBins))
   }
   const sturges = Math.ceil(Math.log2(sampleCount)) + 1
   return clampBinCount(sturges)
}

/** Clamp a bin count into [{@link HISTOGRAM_MIN_BINS}, {@link HISTOGRAM_MAX_BINS}]. */
function clampBinCount(binCount: number): number {
   return Math.min(HISTOGRAM_MAX_BINS, Math.max(HISTOGRAM_MIN_BINS, binCount))
}

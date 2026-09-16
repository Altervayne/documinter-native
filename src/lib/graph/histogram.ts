/*
 * The pure binning math behind the `histogram` chart type. Deterministic, no SVG/theme/React.
 * The renderer and the editor's "effective bin count" readout both call this directly.
 */

import { HISTOGRAM_MIN_BINS, HISTOGRAM_MAX_BINS } from './types'

// #############
// # CONSTANTS #
// #############

/** The all-equal-samples bin half-width: a +/-0.5 span around the single repeated value, since a
 *  real bin width is meaningless when every sample is identical. */
const DEGENERATE_BIN_HALF_WIDTH = 0.5

// #############
// # BINNING   #
// #############

/** One computed histogram: bin edges (length === counts.length + 1, ascending) and each bin's count. */
export interface HistogramBins {
   edges: number[]
   counts: number[]
}

/**
 * Bin `samples` into equal-width bins spanning their `[min, max]`. Non-finite entries are filtered
 * first. Total, never throws.
 *   - No finite sample -> `{ edges: [], counts: [] }` (the renderer draws an empty plot).
 *   - All samples identical -> one degenerate bin of half-width {@link DEGENERATE_BIN_HALF_WIDTH}.
 *   - Otherwise a manual `requestedBins` (rounded + clamped), else Sturges' rule (also clamped),
 *     so neither a single sample nor a huge count produces a pathological bin count.
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
      // A sample at maxValue floors one past the last bin; clamp it in so the top edge is inclusive.
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

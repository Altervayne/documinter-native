/*
 * The pure cut-point decision for the paged (A4) overflow assist. Given a page's ordered rendered block
 * heights (measured from the DOM) plus its available content height, decide where to split so the content
 * fits: the last block that fully fits stays, the first overflowing block starts the next page. Computes
 * an index only; the React layer turns it into an `addPageBreakAfter` when the author clicks "Split here".
 */

// #############
// # CONSTANTS #
// #############

// Sub-pixel measurement slack: content filling the box to the pixel must NOT flap an overflow ribbon.
// Only content spilling past the box by more than this counts as overflowing.
export const OVERFLOW_TOLERANCE_PX = 1

// #########
// # TYPES #
// #########

export interface OverflowCut {
   overflows: boolean
   /** Last block index that fully fits; break AFTER it. `null` when there is no useful split. */
   cutAfterIndex: number | null
   /** First block whose bottom crosses the available height; `null` when nothing overflows. */
   overflowingIndex: number | null
   /** True when the overflowing block is the page's first (index 0): no split can help, it is simply
    *  taller than the page. */
   blockTooTall: boolean
}

const NO_OVERFLOW: OverflowCut = {
   overflows:        false,
   cutAfterIndex:    null,
   overflowingIndex: null,
   blockTooTall:     false,
}

// ##################
// # CUT COMPUTATION #
// ##################

/**
 * Decide where (if anywhere) a page should split, given the ORDERED rendered heights of its top-level
 * blocks and the available content height (px). The running sum through block `i` is its bottom edge from
 * the content-box top (chrome above the first block is folded into the first entry). Edge cases:
 *   - empty page / non-positive available height -> no overflow.
 *   - everything fits -> no overflow, no cut.
 *   - a mid-page block crosses the boundary -> cut AFTER the last block that fully fits.
 *   - the FIRST block already overflows -> no cut, `blockTooTall` set (splitting after block 0 would just
 *     recreate the overflow on a fresh page).
 */
export function computeOverflowCut(blockHeights: number[], availableHeight: number): OverflowCut {
   if (blockHeights.length === 0 || !(availableHeight > 0)) return NO_OVERFLOW

   // Walk the cumulative bottom edge; the first block whose bottom crosses the available height (past
   // the sub-pixel tolerance) is the overflowing one.
   let cumulative = 0
   let overflowingIndex = -1
   for (let index = 0; index < blockHeights.length; index += 1) {
      cumulative += blockHeights[index]
      if (cumulative > availableHeight + OVERFLOW_TOLERANCE_PX) {
         overflowingIndex = index
         break
      }
   }

   if (overflowingIndex === -1) return NO_OVERFLOW   // every block fits within the box

   const cutAfterIndex = overflowingIndex - 1
   if (cutAfterIndex < 0) {
      // The very first block already overflows: nothing above it to move onto the next page.
      return { overflows: true, cutAfterIndex: null, overflowingIndex, blockTooTall: true }
   }
   return { overflows: true, cutAfterIndex, overflowingIndex, blockTooTall: false }
}

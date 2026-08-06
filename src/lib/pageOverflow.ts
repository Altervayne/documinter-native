/**
 * The pure cut-point decision for the paged (A4) overflow assist.
 *
 * The editor measures each A4 page's rendered block heights from the real DOM (never predicts them:
 * DOM-free height estimation of arbitrary rich content is intractable and would be perpetually wrong)
 * and feeds the ordered heights plus the page's available content height in here. This module decides
 * where the page should be split so its content fits: the last block that fully fits stays on the
 * page, the first overflowing block starts the next page.
 *
 * It never touches the DOM and never mutates the model, it only computes an index. The React layer
 * turns that index into an `addPageBreakAfter` when the author clicks "Split here" - the assist never
 * runs automatically, there is no auto-reflow. After a split the tail moves to a new page which is
 * itself re-measured, so an over-long tail resolves iteratively, one assisted click at a time.
 *
 * No React, no DOM: pure and unit-testable, a sibling to pageModel.ts and format.ts.
 */

// #############
// # CONSTANTS #
// #############

// Sub-pixel measurement slack: a page whose content fills the box to the pixel (a fractional
// getBoundingClientRect vs. a fractional millimetre-to-px available height) must NOT flap an overflow
// ribbon. Only content that spills past the box by more than this counts as overflowing.
export const OVERFLOW_TOLERANCE_PX = 1

// #########
// # TYPES #
// #########

export interface OverflowCut {
   /** Whether the measured block content spills past the available content height at all. */
   overflows: boolean
   /** The last block index that fully fits, break AFTER it so the first overflowing block starts the
    *  next page. `null` when there is no useful split (nothing overflows, or the first block already
    *  overflows and so can't be pushed onto a fresh page). */
   cutAfterIndex: number | null
   /** Index of the first block whose bottom crosses the available height. `null` when nothing
    *  overflows; used by the React layer to anchor the ribbon / the too-tall note. */
   overflowingIndex: number | null
   /** True when the first overflowing block is ALSO the first block on the page (index 0): there is
    *  nothing above it to push up, so no split can make the page fit, the block is simply taller than
    *  the page. The React layer shows a "block too tall" note instead of a Split button. */
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
 * Decide where (if anywhere) a page should be split, given the ORDERED rendered heights of its
 * top-level blocks and the page's available content height (A4 page height minus top/bottom margins,
 * in px). `blockHeights[i]` is block `i`'s consumed height in flow order, so the running sum through
 * block `i` is that block's bottom edge measured from the content-box top (any chrome above the first
 * block, a page-1 header, a section title, is folded into the first entry, exactly the space it
 * consumes).
 *
 * Edge cases:
 *   - empty page / non-positive available height -> no overflow.
 *   - everything fits (running sum <= available, within tolerance) -> no overflow, no cut.
 *   - a mid-page block crosses the boundary -> cut AFTER the last block that fully fits.
 *   - the FIRST block already overflows (a single block, or a leading block, taller than the page) ->
 *     no cut is offered and `blockTooTall` is set: pushing content up can't help, splitting after
 *     block 0 would only re-create the same overflow on a fresh page.
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

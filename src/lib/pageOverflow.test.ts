import { describe, it, expect } from 'vitest'
import { computeOverflowCut, OVERFLOW_TOLERANCE_PX } from './pageOverflow'

// ############################################################
//  computeOverflowCut, the pure cut-point decision. The DOM layer (usePageOverflow) feeds it the
//  ORDERED measured heights of a page's top-level blocks + the available content height; it returns
//  where the page should be split (break after the last fitting block) or flags an un-splittable
//  too-tall block. No DOM, no model, index math only.
// ############################################################

describe('computeOverflowCut', () => {
   // ====================================
   //  Everything fits (no overflow, no cut)
   // ====================================
   it('reports no overflow when the running total fits within the available height', () => {
      const cut = computeOverflowCut([100, 100], 250)
      expect(cut).toEqual({ overflows: false, cutAfterIndex: null, overflowingIndex: null, blockTooTall: false })
   })

   it('treats an empty page as no overflow', () => {
      expect(computeOverflowCut([], 250)).toEqual({
         overflows: false, cutAfterIndex: null, overflowingIndex: null, blockTooTall: false,
      })
   })

   it('treats a non-positive available height as no overflow (degenerate margins)', () => {
      expect(computeOverflowCut([100], 0).overflows).toBe(false)
      expect(computeOverflowCut([100], -50).overflows).toBe(false)
   })

   // ====================================
   //  A mid-page block crosses the boundary: cut after the last fitting block
   // ====================================
   it('cuts after the last block that fully fits', () => {
      // 100, 200, 300 cumulative; 300 > 250 at index 2, so the last fitting index is 1.
      const cut = computeOverflowCut([100, 100, 100], 250)
      expect(cut).toEqual({ overflows: true, cutAfterIndex: 1, overflowingIndex: 2, blockTooTall: false })
   })

   it('can cut after the very first block when the second block overflows', () => {
      // 100 fits, 100 + 300 = 400 > 250 at index 1, so it cuts after index 0.
      const cut = computeOverflowCut([100, 300], 250)
      expect(cut).toEqual({ overflows: true, cutAfterIndex: 0, overflowingIndex: 1, blockTooTall: false })
   })

   // ====================================
   //  The first block already overflows: no useful split (too-tall note)
   // ====================================
   it('flags a single block taller than the whole page as too-tall with no cut', () => {
      const cut = computeOverflowCut([500], 250)
      expect(cut).toEqual({ overflows: true, cutAfterIndex: null, overflowingIndex: 0, blockTooTall: true })
   })

   it('flags a too-tall leading block even when more blocks follow', () => {
      // Block 0 alone (300) already overflows 250: pushing 1..n down can't help block 0.
      const cut = computeOverflowCut([300, 100], 250)
      expect(cut).toEqual({ overflows: true, cutAfterIndex: null, overflowingIndex: 0, blockTooTall: true })
   })

   // ====================================
   //  Sub-pixel tolerance (no flapping on fractional measurements)
   // ====================================
   it('does not flag overflow for content that fills the box within the tolerance', () => {
      expect(computeOverflowCut([250 + OVERFLOW_TOLERANCE_PX], 250).overflows).toBe(false)
      expect(computeOverflowCut([250], 250).overflows).toBe(false)
   })

   it('flags overflow only once the spill exceeds the tolerance', () => {
      const cut = computeOverflowCut([250 + OVERFLOW_TOLERANCE_PX + 0.5], 250)
      expect(cut.overflows).toBe(true)
      expect(cut.blockTooTall).toBe(true)
   })
})

import { describe, it, expect } from 'vitest'
import { clampWindowPosition, clampWindowSize } from 'react-pop-a-window'

// The draggable-window primitive's clamp math (now owned by react-pop-a-window) is exposed as two
// pure functions so the "can never leave the screen" / "can never invert" guarantees the app relies
// on are provable without a DOM. The bounds origin stays at 0/0 (the clamp reads width/height only).
const VIEWPORT = { top: 0, left: 0, width: 1000, height: 800 }
const MARGIN = 12

describe('clampWindowPosition', () => {
   it('leaves an in-bounds position untouched', () => {
      const result = clampWindowPosition({ left: 200, top: 150 }, { width: 400, height: 300 }, VIEWPORT, MARGIN)
      expect(result).toEqual({ left: 200, top: 150 })
   })

   it('pushes back from the far edge so the window stays fully on-screen', () => {
      // left 900 + width 400 = 1300 > 1000, so clamp to viewport - width - margin = 588
      const result = clampWindowPosition({ left: 900, top: 700 }, { width: 400, height: 300 }, VIEWPORT, MARGIN)
      expect(result.left).toBe(VIEWPORT.width  - 400 - MARGIN)
      expect(result.top).toBe(VIEWPORT.height - 300 - MARGIN)
   })

   it('floors at the near edge (margin) for negative desired coordinates', () => {
      const result = clampWindowPosition({ left: -50, top: -80 }, { width: 400, height: 300 }, VIEWPORT, MARGIN)
      expect(result).toEqual({ left: MARGIN, top: MARGIN })
   })

   it('prefers the near-edge floor when the window is larger than the viewport', () => {
      // A window wider than the viewport can't satisfy both edges; the near-edge floor wins.
      const result = clampWindowPosition({ left: 500, top: 400 }, { width: 2000, height: 1600 }, VIEWPORT, MARGIN)
      expect(result).toEqual({ left: MARGIN, top: MARGIN })
   })
})

describe('clampWindowSize', () => {
   const MIN = { width: 320, height: 240 }
   const MAX = { width: 920, height: 860 }

   it('keeps a size within all bounds unchanged', () => {
      const result = clampWindowSize({ width: 500, height: 400 }, { left: 100, top: 100 }, MIN, MAX, VIEWPORT, MARGIN)
      expect(result).toEqual({ width: 500, height: 400 })
   })

   it('clamps up to the minimum size', () => {
      const result = clampWindowSize({ width: 100, height: 50 }, { left: 100, top: 100 }, MIN, MAX, VIEWPORT, MARGIN)
      expect(result).toEqual({ width: MIN.width, height: MIN.height })
   })

   it('clamps down to the maximum size, viewport permitting', () => {
      const result = clampWindowSize({ width: 5000, height: 5000 }, { left: 10, top: 10 }, MIN, MAX, VIEWPORT, MARGIN)
      // Width: 1000 - 10 - 12 = 978 available > MAX 920, so the max binds.
      expect(result.width).toBe(MAX.width)
      // Height: MAX 860 would fit, but 800 - 10 - 12 = 778 of viewport remains, so viewport binds first.
      expect(result.height).toBe(VIEWPORT.height - 10 - MARGIN)
   })

   it('caps growth at the remaining viewport from the current position', () => {
      // From left 700, only 1000 - 700 - 12 = 288 px remain; but MIN.width 320 floors it.
      const result = clampWindowSize({ width: 900, height: 900 }, { left: 700, top: 600 }, MIN, MAX, VIEWPORT, MARGIN)
      // available width 288 < MIN 320, so min wins (never inverts below the floor)
      expect(result.width).toBe(MIN.width)
      // available height 800 - 600 - 12 = 188 < MIN 240, so min wins
      expect(result.height).toBe(MIN.height)
   })

   it('uses the remaining viewport when it sits between min and max', () => {
      // From left 300: available = 1000 - 300 - 12 = 688, between MIN 320 and MAX 920, so 688 wins.
      const result = clampWindowSize({ width: 900, height: 400 }, { left: 300, top: 100 }, MIN, MAX, VIEWPORT, MARGIN)
      expect(result.width).toBe(688)
      expect(result.height).toBe(400)
   })
})

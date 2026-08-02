import { describe, it, expect } from 'vitest'
import { fitWithinLongestEdge, DEFAULT_MAX_EDGE } from './imageDownscale'

// The canvas encode is browser-only (jsdom has no real 2D context), so only the pure size math is
// unit-tested here, that is the whole reason it is factored out of downscaleImageToDataUrl.

describe('fitWithinLongestEdge', () => {
   it('leaves an image already within the cap unchanged (never scales up)', () => {
      expect(fitWithinLongestEdge(800, 600, 2048)).toEqual({ width: 800, height: 600 })
      expect(fitWithinLongestEdge(2048, 100, 2048)).toEqual({ width: 2048, height: 100 })
   })

   it('scales a wide landscape image so its width (the longest edge) hits the cap', () => {
      // 4000x1000 -> longest edge 4000 scaled to 2000: factor 0.5 -> 2000x500.
      expect(fitWithinLongestEdge(4000, 1000, 2000)).toEqual({ width: 2000, height: 500 })
   })

   it('scales a tall portrait image so its height (the longest edge) hits the cap', () => {
      expect(fitWithinLongestEdge(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 })
   })

   it('preserves aspect ratio, rounding both dimensions', () => {
      // 3000x2000 -> factor 2048/3000 -> ~2048 x ~1365.33 -> rounds to 1365.
      const fitted = fitWithinLongestEdge(3000, 2000)
      expect(fitted.width).toBe(2048)
      expect(fitted.height).toBe(1365)
   })

   it('uses DEFAULT_MAX_EDGE when no cap is passed', () => {
      const fitted = fitWithinLongestEdge(DEFAULT_MAX_EDGE * 2, DEFAULT_MAX_EDGE * 2)
      expect(Math.max(fitted.width, fitted.height)).toBe(DEFAULT_MAX_EDGE)
   })

   it('never returns a zero dimension for an extreme aspect ratio', () => {
      // 6000x1 capped at 2048: height rounds to ~0.0003 but is floored to 1.
      const fitted = fitWithinLongestEdge(6000, 1, 2048)
      expect(fitted.width).toBe(2048)
      expect(fitted.height).toBe(1)
   })

   it('handles a square image', () => {
      expect(fitWithinLongestEdge(5000, 5000, 2048)).toEqual({ width: 2048, height: 2048 })
   })
})

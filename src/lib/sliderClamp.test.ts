import { describe, it, expect } from 'vitest'
import { clampToStep } from './sliderClamp'

describe('clampToStep', () => {
   it('passes a value already on a valid step through unchanged', () => {
      expect(clampToStep(0.15, 0.02, 0.3, 0.01)).toBeCloseTo(0.15)
      expect(clampToStep(500, 24, 1200, 4)).toBe(500)
   })

   it('clamps a value above max down to max', () => {
      expect(clampToStep(9999, 24, 1200, 4)).toBe(1200)
   })

   it('clamps a value below min up to min', () => {
      expect(clampToStep(-50, 24, 1200, 4)).toBe(24)
   })

   it('snaps an off-step value to the nearest step relative to min', () => {
      // min=24, step=4 -> valid steps are 24, 28, 32, ...; 501 is closer to 500 (24 + 119*4) than 504.
      expect(clampToStep(501, 24, 1200, 4)).toBe(500)
      expect(clampToStep(503, 24, 1200, 4)).toBe(504)
   })

   it('sheds float noise from the snap arithmetic', () => {
      expect(clampToStep(0.1 + 0.2, 0, 1, 0.1)).toBeCloseTo(0.3)
   })
})

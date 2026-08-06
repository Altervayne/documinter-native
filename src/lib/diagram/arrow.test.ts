import { describe, it, expect } from 'vitest'
import { renderArrowhead, ARROW_LENGTH, ARROW_HALF_WIDTH } from './arrow'

describe('renderArrowhead', () => {
   it('draws nothing for a zero-length segment', () => {
      expect(renderArrowhead({ x: 10, y: 10 }, { x: 10, y: 10 }, '#000')).toBe('')
   })

   it('builds a filled triangle polygon oriented along the incoming segment', () => {
      // Horizontal segment pointing right; tip at (100, 50).
      const markup = renderArrowhead({ x: 0, y: 50 }, { x: 100, y: 50 }, '#123456')
      expect(markup).toContain('<polygon')
      expect(markup).toContain('fill="#123456"')
      // Tip is the first point.
      expect(markup).toContain('100,50')
      // The base sits ARROW_LENGTH back (x = 100 - 12 = 88), spanning +/-ARROW_HALF_WIDTH in y.
      expect(markup).toContain(`88,${50 - ARROW_HALF_WIDTH}`)
      expect(markup).toContain(`88,${50 + ARROW_HALF_WIDTH}`)
   })

   it('orients the arrowhead for a vertical downward segment', () => {
      // Segment pointing down; tip at (50, 100). Base center at y = 100 - ARROW_LENGTH.
      const markup = renderArrowhead({ x: 50, y: 0 }, { x: 50, y: 100 }, '#000')
      const baseY = 100 - ARROW_LENGTH
      // Base points span +/-ARROW_HALF_WIDTH in x at the base y.
      expect(markup).toContain(`${50 - ARROW_HALF_WIDTH},${baseY}`)
      expect(markup).toContain(`${50 + ARROW_HALF_WIDTH},${baseY}`)
   })
})

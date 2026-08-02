import { describe, it, expect } from 'vitest'
import { catmullRomPath } from './smooth'

describe('catmullRomPath', () => {
   it('renders nothing for fewer than 2 points', () => {
      expect(catmullRomPath([])).toBe('')
      expect(catmullRomPath([{ x: 1, y: 1 }])).toBe('')
   })

   it('renders a plain straight segment for exactly 2 points', () => {
      expect(catmullRomPath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M 0,0 L 10,5')
   })

   it('renders one Bezier segment per gap for 3+ points, starting with M and ending at the last point', () => {
      const path = catmullRomPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }])
      expect(path.startsWith('M 0,0')).toBe(true)
      expect(path).toContain('C ')
      // Two segments (gap count = points.length - 1 = 2), each starting with a C command.
      expect(path.match(/C /g)?.length).toBe(2)
      expect(path.endsWith('20,0')).toBe(true)
   })

   it('is deterministic for the same input', () => {
      const points = [{ x: 1, y: 2 }, { x: 3, y: 5 }, { x: 8, y: 1 }, { x: 12, y: 9 }]
      expect(catmullRomPath(points)).toBe(catmullRomPath(points))
   })

   it('collapses a non-finite coordinate to 0 rather than emitting NaN', () => {
      const path = catmullRomPath([{ x: 0, y: 0 }, { x: Number.NaN, y: 5 }])
      expect(path).not.toContain('NaN')
   })
})

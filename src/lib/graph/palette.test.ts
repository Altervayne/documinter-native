import { describe, it, expect } from 'vitest'
import {
   GRAPH_SERIES_LIGHT,
   GRAPH_SERIES_DARK,
   MAX_SERIES,
   LIGHT_GRAPH_THEME,
   DARK_GRAPH_THEME,
   resolveSeriesColor,
   relativeLuminance,
   readableTextOn,
} from './palette'

// ###########
// # PALETTE #
// ###########

describe('graph palette', () => {
   it('carries exactly 8 hues in each mode, capped at MAX_SERIES', () => {
      expect(GRAPH_SERIES_LIGHT).toHaveLength(8)
      expect(GRAPH_SERIES_DARK).toHaveLength(8)
      expect(MAX_SERIES).toBe(8)
   })

   it('exposes the light and dark palette columns on the themes', () => {
      expect(LIGHT_GRAPH_THEME.palette).toEqual([...GRAPH_SERIES_LIGHT])
      expect(DARK_GRAPH_THEME.palette).toEqual([...GRAPH_SERIES_DARK])
   })
})

// ####################
// # COLOR RESOLUTION #
// ####################

describe('resolveSeriesColor', () => {
   it('assigns hues in fixed slot order', () => {
      for (let index = 0; index < 8; index++) {
         expect(resolveSeriesColor(index, undefined, LIGHT_GRAPH_THEME)).toBe(GRAPH_SERIES_LIGHT[index])
         expect(resolveSeriesColor(index, undefined, DARK_GRAPH_THEME)).toBe(GRAPH_SERIES_DARK[index])
      }
   })

   it('wraps modulo the 8-color cap for an out-of-range index', () => {
      expect(resolveSeriesColor(8, undefined, LIGHT_GRAPH_THEME)).toBe(GRAPH_SERIES_LIGHT[0])
      expect(resolveSeriesColor(9, undefined, LIGHT_GRAPH_THEME)).toBe(GRAPH_SERIES_LIGHT[1])
   })

   it('lets a per-series override win over the palette slot', () => {
      expect(resolveSeriesColor(0, '#123456', LIGHT_GRAPH_THEME)).toBe('#123456')
      expect(resolveSeriesColor(3, '#abcdef', DARK_GRAPH_THEME)).toBe('#abcdef')
   })

   it('ignores a blank override and falls back to the palette slot', () => {
      expect(resolveSeriesColor(1, '', LIGHT_GRAPH_THEME)).toBe(GRAPH_SERIES_LIGHT[1])
      expect(resolveSeriesColor(1, '   ', LIGHT_GRAPH_THEME)).toBe(GRAPH_SERIES_LIGHT[1])
   })
})

// #############
// # LUMINANCE #
// #############

describe('luminance helpers', () => {
   it('places white near 1 and black near 0', () => {
      expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2)
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 2)
   })

   it('returns 0 for an unparseable color', () => {
      expect(relativeLuminance('not-a-color')).toBe(0)
   })

   it('picks ink on a light fill and white on a dark fill', () => {
      expect(readableTextOn('#ffffff')).toBe('#0b0b0b')
      expect(readableTextOn('#000000')).toBe('#ffffff')
      expect(readableTextOn('#eda100')).toBe('#0b0b0b') // light yellow slot
   })
})

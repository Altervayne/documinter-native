import { describe, it, expect } from 'vitest'
import {
   ALL_LIST_MARKERS,
   markerOrDefault,
   isOrderedMarker,
   markerListStyleType,
   markerMarkerClass,
   formatOrderedMarker,
} from './listMarkers'
import type { ListMarker } from '../types'

describe('markerOrDefault', () => {
   it('returns dot for an absent marker', () => {
      expect(markerOrDefault(undefined)).toBe('dot')
   })

   it('passes a set marker through unchanged', () => {
      expect(markerOrDefault('decimal')).toBe('decimal')
      expect(markerOrDefault('dash')).toBe('dash')
      expect(markerOrDefault('dot')).toBe('dot')
   })
})

describe('isOrderedMarker', () => {
   it('is true for the five numbered markers', () => {
      for (const marker of ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'] as ListMarker[]) {
         expect(isOrderedMarker(marker)).toBe(true)
      }
   })

   it('is false for the five bullet markers', () => {
      for (const marker of ['dot', 'circle', 'square', 'dash', 'arrow'] as ListMarker[]) {
         expect(isOrderedMarker(marker)).toBe(false)
      }
   })
})

describe('markerListStyleType', () => {
   it('maps native markers to their CSS list-style-type', () => {
      expect(markerListStyleType('dot')).toBe('disc')
      expect(markerListStyleType('circle')).toBe('circle')
      expect(markerListStyleType('square')).toBe('square')
      expect(markerListStyleType('decimal')).toBe('decimal')
      expect(markerListStyleType('lower-alpha')).toBe('lower-alpha')
      expect(markerListStyleType('upper-alpha')).toBe('upper-alpha')
      expect(markerListStyleType('lower-roman')).toBe('lower-roman')
      expect(markerListStyleType('upper-roman')).toBe('upper-roman')
   })

   it('returns null for the marker-content markers', () => {
      expect(markerListStyleType('dash')).toBeNull()
      expect(markerListStyleType('arrow')).toBeNull()
   })
})

describe('markerMarkerClass', () => {
   it('names the css class for dash and arrow', () => {
      expect(markerMarkerClass('dash')).toBe('doc-list-marker-dash')
      expect(markerMarkerClass('arrow')).toBe('doc-list-marker-arrow')
   })

   it('is null for every native marker', () => {
      for (const marker of ['dot', 'circle', 'square', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'] as ListMarker[]) {
         expect(markerMarkerClass(marker)).toBeNull()
      }
   })
})

describe('formatOrderedMarker', () => {
   it('formats decimal ordinals', () => {
      expect(formatOrderedMarker('decimal', 1)).toBe('1')
      expect(formatOrderedMarker('decimal', 27)).toBe('27')
   })

   it('formats alpha ordinals with bijective base-26 carry', () => {
      expect(formatOrderedMarker('lower-alpha', 1)).toBe('a')
      expect(formatOrderedMarker('lower-alpha', 26)).toBe('z')
      expect(formatOrderedMarker('lower-alpha', 27)).toBe('aa')
      expect(formatOrderedMarker('upper-alpha', 2)).toBe('B')
   })

   it('formats roman ordinals in both cases', () => {
      expect(formatOrderedMarker('lower-roman', 1)).toBe('i')
      expect(formatOrderedMarker('lower-roman', 4)).toBe('iv')
      expect(formatOrderedMarker('upper-roman', 9)).toBe('IX')
   })

   it('returns an empty string for an unordered marker', () => {
      expect(formatOrderedMarker('dot', 3)).toBe('')
      expect(formatOrderedMarker('dash', 1)).toBe('')
   })
})

describe('ALL_LIST_MARKERS', () => {
   it('lists the ten markers, bullets before numbers', () => {
      expect(ALL_LIST_MARKERS).toEqual([
         'dot', 'circle', 'square', 'dash', 'arrow',
         'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman',
      ])
   })
})

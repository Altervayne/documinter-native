import { describe, it, expect } from 'vitest'
import { esc, stripTags, slugify } from './text'

// sanitizeRichText needs DOMParser, so it is tested in text.dom.test.ts instead.

describe('esc', () => {
   it('escapes &, <, >, and "', () => {
      expect(esc('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
   })

   it('coerces null/undefined to an empty string', () => {
      expect(esc(undefined)).toBe('')
      expect(esc(null)).toBe('')
   })
})

describe('stripTags', () => {
   it('removes all HTML tags, keeping the text content', () => {
      expect(stripTags('<b>hi</b> <i>there</i>')).toBe('hi there')
   })
})

describe('slugify', () => {
   it('lowercases and dash-joins, trimming leading/trailing separators', () => {
      expect(slugify('Hello World!')).toBe('hello-world')
   })

   it('collapses runs of non-alphanumerics into a single dash', () => {
      expect(slugify('a   b---c')).toBe('a-b-c')
   })

   it('falls back to "doc" when nothing usable remains', () => {
      expect(slugify('')).toBe('doc')
      expect(slugify('  !!!  ')).toBe('doc')
   })
})

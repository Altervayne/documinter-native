import { describe, it, expect } from 'vitest'

import { formatPageNumber } from './pageNumbering'
import { normalizeFormat, isDefaultFormat } from './format'

const labels = { page: 'Page', of: 'of' }

describe('formatPageNumber', () => {
   it('renders each style for page 3 of 12', () => {
      expect(formatPageNumber('plain',  3, 12, labels)).toBe('3')
      expect(formatPageNumber('page',   3, 12, labels)).toBe('Page 3')
      expect(formatPageNumber('slash',  3, 12, labels)).toBe('3 / 12')
      expect(formatPageNumber('pageOf', 3, 12, labels)).toBe('Page 3 of 12')
      expect(formatPageNumber('dashes', 3, 12, labels)).toBe('- 3 -')
   })

   it('uses the localized words for page / pageOf', () => {
      expect(formatPageNumber('pageOf', 1, 4, { page: 'Page', of: 'sur' })).toBe('Page 1 sur 4')
   })
})

describe('normalizeFormat, header / footer bands', () => {
   it('keeps a footer band with a page-number item and a credit', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', footer: { left: { kind: 'pageNumber', style: 'pageOf' }, right: { kind: 'credit' } } })
      expect(format.footer).toEqual({ left: { kind: 'pageNumber', style: 'pageOf' }, right: { kind: 'credit' } })
   })

   it('drops an empty content item and a malformed item, keeps a text item', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', header: { left: { kind: 'content' }, center: { kind: 'bogus' }, right: { kind: 'content', text: 'Hi' } } })
      expect(format.header).toEqual({ right: { kind: 'content', text: 'Hi' } })
   })

   it('falls back to the plain page-number style when invalid', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', footer: { center: { kind: 'pageNumber', style: 'bogus' } } })
      expect(format.footer?.center).toEqual({ kind: 'pageNumber', style: 'plain' })
   })

   it('keeps a present-but-empty footer as {} (a deliberately cleared footer)', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', footer: {} })
      expect(format.footer).toEqual({})
   })

   it('a format with a header band is not the default format', () => {
      const format = normalizeFormat({ kind: 'infinite', header: { center: { kind: 'pageNumber', style: 'plain' } } })
      expect(isDefaultFormat(format)).toBe(false)
   })
})

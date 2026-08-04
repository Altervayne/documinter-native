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

describe('normalizeFormat — pageNumbering', () => {
   it('keeps a bottom-right slot + style', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', pageNumbering: { bottom: { align: 'right' }, style: 'pageOf' } })
      expect(format.pageNumbering).toEqual({ bottom: { align: 'right' }, style: 'pageOf' })
   })

   it('keeps both top and bottom slots independently', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', pageNumbering: { top: { align: 'left' }, bottom: { align: 'center' }, style: 'plain' } })
      expect(format.pageNumbering?.top).toEqual({ align: 'left' })
      expect(format.pageNumbering?.bottom).toEqual({ align: 'center' })
   })

   it('drops page numbering when neither edge is present', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', pageNumbering: { style: 'plain' } })
      expect(format.pageNumbering).toBeUndefined()
   })

   it('falls back to the plain style when style is missing / invalid', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', pageNumbering: { bottom: { align: 'center' }, style: 'bogus' } })
      expect(format.pageNumbering?.style).toBe('plain')
   })

   it('drops a slot whose align is invalid', () => {
      const format = normalizeFormat({ kind: 'a4-portrait', pageNumbering: { top: { align: 'middle' }, bottom: { align: 'left' }, style: 'plain' } })
      expect(format.pageNumbering?.top).toBeUndefined()
      expect(format.pageNumbering?.bottom).toEqual({ align: 'left' })
   })

   it('a format with only page numbering is not the default format', () => {
      const format = normalizeFormat({ kind: 'infinite', pageNumbering: { bottom: { align: 'right' }, style: 'plain' } })
      expect(isDefaultFormat(format)).toBe(false)
   })
})

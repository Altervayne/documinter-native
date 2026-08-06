import { describe, it, expect } from 'vitest'
import {
   normalizeFormat,
   isDefaultFormat,
   resolveInfiniteWidthPx,
   resolveDocumentSheetWidthPx,
   DEFAULT_FORMAT,
   INFINITE_WIDTH_NARROW_PX,
   INFINITE_WIDTH_NORMAL_PX,
   INFINITE_WIDTH_WIDE_PX,
   INFINITE_WIDTH_CUSTOM_MIN_PX,
   INFINITE_WIDTH_CUSTOM_MAX_PX,
   type DocFormat,
} from './format'

describe('normalizeFormat', () => {
   it('defaults to infinite for undefined / null / non-object input', () => {
      expect(normalizeFormat(undefined)).toEqual({ kind: 'infinite' })
      expect(normalizeFormat(null)).toEqual({ kind: 'infinite' })
      expect(normalizeFormat('nonsense')).toEqual({ kind: 'infinite' })
      expect(normalizeFormat(42)).toEqual({ kind: 'infinite' })
   })

   it('defaults to infinite for an empty object', () => {
      expect(normalizeFormat({})).toEqual({ kind: 'infinite' })
   })

   it('passes through a valid kind', () => {
      expect(normalizeFormat({ kind: 'a4-portrait' })).toEqual({ kind: 'a4-portrait' })
      expect(normalizeFormat({ kind: 'a4-landscape' })).toEqual({ kind: 'a4-landscape' })
   })

   it('falls back to infinite for an invalid kind', () => {
      expect(normalizeFormat({ kind: 'bogus' })).toEqual({ kind: 'infinite' })
   })

   it('passes through a valid width keyword', () => {
      expect(normalizeFormat({ width: 'narrow' })).toEqual({ kind: 'infinite', width: 'narrow' })
      expect(normalizeFormat({ width: 'wide' })).toEqual({ kind: 'infinite', width: 'wide' })
   })

   it('drops an invalid width, leaving it absent (resolves to normal)', () => {
      expect(normalizeFormat({ width: 'bogus' })).toEqual({ kind: 'infinite' })
   })

   it('clamps a custom width into the sane window', () => {
      expect(normalizeFormat({ width: { custom: 99999 } })).toEqual({ kind: 'infinite', width: { custom: INFINITE_WIDTH_CUSTOM_MAX_PX } })
      expect(normalizeFormat({ width: { custom: 10 } })).toEqual({ kind: 'infinite', width: { custom: INFINITE_WIDTH_CUSTOM_MIN_PX } })
      expect(normalizeFormat({ width: { custom: 700 } })).toEqual({ kind: 'infinite', width: { custom: 700 } })
   })

   it('fills missing margin sides with the default while keeping present ones', () => {
      expect(normalizeFormat({ margins: { top: 10, right: 10, bottom: 10, left: 10 } }))
         .toEqual({ kind: 'infinite', margins: { top: 10, right: 10, bottom: 10, left: 10 } })
      expect(normalizeFormat({ margins: { top: 5 } }))
         .toEqual({ kind: 'infinite', margins: { top: 5, right: 20, bottom: 20, left: 20 } })
   })

   it('drops malformed page-break entries and keeps well-formed ones', () => {
      const result = normalizeFormat({
         kind: 'a4-portrait',
         pages: [
            { id: 'p1', before: { sectionId: 's1', blockId: 'b1' } },
            { id: '', before: { sectionId: 's1', blockId: 'b1' } },   // missing id -> dropped
            { before: { sectionId: 's1', blockId: 'b1' } },           // missing id -> dropped
            { id: 'p2', before: { sectionId: 's2' } },                // missing blockId -> dropped
            'nonsense',
         ],
      })
      expect(result).toEqual({
         kind: 'a4-portrait',
         pages: [{ id: 'p1', before: { sectionId: 's1', blockId: 'b1' } }],
      })
   })

   it('omits an empty pages array entirely (equivalent to absent)', () => {
      expect(normalizeFormat({ pages: [] })).toEqual({ kind: 'infinite' })
   })
})

describe('isDefaultFormat', () => {
   it('is true for the bare default and for an explicit normal width', () => {
      expect(isDefaultFormat({ kind: 'infinite' })).toBe(true)
      expect(isDefaultFormat({ kind: 'infinite', width: 'normal' })).toBe(true)
      expect(isDefaultFormat(DEFAULT_FORMAT)).toBe(true)
   })

   it('is false once width, margins, kind, or pages diverge from default', () => {
      expect(isDefaultFormat({ kind: 'infinite', width: 'wide' })).toBe(false)
      expect(isDefaultFormat({ kind: 'infinite', width: 'narrow' })).toBe(false)
      expect(isDefaultFormat({ kind: 'infinite', width: { custom: 900 } })).toBe(false)
      expect(isDefaultFormat({ kind: 'infinite', margins: { top: 1, right: 1, bottom: 1, left: 1 } })).toBe(false)
      expect(isDefaultFormat({ kind: 'a4-portrait' })).toBe(false)
      const withPages: DocFormat = { kind: 'infinite', pages: [{ id: 'p1', before: { sectionId: 's', blockId: 'b' } }] }
      expect(isDefaultFormat(withPages)).toBe(false)
   })
})

describe('resolveInfiniteWidthPx', () => {
   it('resolves absent and "normal" to the same today-exact px', () => {
      expect(resolveInfiniteWidthPx(undefined)).toBe(INFINITE_WIDTH_NORMAL_PX)
      expect(resolveInfiniteWidthPx('normal')).toBe(INFINITE_WIDTH_NORMAL_PX)
      expect(INFINITE_WIDTH_NORMAL_PX).toBe(860)   // pin the exact today's-sheet value
   })

   it('resolves narrow and wide presets', () => {
      expect(resolveInfiniteWidthPx('narrow')).toBe(INFINITE_WIDTH_NARROW_PX)
      expect(resolveInfiniteWidthPx('wide')).toBe(INFINITE_WIDTH_WIDE_PX)
   })

   it('resolves a custom width, clamped to the sane window', () => {
      expect(resolveInfiniteWidthPx({ custom: 700 })).toBe(700)
      expect(resolveInfiniteWidthPx({ custom: 50 })).toBe(INFINITE_WIDTH_CUSTOM_MIN_PX)
      expect(resolveInfiniteWidthPx({ custom: 5000 })).toBe(INFINITE_WIDTH_CUSTOM_MAX_PX)
   })
})

describe('resolveDocumentSheetWidthPx', () => {
   it('resolves absent format / bare infinite / explicit normal to the same px', () => {
      expect(resolveDocumentSheetWidthPx(undefined)).toBe(INFINITE_WIDTH_NORMAL_PX)
      expect(resolveDocumentSheetWidthPx({ kind: 'infinite' })).toBe(INFINITE_WIDTH_NORMAL_PX)
      expect(resolveDocumentSheetWidthPx({ kind: 'infinite', width: 'normal' })).toBe(INFINITE_WIDTH_NORMAL_PX)
   })

   it('applies a non-normal infinite width', () => {
      expect(resolveDocumentSheetWidthPx({ kind: 'infinite', width: 'wide' })).toBe(INFINITE_WIDTH_WIDE_PX)
      expect(resolveDocumentSheetWidthPx({ kind: 'infinite', width: 'narrow' })).toBe(INFINITE_WIDTH_NARROW_PX)
      expect(resolveDocumentSheetWidthPx({ kind: 'infinite', width: { custom: 999 } })).toBe(999)
   })

   it('ignores width for an A4 kind this phase, falling back to normal (paged rendering is Phase 2)', () => {
      expect(resolveDocumentSheetWidthPx({ kind: 'a4-portrait', width: 'wide' })).toBe(INFINITE_WIDTH_NORMAL_PX)
      expect(resolveDocumentSheetWidthPx({ kind: 'a4-landscape', width: { custom: 1500 } })).toBe(INFINITE_WIDTH_NORMAL_PX)
   })
})

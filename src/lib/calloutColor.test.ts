import { describe, it, expect } from 'vitest'
import { isValidCalloutHex, sanitizeCalloutHex } from './calloutColor'

describe('isValidCalloutHex', () => {
   it('accepts #rgb and #rrggbb, case-insensitive', () => {
      expect(isValidCalloutHex('#f80')).toBe(true)
      expect(isValidCalloutHex('#FF8800')).toBe(true)
      expect(isValidCalloutHex('#ff8800')).toBe(true)
   })

   it('tolerates surrounding whitespace', () => {
      expect(isValidCalloutHex('  #ff8800  ')).toBe(true)
   })

   it('rejects malformed hex strings', () => {
      expect(isValidCalloutHex('#ff88')).toBe(false)      // wrong digit count
      expect(isValidCalloutHex('#zzzzzz')).toBe(false)     // non-hex digits
      expect(isValidCalloutHex('ff8800')).toBe(false)      // missing '#'
      expect(isValidCalloutHex('')).toBe(false)
   })
})

describe('sanitizeCalloutHex', () => {
   it('normalizes a valid hex to trimmed lowercase', () => {
      expect(sanitizeCalloutHex('  #FF8800  ')).toBe('#ff8800')
      expect(sanitizeCalloutHex('#ABC')).toBe('#abc')
   })

   it('returns undefined for a malformed hex', () => {
      expect(sanitizeCalloutHex('#12345')).toBeUndefined()
      expect(sanitizeCalloutHex('not-a-color')).toBeUndefined()
   })
})

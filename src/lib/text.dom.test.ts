// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { sanitizeRichText } from './text'

// DOMParser-based allow-list sanitizer: keeps semantic inline formatting + safe links, converts
// styled spans to semantic tags, and unwraps everything else to inert text.

describe('sanitizeRichText', () => {
   it('preserves the allowed inline formatting tags', () => {
      expect(sanitizeRichText('<b>bold</b> <i>italic</i> <u>under</u> <s>strike</s>'))
         .toBe('<strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s>')
   })

   it('keeps a safe link but strips a javascript: href to plain text', () => {
      expect(sanitizeRichText('<a href="https://example.com">link</a>'))
         .toBe('<a href="https://example.com">link</a>')
      expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe('click')
   })

   it('converts a styled span to its semantic tag and drops color', () => {
      expect(sanitizeRichText('<span style="font-weight:bold">x</span>')).toBe('<strong>x</strong>')
      expect(sanitizeRichText('<span style="color:red">x</span>')).toBe('x')
   })

   it('strips script tags and event-handler attributes', () => {
      const sanitizedScript = sanitizeRichText('<script>alert(1)</script>')
      expect(sanitizedScript).not.toContain('<script')

      expect(sanitizeRichText('<b onclick="evil()">x</b>')).toBe('<strong>x</strong>')
   })

   it('unwraps unknown block tags and trims trailing <br>', () => {
      expect(sanitizeRichText('<div>text</div>')).toBe('text')
      expect(sanitizeRichText('a<br>')).toBe('a')
   })
})

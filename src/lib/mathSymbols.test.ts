import { describe, it, expect } from 'vitest'
import {
   MATH_CARET_MARKER,
   MATH_SYMBOL_CATEGORIES,
   buildSnippetInsertion,
} from './mathSymbols'

describe('buildSnippetInsertion', () => {
   it('appends a marker-less snippet and lands the caret at its end', () => {
      const result = buildSnippetInsertion('\\alpha', '')
      expect(result.text).toBe('\\alpha')
      expect(result.caretOffset).toBe('\\alpha'.length)
   })

   it('replaces the selection outright for a marker-less snippet', () => {
      const result = buildSnippetInsertion('\\beta', 'was selected')
      expect(result.text).toBe('\\beta')
      expect(result.caretOffset).toBe('\\beta'.length)
   })

   it('strips the marker and lands the caret at its position when nothing is selected', () => {
      const result = buildSnippetInsertion(`\\sqrt{${MATH_CARET_MARKER}}`, '')
      expect(result.text).toBe('\\sqrt{}')
      expect(result.text).not.toContain(MATH_CARET_MARKER)
      expect(result.caretOffset).toBe('\\sqrt{'.length)
   })

   it('wraps a non-empty selection into the marker slot and lands the caret after it', () => {
      const result = buildSnippetInsertion(`\\sqrt{${MATH_CARET_MARKER}}`, 'x + 1')
      expect(result.text).toBe('\\sqrt{x + 1}')
      expect(result.caretOffset).toBe('\\sqrt{x + 1'.length)
   })

   it('handles a marker in the middle of a multi-slot template', () => {
      const result = buildSnippetInsertion(`\\frac{${MATH_CARET_MARKER}}{}`, '')
      expect(result.text).toBe('\\frac{}{}')
      expect(result.caretOffset).toBe('\\frac{'.length)
   })
})

describe('MATH_SYMBOL_CATEGORIES catalog', () => {
   it('never leaves the caret marker in a button glyph (latex must be renderable)', () => {
      for (const category of MATH_SYMBOL_CATEGORIES) {
         for (const entry of category.entries) {
            expect(entry.latex).not.toContain(MATH_CARET_MARKER)
         }
      }
   })

   it('has at most one caret marker per insert string', () => {
      for (const category of MATH_SYMBOL_CATEGORIES) {
         for (const entry of category.entries) {
            const markerCount = entry.insert.split(MATH_CARET_MARKER).length - 1
            expect(markerCount).toBeLessThanOrEqual(1)
         }
      }
   })

   it('exposes non-empty name, latex and insert for every entry', () => {
      for (const category of MATH_SYMBOL_CATEGORIES) {
         expect(category.entries.length).toBeGreaterThan(0)
         for (const entry of category.entries) {
            expect(entry.name.length).toBeGreaterThan(0)
            expect(entry.latex.length).toBeGreaterThan(0)
            expect(entry.insert.length).toBeGreaterThan(0)
         }
      }
   })
})

import { describe, it, expect } from 'vitest'
import {
   MATH_CARET_MARKER,
   MATH_SYMBOL_CATEGORIES,
   buildSnippetInsertion,
} from './mathSymbols'
import type { MathSymbolCategoryKey } from './mathSymbols'
import { translations } from './i18n'

// The palette maps each category key to an i18n label string via this key template.
// Keeping the map here (rather than importing the component) keeps this a pure-data test.
const CATEGORY_LABEL_KEYS: Record<MathSymbolCategoryKey, keyof typeof translations.en> = {
   greek:            'blockMathCategoryGreek',
   operators:        'blockMathCategoryOperators',
   relations:        'blockMathCategoryRelations',
   negatedRelations: 'blockMathCategoryNegatedRelations',
   arrows:           'blockMathCategoryArrows',
   bigOperators:     'blockMathCategoryBigOperators',
   fractionsRoots:   'blockMathCategoryFractions',
   accents:          'blockMathCategoryAccents',
   matrices:         'blockMathCategoryMatrices',
   fonts:            'blockMathCategoryFonts',
   symbolsMisc:      'blockMathCategorySymbols',
}

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

   it('gives every category a non-empty i18n label in both languages', () => {
      for (const category of MATH_SYMBOL_CATEGORIES) {
         const labelKey = CATEGORY_LABEL_KEYS[category.key]
         expect(labelKey, `no label key mapped for category "${category.key}"`).toBeTruthy()
         expect(translations.en[labelKey].length).toBeGreaterThan(0)
         expect(translations.fr[labelKey].length).toBeGreaterThan(0)
      }
   })

   it('uses unique entry names within each category (stable React keys)', () => {
      for (const category of MATH_SYMBOL_CATEGORIES) {
         const names = category.entries.map(entry => entry.name)
         expect(new Set(names).size, `duplicate name in "${category.key}"`).toBe(names.length)
      }
   })
})

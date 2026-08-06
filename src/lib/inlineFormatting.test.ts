import { describe, it, expect } from 'vitest'
import { applyColorToRange, mergeAdjacentRuns, runsHaveSameFlags } from './inlineFormatting'
import type { InlineContent } from '../types'

// The color/highlight application + run-normalization primitives used by selection handling.
// The DOM helpers (countCharsToPosition, deriveActiveColorsAt, restoreSelectionRange) need jsdom
// and are covered in inlineFormatting.dom.test.ts.

describe('applyColorToRange', () => {
   it('splits a single run when the range is interior to it', () => {
      const content: InlineContent = [{ text: 'hello' }]
      // Color the 'el' in the middle (chars 1 and 2), leaving 'h' and 'lo' untouched.
      expect(applyColorToRange(content, 1, 3, 'color', '#ff0000')).toEqual([
         { text: 'h' },
         { text: 'el', color: '#ff0000' },
         { text: 'lo' },
      ])
   })

   it('applies across a run boundary, preserving each run\'s other flags', () => {
      const content: InlineContent = [{ text: 'ab' }, { text: 'cd', bold: true }]
      // Range [1,3) covers 'b' (plain) and 'c' (bold); the highlight is added to both.
      expect(applyColorToRange(content, 1, 3, 'highlight', '#ffff00')).toEqual([
         { text: 'a' },
         { text: 'b', highlight: '#ffff00' },
         { text: 'c', bold: true, highlight: '#ffff00' },
         { text: 'd', bold: true },
      ])
   })

   it('applies to the entire content when the range covers all characters', () => {
      const content: InlineContent = [{ text: 'ab' }, { text: 'cd' }]
      expect(applyColorToRange(content, 0, 4, 'color', '#0000ff')).toEqual([
         { text: 'abcd', color: '#0000ff' },
      ])
   })

   it('is a no-op for a zero-length range', () => {
      const content: InlineContent = [{ text: 'hello' }]
      expect(applyColorToRange(content, 2, 2, 'color', '#ff0000')).toEqual([{ text: 'hello' }])
   })

   it('returns empty content unchanged', () => {
      expect(applyColorToRange([], 0, 0, 'color', '#ff0000')).toEqual([])
   })
})

describe('mergeAdjacentRuns', () => {
   it('collapses adjacent runs with identical flags', () => {
      expect(mergeAdjacentRuns([{ text: 'a' }, { text: 'b' }])).toEqual([{ text: 'ab' }])
   })

   it('keeps runs with differing flags separate', () => {
      expect(mergeAdjacentRuns([{ text: 'a', bold: true }, { text: 'b' }]))
         .toEqual([{ text: 'a', bold: true }, { text: 'b' }])
   })

   it('preserves text order while merging only the matching neighbours', () => {
      expect(mergeAdjacentRuns([
         { text: 'a', bold: true },
         { text: 'b', bold: true },
         { text: 'c' },
      ])).toEqual([{ text: 'ab', bold: true }, { text: 'c' }])
   })
})

describe('runsHaveSameFlags', () => {
   it('ignores text and matches on identical flags', () => {
      expect(runsHaveSameFlags({ text: 'x', bold: true }, { text: 'y', bold: true })).toBe(true)
   })

   it('distinguishes a differing boolean flag', () => {
      expect(runsHaveSameFlags({ text: 'x', bold: true }, { text: 'x' })).toBe(false)
   })

   it('distinguishes differing color values', () => {
      expect(runsHaveSameFlags({ text: 'x', color: '#ff0000' }, { text: 'x', color: '#0000ff' }))
         .toBe(false)
   })

   it('distinguishes a set highlight from an absent one', () => {
      expect(runsHaveSameFlags({ text: 'x', highlight: '#ffff00' }, { text: 'x' })).toBe(false)
   })
})

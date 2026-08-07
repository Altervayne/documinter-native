import { describe, it, expect } from 'vitest'
import {
   inlineContentToMintdown,
   mintdownToInlineContent,
   renderInlineContent,
   inlineContentEquals,
   stripTrailingNewlines,
   isEmptyContent,
   splitInlineContent,
} from './inline'
import type { InlineContent } from '../types'

// Tests for the pure, DOM-free inline-content model. The DOM-walk functions
// (parseInlineContent, domToInlineContent, computeCursorPosition) need jsdom and are covered in
// inline.dom.test.ts.

describe('inlineContentToMintdown', () => {
   it('wraps bold+italic as ***text*** (italic inside bold)', () => {
      expect(inlineContentToMintdown([{ text: 'hi', bold: true, italic: true }])).toBe('***hi***')
   })

   it('wraps every flag inside-out: strike → underline → italic → bold → color → highlight → link', () => {
      const content: InlineContent = [{
         text: 'X',
         strikethrough: true, underline: true, italic: true, bold: true,
         color: '#ff0000', highlight: '#ffff00', link: 'href',
      }]
      expect(inlineContentToMintdown(content)).toBe(
         '[{highlight:#ffff00}{color:#ff0000}***__~~X~~__***{/color}{/highlight}](href)',
      )
   })

   it('escapes Mintdown special characters in plain text', () => {
      expect(inlineContentToMintdown([{ text: 'a*b_c~d[e\\f' }])).toBe('a\\*b\\_c\\~d\\[e\\\\f')
   })

   it('encodes a literal ) in a link href as %29', () => {
      expect(inlineContentToMintdown([{ text: 'link', link: 'https://x.com/a)b' }]))
         .toBe('[link](https://x.com/a%29b)')
   })
})

describe('mintdownToInlineContent', () => {
   it('round-trips a representative multi-run content losslessly', () => {
      const content: InlineContent = [
         { text: 'normal ' },
         { text: 'bold', bold: true },
         { text: ' ' },
         { text: 'bolditalic', bold: true, italic: true },
         { text: ' ' },
         { text: 'underline', underline: true },
         { text: ' ' },
         { text: 'strike', strikethrough: true },
         { text: ' ' },
         { text: 'colored', color: '#ff0000' },
         { text: ' ' },
         { text: 'highlit', highlight: '#ffff00' },
         { text: ' ' },
         { text: 'linked', link: 'https://example.com' },
      ]
      const text1  = inlineContentToMintdown(content)
      const parsed = mintdownToInlineContent(text1)
      // Structure survives the parse, and re-serializing is identical.
      expect(parsed).toEqual(content)
      expect(inlineContentToMintdown(parsed)).toBe(text1)
   })

   it('decodes %29 in a link href back to )', () => {
      expect(mintdownToInlineContent('[link](https://x.com/a%29b)'))
         .toEqual([{ text: 'link', link: 'https://x.com/a)b' }])
   })

   it('degrades an unterminated bold marker to literal text without throwing', () => {
      expect(() => mintdownToInlineContent('**unclosed')).not.toThrow()
      expect(mintdownToInlineContent('**unclosed')).toEqual([{ text: '**unclosed' }])
   })

   it('degrades an unterminated color tag to literal text without throwing', () => {
      expect(() => mintdownToInlineContent('{color:#f00}oops')).not.toThrow()
      expect(mintdownToInlineContent('{color:#f00}oops')).toEqual([{ text: '{color:#f00}oops' }])
   })
})

describe('renderInlineContent', () => {
   it('nests bold outside italic', () => {
      expect(renderInlineContent([{ text: 'hi', bold: true, italic: true }]))
         .toBe('<strong><em>hi</em></strong>')
   })

   it('HTML-escapes text content', () => {
      expect(renderInlineContent([{ text: '<b> & "x"' }]))
         .toBe('&lt;b&gt; &amp; &quot;x&quot;')
   })

   it('converts \\n to <br>', () => {
      expect(renderInlineContent([{ text: 'a\nb' }])).toBe('a<br>b')
   })
})

describe('inlineContentEquals', () => {
   it('returns true for field-by-field identical content (incl. color/highlight)', () => {
      const left:  InlineContent = [{ text: 'x', bold: true, color: '#ff0000', highlight: '#ffff00' }]
      const right: InlineContent = [{ text: 'x', bold: true, color: '#ff0000', highlight: '#ffff00' }]
      expect(inlineContentEquals(left, right)).toBe(true)
   })

   it('returns false when text differs', () => {
      expect(inlineContentEquals([{ text: 'a' }], [{ text: 'b' }])).toBe(false)
   })

   it('returns false when a boolean flag differs', () => {
      expect(inlineContentEquals([{ text: 'a', bold: true }], [{ text: 'a' }])).toBe(false)
   })

   it('returns false when color differs', () => {
      expect(inlineContentEquals([{ text: 'a', color: '#ff0000' }], [{ text: 'a', color: '#0000ff' }]))
         .toBe(false)
   })

   it('returns false when length differs', () => {
      expect(inlineContentEquals([{ text: 'a' }], [{ text: 'a' }, { text: 'b' }])).toBe(false)
   })
})

describe('stripTrailingNewlines', () => {
   it('drops trailing newline-only runs', () => {
      expect(stripTrailingNewlines([{ text: 'a' }, { text: '\n' }, { text: '\n\n' }]))
         .toEqual([{ text: 'a' }])
   })

   it('trims a trailing newline off the last run but keeps its text', () => {
      expect(stripTrailingNewlines([{ text: 'a\n' }])).toEqual([{ text: 'a' }])
   })

   it('leaves interior newlines untouched', () => {
      expect(stripTrailingNewlines([{ text: 'a' }, { text: '\n' }, { text: 'b' }]))
         .toEqual([{ text: 'a' }, { text: '\n' }, { text: 'b' }])
   })
})

describe('isEmptyContent', () => {
   it('treats an empty array as empty', () => {
      expect(isEmptyContent([])).toBe(true)
   })

   it('treats all-whitespace runs as empty', () => {
      expect(isEmptyContent([{ text: '   ' }, { text: '\n' }])).toBe(true)
   })

   it('treats any real content as non-empty', () => {
      expect(isEmptyContent([{ text: '  ' }, { text: 'x' }])).toBe(false)
   })
})

/** Concatenate every run's text, the plain-text equivalent of an InlineContent array. */
function flattenText(content: InlineContent): string {
   return content.map(run => run.text).join('')
}

describe('splitInlineContent', () => {
   const mixedContent: InlineContent = [
      { text: 'plain ' },
      { text: 'bold', bold: true },
      { text: ' normal ' },
      { text: 'link', link: 'https://example.com' },
      { text: ' tail' },
   ]

   it('concatenates back to the original text at every offset', () => {
      const totalLength = flattenText(mixedContent).length
      for (let offset = 0; offset <= totalLength; offset++) {
         const [before, after] = splitInlineContent(mixedContent, offset)
         expect(flattenText(before) + flattenText(after)).toBe(flattenText(mixedContent))
      }
   })

   it('returns an empty first half and a clone of the content when offset is 0', () => {
      const [before, after] = splitInlineContent(mixedContent, 0)
      expect(before).toEqual([])
      expect(after).toEqual(mixedContent)
      expect(after[0]).not.toBe(mixedContent[0])
   })

   it('returns an empty first half for a negative offset', () => {
      const [before, after] = splitInlineContent(mixedContent, -5)
      expect(before).toEqual([])
      expect(after).toEqual(mixedContent)
   })

   it('returns an empty second half when offset is at the total length', () => {
      const totalLength = flattenText(mixedContent).length
      const [before, after] = splitInlineContent(mixedContent, totalLength)
      expect(before).toEqual(mixedContent)
      expect(after).toEqual([])
   })

   it('returns an empty second half for an offset past the total length', () => {
      const totalLength = flattenText(mixedContent).length
      const [before, after] = splitInlineContent(mixedContent, totalLength + 50)
      expect(before).toEqual(mixedContent)
      expect(after).toEqual([])
   })

   it('returns two empty halves for empty content', () => {
      expect(splitInlineContent([], 3)).toEqual([[], []])
   })

   it('keeps runs whole when the split falls exactly on a run boundary', () => {
      const content: InlineContent = [{ text: 'abc', bold: true }, { text: 'def' }]
      const [before, after] = splitInlineContent(content, 3)
      expect(before).toEqual([{ text: 'abc', bold: true }])
      expect(after).toEqual([{ text: 'def' }])
   })

   it('splits a marked run in two, both halves carrying the same marks', () => {
      const content: InlineContent = [{ text: 'abcdef', bold: true, color: '#ff0000' }]
      const [before, after] = splitInlineContent(content, 2)
      expect(before).toEqual([{ text: 'ab', bold: true, color: '#ff0000' }])
      expect(after).toEqual([{ text: 'cdef', bold: true, color: '#ff0000' }])
   })

   it('splits inside a link run when content mixes bold, a link, and plain text', () => {
      // 'plain '(6) + 'bold'(4) + ' normal '(8) = 18 characters before the link run starts;
      // offset 20 lands two characters into 'link', splitting it into 'li' | 'nk'.
      const [before, after] = splitInlineContent(mixedContent, 20)
      expect(before).toEqual([
         { text: 'plain ' },
         { text: 'bold', bold: true },
         { text: ' normal ' },
         { text: 'li', link: 'https://example.com' },
      ])
      expect(after).toEqual([
         { text: 'nk', link: 'https://example.com' },
         { text: ' tail' },
      ])
   })

   it('splits inside a run that contains a newline, keeping the newline on its side', () => {
      const content: InlineContent = [{ text: 'line one\nline two', italic: true }]
      const [before, after] = splitInlineContent(content, 9)
      expect(before).toEqual([{ text: 'line one\n', italic: true }])
      expect(after).toEqual([{ text: 'line two', italic: true }])
   })

   it('does not share run objects between the two halves or with the input', () => {
      const content: InlineContent = [{ text: 'abcdef', bold: true }]
      const [before, after] = splitInlineContent(content, 3)
      expect(before[0]).not.toBe(content[0])
      expect(after[0]).not.toBe(content[0])
      expect(before[0]).not.toBe(after[0])

      // Mutating a returned run must not affect the original content.
      before[0].text = 'mutated'
      expect(content[0].text).toBe('abcdef')
   })

   it('merges back into a single run when a split point falls where marks are identical on both sides', () => {
      // Two adjacent runs sharing the same marks are already merged by the stored
      // invariant, but the split path re-collapses from characters, this checks it
      // still produces one run rather than two identical-mark runs.
      const content: InlineContent = [{ text: 'hello world', underline: true }]
      const [before, after] = splitInlineContent(content, 5)
      expect(before).toHaveLength(1)
      expect(after).toHaveLength(1)
   })
})

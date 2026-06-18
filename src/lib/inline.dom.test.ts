// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { parseInlineContent, domToInlineContent, computeCursorPosition } from './inline'

// The DOM-walk half of the inline model: legacy-HTML parsing, the live-element commit path, and the
// caret→offset reader. These need a real node tree + Selection, hence the per-file jsdom docblock.

describe('parseInlineContent', () => {
   it('reads nested formatting elements into flagged runs', () => {
      expect(parseInlineContent('<strong>b<em>bi</em></strong>')).toEqual([
         { text: 'b', bold: true },
         { text: 'bi', bold: true, italic: true },
      ])
   })

   it('reads underline, strikethrough, and links', () => {
      expect(parseInlineContent('<u>under</u><s>strike</s>')).toEqual([
         { text: 'under', underline: true },
         { text: 'strike', strikethrough: true },
      ])
      expect(parseInlineContent('<a href="https://example.com">link</a>')).toEqual([
         { text: 'link', link: 'https://example.com' },
      ])
   })

   it('reads span color and background into normalized hex', () => {
      expect(parseInlineContent('<span style="color:#ff0000">c</span>')).toEqual([
         { text: 'c', color: '#ff0000' },
      ])
      expect(parseInlineContent('<span style="background-color:#ffff00">h</span>')).toEqual([
         { text: 'h', highlight: '#ffff00' },
      ])
   })

   it('converts <br> to \\n', () => {
      expect(parseInlineContent('a<br>b')).toEqual([{ text: 'a\nb' }])
   })

   it('degrades foreign/empty markup gracefully', () => {
      // Unknown elements are traversed without changing flags; their text is kept.
      expect(parseInlineContent('<div><custom-tag>x</custom-tag></div>')).toEqual([{ text: 'x' }])
      expect(parseInlineContent('')).toEqual([])
   })
})

describe('domToInlineContent', () => {
   it('reads the same formatting matrix off a live element', () => {
      const element = document.createElement('div')
      element.innerHTML = '<strong>b</strong><em>i</em><a href="https://example.com">l</a>'
         + '<span style="color:#ff0000">c</span><span style="background-color:#ffff00">h</span>'
      expect(domToInlineContent(element)).toEqual([
         { text: 'b', bold: true },
         { text: 'i', italic: true },
         { text: 'l', link: 'https://example.com' },
         { text: 'c', color: '#ff0000' },
         { text: 'h', highlight: '#ffff00' },
      ])
   })

   it('converts a <br> in the live element to \\n', () => {
      const element = document.createElement('div')
      element.innerHTML = 'a<br>b'
      expect(domToInlineContent(element)).toEqual([{ text: 'a\nb' }])
   })
})

describe('computeCursorPosition', () => {
   // Place a collapsed caret at (textNode, offset) and return the live Selection's reading.
   function placeCaret(textNode: Node, offset: number): void {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.collapse(true)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
   }

   it('reports the flat char offset at the start and mid-text', () => {
      const element = document.createElement('div')
      element.textContent = 'hello'
      document.body.appendChild(element)
      const textNode = element.firstChild!

      placeCaret(textNode, 0)
      expect(computeCursorPosition(element)).toEqual({ runIndex: 0, offset: 0 })

      placeCaret(textNode, 3)
      expect(computeCursorPosition(element)).toEqual({ runIndex: 0, offset: 3 })
   })

   it('counts a <br> as one character', () => {
      const element = document.createElement('div')
      element.innerHTML = 'a<br>b'
      document.body.appendChild(element)
      const textNodeB = element.childNodes[2]   // 'a', <br>, 'b'

      placeCaret(textNodeB, 0)
      expect(computeCursorPosition(element)).toEqual({ runIndex: 0, offset: 2 })
   })

   it('returns null when there is no selection', () => {
      const element = document.createElement('div')
      element.textContent = 'hello'
      document.body.appendChild(element)
      window.getSelection()!.removeAllRanges()
      expect(computeCursorPosition(element)).toBeNull()
   })

   it('returns null when the caret is outside the element', () => {
      const inside  = document.createElement('div')
      inside.textContent = 'inside'
      const outside = document.createElement('div')
      outside.textContent = 'outside'
      document.body.append(inside, outside)

      placeCaret(outside.firstChild!, 1)
      expect(computeCursorPosition(inside)).toBeNull()
   })
})

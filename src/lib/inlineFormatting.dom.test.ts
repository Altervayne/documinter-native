// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { countCharsToPosition, deriveActiveColorsAt, restoreSelectionRange } from './inlineFormatting'

// The DOM-reading selection helpers: flat-offset counting, active-color lookup, and the sole
// Selection writer. jsdom provides the node tree and a basic Selection (no layout geometry needed).

describe('countCharsToPosition', () => {
   it('counts characters across child runs up to a (node, offset)', () => {
      const root = document.createElement('div')
      root.innerHTML = '<strong>ab</strong>cd'
      const trailingText = root.childNodes[1]   // the 'cd' text node after <strong>
      expect(countCharsToPosition(root, trailingText, 1)).toBe(3)   // 'ab' + 'c'
   })

   it('counts a <br> as one character', () => {
      const root = document.createElement('div')
      root.innerHTML = 'a<br>b'
      const textNodeB = root.childNodes[2]
      expect(countCharsToPosition(root, textNodeB, 0)).toBe(2)   // 'a' + <br>
   })
})

describe('deriveActiveColorsAt', () => {
   it('reports the font color inside a colored run and undefined in plain text', () => {
      const element = document.createElement('div')
      element.innerHTML = '<span style="color:#ff0000">red</span>plain'
      const coloredText = element.querySelector('span')!.firstChild!
      const plainText   = element.childNodes[1]

      expect(deriveActiveColorsAt(element, coloredText, 1).fontColor).toBe('#ff0000')
      expect(deriveActiveColorsAt(element, plainText, 1).fontColor).toBeUndefined()
   })
})

describe('restoreSelectionRange', () => {
   it('selects the requested flat character range in the live Selection', () => {
      const element = document.createElement('div')
      element.textContent = 'hello world'
      document.body.appendChild(element)

      restoreSelectionRange(element, 0, 5)

      const selection = window.getSelection()!
      const range     = selection.getRangeAt(0)
      expect(range.startContainer).toBe(element.firstChild)
      expect(range.startOffset).toBe(0)
      expect(range.endOffset).toBe(5)
   })
})

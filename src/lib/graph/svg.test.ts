import { describe, it, expect } from 'vitest'
import {
   escapeXml,
   roundCoordinate,
   formatNumber,
   attributesToString,
   element,
   selfClosingElement,
   textElement,
   titleElement,
} from './svg'

// ############
// # ESCAPING #
// ############

describe('escapeXml', () => {
   it('escapes all five XML significant characters', () => {
      expect(escapeXml('&')).toBe('&amp;')
      expect(escapeXml('<')).toBe('&lt;')
      expect(escapeXml('>')).toBe('&gt;')
      expect(escapeXml('"')).toBe('&quot;')
      expect(escapeXml("'")).toBe('&#39;')
   })

   it('escapes ampersand first so entities are not double-escaped', () => {
      expect(escapeXml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;')
   })

   it('leaves ordinary text untouched', () => {
      expect(escapeXml('Quarter 1 revenue')).toBe('Quarter 1 revenue')
   })
})

// #####################
// # NUMBER FORMATTING #
// #####################

describe('roundCoordinate', () => {
   it('rounds to two places by default', () => {
      expect(roundCoordinate(1.23456)).toBe(1.23)
      expect(roundCoordinate(10)).toBe(10)
      expect(roundCoordinate(1.2)).toBe(1.2)
   })

   it('collapses non-finite input to zero', () => {
      expect(roundCoordinate(Number.NaN)).toBe(0)
      expect(roundCoordinate(Number.POSITIVE_INFINITY)).toBe(0)
   })
})

describe('formatNumber', () => {
   it('groups the integer part with thousands commas', () => {
      expect(formatNumber(1000)).toBe('1,000')
      expect(formatNumber(1234567)).toBe('1,234,567')
      expect(formatNumber(42)).toBe('42')
      expect(formatNumber(0)).toBe('0')
   })

   it('preserves a leading minus and groups the digits', () => {
      expect(formatNumber(-1500)).toBe('-1,500')
   })

   it('keeps a trimmed fractional part', () => {
      expect(formatNumber(12.5)).toBe('12.5')
      expect(formatNumber(1234.5)).toBe('1,234.5')
   })

   it('is deterministic and finite-safe', () => {
      expect(formatNumber(Number.NaN)).toBe('0')
      expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0')
   })
})

// ####################
// # ELEMENT BUILDERS #
// ####################

describe('attributesToString', () => {
   it('rounds numeric attribute values and drops undefined ones', () => {
      expect(attributesToString({ x: 1.23456, y: undefined, width: 10 })).toBe('x="1.23" width="10"')
   })

   it('escapes string attribute values', () => {
      expect(attributesToString({ 'data-name': 'a<b>&"c"' })).toBe('data-name="a&lt;b&gt;&amp;&quot;c&quot;"')
   })
})

describe('element builders', () => {
   it('builds a container element with raw children', () => {
      expect(element('g', { fill: 'red' }, '<rect/>')).toBe('<g fill="red"><rect/></g>')
   })

   it('builds a self-closing element', () => {
      expect(selfClosingElement('line', { x1: 0, y1: 0, x2: 10, y2: 0 })).toBe('<line x1="0" y1="0" x2="10" y2="0"/>')
   })

   it('escapes user text in text and title elements', () => {
      expect(textElement({ x: 0 }, 'A & B')).toBe('<text x="0">A &amp; B</text>')
      expect(titleElement('Q1 <script>')).toBe('<title>Q1 &lt;script&gt;</title>')
   })
})

import { describe, it, expect } from 'vitest'
import { cloneBlock, moveItem, generateHandle, blkPreview, mkSection, mkBlock } from './document'
import { translations } from './i18n'
import { normalizeIds } from '../test/normalizeIds'
import type { Block, DocMeta, DocState } from '../types'

// The real English translations supply the T object mkBlock needs for default content.
const t = translations.en

describe('cloneBlock', () => {
   const source: Block = {
      id: 'container-src', type: 'container', ratio: 0.25,
      left: [{
         id: 'list-src', type: 'list',
         items: [{
            id: 'item-src', richText: [{ text: 'parent' }],
            children: [{ id: 'child-src', richText: [{ text: 'child' }], children: [] }],
         }],
      }],
      right: [{ id: 'para-src', type: 'p', richText: [{ text: 'right' }] }],
   }

   // normalizeIds operates on a DocState, so wrap the block to reuse it for the structural compare.
   function asNormalizedDoc(block: Block): DocState {
      const meta: DocMeta = { title: '', fields: [] }
      return normalizeIds({ meta, sections: [{ id: 's', title: '', collapsed: false, blocks: [block] }] })
   }

   it('preserves structure but assigns fresh ids at every level', () => {
      const clone = cloneBlock(source)
      expect(asNormalizedDoc(clone)).toEqual(asNormalizedDoc(source))

      expect(clone.id).not.toBe(source.id)
      const sourceNestedItemId = source.left![0].items![0].children[0].id
      const cloneNestedItemId  = clone.left![0].items![0].children[0].id
      expect(cloneNestedItemId).not.toBe(sourceNestedItemId)
   })
})

describe('moveItem', () => {
   it('swaps the two indices', () => {
      expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['c', 'b', 'a'])
   })

   it('returns the original array reference when an index is out of bounds', () => {
      const input = ['a', 'b']
      expect(moveItem(input, 0, 5)).toBe(input)
      expect(moveItem(input, -1, 0)).toBe(input)
   })
})

describe('generateHandle', () => {
   it('slugifies the first line of text', () => {
      expect(generateHandle({ id: 'x', type: 'p', richText: [{ text: 'Hello World!' }] })).toBe('hello-world')
   })

   it('derives from the first line of code when there is no richText', () => {
      expect(generateHandle({ id: 'x', type: 'code', code: 'first line\nsecond line' })).toBe('first-line')
   })

   it('falls back to an 8-char id fragment when there is no usable text', () => {
      expect(generateHandle({ id: 'x', type: 'p', richText: [{ text: '' }] })).toMatch(/^[0-9a-f]{8}$/)
   })
})

describe('blkPreview', () => {
   it('renders per-type previews', () => {
      expect(blkPreview({ id: 'x', type: 'p', richText: [{ text: 'Some paragraph' }] })).toBe('Some paragraph')
      expect(blkPreview({ id: 'x', type: 'callout', style: 'warning', richText: [{ text: 'Careful' }] })).toBe('[warning] Careful')
      expect(blkPreview({ id: 'x', type: 'code', code: 'let value = 1' })).toBe('let value = 1')
      expect(blkPreview({ id: 'x', type: 'container', ratio: 0.25 })).toBe('Container (25/75)')
      expect(blkPreview({ id: 'x', type: 'table', richHeaders: [[], []], richRows: [[[], []]] })).toBe('2 col × 1 rows')
      expect(blkPreview({ id: 'x', type: 'image', alt: 'a diagram' })).toBe('[Image] a diagram')
      expect(blkPreview({ id: 'x', type: 'hr' })).toBe('———————————————')
   })
})

describe('mkSection / mkBlock factories', () => {
   it('mkSection builds an empty, expanded section with a fresh id', () => {
      const section = mkSection('My Section')
      expect(section.title).toBe('My Section')
      expect(section.collapsed).toBe(false)
      expect(section.blocks).toEqual([])
      expect(section.id.length).toBeGreaterThan(0)
   })

   it('mkBlock supplies per-type defaults', () => {
      const paragraph = mkBlock('p', t)
      expect(paragraph.type).toBe('p')
      expect(paragraph.richText).toEqual([{ text: t.blockDefaultP }])

      const code = mkBlock('code', t)
      expect(code).toMatchObject({ type: 'code', code: t.blockDefaultCode, lang: 'windev' })

      const container = mkBlock('container', t)
      expect(container).toMatchObject({ type: 'container', ratio: 0.5, left: [], right: [] })

      const list = mkBlock('list', t)
      expect(list.type).toBe('list')
      expect(list.items).toHaveLength(2)
      expect(list.items![0].children).toEqual([])

      const checklist = mkBlock('checklist', t)
      expect(checklist.items![0].checked).toBe(false)
   })
})

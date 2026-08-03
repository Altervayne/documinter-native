import { describe, it, expect } from 'vitest'
import type { Block, Section } from '../types'
import type { PageBreak } from './format'
import {
   partitionIntoPages,
   reconcilePages,
   addPageBreakAfter,
   removePageBreakAfter,
   removePageBreak,
   hasPageBreakAfter,
   canBreakAfter,
   FIRST_PAGE_ID,
} from './pageModel'

// ###########
// # FIXTURES #
// ###########

function mkBlock(id: string): Block {
   return { id, type: 'p', richText: [] }
}

function mkSection(id: string, blockIds: string[]): Section {
   return { id, title: id, collapsed: false, blocks: blockIds.map(mkBlock) }
}

function breakBefore(id: string, sectionId: string, blockId: string): PageBreak {
   return { id, before: { sectionId, blockId } }
}

// A two-section document: s1[a,b,c] · s2[d,e].
const SECTIONS: Section[] = [
   mkSection('s1', ['a', 'b', 'c']),
   mkSection('s2', ['d', 'e']),
]

/** Compact view of a partition for readable assertions: page ids + the block ids per page. */
function shape(pages: ReturnType<typeof partitionIntoPages>) {
   return pages.map(page => ({
      id:     page.id,
      blocks: page.slices.flatMap(slice => slice.blocks.map(block => block.id)),
   }))
}

// #############
// # PARTITION #
// #############

describe('partitionIntoPages', () => {
   it('returns a single page for a document with no breaks', () => {
      const pages = partitionIntoPages(SECTIONS, [])
      expect(shape(pages)).toEqual([{ id: FIRST_PAGE_ID, blocks: ['a', 'b', 'c', 'd', 'e'] }])
   })

   it('returns a single empty page for an empty document', () => {
      const pages = partitionIntoPages([], [])
      expect(pages).toHaveLength(1)
      expect(pages[0].id).toBe(FIRST_PAGE_ID)
      expect(pages[0].slices).toEqual([])
   })

   it('splits mid-section at a break anchoring a block inside the section', () => {
      // break before 'c' → page 1 ends after b, page 2 begins at c.
      const pages = partitionIntoPages(SECTIONS, [breakBefore('brk', 's1', 'c')])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a', 'b'] },
         { id: 'brk',         blocks: ['c', 'd', 'e'] },
      ])
   })

   it('marks the split section slices with start/end flags', () => {
      const pages = partitionIntoPages(SECTIONS, [breakBefore('brk', 's1', 'c')])
      // Page 1: s1 slice is the section START but NOT the end (c is elsewhere).
      const page1s1 = pages[0].slices[0]
      expect(page1s1.section.id).toBe('s1')
      expect(page1s1.isSectionStart).toBe(true)
      expect(page1s1.isSectionEnd).toBe(false)
      // Page 2: first slice is the s1 CONTINUATION (not start) that ends the section.
      const page2s1 = pages[1].slices[0]
      expect(page2s1.section.id).toBe('s1')
      expect(page2s1.isSectionStart).toBe(false)
      expect(page2s1.isSectionEnd).toBe(true)
      // Page 2: second slice is s2, a fresh section start + end.
      const page2s2 = pages[1].slices[1]
      expect(page2s2.section.id).toBe('s2')
      expect(page2s2.isSectionStart).toBe(true)
      expect(page2s2.isSectionEnd).toBe(true)
   })

   it('handles multiple breaks producing several ordered pages', () => {
      const pages = partitionIntoPages(SECTIONS, [
         breakBefore('b1', 's1', 'b'),
         breakBefore('b2', 's2', 'd'),
      ])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a'] },
         { id: 'b1',          blocks: ['b', 'c'] },
         { id: 'b2',          blocks: ['d', 'e'] },
      ])
   })

   it('isolates the last block onto a final page when the break anchors it', () => {
      const pages = partitionIntoPages(SECTIONS, [breakBefore('brk', 's2', 'e')])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a', 'b', 'c', 'd'] },
         { id: 'brk',         blocks: ['e'] },
      ])
   })

   it('breaks cleanly at a section boundary (whole next section on a new page)', () => {
      const pages = partitionIntoPages(SECTIONS, [breakBefore('brk', 's2', 'd')])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a', 'b', 'c'] },
         { id: 'brk',         blocks: ['d', 'e'] },
      ])
   })

   it('absorbs a break anchoring the very first block (no empty leading page)', () => {
      const pages = partitionIntoPages(SECTIONS, [breakBefore('brk', 's1', 'a')])
      expect(shape(pages)).toEqual([{ id: FIRST_PAGE_ID, blocks: ['a', 'b', 'c', 'd', 'e'] }])
   })

   it('places an empty section as a single start+end slice, no cut', () => {
      const withEmpty: Section[] = [mkSection('s1', ['a']), mkSection('empty', [])]
      const pages = partitionIntoPages(withEmpty, [])
      expect(pages).toHaveLength(1)
      const emptySlice = pages[0].slices[1]
      expect(emptySlice.section.id).toBe('empty')
      expect(emptySlice.blocks).toEqual([])
      expect(emptySlice.isSectionStart).toBe(true)
      expect(emptySlice.isSectionEnd).toBe(true)
   })

   it('preserves stable block ordering across pages', () => {
      const pages = partitionIntoPages(SECTIONS, [
         breakBefore('b2', 's2', 'd'),
         breakBefore('b1', 's1', 'b'),   // deliberately out of flow order
      ])
      // Ordering follows the FLAT FLOW, not the pages-array order.
      expect(shape(pages).flatMap(page => page.blocks)).toEqual(['a', 'b', 'c', 'd', 'e'])
   })
})

// #############
// # RECONCILE #
// #############

describe('reconcilePages', () => {
   it('drops a break whose anchor block no longer exists', () => {
      const pages = [breakBefore('brk', 's1', 'gone')]
      expect(reconcilePages(pages, SECTIONS)).toEqual([])
   })

   it('keeps a break whose anchor block still exists', () => {
      const pages = [breakBefore('brk', 's1', 'c')]
      expect(reconcilePages(pages, SECTIONS)).toEqual(pages)
   })

   it('de-dupes multiple breaks on the same anchor', () => {
      const pages = [breakBefore('brk1', 's1', 'c'), breakBefore('brk2', 's1', 'c')]
      expect(reconcilePages(pages, SECTIONS)).toEqual([breakBefore('brk1', 's1', 'c')])
   })

   it('refreshes a stale sectionId when the anchor block moved sections', () => {
      // 'd' now lives in s1, but the stored break still says s2.
      const moved: Section[] = [mkSection('s1', ['a', 'd']), mkSection('s2', ['e'])]
      const pages = [breakBefore('brk', 's2', 'd')]
      expect(reconcilePages(pages, moved)).toEqual([breakBefore('brk', 's1', 'd')])
   })
})

// ###############
// # BREAK EDITS #
// ###############

describe('canBreakAfter / hasPageBreakAfter', () => {
   it('canBreakAfter is true for every block except the last', () => {
      expect(canBreakAfter(SECTIONS, 'a')).toBe(true)
      expect(canBreakAfter(SECTIONS, 'd')).toBe(true)
      expect(canBreakAfter(SECTIONS, 'e')).toBe(false)   // last block of the document
      expect(canBreakAfter(SECTIONS, 'missing')).toBe(false)
   })

   it('hasPageBreakAfter reflects a break before the successor', () => {
      const pages = [breakBefore('brk', 's1', 'c')]   // break BEFORE c == break AFTER b
      expect(hasPageBreakAfter(pages, SECTIONS, 'b')).toBe(true)
      expect(hasPageBreakAfter(pages, SECTIONS, 'a')).toBe(false)
      expect(hasPageBreakAfter(pages, SECTIONS, 'e')).toBe(false)
   })
})

describe('addPageBreakAfter', () => {
   it('adds a break before the successor of the target block', () => {
      const next = addPageBreakAfter([], SECTIONS, 'b')   // after b → before c
      expect(next).toHaveLength(1)
      expect(next[0].before).toEqual({ sectionId: 's1', blockId: 'c' })
      expect(typeof next[0].id).toBe('string')
      expect(next[0].id.length).toBeGreaterThan(0)
   })

   it('crosses a section boundary (after the last block of a section)', () => {
      const next = addPageBreakAfter([], SECTIONS, 'c')   // after c → before d (s2)
      expect(next[0].before).toEqual({ sectionId: 's2', blockId: 'd' })
   })

   it('is a no-op after the last block of the document', () => {
      const pages: PageBreak[] = []
      expect(addPageBreakAfter(pages, SECTIONS, 'e')).toBe(pages)
   })

   it('is a no-op when a break already sits there', () => {
      const pages = [breakBefore('brk', 's1', 'c')]
      expect(addPageBreakAfter(pages, SECTIONS, 'b')).toBe(pages)
   })
})

describe('removePageBreakAfter / removePageBreak', () => {
   it('removes the break sitting after the target block', () => {
      const pages = [breakBefore('brk', 's1', 'c'), breakBefore('brk2', 's2', 'e')]
      expect(removePageBreakAfter(pages, SECTIONS, 'b')).toEqual([breakBefore('brk2', 's2', 'e')])
   })

   it('leaves the array untouched when nothing sits after the block', () => {
      const pages = [breakBefore('brk', 's1', 'c')]
      expect(removePageBreakAfter(pages, SECTIONS, 'a')).toEqual(pages)
   })

   it('removePageBreak drops the break with the given id', () => {
      const pages = [breakBefore('brk1', 's1', 'c'), breakBefore('brk2', 's2', 'e')]
      expect(removePageBreak(pages, 'brk1')).toEqual([breakBefore('brk2', 's2', 'e')])
   })
})

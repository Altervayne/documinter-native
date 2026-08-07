import { describe, it, expect } from 'vitest'
import type { Block, Section } from '../types'
import type { PageBreak } from './format'
import {
   partitionIntoPages,
   reconcilePages,
   reanchorMovedBlocks,
   addPageBreakAfter,
   removePageBreakAfter,
   removePageBreak,
   hasPageBreakAfter,
   canBreakAfter,
   reorderPages,
   duplicatePage,
   deletePage,
   insertBlankPageAfter,
   placeBlockOnBlankPage,
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

/** A boundary sitting after `blockId` (the last block of the page before it). */
function breakAfter(id: string, sectionId: string, blockId: string): PageBreak {
   return { id, after: { sectionId, blockId } }
}

/** A leading blank-page boundary, before all content. */
function breakLeading(id: string): PageBreak {
   return { id, after: null }
}

// A two-section document: s1[a,b,c], s2[d,e].
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

/** Just the per-page block-id lists (ignores page ids), for structural assertions. */
function blockGrid(pages: ReturnType<typeof partitionIntoPages>) {
   return shape(pages).map(page => page.blocks)
}

// #############
// # PARTITION #
// #############

describe('partitionIntoPages', () => {
   it('returns a single page for a document with no breaks', () => {
      expect(shape(partitionIntoPages(SECTIONS, []))).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a', 'b', 'c', 'd', 'e'] },
      ])
   })

   it('returns a single empty page for an empty document', () => {
      const pages = partitionIntoPages([], [])
      expect(pages).toHaveLength(1)
      expect(pages[0].id).toBe(FIRST_PAGE_ID)
      expect(pages[0].slices).toEqual([])
   })

   it('splits mid-section at a break after a block inside the section', () => {
      // break after 'b': page 1 ends after b, page 2 begins at c.
      const pages = partitionIntoPages(SECTIONS, [breakAfter('brk', 's1', 'b')])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a', 'b'] },
         { id: 'brk',         blocks: ['c', 'd', 'e'] },
      ])
   })

   it('marks the split section slices with start/end flags', () => {
      const pages = partitionIntoPages(SECTIONS, [breakAfter('brk', 's1', 'b')])
      const page1s1 = pages[0].slices[0]
      expect(page1s1.section.id).toBe('s1')
      expect(page1s1.isSectionStart).toBe(true)
      expect(page1s1.isSectionEnd).toBe(false)
      const page2s1 = pages[1].slices[0]
      expect(page2s1.section.id).toBe('s1')
      expect(page2s1.isSectionStart).toBe(false)
      expect(page2s1.isSectionEnd).toBe(true)
      const page2s2 = pages[1].slices[1]
      expect(page2s2.section.id).toBe('s2')
      expect(page2s2.isSectionStart).toBe(true)
      expect(page2s2.isSectionEnd).toBe(true)
   })

   it('breaks cleanly at a section boundary (whole next section on a new page)', () => {
      const pages = partitionIntoPages(SECTIONS, [breakAfter('brk', 's1', 'c')])
      expect(blockGrid(pages)).toEqual([['a', 'b', 'c'], ['d', 'e']])
   })

   it('isolates the last block onto a final page when the break sits after the one before it', () => {
      const pages = partitionIntoPages(SECTIONS, [breakAfter('brk', 's2', 'd')])
      expect(blockGrid(pages)).toEqual([['a', 'b', 'c', 'd'], ['e']])
   })

   it('makes a trailing blank page for a break after the document last block', () => {
      const pages = partitionIntoPages(SECTIONS, [breakAfter('brk', 's2', 'e')])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: ['a', 'b', 'c', 'd', 'e'] },
         { id: 'brk',         blocks: [] },
      ])
      expect(pages[1].slices).toEqual([])
   })

   it('makes a leading blank page for a null-anchored break', () => {
      const pages = partitionIntoPages(SECTIONS, [breakLeading('brk')])
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, blocks: [] },
         { id: 'brk',         blocks: ['a', 'b', 'c', 'd', 'e'] },
      ])
   })

   it('stacks two breaks on the same anchor as a blank page between content pages', () => {
      const pages = partitionIntoPages(SECTIONS, [breakAfter('b1', 's1', 'b'), breakAfter('b2', 's1', 'b')])
      expect(blockGrid(pages)).toEqual([['a', 'b'], [], ['c', 'd', 'e']])
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

   it('preserves stable block ordering regardless of the breaks-array order', () => {
      const pages = partitionIntoPages(SECTIONS, [
         breakAfter('b2', 's2', 'd'),
         breakAfter('b1', 's1', 'a'),   // deliberately out of flow order
      ])
      expect(shape(pages).flatMap(page => page.blocks)).toEqual(['a', 'b', 'c', 'd', 'e'])
   })
})

// #############
// # RECONCILE #
// #############

describe('reconcilePages', () => {
   it('drops a break whose anchor block no longer exists and there is no previous flow', () => {
      expect(reconcilePages([breakAfter('brk', 's1', 'gone')], SECTIONS)).toEqual([])
   })

   it('keeps a break whose anchor block still exists', () => {
      const pages = [breakAfter('brk', 's1', 'b')]
      expect(reconcilePages(pages, SECTIONS)).toEqual(pages)
   })

   it('keeps stacked breaks (blank pages), no longer de-duped', () => {
      const pages = [breakAfter('brk1', 's1', 'b'), breakAfter('brk2', 's1', 'b')]
      expect(reconcilePages(pages, SECTIONS)).toEqual(pages)
   })

   it('always keeps a leading blank break', () => {
      const pages = [breakLeading('brk')]
      expect(reconcilePages(pages, SECTIONS)).toEqual(pages)
   })

   it('refreshes a stale sectionId when the anchor block moved sections', () => {
      const moved: Section[] = [mkSection('s1', ['a', 'd']), mkSection('s2', ['e'])]
      const pages = [breakAfter('brk', 's2', 'd')]
      expect(reconcilePages(pages, moved)).toEqual([breakAfter('brk', 's1', 'd')])
   })

   it('leaves the boundary put when the page-starting (top) block is deleted', () => {
      // break after 'b' starts a page at 'c'. Delete 'c' (the top block): the boundary stays after b.
      const afterDelete: Section[] = [mkSection('s1', ['a', 'b']), mkSection('s2', ['d', 'e'])]
      const reconciled = reconcilePages([breakAfter('brk', 's1', 'b')], afterDelete, SECTIONS)
      expect(blockGrid(partitionIntoPages(afterDelete, reconciled))).toEqual([['a', 'b'], ['d', 'e']])
   })

   it('leaves a blank page when a page-only block is deleted (delete keeps the boundary)', () => {
      // Pages [a,b][c][d,e] via breaks after b and after c. Delete 'c' (that page's only block).
      const pages = [breakAfter('b1', 's1', 'b'), breakAfter('b2', 's1', 'c')]
      const afterDelete: Section[] = [mkSection('s1', ['a', 'b']), mkSection('s2', ['d', 'e'])]
      const reconciled = reconcilePages(pages, afterDelete, SECTIONS)
      expect(blockGrid(partitionIntoPages(afterDelete, reconciled))).toEqual([['a', 'b'], [], ['d', 'e']])
   })

   it('re-anchors to a leading blank when the deleted anchor was the first block', () => {
      // break after 'a' (page 1 = just 'a'). Delete 'a': boundary becomes a leading blank page.
      const afterDelete: Section[] = [mkSection('s1', ['b', 'c']), mkSection('s2', ['d', 'e'])]
      const reconciled = reconcilePages([breakAfter('brk', 's1', 'a')], afterDelete, SECTIONS)
      expect(reconciled).toEqual([breakLeading('brk')])
   })
})

describe('reanchorMovedBlocks', () => {
   it('re-anchors a boundary to the moved anchor block predecessor', () => {
      // break after 'c'. Drag 'c' away: the boundary should stay after 'b' (c predecessor).
      expect(reanchorMovedBlocks([breakAfter('brk', 's1', 'c')], SECTIONS, ['c']))
         .toEqual([breakAfter('brk', 's1', 'b')])
   })

   it('leaves a boundary untouched when a non-anchor (top) block moves', () => {
      const pages = [breakAfter('brk', 's1', 'b')]
      expect(reanchorMovedBlocks(pages, SECTIONS, ['c'])).toBe(pages)
   })

   it('re-anchors to a leading blank when the moved anchor was the first block', () => {
      expect(reanchorMovedBlocks([breakAfter('brk', 's1', 'a')], SECTIONS, ['a']))
         .toEqual([breakLeading('brk')])
   })
})

// ###############
// # BREAK EDITS #
// ###############

describe('canBreakAfter / hasPageBreakAfter', () => {
   it('canBreakAfter is true for every block except the last', () => {
      expect(canBreakAfter(SECTIONS, 'a')).toBe(true)
      expect(canBreakAfter(SECTIONS, 'd')).toBe(true)
      expect(canBreakAfter(SECTIONS, 'e')).toBe(false)
      expect(canBreakAfter(SECTIONS, 'missing')).toBe(false)
   })

   it('hasPageBreakAfter reflects a break directly after the block', () => {
      const pages = [breakAfter('brk', 's1', 'b')]
      expect(hasPageBreakAfter(pages, 'b')).toBe(true)
      expect(hasPageBreakAfter(pages, 'a')).toBe(false)
   })
})

describe('addPageBreakAfter', () => {
   it('adds a break after the target block', () => {
      const next = addPageBreakAfter([], SECTIONS, 'b')
      expect(next).toHaveLength(1)
      expect(next[0].after).toEqual({ sectionId: 's1', blockId: 'b' })
      expect(next[0].id.length).toBeGreaterThan(0)
   })

   it('crosses a section boundary (after the last block of a section)', () => {
      const next = addPageBreakAfter([], SECTIONS, 'c')
      expect(next[0].after).toEqual({ sectionId: 's1', blockId: 'c' })
   })

   it('is a no-op after the last block of the document', () => {
      const pages: PageBreak[] = []
      expect(addPageBreakAfter(pages, SECTIONS, 'e')).toBe(pages)
   })

   it('is a no-op when a break already sits there', () => {
      const pages = [breakAfter('brk', 's1', 'b')]
      expect(addPageBreakAfter(pages, SECTIONS, 'b')).toBe(pages)
   })
})

describe('removePageBreakAfter / removePageBreak', () => {
   it('removes the break sitting after the target block', () => {
      const pages = [breakAfter('brk', 's1', 'b'), breakAfter('brk2', 's2', 'd')]
      expect(removePageBreakAfter(pages, 'b')).toEqual([breakAfter('brk2', 's2', 'd')])
   })

   it('peels one stacked blank off at a time (removes the last match)', () => {
      const pages = [breakAfter('brk1', 's1', 'b'), breakAfter('brk2', 's1', 'b')]
      expect(removePageBreakAfter(pages, 'b')).toEqual([breakAfter('brk1', 's1', 'b')])
   })

   it('leaves the array untouched when nothing sits after the block', () => {
      const pages = [breakAfter('brk', 's1', 'b')]
      expect(removePageBreakAfter(pages, 'a')).toBe(pages)
   })

   it('removePageBreak drops the break with the given id', () => {
      const pages = [breakAfter('brk1', 's1', 'b'), breakAfter('brk2', 's2', 'd')]
      expect(removePageBreak(pages, 'brk1')).toEqual([breakAfter('brk2', 's2', 'd')])
   })
})

// ###################
// # PAGE OPERATIONS #
// ###################

/** Re-derive the page shape from a committed { sections, pages } result. */
function resultGrid(result: { sections: Section[]; pages: PageBreak[] }) {
   return blockGrid(partitionIntoPages(result.sections, result.pages))
}

function sectionIds(result: { sections: Section[]; pages: PageBreak[] }) {
   return result.sections.map(section => section.id)
}

// Three-page fixture: P0 = [a, b], P1 = [c, d], P2 = [e].
const THREE_PAGE_BREAKS = [breakAfter('brk1', 's1', 'b'), breakAfter('brk2', 's2', 'd')]

describe('reorderPages', () => {
   it('is a no-op for equal indices (same references)', () => {
      const result = reorderPages(SECTIONS, THREE_PAGE_BREAKS, 1, 1)
      expect(result.sections).toBe(SECTIONS)
      expect(result.pages).toBe(THREE_PAGE_BREAKS)
   })

   it('swaps two adjacent pages', () => {
      expect(resultGrid(reorderPages(SECTIONS, THREE_PAGE_BREAKS, 1, 0))).toEqual([['c', 'd'], ['a', 'b'], ['e']])
   })

   it('moves a page to the front', () => {
      expect(resultGrid(reorderPages(SECTIONS, THREE_PAGE_BREAKS, 2, 0))).toEqual([['e'], ['a', 'b'], ['c', 'd']])
   })

   it('moves a page to the end', () => {
      expect(resultGrid(reorderPages(SECTIONS, THREE_PAGE_BREAKS, 0, 2))).toEqual([['c', 'd'], ['e'], ['a', 'b']])
   })

   it('splits a section when a mid-section slice is torn away (fresh id, unique)', () => {
      const result = reorderPages(SECTIONS, THREE_PAGE_BREAKS, 2, 0)
      const ids = sectionIds(result)
      expect(new Set(ids).size).toBe(ids.length)
      const sectionOfBlock = (blockId: string) =>
         result.sections.find(section => section.blocks.some(block => block.id === blockId))!.id
      expect(sectionOfBlock('e')).not.toBe(sectionOfBlock('d'))
   })

   it('preserves every block exactly once', () => {
      const result = reorderPages(SECTIONS, THREE_PAGE_BREAKS, 2, 0)
      const allBlockIds = result.sections.flatMap(section => section.blocks.map(block => block.id))
      expect(allBlockIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
   })

   it('keeps a blank page through a reorder', () => {
      // [a,b][blank][c,d,e] -> move the blank to the front.
      const withBlank = [breakAfter('b1', 's1', 'b'), breakAfter('b2', 's1', 'b')]
      const result = reorderPages(SECTIONS, withBlank, 1, 0)
      expect(resultGrid(result)).toEqual([[], ['a', 'b'], ['c', 'd', 'e']])
   })
})

describe('duplicatePage', () => {
   it('inserts a clone directly after the source page', () => {
      const result = duplicatePage(SECTIONS, THREE_PAGE_BREAKS, 0)
      expect(resultGrid(result).map(page => page.length)).toEqual([2, 2, 2, 1])
   })

   it('gives the clone fresh block ids (no id collision)', () => {
      const result = duplicatePage(SECTIONS, THREE_PAGE_BREAKS, 0)
      const allBlockIds = result.sections.flatMap(section => section.blocks.map(block => block.id))
      expect(new Set(allBlockIds).size).toBe(allBlockIds.length)
      expect(allBlockIds).toHaveLength(7)
   })

   it('is a no-op for an out-of-range index (same references)', () => {
      const result = duplicatePage(SECTIONS, THREE_PAGE_BREAKS, 9)
      expect(result.sections).toBe(SECTIONS)
      expect(result.pages).toBe(THREE_PAGE_BREAKS)
   })

   it('does not split a spanning section or strand phantom titles when duplicating its start page', () => {
      // s1[a,b,c] spans page 0 [a] and page 1 [b,c] (break after a). Duplicating page 0 must NOT tear
      // s1 into titled fragments: the copy merges back into s1, which stays ONE section.
      const result = duplicatePage(SECTIONS, [breakAfter('brk', 's1', 'a')], 0)
      expect(result.sections.map(section => section.title)).toEqual(['s1', 's2'])
      expect(result.sections.filter(section => section.title === 's1')).toHaveLength(1)
      const allBlockIds = result.sections.flatMap(section => section.blocks.map(block => block.id))
      expect(new Set(allBlockIds).size).toBe(allBlockIds.length)   // clone blocks are fresh, unique
      expect(allBlockIds).toHaveLength(6)                          // 5 originals + 1 cloned (a')
   })

   it('makes an independent titled copy when duplicating a page that holds a whole section', () => {
      // Break at the section boundary: page 0 = whole s1 [a,b,c], page 1 = whole s2 [d,e].
      const result = duplicatePage(SECTIONS, [breakAfter('brk', 's1', 'c')], 0)
      const ids = result.sections.map(section => section.id)
      expect(new Set(ids).size).toBe(ids.length)                  // clone section id is fresh + unique
      expect(result.sections.filter(section => section.title === 's1')).toHaveLength(2)  // original + copy
      expect(resultGrid(result).map(page => page.length)).toEqual([3, 3, 2])   // original s1, copy, s2
   })
})

describe('deletePage', () => {
   it('drops a page and its content, leaving the rest in order', () => {
      expect(resultGrid(deletePage(SECTIONS, THREE_PAGE_BREAKS, 1))).toEqual([['a', 'b'], ['e']])
   })

   it('removes exactly the deleted page blocks', () => {
      const result = deletePage(SECTIONS, THREE_PAGE_BREAKS, 2)
      const allBlockIds = result.sections.flatMap(section => section.blocks.map(block => block.id))
      expect(allBlockIds.sort()).toEqual(['a', 'b', 'c', 'd'])
   })

   it('deletes a blank page cleanly, keeping the two content pages separated', () => {
      // [a,b][blank][c,d,e] -> delete the blank -> the content boundary after b remains.
      const withBlank = [breakAfter('b1', 's1', 'b'), breakAfter('b2', 's1', 'b')]
      expect(resultGrid(deletePage(SECTIONS, withBlank, 1))).toEqual([['a', 'b'], ['c', 'd', 'e']])
   })

   it('is a no-op when only one page exists (same references)', () => {
      const result = deletePage(SECTIONS, [], 0)
      expect(result.sections).toBe(SECTIONS)
      expect(result.pages).toEqual([])
   })
})

describe('insertBlankPageAfter', () => {
   it('inserts a blank page after the given page', () => {
      const result = insertBlankPageAfter(SECTIONS, THREE_PAGE_BREAKS, 0)
      expect(resultGrid(result)).toEqual([['a', 'b'], [], ['c', 'd'], ['e']])
   })

   it('appends a trailing blank page after the last page', () => {
      const result = insertBlankPageAfter(SECTIONS, THREE_PAGE_BREAKS, 2)
      expect(resultGrid(result)).toEqual([['a', 'b'], ['c', 'd'], ['e'], []])
   })

   it('adds a blank page to a single-page document', () => {
      const result = insertBlankPageAfter(SECTIONS, [], 0)
      expect(resultGrid(result)).toEqual([['a', 'b', 'c', 'd', 'e'], []])
   })

   it('is a no-op for an out-of-range index (same references)', () => {
      const result = insertBlankPageAfter(SECTIONS, THREE_PAGE_BREAKS, 9)
      expect(result.sections).toBe(SECTIONS)
      expect(result.pages).toBe(THREE_PAGE_BREAKS)
   })
})

describe('placeBlockOnBlankPage', () => {
   // [a,b][blank][c,d,e]: breaks stacked after b.
   const WITH_BLANK = [breakAfter('b1', 's1', 'b'), breakAfter('b2', 's1', 'b')]

   it('moves a block onto the blank page, making it that page content', () => {
      // Drop 'a' onto the blank middle page: page 1 keeps b, the blank becomes [a].
      const result = placeBlockOnBlankPage(SECTIONS, WITH_BLANK, 1, 'a')
      expect(resultGrid(result)).toEqual([['b'], ['a'], ['c', 'd', 'e']])
   })

   it('keeps every block exactly once', () => {
      const result = placeBlockOnBlankPage(SECTIONS, WITH_BLANK, 1, 'd')
      const allBlockIds = result.sections.flatMap(section => section.blocks.map(block => block.id))
      expect(allBlockIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
   })

   it('is a no-op when the target page is not blank (same references)', () => {
      const result = placeBlockOnBlankPage(SECTIONS, WITH_BLANK, 0, 'a')
      expect(result.sections).toBe(SECTIONS)
      expect(result.pages).toBe(WITH_BLANK)
   })

   it('is a no-op for an unknown block (same references)', () => {
      const result = placeBlockOnBlankPage(SECTIONS, WITH_BLANK, 1, 'nope')
      expect(result.sections).toBe(SECTIONS)
      expect(result.pages).toBe(WITH_BLANK)
   })
})

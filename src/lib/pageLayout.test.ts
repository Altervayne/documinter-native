import { describe, it, expect } from 'vitest'

import { paginate, buildMetrics, isAutoPageId, AUTO_PAGE_PREFIX, allParagraphIds, type LayoutMetrics, type MeasuredHeights, type ParagraphLine } from './pageLayout'
import { FIRST_PAGE_ID } from './pageModel'
import type { Block, Section, ListItem } from '../types'

// ###########
// # FIXTURES #
// ###########

function block(id: string, type: Block['type'] = 'p'): Block {
   return { id, type }
}

function listItems(blockId: string, count: number): ListItem[] {
   return Array.from({ length: count }, (_unused, index) => ({ id: `${blockId}-i${index}`, children: [] }))
}

function listBlock(id: string, itemCount: number): Block {
   return { id, type: 'list', items: listItems(id, itemCount) }
}

function section(id: string, blocks: Block[]): Section {
   return { id, title: id, collapsed: false, blocks }
}

// A synthetic height oracle: uniform section title height, per-block heights, per-list item heights,
// and per-paragraph rendered lines.
function metricsFrom(spec: {
   headerHeight?:   number
   titleHeight?:    number
   blockHeights:    Record<string, number>
   listItems?:      Record<string, number[]>
   paragraphLines?: Record<string, ParagraphLine[]>
}): LayoutMetrics {
   return {
      headerHeight:       spec.headerHeight ?? 0,
      sectionTitleHeight: () => spec.titleHeight ?? 0,
      blockHeight:        (blockId) => spec.blockHeights[blockId] ?? 0,
      listItemHeights:    (blockId) => spec.listItems?.[blockId] ?? null,
      paragraphLines:     (blockId) => spec.paragraphLines?.[blockId] ?? null,
   }
}

// Compact page shape for assertions: page id + per-slice block-id lists + start/end flags.
function shape(pages: ReturnType<typeof paginate>) {
   return pages.map(page => ({
      id: page.id,
      slices: page.slices.map(slice => ({
         section: slice.section.id,
         blocks:  slice.blocks.map(b => b.id),
         start:   slice.isSectionStart,
         end:     slice.isSectionEnd,
      })),
   }))
}

// #########
// # TESTS #
// #########

describe('paginate — no split needed', () => {
   it('keeps a section that fits on one page', () => {
      const sections = [section('S', [block('A'), block('B'), block('C')])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 30, B: 30, C: 30 } })
      const pages = paginate(sections, [], 100, metrics)
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, slices: [{ section: 'S', blocks: ['A', 'B', 'C'], start: true, end: true }] },
      ])
   })

   it('returns a single empty page for an empty document', () => {
      const pages = paginate([], [], 100, metricsFrom({ blockHeights: {} }))
      expect(pages).toHaveLength(1)
      expect(pages[0].id).toBe(FIRST_PAGE_ID)
      expect(pages[0].slices).toEqual([])
   })

   it('emits a title-only slice for an empty section', () => {
      const pages = paginate([section('S', [])], [], 100, metricsFrom({ titleHeight: 10, blockHeights: {} }))
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, slices: [{ section: 'S', blocks: [], start: true, end: true }] },
      ])
   })
})

describe('paginate — atomic overflow', () => {
   it('moves an atomic block that does not fit onto a fresh auto page', () => {
      const sections = [section('S', [block('A'), block('B'), block('C')])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 40, B: 40, C: 40 } })
      // page 1: title(10) + A(40) + B(40) = 90; C(40) would reach 130 > 100 -> next page.
      const pages = paginate(sections, [], 100, metrics)
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID,            slices: [{ section: 'S', blocks: ['A', 'B'], start: true,  end: false }] },
         { id: `${AUTO_PAGE_PREFIX}C`,   slices: [{ section: 'S', blocks: ['C'],      start: false, end: true  }] },
      ])
      expect(isAutoPageId(pages[1].id)).toBe(true)
   })

   it('places a block taller than a whole page anyway (overflow, still one placement)', () => {
      const sections = [section('S', [block('A')])]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { A: 250 } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks.map(b => b.id)).toEqual(['A'])
   })
})

describe('paginate — list splitting', () => {
   it('splits a list across two pages at the last item that fits', () => {
      const sections = [section('S', [listBlock('L', 4)])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: {}, listItems: { L: [30, 30, 30, 30] } })
      // page 1 has 90 left after title; items 0..2 (90) fit, item 3 flows over.
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks[0].items?.map(i => i.id)).toEqual(['L-i0', 'L-i1', 'L-i2'])
      expect(pages[1].slices[0].blocks[0].items?.map(i => i.id)).toEqual(['L-i3'])
      // Same logical block id on both fragments; the model list is untouched.
      expect(pages[0].slices[0].blocks[0].id).toBe('L')
      expect(pages[1].slices[0].blocks[0].id).toBe('L')
      expect(pages[0].slices[0].isSectionStart).toBe(true)
      expect(pages[0].slices[0].isSectionEnd).toBe(false)
      expect(pages[1].slices[0].isSectionStart).toBe(false)
      expect(pages[1].slices[0].isSectionEnd).toBe(true)
      expect(isAutoPageId(pages[1].id)).toBe(true)
   })

   it('splits a list across three pages', () => {
      const sections = [section('S', [listBlock('L', 5)])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: {}, listItems: { L: [40, 40, 40, 40, 40] } })
      // page 1: 90 left -> items 0..1 (80); page 2: 100 -> items 2..3 (80); page 3: item 4.
      const pages = paginate(sections, [], 100, metrics)
      expect(pages.map(p => p.slices[0].blocks[0].items?.length)).toEqual([2, 2, 1])
   })

   it('does not split a list that fits whole', () => {
      const sections = [section('S', [listBlock('L', 3)])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: {}, listItems: { L: [20, 20, 20] } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks[0].items?.length).toBe(3)
   })
})

describe('paginate — paragraph splitting', () => {
   // A `p` block whose richText is `length` chars long, so a fragment's sliced richText is verifiable.
   function paragraphBlock(id: string, length: number): Block {
      return { id, type: 'p', richText: [{ text: 'x'.repeat(length) }] }
   }
   function fragmentOf(block: Block | undefined) {
      return block?.paragraphFragment
   }

   it('splits a paragraph across two pages at the last line that fits', () => {
      const sections = [section('S', [paragraphBlock('P', 40)])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      // page 1 has 90 left after the title; lines 0..2 (90) fit, line 3 flows over.
      const pages = paginate(sections, [], 100, metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: lines } }))
      expect(pages).toHaveLength(2)
      expect(fragmentOf(pages[0].slices[0].blocks[0])).toEqual({ charStart: 0, charEnd: 30, isTail: false })
      expect(fragmentOf(pages[1].slices[0].blocks[0])).toEqual({ charStart: 30, charEnd: 40, isTail: true })
      // The sliced richText carries exactly that page's char range, and the block id is shared.
      expect(pages[0].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(30) }])
      expect(pages[1].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(10) }])
      expect(pages[0].slices[0].blocks[0].id).toBe('P')
      expect(pages[1].slices[0].blocks[0].id).toBe('P')
      expect(pages[0].slices[0].isSectionEnd).toBe(false)
      expect(pages[1].slices[0].isSectionEnd).toBe(true)
      expect(isAutoPageId(pages[1].id)).toBe(true)
   })

   it('splits a paragraph across three pages at the right char offsets', () => {
      const sections = [section('S', [paragraphBlock('P', 200)])]
      const lines: ParagraphLine[] = [
         { height: 40, charEnd: 40 }, { height: 40, charEnd: 80 }, { height: 40, charEnd: 120 },
         { height: 40, charEnd: 160 }, { height: 40, charEnd: 200 },
      ]
      // page 1: 90 left -> lines 0..1 (80); page 2: 100 -> lines 2..3 (80); page 3: line 4.
      const pages = paginate(sections, [], 100, metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: lines } }))
      expect(pages).toHaveLength(3)
      expect(pages.map(page => fragmentOf(page.slices[0].blocks[0])?.charEnd)).toEqual([80, 160, 200])
      expect(pages.map(page => fragmentOf(page.slices[0].blocks[0])?.charStart)).toEqual([0, 80, 160])
      expect(pages.map(page => fragmentOf(page.slices[0].blocks[0])?.isTail)).toEqual([false, false, true])
   })

   it('keeps a paragraph whole when its id is in atomicBlockIds', () => {
      const sections = [section('S', [paragraphBlock('P', 40)])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      // Held atomic: it uses blockHeight('P') (one whole unit) instead of its per-line channel, so it
      // is never split, only placed or moved whole.
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { P: 50 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics, allParagraphIds(sections))
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks).toHaveLength(1)
      // The model block is placed as-is, carrying no fragment tag and its full richText.
      expect(fragmentOf(pages[0].slices[0].blocks[0])).toBeUndefined()
      expect(pages[0].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(40) }])
   })

   it('leaves a paragraph that fits on one page untagged (a normal editable block, not a fragment)', () => {
      const sections = [section('S', [paragraphBlock('P', 20)])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }]
      const pages = paginate(sections, [], 100, metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: lines } }))
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks).toHaveLength(1)
      // No split happened, so the ORIGINAL block is placed: no fragment tag, full richText. This is what
      // keeps a whole paragraph rendering as an editable block instead of a read-only fragment.
      expect(fragmentOf(pages[0].slices[0].blocks[0])).toBeUndefined()
      expect(pages[0].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(20) }])
   })

   it('tags fragments only when a paragraph genuinely spans two or more pages', () => {
      // Fits: one untagged piece. Splits: every piece carries a partial-range fragment tag.
      const fits = paginate(
         [section('S', [paragraphBlock('P', 20)])], [], 100,
         metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }] } }),
      )
      expect(fits).toHaveLength(1)
      expect(fits[0].slices[0].blocks.every(candidate => candidate.paragraphFragment === undefined)).toBe(true)

      const splits = paginate(
         [section('S', [paragraphBlock('Q', 40)])], [], 100,
         metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { Q: [
            { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 }, { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
         ] } }),
      )
      expect(splits.length).toBeGreaterThan(1)
      const fragments = splits.flatMap(page => page.slices.flatMap(slice => slice.blocks))
      expect(fragments.every(candidate => candidate.paragraphFragment !== undefined)).toBe(true)
   })

   it('never splits an h3 or callout, even with stray paragraph-line measurements', () => {
      // The type gate lives in buildMetrics: only `p` blocks get a non-null paragraphLines channel.
      const sections = [section('S', [block('H', 'h3'), block('C', 'callout')])]
      const heights: MeasuredHeights = {
         header: 0, titleBySection: new Map(), blockById: new Map(),
         listItemById: new Map(),
         paragraphLinesById: new Map([
            ['H', [{ height: 30, charEnd: 5 }, { height: 30, charEnd: 10 }]],
            ['C', [{ height: 30, charEnd: 5 }, { height: 30, charEnd: 10 }]],
         ]),
      }
      const metrics = buildMetrics(heights, sections)
      expect(metrics.paragraphLines('H')).toBeNull()
      expect(metrics.paragraphLines('C')).toBeNull()
   })

   it('serves measured paragraph lines while their total still matches the model char count', () => {
      const paragraph: Block = { id: 'P', type: 'p', richText: [{ text: 'x'.repeat(40) }] }
      const sections = [section('S', [paragraph])]
      const lines: ParagraphLine[] = [{ height: 30, charEnd: 20 }, { height: 30, charEnd: 40 }]
      const heights: MeasuredHeights = {
         header: 0, titleBySection: new Map(), blockById: new Map(), listItemById: new Map(),
         paragraphLinesById: new Map([['P', lines]]),
      }
      expect(buildMetrics(heights, sections).paragraphLines('P')).toEqual(lines)
   })

   it('rejects paragraph lines whose total no longer matches the model (an edit landed since measure)', () => {
      // The measurement ended at char 40 but the model now holds 30 chars, so the lines predate the
      // current text: the paragraph must stay whole until it is re-measured.
      const paragraph: Block = { id: 'P', type: 'p', richText: [{ text: 'x'.repeat(30) }] }
      const sections = [section('S', [paragraph])]
      const staleLines: ParagraphLine[] = [{ height: 30, charEnd: 20 }, { height: 30, charEnd: 40 }]
      const heights: MeasuredHeights = {
         header: 0, titleBySection: new Map(), blockById: new Map(), listItemById: new Map(),
         paragraphLinesById: new Map([['P', staleLines]]),
      }
      expect(buildMetrics(heights, sections).paragraphLines('P')).toBeNull()
   })
})

describe('paginate — explicit breaks still win', () => {
   it('honours a forced break after a block, filling the rest by auto-flow', () => {
      const sections = [section('S', [block('A'), block('B'), block('C')])]
      const forced = [{ id: 'brk', after: { sectionId: 'S', blockId: 'A' } }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 30, B: 30, C: 30 } })
      const pages = paginate(sections, forced, 100, metrics)
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID, slices: [{ section: 'S', blocks: ['A'],      start: true,  end: false }] },
         { id: 'brk',         slices: [{ section: 'S', blocks: ['B', 'C'], start: false, end: true  }] },
      ])
      expect(isAutoPageId(pages[1].id)).toBe(false)
   })

   it('treats a leading after:null break as a blank first page', () => {
      const sections = [section('S', [block('A')])]
      const forced = [{ id: 'lead', after: null }]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { A: 20 } })
      const pages = paginate(sections, forced, 100, metrics)
      expect(pages[0].id).toBe(FIRST_PAGE_ID)
      expect(pages[0].slices).toEqual([])
      expect(pages[1].id).toBe('lead')
      expect(pages[1].slices[0].blocks.map(b => b.id)).toEqual(['A'])
   })
})

describe('paginate — multi-section flow', () => {
   it('pushes a section whose title cannot fit under existing content to a new page', () => {
      const sections = [section('S1', [block('A')]), section('S2', [block('B')])]
      // page 1: title(60) + A(30) = 90; S2 title(60) would overflow (90 + 60 > 100).
      const metrics = metricsFrom({ titleHeight: 60, blockHeights: { A: 30, B: 30 } })
      const pages = paginate(sections, [], 100, metrics)
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID,                     slices: [{ section: 'S1', blocks: ['A'], start: true, end: true }] },
         { id: `${AUTO_PAGE_PREFIX}section-S2`,    slices: [{ section: 'S2', blocks: ['B'], start: true, end: true }] },
      ])
   })
})

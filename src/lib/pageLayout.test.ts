import { describe, it, expect } from 'vitest'

import { paginate, isAutoPageId, AUTO_PAGE_PREFIX, type LayoutMetrics } from './pageLayout'
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

// A synthetic height oracle: uniform section title height, per-block heights, and per-list item heights.
function metricsFrom(spec: {
   headerHeight?: number
   titleHeight?:  number
   blockHeights:  Record<string, number>
   listItems?:    Record<string, number[]>
}): LayoutMetrics {
   return {
      headerHeight:       spec.headerHeight ?? 0,
      sectionTitleHeight: () => spec.titleHeight ?? 0,
      blockHeight:        (blockId) => spec.blockHeights[blockId] ?? 0,
      listItemHeights:    (blockId) => spec.listItems?.[blockId] ?? null,
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

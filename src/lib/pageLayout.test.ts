import { describe, it, expect } from 'vitest'

import { paginate, buildMetrics, findTooTallPageIds, reconcileParagraphLines, isAutoPageId, AUTO_PAGE_PREFIX, allParagraphIds, contentBoxWidthPx, type LayoutMetrics, type MeasuredHeights, type ParagraphLine } from './pageLayout'
import { FIRST_PAGE_ID, A4_PORTRAIT_WIDTH_PX, A4_LANDSCAPE_WIDTH_PX, millimetresToPx, type Page } from './pageModel'
import { DEFAULT_A4_MARGINS, type DocFormat } from './format'
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

// A synthetic height oracle: title height, per-block, per-list-item, and per-paragraph line heights.
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
      // Held atomic: it uses blockHeight('P') not its per-line channel, so it is never split.
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { P: 50 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics, allParagraphIds(sections))
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks).toHaveLength(1)
      expect(fragmentOf(pages[0].slices[0].blocks[0])).toBeUndefined()
      expect(pages[0].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(40) }])
   })

   it('leaves a paragraph that fits on one page untagged (a normal editable block, not a fragment)', () => {
      const sections = [section('S', [paragraphBlock('P', 20)])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }]
      const pages = paginate(sections, [], 100, metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: lines } }))
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks).toHaveLength(1)
      // No split, so the ORIGINAL block is placed (no fragment tag): this keeps a whole paragraph an
      // editable block, not a read-only fragment.
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
      // The lines end at char 40 but the model now holds 30 chars, so they predate the current text:
      // the paragraph stays whole until re-measured.
      const paragraph: Block = { id: 'P', type: 'p', richText: [{ text: 'x'.repeat(30) }] }
      const sections = [section('S', [paragraph])]
      const staleLines: ParagraphLine[] = [{ height: 30, charEnd: 20 }, { height: 30, charEnd: 40 }]
      const heights: MeasuredHeights = {
         header: 0, titleBySection: new Map(), blockById: new Map(), listItemById: new Map(),
         paragraphLinesById: new Map([['P', staleLines]]),
      }
      expect(buildMetrics(heights, sections).paragraphLines('P')).toBeNull()
   })

   // Editor at rest and export both paginate with an empty atomic set from the same measured lines, so
   // a paragraph the editor splits across two pages must land the identical split in the export.
   it('splits a paragraph identically in the editor (at rest) and the export atomic sets', () => {
      const sections = [section('S', [paragraphBlock('P', 40)])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: lines } })
      // Same empty atomic set both times (nothing focused, export always empty), so the layouts match.
      const editorAtRest = paginate(sections, [], 100, metrics, new Set<string>())
      const exportLayout = paginate(sections, [], 100, metrics, new Set<string>())
      expect(shape(exportLayout)).toEqual(shape(editorAtRest))
      expect(exportLayout).toHaveLength(2)
      expect(fragmentOf(exportLayout[0].slices[0].blocks[0])).toEqual({ charStart: 0, charEnd: 30, isTail: false })
      expect(fragmentOf(exportLayout[1].slices[0].blocks[0])).toEqual({ charStart: 30, charEnd: 40, isTail: true })
   })

   it('would keep the paragraph whole (no split) when its measured lines are missing', () => {
      // If the lines drop from measuredHeights, paragraphLines is null and the paragraph is placed whole,
      // which clips its overflow in the paged PDF: the lines must survive every re-measure.
      const sections = [section('S', [paragraphBlock('P', 40)])]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { P: 250 }, paragraphLines: {} })
      const pages = paginate(sections, [], 100, metrics, new Set<string>())
      expect(pages).toHaveLength(1)
      expect(fragmentOf(pages[0].slices[0].blocks[0])).toBeUndefined()
   })
})

describe('paginate — split block margin accounting', () => {
   // A `p` block whose richText is `length` chars long.
   function paragraphBlock(id: string, length: number): Block {
      return { id, type: 'p', richText: [{ text: 'x'.repeat(length) }] }
   }
   function fragmentOf(candidate: Block | undefined) {
      return candidate?.paragraphFragment
   }

   // A whole-placed splittable paragraph must still spend its own bottom margin against the next block.
   // Its lines sum to 50 but the measured whole height is 60 (a 10px margin); at budget 90, margin-blind
   // accounting would wrongly keep NEXT on page 1.
   it('counts a whole-placed paragraph own margin against a following block', () => {
      const sections = [section('S', [paragraphBlock('P', 50), block('NEXT')])]
      const lines: ParagraphLine[] = [{ height: 50, charEnd: 50 }]
      const metrics = metricsFrom({
         titleHeight: 0, blockHeights: { P: 60, NEXT: 40 }, paragraphLines: { P: lines },
      })
      const pages = paginate(sections, [], 90, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['P'])
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['NEXT'])
      expect(isAutoPageId(pages[1].id)).toBe(true)
   })

   // A whole-placed splittable paragraph spends its full blockHeight, like the atomic branch: line sums
   // 30 + 30 = 60 fit, but the measured 40 + 30 = 70 > the 65 budget, so the second is pushed off.
   it('spends a whole-placed splittable paragraph full blockHeight, not just its line sum', () => {
      const sections = [section('S', [paragraphBlock('P1', 30), paragraphBlock('P2', 30)])]
      const linesP1: ParagraphLine[] = [{ height: 30, charEnd: 30 }]
      const linesP2: ParagraphLine[] = [{ height: 30, charEnd: 30 }]
      const metrics = metricsFrom({
         titleHeight: 0, blockHeights: { P1: 40, P2: 40 }, paragraphLines: { P1: linesP1, P2: linesP2 },
      })
      const pages = paginate(sections, [], 65, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['P1'])
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['P2'])
      // Both placed whole, never split: the margin fix changes `used` accounting, not fragment tagging.
      expect(fragmentOf(pages[0].slices[0].blocks[0])).toBeUndefined()
      expect(fragmentOf(pages[1].slices[0].blocks[0])).toBeUndefined()
   })

   // The list analogue: items sum to 50 but the measured whole height is 60 (a 10px margin). At budget
   // 80, margin-blind accounting would wrongly keep NEXT on page 1.
   it('counts a whole-placed list own margin against a following block', () => {
      const sections = [section('S', [listBlock('L', 2), block('NEXT')])]
      const metrics = metricsFrom({
         titleHeight: 0, blockHeights: { L: 60, NEXT: 30 }, listItems: { L: [25, 25] },
      })
      const pages = paginate(sections, [], 80, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['L'])
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['NEXT'])
      expect(isAutoPageId(pages[1].id)).toBe(true)
   })
})

describe('reconcileParagraphLines', () => {
   const linesA: ParagraphLine[] = [{ height: 30, charEnd: 20 }, { height: 30, charEnd: 40 }]
   const linesB: ParagraphLine[] = [{ height: 20, charEnd: 15 }, { height: 20, charEnd: 30 }]

   it('keeps a fresh measurement when one is available', () => {
      const result = reconcileParagraphLines(['P'], new Map([['P', linesA]]), new Map())
      expect(result.get('P')).toBe(linesA)
   })

   it('carries the previous lines forward when a paragraph has no fresh measurement (split at rest)', () => {
      // A split paragraph renders as fragments with no measurable [data-rich], so no fresh lines this
      // pass; its last whole-render lines must survive so the export still splits it.
      const result = reconcileParagraphLines(['P'], new Map(), new Map([['P', linesA]]))
      expect(result.get('P')).toBe(linesA)
   })

   it('prefers the fresh measurement over the carried one', () => {
      const result = reconcileParagraphLines(['P'], new Map([['P', linesB]]), new Map([['P', linesA]]))
      expect(result.get('P')).toBe(linesB)
   })

   it('does not drop lines on a transient zero-line measurement (treated as no fresh data, carried)', () => {
      // A transient zero-line measurement must fall back to the carried lines, not wipe them.
      const result = reconcileParagraphLines(['P'], new Map([['P', []]]), new Map([['P', linesA]]))
      expect(result.get('P')).toBe(linesA)
   })

   it('drops lines for a paragraph no longer in the model', () => {
      const result = reconcileParagraphLines(['P'], new Map(), new Map([['GONE', linesA]]))
      expect(result.has('GONE')).toBe(false)
      expect(result.has('P')).toBe(false)
   })

   it('retains every model paragraph across a mix of fresh and carried', () => {
      const result = reconcileParagraphLines(
         ['P1', 'P2', 'P3'],
         new Map([['P1', linesA]]),
         new Map([['P2', linesB]]),
      )
      expect(result.get('P1')).toBe(linesA)   // fresh
      expect(result.get('P2')).toBe(linesB)   // carried
      expect(result.has('P3')).toBe(false)    // never measured, nothing to carry
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

describe('contentBoxWidthPx — width-parity guard', () => {
   // Editor/export convergence rests on the offscreen measurement wrapping text at the SAME width the
   // paged sheet renders at: the sheet is A4_*_WIDTH_PX (border-box) with margins as `.doc-render`
   // padding, so its content box is sheetWidth minus the horizontal margins. contentBoxWidthPx is the
   // ONE source both the measurement and this formula read; these pin them so they cannot drift.

   it('returns the a4-portrait sheet width minus the horizontal margins', () => {
      const margins = { top: 15, right: 25, bottom: 15, left: 30 }
      const format: DocFormat = { kind: 'a4-portrait', margins }
      expect(contentBoxWidthPx(format)).toBe(A4_PORTRAIT_WIDTH_PX - millimetresToPx(30) - millimetresToPx(25))
   })

   it('returns the a4-landscape sheet width minus the horizontal margins', () => {
      const margins = { top: 10, right: 18, bottom: 10, left: 22 }
      const format: DocFormat = { kind: 'a4-landscape', margins }
      expect(contentBoxWidthPx(format)).toBe(A4_LANDSCAPE_WIDTH_PX - millimetresToPx(22) - millimetresToPx(18))
   })

   it('falls back to the default A4 margins when a paged format sets none', () => {
      expect(contentBoxWidthPx({ kind: 'a4-portrait' })).toBe(
         A4_PORTRAIT_WIDTH_PX - millimetresToPx(DEFAULT_A4_MARGINS.left) - millimetresToPx(DEFAULT_A4_MARGINS.right),
      )
   })

   it('returns 0 for an infinite or absent format (no fixed sheet width)', () => {
      expect(contentBoxWidthPx({ kind: 'infinite' })).toBe(0)
      expect(contentBoxWidthPx(undefined)).toBe(0)
   })

   it('equals the paged sheet content box the export actually renders at (drift tripwire)', () => {
      for (const kind of ['a4-portrait', 'a4-landscape'] as const) {
         const margins = { top: 12, right: 20, bottom: 12, left: 28 }
         const sheetWidth = kind === 'a4-landscape' ? A4_LANDSCAPE_WIDTH_PX : A4_PORTRAIT_WIDTH_PX
         const renderedContentBox = sheetWidth - millimetresToPx(margins.left) - millimetresToPx(margins.right)
         expect(contentBoxWidthPx({ kind, margins })).toBe(renderedContentBox)
      }
   })
})

describe('paginate — page origin', () => {
   it('labels page 1 first and a forced-break page manual', () => {
      const sections = [section('S', [block('A'), block('B')])]
      const forced = [{ id: 'brk', after: { sectionId: 'S', blockId: 'A' } }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 30, B: 30 } })
      const pages = paginate(sections, forced, 100, metrics)
      expect(pages.map(page => page.origin)).toEqual(['first', 'manual'])
   })

   it('labels a mid-block auto-flow page continuation', () => {
      // A(40) + B(40) fill page 1; C(40) overflows onto an auto page opened with continuation:true.
      const sections = [section('S', [block('A'), block('B'), block('C')])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 40, B: 40, C: 40 } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages.map(page => page.origin)).toEqual(['first', 'continuation'])
      expect(isAutoPageId(pages[1].id)).toBe(true)
   })

   it('labels a section-push auto page auto-start (it begins fresh content)', () => {
      const sections = [section('S1', [block('A')]), section('S2', [block('B')])]
      const metrics = metricsFrom({ titleHeight: 60, blockHeights: { A: 30, B: 30 } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages.map(page => page.origin)).toEqual(['first', 'auto-start'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}section-S2`)
   })

   it('labels a leading blank page manual and a paragraph split page continuation together', () => {
      const paragraph: Block = { id: 'P', type: 'p', richText: [{ text: 'x'.repeat(40) }] }
      const sections = [section('S', [paragraph])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      const forced = [{ id: 'lead', after: null }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: {}, paragraphLines: { P: lines } })
      const pages = paginate(sections, forced, 100, metrics)
      // page 1 first (blank), page 2 the leading manual break, page 3 the paragraph's continuation.
      expect(pages.map(page => page.origin)).toEqual(['first', 'manual', 'continuation'])
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

describe('paginate — keep-with-next', () => {
   it('keeps a heading with its first block instead of orphaning it at a page bottom', () => {
      const sections = [section('S', [block('F'), block('H', 'h3'), block('P', 'p')])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }, { height: 20, charEnd: 30 }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { F: 60, H: 20 }, paragraphLines: { P: lines } })
      // page 1: title(10) + F(60) = 70, remaining 30. H(20) alone would fit, but H + firstAtom(P)=40 => 60
      // does not, so H moves with P to a fresh auto page instead of sitting orphaned above the seam.
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}H`)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['H', 'P'])
   })

   it('keeps a section title with its first block when the pair cannot fit under existing content', () => {
      const sections = [section('S1', [block('A')]), section('S2', [block('H', 'h3'), block('P', 'p')])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 55, H: 15 }, paragraphLines: { P: lines } })
      // page 1: title(10) + A(55) = 65, remaining 35. S2 title(10) + H(15) = 25 would fit, but the whole
      // start title(10) + H(15) + firstAtom(P)=40 => 65 does not, so the entire S2 start moves together.
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['A'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}section-S2`)
      expect(pages[1].slices[0].section.id).toBe('S2')
      expect(pages[1].slices[0].isSectionStart).toBe(true)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['H', 'P'])
   })

   it('moves a chained heading cluster together with the first atom of its body', () => {
      const sections = [section('S', [block('F'), block('H3', 'h3'), block('H4', 'h4'), block('P', 'p')])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { F: 60, H3: 15, H4: 15 }, paragraphLines: { P: lines } })
      // page 1: title(10) + F(60) = 70, remaining 30. The H3 reservation chains H4 then firstAtom(P):
      // 15 + 15 + 40 = 70, plus H3 itself, well past 30, so the whole cluster starts a fresh auto page.
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}H3`)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['H3', 'H4', 'P'])
   })

   it('does not break for an unsatisfiable giant companion (leaves the heading where it sits)', () => {
      const sections = [section('S', [block('F'), block('H', 'h3'), block('BIG', 'table')])]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 50, H: 20, BIG: 250 } })
      // remaining after F is 50. H + firstAtom(BIG)=250 => 270 cannot fit ANY fresh page (availableHeight
      // 100), so worthBreaking is false: H is placed beside F and the giant flows onto its own sheet.
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F', 'H'])
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['BIG'])
   })

   it('lets a forced break after a heading suppress keep-with-next', () => {
      const sections = [section('S', [block('F'), block('H', 'h3'), block('P', 'p')])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }]
      const forced = [{ id: 'brk', after: { sectionId: 'S', blockId: 'H' } }]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 60, H: 20 }, paragraphLines: { P: lines } })
      // Without the forced break, F(60) + remaining 40 would push H + firstAtom(P)=60 to an auto:H page.
      // The author break on H sets keepWith to 0, so H stays at the bottom and the break itself fires: P
      // starts the explicit `brk` page, not an auto keep-with-next page.
      const pages = paginate(sections, forced, 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F', 'H'])
      expect(pages[1].id).toBe('brk')
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['P'])
      expect(isAutoPageId(pages[1].id)).toBe(false)
   })

   it('breaks for a section title whose first block will not follow, though the title alone fits', () => {
      const sections = [section('S1', [block('A')]), section('S2', [block('B')])]
      const metrics = metricsFrom({ titleHeight: 30, blockHeights: { A: 40, B: 40 } })
      // page 1: title(30) + A(40) = 70, remaining 30. S2 title(30) alone would fit (30 <= 30, the
      // title-alone break is strict), but title(30) + B(40) = 70 does not, so keep-with-next moves S2.
      const pages = paginate(sections, [], 100, metrics)
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID,                  slices: [{ section: 'S1', blocks: ['A'], start: true, end: true }] },
         { id: `${AUTO_PAGE_PREFIX}section-S2`, slices: [{ section: 'S2', blocks: ['B'], start: true, end: true }] },
      ])
   })

   it('lays out a heading cluster identically for the editor at rest and the export atomic set', () => {
      const sections = [section('S', [block('F'), block('H', 'h3'), block('P', 'p')])]
      const lines: ParagraphLine[] = [{ height: 20, charEnd: 10 }, { height: 20, charEnd: 20 }, { height: 20, charEnd: 30 }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { F: 60, H: 20 }, paragraphLines: { P: lines } })
      const editorAtRest = paginate(sections, [], 100, metrics, new Set<string>())
      const exportLayout = paginate(sections, [], 100, metrics, new Set<string>())
      expect(shape(exportLayout)).toEqual(shape(editorAtRest))
      expect(exportLayout).toHaveLength(2)
      expect(exportLayout[1].id).toBe(`${AUTO_PAGE_PREFIX}H`)
   })

   it('leaves non-heading atomic placement byte-identical (no keep-with-next reservation)', () => {
      const sections = [section('S', [block('A'), block('B'), block('C')])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { A: 40, B: 40, C: 40 } })
      // A and B are plain (non-heading) blocks, so keepWith stays 0 and the seam falls exactly where the
      // pre-keep-with-next paginator put it: A + B on page 1, C pushed to the auto page on its own.
      const pages = paginate(sections, [], 100, metrics)
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID,          slices: [{ section: 'S', blocks: ['A', 'B'], start: true,  end: false }] },
         { id: `${AUTO_PAGE_PREFIX}C`, slices: [{ section: 'S', blocks: ['C'],      start: false, end: true  }] },
      ])
   })
})

describe('paginate — keep-together', () => {
   // A `p` block whose richText is `length` chars long, optionally held whole via keepTogether.
   function paragraph(id: string, length: number, held = false): Block {
      const base: Block = { id, type: 'p', richText: [{ text: 'x'.repeat(length) }] }
      return held ? { ...base, keepTogether: true } : base
   }

   // A held paragraph uses its whole `blockHeight`, never its per-line channel, so keepTogether alone
   // holds it whole even with an empty export atomic set.
   it('places a keepTogether paragraph whole instead of splitting it', () => {
      const sections = [section('S', [paragraph('P', 40, true)])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { P: 50 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks).toHaveLength(1)
      expect(pages[0].slices[0].blocks[0].paragraphFragment).toBeUndefined()
      expect(pages[0].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(40) }])
   })

   it('moves a keepTogether paragraph whole to the next page when it does not fit', () => {
      const sections = [section('S', [block('F'), paragraph('P', 40, true)])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      // page 1: F(70) fills it, remaining 30. Held P whole = blockHeight 80 > 30, so it moves WHOLE onto an
      // auto page (keyed on the block id, not a continuation ordinal), carrying no fragment tag.
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 70, P: 80 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}P`)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['P'])
      expect(pages[1].slices[0].blocks[0].paragraphFragment).toBeUndefined()
   })

   it('still splits the same paragraph across pages without the keepTogether flag (regression)', () => {
      const sections = [section('S', [block('F'), paragraph('P', 40)])]
      const lines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 },
         { height: 30, charEnd: 30 }, { height: 30, charEnd: 40 },
      ]
      // Same layout as above but unheld: the paragraph splits at a line boundary rather than moving whole.
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 70, P: 80 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages.length).toBeGreaterThan(1)
      const fragments = pages.flatMap(page => page.slices.flatMap(slice => slice.blocks))
         .filter(candidate => candidate.id === 'P')
      expect(fragments.every(candidate => candidate.paragraphFragment !== undefined)).toBe(true)
   })

   it('places a keepTogether list whole instead of splitting it at an item boundary', () => {
      const held: Block = { ...listBlock('L', 4), keepTogether: true }
      const sections = [section('S', [held])]
      // The whole-list height is measured on the block (blockHeight), so a held list lands via the
      // atomic path; its per-item heights (which would split it 3 / 1) are ignored.
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { L: 60 }, listItems: { L: [30, 30, 30, 30] } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks).toHaveLength(1)
      expect(pages[0].slices[0].blocks[0].items?.map(item => item.id)).toEqual(['L-i0', 'L-i1', 'L-i2', 'L-i3'])
   })

   it('still splits the same list at an item boundary without the keepTogether flag (regression)', () => {
      const sections = [section('S', [listBlock('L', 4)])]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { L: 60 }, listItems: { L: [30, 30, 30, 30] } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks[0].items?.length).toBe(3)
      expect(pages[1].slices[0].blocks[0].items?.length).toBe(1)
   })

   // A held heading companion must reserve its WHOLE height in keep-with-next: it can never be placed in
   // pieces, so a first-line reservation would strand the heading.
   it('reserves a keepTogether companion whole height in keep-with-next', () => {
      const held = paragraph('P', 30, true)
      const sections = [section('S', [block('F'), block('H', 'h3'), held])]
      const lines: ParagraphLine[] = [{ height: 15, charEnd: 10 }, { height: 15, charEnd: 20 }, { height: 15, charEnd: 30 }]
      // page 1: title(10) + F(30) = 40, remaining 60. Were P splittable, H + firstAtom(P)=20+30=50 fits, so
      // H would stay put. Held, firstAtomHeight(P) is its WHOLE 70: H + 70 = 90 > 60, so the heading moves
      // with the held paragraph to a fresh auto page.
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { F: 30, H: 20, P: 70 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}H`)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['H', 'P'])
   })

   // Contrast the test above: the SAME layout with an unheld companion leaves the heading in place (H +
   // its first two lines fit), proving the whole-height reservation is what moves the cluster.
   it('leaves the heading in place when the same companion is not held (contrast)', () => {
      const unheld = paragraph('P', 30)
      const sections = [section('S', [block('F'), block('H', 'h3'), unheld])]
      const lines: ParagraphLine[] = [{ height: 15, charEnd: 10 }, { height: 15, charEnd: 20 }, { height: 15, charEnd: 30 }]
      const metrics = metricsFrom({ titleHeight: 10, blockHeights: { F: 30, H: 20, P: 70 }, paragraphLines: { P: lines } })
      const pages = paginate(sections, [], 100, metrics)
      // H is NOT moved to its own auto page: it stays on page 1 beside F, and the unheld paragraph then
      // splits with its head trailing on the same sheet (contrast the held case, where page 1 held only F).
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id).slice(0, 2)).toEqual(['F', 'H'])
      expect(pages[1]?.id).not.toBe(`${AUTO_PAGE_PREFIX}H`)
   })
})

describe('findTooTallPageIds', () => {
   const CONTENT_BOX = 100

   // A measured-height oracle carrying only per-block whole heights (the fields findTooTallPageIds reads).
   function heightsFor(blockHeights: Record<string, number>): MeasuredHeights {
      return {
         header: 0, titleBySection: new Map(), listItemById: new Map(), paragraphLinesById: new Map(),
         blockById: new Map(Object.entries(blockHeights)),
      }
   }

   // A page whose whole content is one slice holding `blocks`.
   function soleBlockPage(id: string, blocks: Block[]): Page {
      return { id, origin: 'continuation', slices: [{ section: section('S', []), blocks, isSectionStart: false, isSectionEnd: true }] }
   }

   // A spanning paragraph renders as same-id fragments, each carrying the WHOLE paragraph height in
   // blockById. It reflows on its own, so no fragment page is ever flagged.
   it('never flags a splittable paragraph that spans several pages', () => {
      const fragment: Block = { id: 'P', type: 'p', paragraphFragment: { charStart: 0, charEnd: 20, isTail: false }, richText: [{ text: 'x'.repeat(20) }] }
      const pages = [soleBlockPage('page-a', [fragment]), soleBlockPage('page-b', [fragment]), soleBlockPage('page-c', [fragment])]
      const tooTall = findTooTallPageIds(pages, heightsFor({ P: 260 }), CONTENT_BOX)
      expect(tooTall.size).toBe(0)
   })

   // A splittable list splits at an item boundary, so a list-only page is never too tall either.
   it('never flags a splittable list', () => {
      const pages = [soleBlockPage('page-a', [listBlock('L', 4)])]
      const tooTall = findTooTallPageIds(pages, heightsFor({ L: 300 }), CONTENT_BOX)
      expect(tooTall.size).toBe(0)
   })

   // A keepTogether paragraph is atomic and CAN overflow one sheet, so a genuinely oversized held
   // paragraph is the one case that still warrants the note.
   it('flags a keepTogether paragraph taller than the content box', () => {
      const held: Block = { id: 'P', type: 'p', keepTogether: true, richText: [{ text: 'x'.repeat(40) }] }
      const tooTall = findTooTallPageIds([soleBlockPage('page-a', [held])], heightsFor({ P: 260 }), CONTENT_BOX)
      expect([...tooTall]).toEqual(['page-a'])
   })

   // An inherently atomic block (an image, code, table, ...) taller than the sheet is flagged as before.
   it('flags an atomic block taller than the content box', () => {
      const tooTall = findTooTallPageIds([soleBlockPage('page-a', [block('IMG', 'image')])], heightsFor({ IMG: 300 }), CONTENT_BOX)
      expect([...tooTall]).toEqual(['page-a'])
   })

   // A page with more than one block is a normal auto-flow seam, never a single-block dead end.
   it('never flags a page holding more than one block', () => {
      const held: Block = { id: 'P', type: 'p', keepTogether: true, richText: [{ text: 'x' }] }
      const pages = [soleBlockPage('page-a', [held, block('B', 'image')])]
      const tooTall = findTooTallPageIds(pages, heightsFor({ P: 260, B: 260 }), CONTENT_BOX)
      expect(tooTall.size).toBe(0)
   })

   it('does not flag an atomic block that fits', () => {
      const tooTall = findTooTallPageIds([soleBlockPage('page-a', [block('IMG', 'image')])], heightsFor({ IMG: 80 }), CONTENT_BOX)
      expect(tooTall.size).toBe(0)
   })
})

describe('paginate — keep-with-next (manual flag)', () => {
   // A splittable `p` flagged keepWithNext: it fits whole but is pinned to whatever follows it.
   function keeperParagraph(id: string, length: number): Block {
      return { id, type: 'p', richText: [{ text: 'x'.repeat(length) }], keepWithNext: true }
   }
   const shortLines: ParagraphLine[] = [{ height: 10, charEnd: 5 }, { height: 10, charEnd: 10 }]

   // The paragraph fits under existing content, but its companion would not follow it there, so the
   // pre-check moves the paragraph WHOLE (untagged) to a fresh page where the pair fits together.
   it('moves a flagged short paragraph whole to a fresh page so its companion can follow', () => {
      const sections = [section('S', [block('F'), keeperParagraph('P', 10), block('C')])]
      // page 1: F(60), remaining 40. P fits whole (20), but P(20) + firstAtom(C)=30 => 50 > 40, so the pair
      // moves: P starts an auto:P page, C follows on the same sheet.
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 60, P: 20, C: 30 }, paragraphLines: { P: shortLines } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}P`)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['P', 'C'])
      // Moved whole, not split: the original block is placed untagged with its full richText.
      expect(pages[1].slices[0].blocks[0].paragraphFragment).toBeUndefined()
      expect(pages[1].slices[0].blocks[0].richText).toEqual([{ text: 'x'.repeat(10) }])
   })

   // A flagged ATOMIC block (no line / item channel) reserves its companion through the atomic branch,
   // not the pre-check: same pinning result, via `need = height + keepWith` in the atomic path.
   it('reserves a companion for a flagged atomic block through the atomic branch', () => {
      const flaggedTable: Block = { id: 'A', type: 'table', keepWithNext: true }
      const sections = [section('S', [block('F'), flaggedTable, block('C')])]
      // page 1: F(60), remaining 40. A is atomic (20); A + firstAtom(C)=30 => 50 > 40, so the atomic branch
      // breaks and the pair starts an auto:A page together.
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 60, A: 20, C: 30 } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F'])
      expect(pages[1].id).toBe(`${AUTO_PAGE_PREFIX}A`)
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['A', 'C'])
   })

   // An explicit break right after the flagged block wins: the call-site short-circuit sets keepWith to
   // 0, so keep-with-next reserves nothing and the author break fires as written.
   it('is inert when an explicit break sits after the flagged block', () => {
      const sections = [section('S', [block('F'), keeperParagraph('P', 10), block('C')])]
      const forced = [{ id: 'brk', after: { sectionId: 'S', blockId: 'P' } }]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 60, P: 20, C: 30 }, paragraphLines: { P: shortLines } })
      const pages = paginate(sections, forced, 100, metrics)
      // Without the short-circuit P would move with C; the break on P zeroes keepWith, so P stays beside F
      // and C starts the explicit `brk` page.
      expect(pages).toHaveLength(2)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F', 'P'])
      expect(pages[1].id).toBe('brk')
      expect(pages[1].slices[0].blocks.map(candidate => candidate.id)).toEqual(['C'])
      expect(isAutoPageId(pages[1].id)).toBe(false)
   })

   // The flag on the flow's LAST block is inert: trailingKeepHeight past the end is 0, so keepWith is 0.
   it('is inert on the last block of the flow (nothing follows to keep with)', () => {
      const sections = [section('S', [block('F'), keeperParagraph('P', 10)])]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 60, P: 20 }, paragraphLines: { P: shortLines } })
      const pages = paginate(sections, [], 100, metrics)
      // P fits under F (60 + 20 = 80 <= 100) and has no successor, so it simply stays on page 1.
      expect(pages).toHaveLength(1)
      expect(pages[0].slices[0].blocks.map(candidate => candidate.id)).toEqual(['F', 'P'])
   })

   // Without the flag the SAME layout leaves the paragraph where it fits, so C alone spills.
   it('leaves the same paragraph unaffected without the flag', () => {
      const plain: Block = { id: 'P', type: 'p', richText: [{ text: 'x'.repeat(10) }] }
      const sections = [section('S', [block('F'), plain, block('C')])]
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 60, P: 20, C: 30 }, paragraphLines: { P: shortLines } })
      const pages = paginate(sections, [], 100, metrics)
      // No flag: P stays beside F (fits at remaining 40), and only C is pushed onto its own auto page.
      expect(shape(pages)).toEqual([
         { id: FIRST_PAGE_ID,          slices: [{ section: 'S', blocks: ['F', 'P'], start: true,  end: false }] },
         { id: `${AUTO_PAGE_PREFIX}C`, slices: [{ section: 'S', blocks: ['C'],      start: false, end: true  }] },
      ])
   })

   // A flagged paragraph long enough to genuinely split still splits: when the whole block plus its
   // companion cannot fit ANY fresh page, the pre-check declines and the split loop runs as usual.
   it('still splits a flagged paragraph too tall to keep with its companion on one page', () => {
      const longLines: ParagraphLine[] = [
         { height: 30, charEnd: 10 }, { height: 30, charEnd: 20 }, { height: 30, charEnd: 30 },
         { height: 30, charEnd: 40 }, { height: 30, charEnd: 50 },
      ]
      const sections = [section('S', [block('F'), keeperParagraph('P', 50), block('C')])]
      // P whole is 150 > availableHeight 100, so P(150) + firstAtom(C)=30 can never share a sheet: the
      // pre-check's `<= availableHeight` guard is false, so it declines and P splits at a line boundary.
      const metrics = metricsFrom({ titleHeight: 0, blockHeights: { F: 30, P: 150, C: 30 }, paragraphLines: { P: longLines } })
      const pages = paginate(sections, [], 100, metrics)
      expect(pages.length).toBeGreaterThan(1)
      const fragments = pages.flatMap(page => page.slices.flatMap(slice => slice.blocks))
         .filter(candidate => candidate.id === 'P')
      expect(fragments.length).toBeGreaterThan(1)
      expect(fragments.every(candidate => candidate.paragraphFragment !== undefined)).toBe(true)
   })
})

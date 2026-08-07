/**
 * The measured paginator for the paged (A4) format: automatic reflow.
 *
 * `pageModel.partitionIntoPages` cuts the flat block flow at EXPLICIT breaks only, so a paragraph or
 * list that runs past the bottom of a sheet is forced whole onto the next one, leaving a blank gap
 * (and a single block taller than the page dead-ends). This module fills that gap: given the rendered
 * HEIGHTS of the content (measured from the DOM, never predicted) plus the available content height,
 * it greedily fills each sheet and, when a `list`/`checklist` block would overrun, splits it at the
 * last root item that fits and continues the remainder on the next sheet. Other block types stay
 * atomic (moved whole to the next sheet, or left to overflow when taller than a whole page).
 *
 * Reflow is a LAYOUT DERIVATION, never a model mutation: the Section/Block flow is untouched. A
 * spanning list is expressed as SHALLOW-COPIED list blocks whose `items` hold only that page's slice,
 * so the existing slice renderers (editor `renderPageSlice`, export `exportBlock`) need no
 * fragment-awareness; a continuation simply renders as another `<ul>`.
 *
 * Heights are width-stable: an item / block height depends only on the content width (constant across
 * sheets of one format), never on where the break lands, so the caller measures once per content
 * version and this function re-paginates purely, with no feedback loop.
 *
 * Explicit breaks (`format.pages`) still win: a forced break is a hard page start, and auto-flow only
 * fills the space between forced breaks. Auto-created pages carry a synthetic id (see `AUTO_PAGE_PREFIX`)
 * so the editor / Pages panel can tell a continuation sheet from an author-made one.
 *
 * No React, no DOM: pure and unit-testable, a sibling to pageModel.ts / pageOverflow.ts.
 */

import type { Block, Section } from '../types'
import type { PageBreak } from './format'
import type { Page, PageSlice } from './pageModel'
import { FIRST_PAGE_ID } from './pageModel'

// #############
// # CONSTANTS #
// #############

// Auto-created (continuation) pages carry an id with this prefix, distinct from FIRST_PAGE_ID and the
// crypto.randomUUID ids of explicit PageBreaks. Lets the editor / panel treat a continuation sheet as
// non-operable (its content belongs to the block flowing onto it), and keeps React keys stable across
// re-measures because the id is derived from the content that starts the page.
export const AUTO_PAGE_PREFIX = 'auto:'

/** Whether a page id names an auto-created continuation page (vs. the first page or an explicit break). */
export function isAutoPageId(pageId: string): boolean {
   return pageId.startsWith(AUTO_PAGE_PREFIX)
}

// #########
// # TYPES #
// #########

/**
 * The height oracle the paginator reads, in CSS px. Supplied by the measuring hook from the real DOM
 * (or by tests as synthetic numbers). Every height INCLUDES the element's own top + bottom margin, so
 * summing consumed heights approximates the rendered stack; a small over/under-estimate at a page seam
 * is acceptable (the sheet is min-height on screen and overflow-hidden in print).
 */
export interface LayoutMetrics {
   /** The page-1 document header's consumed height (0 when it is absent or not measured yet). */
   headerHeight: number
   /** A section title row's consumed height when it is shown (on the slice that starts the section). */
   sectionTitleHeight: (sectionId: string) => number
   /** A whole top-level block's consumed height. */
   blockHeight: (blockId: string) => number
   /** For a splittable `list`/`checklist` block, the consumed height of each ROOT item in order;
    *  `null` for any non-splittable block (measured as one atomic unit via `blockHeight`). */
   listItemHeights: (blockId: string) => number[] | null
}

// ##########
// # HELPERS #
// ##########

/** A shallow render-copy of a list block carrying only its root items `[start, end)`. Same block id
 *  (page-scoped queries keep it unambiguous); the model list is never mutated. */
function sliceListBlock(block: Block, start: number, end: number): Block {
   return { ...block, items: (block.items ?? []).slice(start, end) }
}

// ##############
// # PAGINATE   #
// ##############

/**
 * Lay the section/block flow out into height-fitted pages. Honours explicit breaks exactly like
 * `partitionIntoPages` (leading `after:null` breaks are blank pages, breaks stacked on one anchor are
 * consecutive blanks), then auto-flows the content between them so nothing overruns a sheet. Always
 * returns at least one page. Pure: it re-references the same Block objects (list fragments are shallow
 * copies) and never mutates `sections`.
 */
export function paginate(
   sections:        Section[],
   forcedBreaks:    PageBreak[],
   availableHeight: number,
   metrics:         LayoutMetrics,
): Page[] {
   // Explicit-break maps, identical to pageModel.partitionIntoPages.
   const breaksAfterBlockId = new Map<string, PageBreak[]>()
   const leadingBreaks: PageBreak[] = []
   for (const pageBreak of forcedBreaks) {
      if (pageBreak.after === null) { leadingBreaks.push(pageBreak); continue }
      const list = breaksAfterBlockId.get(pageBreak.after.blockId)
      if (list) list.push(pageBreak)
      else breaksAfterBlockId.set(pageBreak.after.blockId, [pageBreak])
   }

   const pages: Page[] = []
   let pageId = FIRST_PAGE_ID
   let slices: PageSlice[] = []
   let pageIndex = 0
   let used = 0
   let openSlice: PageSlice | null = null
   let currentSection: Section | null = null

   // Remaining content height on the current sheet (page 1 also spends the document header).
   function remaining(): number {
      return availableHeight - (pageIndex === 0 ? metrics.headerHeight : 0) - used
   }

   // Close the current sheet and open the next. `continuation` keeps the current section open as a
   // no-title continuation slice (auto-flow mid-section); otherwise the next block re-opens a slice.
   function startPage(nextId: string, continuation: boolean): void {
      pages.push({ id: pageId, slices })
      pageId = nextId
      slices = []
      used = 0
      pageIndex += 1
      if (continuation && currentSection) {
         openSlice = { section: currentSection, blocks: [], isSectionStart: false, isSectionEnd: false }
         slices.push(openSlice)
      } else {
         openSlice = null
      }
   }

   // An auto (height-driven) break: synthetic id derived from the content that will start the next page,
   // so it stays stable across re-measures. `continuation` keeps the current section open as a no-title
   // continuation slice (mid-block / mid-list flow); pass false when the caller opens its own next slice
   // (a following section pushed down because its title would not fit).
   function autoBreak(nextStartKey: string, continuation: boolean): void {
      startPage(`${AUTO_PAGE_PREFIX}${nextStartKey}`, continuation)
   }

   // Leading blank pages: each closes the current (empty) page and opens the next.
   for (const pageBreak of leadingBreaks) startPage(pageBreak.id, false)

   for (const section of sections) {
      currentSection = section

      if (section.blocks.length === 0) {
         // An empty section is a title-only slice. Move it to a fresh page if its title cannot fit
         // under existing content (it never splits).
         const titleHeight = metrics.sectionTitleHeight(section.id)
         if (used > 0 && titleHeight > remaining()) autoBreak(`empty-${section.id}`, false)
         slices.push({ section, blocks: [], isSectionStart: true, isSectionEnd: true })
         used += titleHeight
         openSlice = null
         continue
      }

      openSlice = null
      let placedAnyBlockOfSection = false

      section.blocks.forEach((block, blockIndex) => {
         // Open this section's slice on the current page, spending the title when it starts the section.
         if (openSlice === null) {
            const isStart = !placedAnyBlockOfSection
            if (isStart && used > 0 && metrics.sectionTitleHeight(section.id) > remaining()) {
               // Title would not fit under existing content: push the whole section start to a new page.
               autoBreak(`section-${section.id}`, false)
            }
            openSlice = { section, blocks: [], isSectionStart: isStart, isSectionEnd: false }
            slices.push(openSlice)
            if (isStart) used += metrics.sectionTitleHeight(section.id)
         }

         placeBlock(block)
         placedAnyBlockOfSection = true
         if (blockIndex === section.blocks.length - 1 && openSlice) openSlice.isSectionEnd = true

         // Explicit break(s) after this block: the first starts the next content page, extras are blanks.
         const cuts = breaksAfterBlockId.get(block.id)
         if (cuts) {
            for (const pageBreak of cuts) startPage(pageBreak.id, false)
            openSlice = null
         }
      })
   }

   pages.push({ id: pageId, slices })
   return pages

   // Place one block on the current page, auto-breaking (and, for a splittable list, splitting) so it
   // fits. `openSlice` is guaranteed non-null on entry.
   function placeBlock(block: Block): void {
      const itemHeights = metrics.listItemHeights(block.id)

      if (!itemHeights || itemHeights.length === 0) {
         // Atomic block: keep it whole. Move to a fresh page when it does not fit under existing
         // content; if it does not fit even on an empty page it is simply taller than the page, place
         // it anyway (the sheet clips it in print, exactly the pre-reflow "too tall" case).
         const height = metrics.blockHeight(block.id)
         if (used > 0 && height > remaining()) autoBreak(block.id, true)
         openSlice!.blocks.push(block)
         used += height
         return
      }

      // Splittable list: fill root items across pages, splitting at the last item that fits.
      let start = 0
      while (start < itemHeights.length) {
         let end = start
         let sum = 0
         for (let index = start; index < itemHeights.length; index += 1) {
            const next = sum + itemHeights[index]
            // Stop before the first item that crosses the boundary, but always take at least one item
            // when the page is otherwise empty (else an oversized item would loop forever).
            if (next > remaining() && (index > start || used > 0)) break
            sum = next
            end = index + 1
         }

         if (end === start) {
            // Nothing fits in the space left: break to a fresh page and retry this item there.
            autoBreak(`${block.id}:${start}`, true)
            continue
         }

         openSlice!.blocks.push(sliceListBlock(block, start, end))
         used += sum
         start = end
         if (start < itemHeights.length) autoBreak(`${block.id}:${start}`, true)
      }
   }
}

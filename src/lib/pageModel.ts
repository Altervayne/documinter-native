/**
 * pageModel.ts, the pure page model for the paged (A4) document format.
 *
 * Document Formats PHASE 2. Pages are DERIVED, never stored on content: a document's flat section/
 * block flow is partitioned into discrete pages at explicit break markers (`format.pages`, the
 * `PageBreak[]` shipped by Phase 1). The `Section` / `Block` / `DocState` model is UNTOUCHED, this is
 * layout over the content, mirroring how `presentation.reconcileNav` derives the sidebar nav from the
 * same section flow without changing content. See docs/reference/document_formats_study.md (option
 * c', "pages as break-marker partitions over the flat section flow").
 *
 * BREAK SEMANTICS (matching the shipped `PageBreak.before` field): a break's `before.blockId` names
 * the block that STARTS the next page, i.e. content from that anchor onward belongs to the next page.
 * The author-facing action is "insert a page break AFTER block X", which resolves to a break BEFORE
 * X's successor in the flat flow (see `addPageBreakAfter`), so a break can never isolate an empty
 * leading page.
 *
 * No React, no DOM: pure and unit-testable, like format.ts / listItemTree.ts.
 */

import type { Block, Section } from '../types'
import type { PageBreak } from './format'

// #############
// # CONSTANTS #
// #############

// A4 sheet geometry in CSS px at 96dpi (A4 = 210 x 297mm). Portrait is the sheet upright; landscape
// swaps width/height. The editor renders sheets at these pixel sizes; the eventual @page export
// (Phase 5) uses the mm-native margins so print maps 1:1 to physical A4.
export const A4_PORTRAIT_WIDTH_PX  = 794
export const A4_PORTRAIT_HEIGHT_PX = 1123
export const A4_LANDSCAPE_WIDTH_PX  = 1123
export const A4_LANDSCAPE_HEIGHT_PX = 794

// The synthetic id of the implicit FIRST page (which needs no break marker). Real pages 2..N are
// keyed by the id of the PageBreak that begins them. crypto.randomUUID ids never collide with this.
export const FIRST_PAGE_ID = 'page-first'

// Millimetres → CSS px at 96dpi (25.4mm per inch), for turning the mm-native margins into editor
// padding. Kept here so the editor and any later print path share ONE conversion.
export function millimetresToPx(millimetres: number): number {
   return (millimetres * 96) / 25.4
}

// #########
// # TYPES #
// #########

/**
 * One section's contribution to a single page. A section that spans a page break yields MULTIPLE
 * slices (one per page it touches); `isSectionStart` marks the slice that begins the section (renders
 * its title), `isSectionEnd` marks the slice that ends it (renders the add-block affordance). An
 * empty section yields exactly one slice that is both start and end.
 */
export interface PageSlice {
   section:        Section
   blocks:         Block[]
   isSectionStart: boolean
   isSectionEnd:   boolean
}

/** A derived page: an ordered list of section slices. `id` is `FIRST_PAGE_ID` for page 1, else the
 *  `PageBreak.id` that starts it (a stable key for React + the later page sorter). */
export interface Page {
   id:     string
   slices: PageSlice[]
}

// ##############
// # PARTITION #
// ##############

/**
 * Partition the flat section/block flow into ordered pages at the given break markers. Pure: it never
 * mutates `sections` (it re-references the same Block objects into slices). Always returns at least
 * one page (an empty document is a single empty page). A break whose anchor is the very first block
 * of the whole document is absorbed (cutting there would create an empty leading page); back-to-back
 * anchors likewise never produce an empty page.
 */
export function partitionIntoPages(sections: Section[], pages: PageBreak[]): Page[] {
   // Anchor blockId → the PageBreak.id that begins a page BEFORE that block (last wins on a dup).
   const breakIdByBlockId = new Map<string, string>()
   for (const pageBreak of pages) breakIdByBlockId.set(pageBreak.before.blockId, pageBreak.id)

   const result: Page[] = []
   let currentPage: Page = { id: FIRST_PAGE_ID, slices: [] }
   result.push(currentPage)
   // Whether the current page holds any block yet — the guard that stops a break from opening an
   // empty page (leading break, or two breaks on adjacent blocks).
   let currentPageHasBlocks = false

   for (const section of sections) {
      if (section.blocks.length === 0) {
         // An empty section is one whole slice on the current page (title + empty-state, no cut).
         currentPage.slices.push({ section, blocks: [], isSectionStart: true, isSectionEnd: true })
         continue
      }

      // The open slice for THIS section on the current page (lazily (re)created after a cut).
      let openSlice: PageSlice | null = null
      let placedAnyBlockOfSection = false

      section.blocks.forEach((block, blockIndex) => {
         const breakId = breakIdByBlockId.get(block.id)
         if (breakId && currentPageHasBlocks) {
            // Cut: this block starts a new page.
            currentPage = { id: breakId, slices: [] }
            result.push(currentPage)
            currentPageHasBlocks = false
            openSlice = null
         }
         if (openSlice === null) {
            openSlice = { section, blocks: [], isSectionStart: !placedAnyBlockOfSection, isSectionEnd: false }
            currentPage.slices.push(openSlice)
         }
         openSlice.blocks.push(block)
         currentPageHasBlocks = true
         placedAnyBlockOfSection = true
         if (blockIndex === section.blocks.length - 1) openSlice.isSectionEnd = true
      })
   }

   return result
}

// #############
// # RECONCILE #
// #############

/**
 * Drop break markers whose anchor block no longer exists (a deleted/undone block), so a stale marker
 * can never leave a dangling cut, mirroring `reconcileNav` dropping dead nav targets. A surviving
 * marker whose anchor block moved to a different section has its `before.sectionId` refreshed (the
 * partition keys on blockId, but a stale sectionId is kept honest). Duplicates on the same anchor are
 * de-duped defensively. Returns the SAME array reference semantics as the caller expects: a fresh
 * array either way (callers compare contents, see WysiwygArea's reconcile effect).
 */
export function reconcilePages(pages: PageBreak[], sections: Section[]): PageBreak[] {
   const sectionIdByBlockId = new Map<string, string>()
   for (const section of sections)
      for (const block of section.blocks) sectionIdByBlockId.set(block.id, section.id)

   const seenBlockIds = new Set<string>()
   const result: PageBreak[] = []
   for (const pageBreak of pages) {
      const sectionId = sectionIdByBlockId.get(pageBreak.before.blockId)
      if (sectionId === undefined) continue                       // anchor block deleted → drop
      if (seenBlockIds.has(pageBreak.before.blockId)) continue    // duplicate anchor → drop
      seenBlockIds.add(pageBreak.before.blockId)
      result.push(sectionId === pageBreak.before.sectionId
         ? pageBreak
         : { ...pageBreak, before: { sectionId, blockId: pageBreak.before.blockId } })
   }
   return result
}

// ###############
// # BREAK EDITS #
// ###############

/** The flat, ordered list of top-level blocks across all sections (container inner blocks are NOT
 *  page-break targets). */
function flattenBlocks(sections: Section[]): { sectionId: string; block: Block }[] {
   const flat: { sectionId: string; block: Block }[] = []
   for (const section of sections)
      for (const block of section.blocks) flat.push({ sectionId: section.id, block })
   return flat
}

/** The block immediately AFTER `afterBlockId` in the flat flow, as a break anchor, or null when
 *  `afterBlockId` is the last block (or is absent). "Break after X" is stored as a break BEFORE this
 *  successor, so a break never isolates an empty trailing page. */
function successorAnchor(sections: Section[], afterBlockId: string): { sectionId: string; blockId: string } | null {
   const flat = flattenBlocks(sections)
   const index = flat.findIndex(entry => entry.block.id === afterBlockId)
   if (index === -1 || index === flat.length - 1) return null
   const next = flat[index + 1]
   return { sectionId: next.sectionId, blockId: next.block.id }
}

/** Whether a page break can be placed after `afterBlockId` — true unless it is the last block of the
 *  document (nothing to push to the next page). */
export function canBreakAfter(sections: Section[], afterBlockId: string): boolean {
   return successorAnchor(sections, afterBlockId) !== null
}

/** Whether a page break already exists immediately after `afterBlockId`. */
export function hasPageBreakAfter(pages: PageBreak[], sections: Section[], afterBlockId: string): boolean {
   const successor = successorAnchor(sections, afterBlockId)
   if (!successor) return false
   return pages.some(pageBreak => pageBreak.before.blockId === successor.blockId)
}

/**
 * Add a page break immediately after `afterBlockId` (i.e. before its successor in the flat flow).
 * Returns `pages` unchanged when `afterBlockId` is the last block (no successor to break before) or a
 * break already sits there. Pure: yields a new array on a real change.
 *
 * NOTE the `sections` parameter (beyond the study's `(pages, blockId)` sketch): resolving "after X"
 * to the stored "before X's successor" anchor requires the flat flow.
 */
export function addPageBreakAfter(pages: PageBreak[], sections: Section[], afterBlockId: string): PageBreak[] {
   const successor = successorAnchor(sections, afterBlockId)
   if (!successor) return pages
   if (pages.some(pageBreak => pageBreak.before.blockId === successor.blockId)) return pages
   return [...pages, { id: crypto.randomUUID(), before: successor }]
}

/** Remove the page break sitting immediately after `afterBlockId` (before its successor), if any. */
export function removePageBreakAfter(pages: PageBreak[], sections: Section[], afterBlockId: string): PageBreak[] {
   const successor = successorAnchor(sections, afterBlockId)
   if (!successor) return pages
   return pages.filter(pageBreak => pageBreak.before.blockId !== successor.blockId)
}

/** Remove a page break by its id (the between-pages "remove break" affordance keys on the page id,
 *  which for pages 2..N is the starting break's id). */
export function removePageBreak(pages: PageBreak[], pageBreakId: string): PageBreak[] {
   return pages.filter(pageBreak => pageBreak.id !== pageBreakId)
}

/**
 * The pure page model for the paged (A4) document format.
 *
 * Pages are DERIVED, never stored on content: a document's flat section/block flow is partitioned
 * into discrete pages at explicit break markers (`format.pages`, a `PageBreak[]`). The `Section` /
 * `Block` / `DocState` model is UNTOUCHED, this is layout over the content, mirroring how
 * `presentation.reconcileNav` derives the sidebar nav from the same section flow without changing
 * content.
 *
 * BOUNDARY SEMANTICS (matching the `PageBreak.after` field): a break's `after.blockId` names the block
 * that ENDS the page before it (the last block of the previous page). The boundary is physical: moving
 * or deleting the block that STARTS the next page never touches it, because that block is not the
 * anchor. A break with `after: null` sits before all content, a leading blank page. Multiple breaks
 * sharing the same anchor STACK as consecutive blank pages, so blank pages can live anywhere.
 *
 * No React, no DOM: pure and unit-testable, like format.ts / listItemTree.ts.
 */

import type { Block, Section } from '../types'
import type { PageBreak } from './format'
import { cloneBlock } from './document'

// #############
// # CONSTANTS #
// #############

// A4 sheet geometry in CSS px at 96dpi (A4 = 210 x 297mm). Portrait is the sheet upright; landscape
// swaps width/height. The editor renders sheets at these pixel sizes; the eventual @page export
// uses the mm-native margins so print maps 1:1 to physical A4.
export const A4_PORTRAIT_WIDTH_PX  = 794
export const A4_PORTRAIT_HEIGHT_PX = 1123
export const A4_LANDSCAPE_WIDTH_PX  = 1123
export const A4_LANDSCAPE_HEIGHT_PX = 794

// The synthetic id of the implicit FIRST page (which needs no break marker). Real pages 2..N are
// keyed by the id of the PageBreak that begins them. crypto.randomUUID ids never collide with this.
export const FIRST_PAGE_ID = 'page-first'

// Millimetres to CSS px at 96dpi (25.4mm per inch), for turning the mm-native margins into editor
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

/** A derived page: an ordered list of section slices. A blank page has no slices. `id` is
 *  `FIRST_PAGE_ID` for page 1, else the `PageBreak.id` that starts it (a stable key for React + the
 *  page sorter). */
export interface Page {
   id:     string
   slices: PageSlice[]
   /** How this page came to exist, set at page-creation time so the Pages panel can label it honestly
    *  without string-sniffing ids: `first` = page 1, `manual` = opened by an explicit `format.pages`
    *  break, `continuation` = an auto page carrying a block that flowed off the previous sheet,
    *  `auto-start` = an auto page a section push / empty section / keep-with-next opened to START fresh
    *  content. Only the measured paginator emits `continuation` / `auto-start` (partitionIntoPages, which
    *  cuts at explicit breaks only, emits just `first` / `manual`). */
   origin?: 'first' | 'manual' | 'continuation' | 'auto-start'
}

// ##############
// # FLATTEN    #
// ##############

/** The flat, ordered list of top-level blocks across all sections (container inner blocks are NOT
 *  page-break targets). */
function flattenBlocks(sections: Section[]): { sectionId: string; block: Block }[] {
   const flat: { sectionId: string; block: Block }[] = []
   for (const section of sections)
      for (const block of section.blocks) flat.push({ sectionId: section.id, block })
   return flat
}

// ##############
// # PARTITION  #
// ##############

/**
 * Partition the flat section/block flow into ordered pages at the given break markers. Pure: it never
 * mutates `sections` (it re-references the same Block objects into slices). Always returns at least
 * one page (an empty document is a single empty page). A break anchored `after` a block cuts right
 * after that block; breaks stacked on one anchor (or `after: null`) insert consecutive blank pages.
 */
export function partitionIntoPages(sections: Section[], pages: PageBreak[]): Page[] {
   // Anchor blockId -> the breaks cutting after it, in array order (their order = stacking order).
   const breaksAfterBlockId = new Map<string, PageBreak[]>()
   const leadingBreaks: PageBreak[] = []
   for (const pageBreak of pages) {
      if (pageBreak.after === null) {
         leadingBreaks.push(pageBreak)
         continue
      }
      const list = breaksAfterBlockId.get(pageBreak.after.blockId)
      if (list) list.push(pageBreak)
      else breaksAfterBlockId.set(pageBreak.after.blockId, [pageBreak])
   }

   const result: Page[] = []
   let currentPage: Page = { id: FIRST_PAGE_ID, slices: [], origin: 'first' }

   // Every page this function opens comes from an explicit break marker (a leading blank or a mid-section
   // cut), so it is always `manual`; only page 1 is `first`. The measured paginator adds the auto kinds.
   function startPage(pageId: string): void {
      result.push(currentPage)
      currentPage = { id: pageId, slices: [], origin: 'manual' }
   }

   // Leading blank pages: each leading break closes the current (still empty) page and opens the next.
   for (const pageBreak of leadingBreaks) startPage(pageBreak.id)

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
         if (openSlice === null) {
            openSlice = { section, blocks: [], isSectionStart: !placedAnyBlockOfSection, isSectionEnd: false }
            currentPage.slices.push(openSlice)
         }
         openSlice.blocks.push(block)
         placedAnyBlockOfSection = true
         if (blockIndex === section.blocks.length - 1) openSlice.isSectionEnd = true

         // Cut(s) after this block: the first starts the next content page, extras are blank pages.
         const cuts = breaksAfterBlockId.get(block.id)
         if (cuts) {
            for (const pageBreak of cuts) {
               startPage(pageBreak.id)
               openSlice = null   // remaining blocks of this section open a fresh continuation slice
            }
         }
      })
   }

   result.push(currentPage)
   return result
}

// #############
// # RECONCILE #
// #############

/**
 * Keep the break list honest after a content edit. A break `after: null` is always valid (leading
 * blank). A break whose anchor block still exists is kept (its `after.sectionId` refreshed if the
 * block moved sections). A break whose anchor block was DELETED re-anchors to the anchor's nearest
 * surviving predecessor in `previousSections` (so the boundary stays physical: the page keeps its
 * earlier content, or becomes a stacked blank when the deleted block was the page's only one). Without
 * `previousSections` a deleted anchor is dropped. Stacked breaks are preserved, they are blank pages.
 */
export function reconcilePages(pages: PageBreak[], sections: Section[], previousSections?: Section[]): PageBreak[] {
   const sectionIdByBlockId = new Map<string, string>()
   for (const section of sections)
      for (const block of section.blocks) sectionIdByBlockId.set(block.id, section.id)

   const previousFlat = previousSections ? flattenBlocks(previousSections) : undefined

   const result: PageBreak[] = []
   for (const pageBreak of pages) {
      if (pageBreak.after === null) {
         result.push(pageBreak)
         continue
      }
      const currentSectionId = sectionIdByBlockId.get(pageBreak.after.blockId)
      if (currentSectionId !== undefined) {
         result.push(currentSectionId === pageBreak.after.sectionId
            ? pageBreak
            : { ...pageBreak, after: { sectionId: currentSectionId, blockId: pageBreak.after.blockId } })
         continue
      }
      // Anchor block deleted: re-anchor to its nearest surviving predecessor to keep the boundary put.
      const reanchored = reanchorToPredecessor(pageBreak, sectionIdByBlockId, previousFlat)
      if (reanchored) result.push(reanchored)
   }
   return result
}

/** Re-anchor a break to the nearest block that still exists before its (gone or moved) anchor in the
 *  previous flow. Returns `after: null` when no predecessor survives (the anchor was the first block),
 *  or undefined when there is no previous flow to consult (the break is dropped). */
function reanchorToPredecessor(
   pageBreak: PageBreak,
   sectionIdByBlockId: Map<string, string>,
   previousFlat: { sectionId: string; block: Block }[] | undefined,
): PageBreak | undefined {
   if (!previousFlat || pageBreak.after === null) return undefined
   const anchorIndex = previousFlat.findIndex(entry => entry.block.id === pageBreak.after!.blockId)
   if (anchorIndex === -1) return undefined
   for (let index = anchorIndex - 1; index >= 0; index--) {
      const candidateId = previousFlat[index].block.id
      const sectionId = sectionIdByBlockId.get(candidateId)
      if (sectionId !== undefined) return { ...pageBreak, after: { sectionId, blockId: candidateId } }
   }
   return { ...pageBreak, after: null }
}

/**
 * Re-anchor the breaks whose anchor is one of `movedBlockIds` to that block's predecessor in
 * `previousSections`, called when a block is dragged so a boundary that ended a page stays where the
 * page ended instead of following the moved block across the document. Breaks on other anchors are
 * untouched. Returns the SAME array when nothing changed.
 */
export function reanchorMovedBlocks(
   pages: PageBreak[], previousSections: Section[], movedBlockIds: string[],
): PageBreak[] {
   const moved = new Set(movedBlockIds)
   if (!pages.some(pageBreak => pageBreak.after !== null && moved.has(pageBreak.after.blockId))) return pages
   const previousFlat = flattenBlocks(previousSections)
   const sectionIdByBlockId = new Map<string, string>()
   for (const section of previousSections)
      for (const block of section.blocks) sectionIdByBlockId.set(block.id, section.id)

   return pages.map(pageBreak => {
      if (pageBreak.after === null || !moved.has(pageBreak.after.blockId)) return pageBreak
      const anchorIndex = previousFlat.findIndex(entry => entry.block.id === pageBreak.after!.blockId)
      for (let index = anchorIndex - 1; index >= 0; index--) {
         const candidateId = previousFlat[index].block.id
         if (moved.has(candidateId)) continue   // skip other moved blocks, they left too
         const sectionId = sectionIdByBlockId.get(candidateId)!
         return { ...pageBreak, after: { sectionId, blockId: candidateId } }
      }
      return { ...pageBreak, after: null }
   })
}

// ###############
// # BREAK EDITS #
// ###############

/** The section a top-level block lives in, or undefined. */
function sectionIdOfBlock(sections: Section[], blockId: string): string | undefined {
   return flattenBlocks(sections).find(entry => entry.block.id === blockId)?.sectionId
}

/** Whether a content page break can be placed after `blockId`: true for any top-level block that is
 *  not the document's last (a trailing blank page is created through the add-page action instead). */
export function canBreakAfter(sections: Section[], blockId: string): boolean {
   const flat = flattenBlocks(sections)
   const index = flat.findIndex(entry => entry.block.id === blockId)
   return index !== -1 && index < flat.length - 1
}

/** Whether a page break already sits immediately after `blockId`. */
export function hasPageBreakAfter(pages: PageBreak[], blockId: string): boolean {
   return pages.some(pageBreak => pageBreak.after !== null && pageBreak.after.blockId === blockId)
}

/**
 * Add a content page break immediately after `blockId`. Idempotent: returns `pages` unchanged when a
 * break already sits there, when the block is not a top-level block, or when it is the document's last
 * block (a trailing blank belongs to the add-page action). Pure: yields a new array on a real change.
 */
export function addPageBreakAfter(pages: PageBreak[], sections: Section[], blockId: string): PageBreak[] {
   if (!canBreakAfter(sections, blockId)) return pages
   if (hasPageBreakAfter(pages, blockId)) return pages
   const sectionId = sectionIdOfBlock(sections, blockId)
   if (sectionId === undefined) return pages
   return [...pages, { id: crypto.randomUUID(), after: { sectionId, blockId } }]
}

/** Remove the content page break sitting immediately after `blockId`, if any. Removes the last such
 *  break so stacked blank pages after the same anchor peel off one at a time. */
export function removePageBreakAfter(pages: PageBreak[], blockId: string): PageBreak[] {
   const lastIndex = findLastIndex(pages, pageBreak => pageBreak.after !== null && pageBreak.after.blockId === blockId)
   if (lastIndex === -1) return pages
   return pages.filter((_pageBreak, index) => index !== lastIndex)
}

/** Remove a page break by its id (the between-pages "remove break" affordance keys on the page id,
 *  which for pages 2..N is the starting break's id). */
export function removePageBreak(pages: PageBreak[], pageBreakId: string): PageBreak[] {
   return pages.filter(pageBreak => pageBreak.id !== pageBreakId)
}

/** Array.prototype.findLastIndex, spelled out so the pure layer does not depend on the lib target. */
function findLastIndex<ItemType>(items: ItemType[], predicate: (item: ItemType) => boolean): number {
   for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index])) return index
   return -1
}

// ####################
// # START-ON-NEW-PAGE #
// ####################

// "Make block X start a fresh page" is expressed WITHOUT a new anchor direction: the model is after-only
// (a `before` anchor was deliberately migrated away, see documentMigration.ts), so starting X on a new
// page means a break AFTER X's flat predecessor. Each wrapper below is a predecessor lookup composed with
// an existing after-primitive, so all the idempotency and robustness of those primitives carry through
// for free. The flat flow is TOP-LEVEL blocks only (flattenBlocks does not descend into container
// columns), so a container inner block is never a target here.

/** The top-level block immediately before `blockId` in the flat flow, or null when `blockId` is the
 *  document's first top-level block (no predecessor to anchor after) or is not a top-level block at all
 *  (a container inner block is not in the flow). */
export function flatPredecessorBlockId(sections: Section[], blockId: string): string | null {
   const flat = flattenBlocks(sections)
   const index = flat.findIndex(entry => entry.block.id === blockId)
   if (index <= 0) return null   // -1 = not a top-level block, 0 = the first block (no predecessor)
   return flat[index - 1].block.id
}

/** Whether `blockId` can be made to start a fresh page: false for the document's first top-level block
 *  (nothing to anchor a break after) and for a non-top-level id, true otherwise. The mirror of
 *  `canBreakAfter`, which instead forbids the last block. */
export function canStartOnNewPage(sections: Section[], blockId: string): boolean {
   return flatPredecessorBlockId(sections, blockId) !== null
}

/** Whether a break already sits so `blockId` starts a fresh page, i.e. a break after its flat
 *  predecessor. False when `blockId` has no predecessor. */
export function blockStartsFreshPage(pages: PageBreak[], sections: Section[], blockId: string): boolean {
   const predecessor = flatPredecessorBlockId(sections, blockId)
   return predecessor !== null && hasPageBreakAfter(pages, predecessor)
}

/** Make `blockId` start a fresh page by adding a break after its flat predecessor. Returns `pages`
 *  unchanged when there is no predecessor (the first block already tops page 1). Idempotent through
 *  `addPageBreakAfter`. */
export function startBlockOnNewPage(pages: PageBreak[], sections: Section[], blockId: string): PageBreak[] {
   const predecessor = flatPredecessorBlockId(sections, blockId)
   if (predecessor === null) return pages
   return addPageBreakAfter(pages, sections, predecessor)
}

/** Merge `blockId` back onto the previous page by removing the break after its flat predecessor. Returns
 *  `pages` unchanged when there is no predecessor or no such break sits there. */
export function mergeBlockWithPrevious(pages: PageBreak[], sections: Section[], blockId: string): PageBreak[] {
   const predecessor = flatPredecessorBlockId(sections, blockId)
   if (predecessor === null) return pages
   return removePageBreakAfter(pages, predecessor)
}

// ###################
// # PAGE OPERATIONS #
// ###################

/**
 * The page-sorter's operations plus manual page creation: reorder, duplicate, delete, and insert a
 * blank page.
 *
 * These are the ONE place the paged format mutates the real Section/Block flow (everything else only
 * touches the break markers). The doctrine still holds: pages remain DERIVED from break markers, so
 * these operations work by (a) partitioning the flow into pages, (b) rearranging the pages' slice
 * groups (an arrayMove / clone / filter / splice over `PageSlice[][]`, where a blank page is an empty
 * group), then (c) reconstructing the flat Section[] from the new slice order AND recomputing the
 * break list so a re-partition yields exactly the intended page order, blank pages included.
 *
 * SECTION SPLITTING: because a page can be a mid-section slice, moving/duplicating/deleting pages can
 * leave a section's blocks non-contiguous, a genuine split. The reconstruction coalesces consecutive
 * slices of the same section back into one section (a section that merely SPANS a page break, or a
 * blank page, stays one section) and mints a FRESH section id only for a later, genuinely disconnected
 * fragment of an already-emitted section id (so section ids stay unique). Title/collapsed are carried
 * onto every fragment.
 */

/** Move an item within an array, matching dnd-kit's `arrayMove` (remove at `from`, insert at `to`).
 *  Kept local so pageModel stays dependency-free (no @dnd-kit import in the pure layer). */
function moveInArray<ItemType>(items: ItemType[], from: number, to: number): ItemType[] {
   const next = items.slice()
   const [moved] = next.splice(from, 1)
   next.splice(to, 0, moved)
   return next
}

/** The last actual block across a page's slices, or null when the page is blank. */
function lastBlockOfSlices(slices: PageSlice[]): Block | null {
   for (let index = slices.length - 1; index >= 0; index--) {
      const blocks = slices[index].blocks
      if (blocks.length > 0) return blocks[blocks.length - 1]
   }
   return null
}

/**
 * Rebuild a flat Section[] from an ordered slice sequence (the concatenation of the pages' slice
 * groups; blank pages contribute nothing). Consecutive slices of the same original section merge into
 * one section (keeping the first occurrence's id); a same-id section that reappears after a different
 * section intervened is a split fragment and gets a fresh id. Empty-section slices survive as empty
 * sections.
 */
function reconstructSections(slices: PageSlice[]): Section[] {
   const result: Section[] = []
   const usedSectionIds = new Set<string>()
   let currentOriginalId: string | null = null
   let currentTemplate: Section | null = null
   let currentBlocks: Block[] = []

   function flush(): void {
      if (currentTemplate === null) return
      let id = currentTemplate.id
      if (usedSectionIds.has(id)) id = crypto.randomUUID()   // a genuinely split fragment -> fresh id
      usedSectionIds.add(id)
      result.push({ ...currentTemplate, id, blocks: currentBlocks })
   }

   for (const slice of slices) {
      if (currentTemplate !== null && currentOriginalId === slice.section.id) {
         // Same section as the open run (a section spanning a page break, or contiguous slices).
         currentBlocks = [...currentBlocks, ...slice.blocks]
      } else {
         flush()
         currentOriginalId = slice.section.id
         currentTemplate   = slice.section
         currentBlocks     = [...slice.blocks]
      }
   }
   flush()
   return result
}

/** Recompute the break list for an ordered sequence of page slice-groups over the reconstructed
 *  sections. Page k (k >= 1) begins with a break AFTER the last block of the most recent non-blank
 *  page (or `after: null` when no content has appeared yet, a leading blank). A blank page carries the
 *  same anchor as its predecessor, so stacked blanks come out as stacked breaks. Fresh break ids. */
function breaksForPageGroups(pageGroups: PageSlice[][], sections: Section[]): PageBreak[] {
   const sectionIdByBlockId = new Map<string, string>()
   for (const section of sections)
      for (const block of section.blocks) sectionIdByBlockId.set(block.id, section.id)

   const breaks: PageBreak[] = []
   let lastContentBlock: Block | null = null
   for (let pageIndex = 0; pageIndex < pageGroups.length; pageIndex++) {
      if (pageIndex >= 1) {
         const anchor = lastContentBlock
            ? { sectionId: sectionIdByBlockId.get(lastContentBlock.id)!, blockId: lastContentBlock.id }
            : null
         breaks.push({ id: crypto.randomUUID(), after: anchor })
      }
      const last = lastBlockOfSlices(pageGroups[pageIndex])
      if (last) lastContentBlock = last
   }
   return breaks
}

/** Turn a rearranged sequence of page slice-groups into the committed `{ sections, pages }` pair. */
function buildFromPageGroups(pageGroups: PageSlice[][]): { sections: Section[]; pages: PageBreak[] } {
   const sections = reconstructSections(pageGroups.flat())
   const pages    = breaksForPageGroups(pageGroups, sections)
   return { sections, pages }
}

/** Deep-clone a page's slice group for duplication: fresh block ids (via `cloneBlock`) always, and a
 *  fresh section id ONLY for a section wholly contained on the duplicated page (an independent copy). A
 *  section that SPANS onto another page keeps its id so the copy merges back into it, rather than
 *  splitting the section and stranding a phantom titled fragment on the neighbouring page. */
function cloneSliceGroup(slices: PageSlice[]): PageSlice[] {
   const cloneSectionIdByOriginalId = new Map<string, string>()
   return slices.map(slice => {
      const wholeSectionOnPage = slice.isSectionStart && slice.isSectionEnd
      let cloneSectionId: string
      if (wholeSectionOnPage) {
         const existing = cloneSectionIdByOriginalId.get(slice.section.id)
         if (existing !== undefined) {
            cloneSectionId = existing
         } else {
            cloneSectionId = crypto.randomUUID()
            cloneSectionIdByOriginalId.set(slice.section.id, cloneSectionId)
         }
      } else {
         cloneSectionId = slice.section.id
      }
      return {
         section:        { ...slice.section, id: cloneSectionId, blocks: [] },
         blocks:         slice.blocks.map(cloneBlock),
         isSectionStart: slice.isSectionStart,
         isSectionEnd:   slice.isSectionEnd,
      }
   })
}

/**
 * Reorder pages: move the page at `fromPageIndex` to `toPageIndex` (dnd-kit `arrayMove` semantics),
 * which moves that page's block range within the flat flow and re-derives the break markers so the
 * pages come out in the new order. Pure; returns the SAME `sections`/`pages` references on a no-op
 * (equal or out-of-range indices).
 */
export function reorderPages(
   sections: Section[], pages: PageBreak[], fromPageIndex: number, toPageIndex: number,
): { sections: Section[]; pages: PageBreak[] } {
   const derived = partitionIntoPages(sections, pages)
   if (fromPageIndex === toPageIndex) return { sections, pages }
   if (fromPageIndex < 0 || fromPageIndex >= derived.length) return { sections, pages }
   if (toPageIndex   < 0 || toPageIndex   >= derived.length) return { sections, pages }
   const pageGroups = moveInArray(derived.map(page => page.slices), fromPageIndex, toPageIndex)
   return buildFromPageGroups(pageGroups)
}

/**
 * Duplicate the page at `pageIndex`: insert a clone (fresh block + section ids) as a new page directly
 * after it, re-deriving the break markers. A blank page duplicates to another blank page. Pure; no-op
 * (same references) on an out-of-range index.
 */
export function duplicatePage(
   sections: Section[], pages: PageBreak[], pageIndex: number,
): { sections: Section[]; pages: PageBreak[] } {
   const derived = partitionIntoPages(sections, pages)
   if (pageIndex < 0 || pageIndex >= derived.length) return { sections, pages }
   const groups     = derived.map(page => page.slices)
   const cloneGroup = cloneSliceGroup(derived[pageIndex].slices)
   const pageGroups = [...groups.slice(0, pageIndex + 1), cloneGroup, ...groups.slice(pageIndex + 1)]
   return buildFromPageGroups(pageGroups)
}

/**
 * Delete the page at `pageIndex`: drop that page's blocks from the flow (whole sections wholly on the
 * page vanish; a section split across it keeps its other slices, which re-coalesce) and re-derive the
 * break markers. Pure; no-op (same references) on an out-of-range index or when only one page exists
 * (deleting the sole page would empty the document, the sorter guards this too).
 */
export function deletePage(
   sections: Section[], pages: PageBreak[], pageIndex: number,
): { sections: Section[]; pages: PageBreak[] } {
   const derived = partitionIntoPages(sections, pages)
   if (derived.length <= 1) return { sections, pages }
   if (pageIndex < 0 || pageIndex >= derived.length) return { sections, pages }
   const pageGroups = derived.map(page => page.slices).filter((_group, index) => index !== pageIndex)
   return buildFromPageGroups(pageGroups)
}

/**
 * Insert a blank page immediately after the page at `pageIndex`, re-deriving the break markers. This
 * is manual page creation: appending (pageIndex = last page) makes a trailing blank; inserting in the
 * middle stacks a blank between two content pages. Pure; no-op (same references) on an out-of-range
 * index.
 */
export function insertBlankPageAfter(
   sections: Section[], pages: PageBreak[], pageIndex: number,
): { sections: Section[]; pages: PageBreak[] } {
   const derived = partitionIntoPages(sections, pages)
   if (pageIndex < 0 || pageIndex >= derived.length) return { sections, pages }
   const groups     = derived.map(page => page.slices)
   const pageGroups = [...groups.slice(0, pageIndex + 1), [], ...groups.slice(pageIndex + 1)]
   return buildFromPageGroups(pageGroups)
}

/**
 * Move a top-level block onto the blank page at `pageIndex`, making it that page's only content. The
 * block is pulled from wherever it lives (its old slice is dropped if the move empties it) and becomes
 * a lone slice on the target page. No-op (same references) when the target is not a blank page or the
 * block is not a top-level block (a container inner block is not a page-level target).
 */
export function placeBlockOnBlankPage(
   sections: Section[], pages: PageBreak[], pageIndex: number, blockId: string,
): { sections: Section[]; pages: PageBreak[] } {
   const derived = partitionIntoPages(sections, pages)
   if (pageIndex < 0 || pageIndex >= derived.length) return { sections, pages }
   if (derived[pageIndex].slices.length !== 0) return { sections, pages }   // only onto a blank page

   let owner: Section | undefined
   let moved: Block | undefined
   for (const section of sections) {
      const block = section.blocks.find(candidate => candidate.id === blockId)
      if (block) { owner = section; moved = block; break }
   }
   if (!owner || !moved) return { sections, pages }

   // Pull the block from its slice; drop that slice if the removal empties it (only the block's own
   // slice ever changes, so original empty-section slices are untouched).
   const groups = derived.map(page => page.slices.flatMap(slice => {
      if (!slice.blocks.some(candidate => candidate.id === blockId)) return [slice]
      const remaining = slice.blocks.filter(candidate => candidate.id !== blockId)
      return remaining.length > 0 ? [{ ...slice, blocks: remaining }] : []
   }))
   groups[pageIndex] = [{ section: owner, blocks: [moved], isSectionStart: true, isSectionEnd: true }]
   return buildFromPageGroups(groups)
}

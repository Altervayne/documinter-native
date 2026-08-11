/**
 * The measured paginator for the paged (A4) format: automatic reflow.
 *
 * `pageModel.partitionIntoPages` cuts the flat block flow at EXPLICIT breaks only, so a paragraph or
 * list that runs past the bottom of a sheet is forced whole onto the next one, leaving a blank gap
 * (and a single block taller than the page dead-ends). This module fills that gap: given the rendered
 * HEIGHTS of the content (measured from the DOM, never predicted) plus the available content height,
 * it greedily fills each sheet and, when a `list`/`checklist` block would overrun, splits it at the
 * last root item that fits and continues the remainder on the next sheet. A `p` block splits the same
 * way at a rendered-line boundary (when its per-line metrics are known and it is not held atomic).
 * Other block types stay atomic (moved whole to the next sheet, or left to overflow when taller than a
 * whole page).
 *
 * Reflow is a LAYOUT DERIVATION, never a model mutation: the Section/Block flow is untouched. A
 * spanning list is expressed as SHALLOW-COPIED list blocks whose `items` hold only that page's slice,
 * and a spanning paragraph as shallow `p` blocks whose `richText` holds only that page's char slice, so
 * the existing slice renderers (editor `renderPageSlice`, export `exportBlock`) need no
 * fragment-awareness; a continuation simply renders as another `<ul>` or `<p>`.
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
import { splitInlineContent } from './inline'
import { DEFAULT_A4_MARGINS, type DocFormat, type PageBreak } from './format'
import type { Page, PageSlice } from './pageModel'
import { FIRST_PAGE_ID, A4_PORTRAIT_WIDTH_PX, A4_LANDSCAPE_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_HEIGHT_PX, millimetresToPx } from './pageModel'

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

/** One rendered visual line of a splittable paragraph: the height it consumes and the char offset at
 *  its END, measured over the paragraph's OWN richText (so a split after this line cuts the richText at
 *  `charEnd`). `charEnd` counts every character, with `\n` (a `<br>`) as one, matching splitInlineContent. */
export interface ParagraphLine {
   height:  number
   charEnd: number
}

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
   /** For a splittable `p` block, its rendered lines in order (height + end char offset each); `null`
    *  for any other block type, and for a `p` not measured yet (kept atomic until its lines are known). */
   paragraphLines: (blockId: string) => ParagraphLine[] | null
}

/**
 * The rendered heights read from the DOM (CSS px), keyed by stable model id so they survive
 * re-pagination (a split changes which sheet a unit sits on, never its width, hence never its height).
 * The offscreen measurement pass (`measureHeightsFromContainer`, driven by `computeDocumentPages` in
 * lib/exportLayout) produces this; `buildMetrics` turns it into a `LayoutMetrics`. Kept here (pure) so
 * the one paginator that every surface draws from builds the SAME metrics and paginates identically.
 */
export interface MeasuredHeights {
   header:             number
   titleBySection:     Map<string, number>
   blockById:          Map<string, number>
   listItemById:       Map<string, number>
   paragraphLinesById: Map<string, ParagraphLine[]>
}

export const EMPTY_HEIGHTS: MeasuredHeights = {
   header: 0, titleBySection: new Map(), blockById: new Map(), listItemById: new Map(),
   paragraphLinesById: new Map(),
}

/**
 * Build the paginator's height oracle from measured heights and the model (which names the splittable
 * list blocks and their root item ids). An unmeasured item (a freshly added one, before the next
 * measure) is ESTIMATED from the average of the list's measured items, so adding an item keeps the
 * existing split stable instead of flashing the whole list back onto one page. A list with ZERO
 * measured items stays atomic (the one-time bootstrap before the first measure).
 */
export function buildMetrics(heights: MeasuredHeights, sections: Section[]): LayoutMetrics {
   const listRootItemIds = new Map<string, string[]>()
   const paragraphBlockIds = new Set<string>()
   // Model char count per top-level `p` block, so measured lines whose total no longer matches (an edit
   // landed since the last measure) can be rejected as stale rather than slicing at the wrong offsets.
   const paragraphCharCount = new Map<string, number>()
   for (const section of sections)
      for (const block of section.blocks) {
         if ((block.type === 'list' || block.type === 'checklist') && block.items && block.items.length > 0)
            listRootItemIds.set(block.id, block.items.map(item => item.id))
         if (block.type === 'p') {
            paragraphBlockIds.add(block.id)
            paragraphCharCount.set(block.id, (block.richText ?? []).reduce((sum, run) => sum + run.text.length, 0))
         }
      }

   return {
      headerHeight:       heights.header,
      sectionTitleHeight: (sectionId) => heights.titleBySection.get(sectionId) ?? 0,
      blockHeight:        (blockId) => heights.blockById.get(blockId) ?? 0,
      listItemHeights:    (blockId) => {
         const rootIds = listRootItemIds.get(blockId)
         if (!rootIds) return null
         const measured = rootIds.map(itemId => heights.listItemById.get(itemId))
         const known = measured.filter((height): height is number => height !== undefined)
         if (known.length === 0) return null
         const average = known.reduce((sum, height) => sum + height, 0) / known.length
         return measured.map(height => height ?? average)
      },
      paragraphLines:     (blockId) => {
         // Only a `p` block splits; and only once its lines are measured. A freshly typed paragraph
         // with no measured lines stays atomic (null) so it is never split at a stale offset.
         if (!paragraphBlockIds.has(blockId)) return null
         const lines = heights.paragraphLinesById.get(blockId)
         if (!lines || lines.length === 0) return null
         // The last measured line ends at the paragraph's char count AT MEASURE TIME. If the model no
         // longer holds that many chars the measurement predates the current text, so keep the block
         // whole (return null) until the next measure re-reads it, rather than slicing at stale offsets
         // that would drop or misplace characters.
         const measuredTotal = lines[lines.length - 1].charEnd
         const modelTotal    = paragraphCharCount.get(blockId) ?? measuredTotal
         if (measuredTotal !== modelTotal) return null
         return lines
      },
   }
}

/** Every `p` block id in the flow (walking container columns too). Fed to `paginate` as its atomic set
 *  by the editor and Pages panel so paragraphs render WHOLE there, while export passes an empty set so
 *  they split across sheets. */
export function allParagraphIds(sections: Section[]): Set<string> {
   const ids = new Set<string>()
   function walk(blocks: Block[]): void {
      for (const block of blocks) {
         if (block.type === 'p') ids.add(block.id)
         if (block.left)  walk(block.left)
         if (block.right) walk(block.right)
      }
   }
   for (const section of sections) walk(section.blocks)
   return ids
}

/**
 * Reconcile a re-measure pass's paragraph line data with the previous pass. For every paragraph still
 * in the model, keep a freshly measured set when one is available (the paragraph rendered whole with a
 * live rich-text element and produced at least one line), otherwise CARRY FORWARD the previous pass's
 * lines. Two cases depend on this: a paragraph split at rest renders as read-only fragments with no
 * measurable element, so it never has a fresh measurement and must retain its last whole-render lines;
 * and a whole render can momentarily report zero line boxes (an element not yet laid out), which must
 * not wipe good data either. Carrying stale lines is safe because the buildMetrics length guard keeps
 * the paragraph whole until a fresh measurement lands whenever an edit has changed its char count.
 * Only ids in `paragraphIds` (the current model paragraphs) are carried, so a removed paragraph's lines
 * are dropped. Pure so the measure hook and its tests share the exact retention rule.
 */
export function reconcileParagraphLines(
   paragraphIds:  Iterable<string>,
   freshLines:    Map<string, ParagraphLine[]>,
   previousLines: Map<string, ParagraphLine[]>,
): Map<string, ParagraphLine[]> {
   const result = new Map<string, ParagraphLine[]>()
   for (const blockId of paragraphIds) {
      const fresh = freshLines.get(blockId)
      if (fresh && fresh.length > 0) { result.set(blockId, fresh); continue }
      const carried = previousLines.get(blockId)
      if (carried && carried.length > 0) result.set(blockId, carried)
   }
   return result
}

/** The A4 content-box height (sheet height minus top/bottom margins) for a format, in CSS px. The true
 *  content box; the print sheet's `.doc-render` fills exactly this. */
export function contentBoxHeightPx(format: DocFormat | undefined): number {
   const sheetHeight = format?.kind === 'a4-landscape' ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX
   const margins = format?.margins ?? DEFAULT_A4_MARGINS
   return sheetHeight - millimetresToPx(margins.top) - millimetresToPx(margins.bottom)
}

/** A slack band left UNFILLED at the bottom of every auto-flowed sheet. A manually placed break (the old
 *  out-of-bounds "cut here") always left room below its last block, so its page never filled to the brim
 *  and never clipped in print. The measured paginator instead fills each sheet to the exact content box,
 *  and in print that razor's-edge packing clips: a printed sheet holds a hair LESS than the CSS math
 *  says (per-line sub-pixel rounding accumulated over a full page, font-metric drift between the
 *  off-screen measurement and the print render, Chrome's per-sheet `100vh` rounding), and a page filled
 *  to the brim spills past the fixed `height:100vh; overflow:hidden` sheet so the tail is silently cut.
 *  Reserving this band gives every auto page the same breathing room a manual break always had. Sized to
 *  cover a splittable block's own bottom margin (which the line/item sums omit) plus a line of drift. */
export const PAGE_FILL_RESERVE_PX = 40

/** The height the paginator may fill on one sheet: the content box minus the slack band, so auto pages
 *  keep the breathing room manual breaks always had and never pack to the razor's edge the print sheet
 *  cannot hold. There is now exactly ONE paginator (computeDocumentPages), so this single budget shapes
 *  every surface at once: editor, Pages panel, Preview, and the PDF/HTML export can never disagree. */
export function paginationBudgetPx(format: DocFormat | undefined): number {
   return Math.max(0, contentBoxHeightPx(format) - PAGE_FILL_RESERVE_PX)
}

/**
 * The A4 content-box WIDTH (sheet width minus left/right margins) for a paged format, in CSS px. This is
 * the width text wraps at on a paged sheet, and the SAME width the offscreen export measurement renders
 * its content at, so both the editor sheet and the export measure heights over one width. An infinite (or
 * absent) format has no fixed sheet width, so it returns 0: the paged measurement never calls it there
 * (an infinite export is not paginated), and 0 is an explicit "no paged width" sentinel. Kept beside
 * contentBoxHeightPx so the paged width and height come from one place and the width-parity guard test can
 * pin the measurement width to the rendered sheet width.
 */
export function contentBoxWidthPx(format: DocFormat | undefined): number {
   if (!format || format.kind === 'infinite') return 0
   const sheetWidth = format.kind === 'a4-landscape' ? A4_LANDSCAPE_WIDTH_PX : A4_PORTRAIT_WIDTH_PX
   const margins = format.margins ?? DEFAULT_A4_MARGINS
   return sheetWidth - millimetresToPx(margins.left) - millimetresToPx(margins.right)
}

// ##########
// # HELPERS #
// ##########

/** A shallow render-copy of a list block carrying only its root items `[start, end)`. Same block id
 *  (page-scoped queries keep it unambiguous); the model list is never mutated. */
function sliceListBlock(block: Block, start: number, end: number): Block {
   return { ...block, items: (block.items ?? []).slice(start, end) }
}

/** A shallow render-copy of a `p` block whose richText is the `[charStart, charEnd)` slice of the model
 *  richText, tagged with its fragment range for the renderer. Same block id; the model block is never
 *  mutated. `paragraphFragment` is transient (render-only) and never serialized. */
function sliceParagraphBlock(block: Block, charStart: number, charEnd: number, isTail: boolean): Block {
   const [, fromStart] = splitInlineContent(block.richText ?? [], charStart)
   const [slice]       = splitInlineContent(fromStart, charEnd - charStart)
   return { ...block, richText: slice, paragraphFragment: { charStart, charEnd, isTail } }
}

// ##############
// # PAGINATE   #
// ##############

/**
 * Lay the section/block flow out into height-fitted pages. Honours explicit breaks exactly like
 * `partitionIntoPages` (leading `after:null` breaks are blank pages, breaks stacked on one anchor are
 * consecutive blanks), then auto-flows the content between them so nothing overruns a sheet. Always
 * returns at least one page. Pure: it re-references the same Block objects (list / paragraph fragments
 * are shallow copies) and never mutates `sections`. A `p` block whose id is in `atomicBlockIds` (or
 * whose lines are unmeasured) stays whole; otherwise it splits across sheets at a line boundary.
 */
export function paginate(
   sections:        Section[],
   forcedBreaks:    PageBreak[],
   availableHeight: number,
   metrics:         LayoutMetrics,
   atomicBlockIds:  Set<string> = new Set(),
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

   // ####################
   // # KEEP-WITH-NEXT   #
   // ####################

   // A heading is a keeper: it reads as a label for whatever follows, so it must never sit alone at a
   // page bottom with its body on the next sheet. Section titles (h2) are keepers too, handled inline.
   function isHeadingType(block: Block): boolean {
      return block.type === 'h3' || block.type === 'h4'
   }

   // A block that must be placed WHOLE, never split. Two sources feed it: `atomicBlockIds` (the editor
   // holds the focused paragraph whole while it is being typed) and the persisted `keepTogether` flag
   // (an author choosing to keep a paragraph / list on one page). Reading both here means editor and
   // export honour the model flag identically, since the flag rides on the block, not on a caller.
   function isHeldAtomic(block: Block): boolean {
      return atomicBlockIds.has(block.id) || block.keepTogether === true
   }

   // The smallest indivisible leading piece of a block that has to travel with a keeper above it. For a
   // splittable list it is the first item, for a splittable paragraph the first line (and I reserve the
   // second line too when it exists, so a heading is never followed by one dangling line then a break),
   // and for anything atomic the whole height (an atomic block cannot be placed in pieces). Reserving one
   // atom is enough because the split loops are guaranteed to place at least that atom once its room is
   // held, which keeps the reservation self-consistent with placement.
   function firstAtomHeight(block: Block): number {
      // A held block (keep-together, or atomic in the editor) is never placed in pieces, so as a keeper's
      // companion it reserves its WHOLE height, not a first item / line. Checked first so a held list is
      // held whole too, not reserved by its first item.
      if (isHeldAtomic(block)) return metrics.blockHeight(block.id)
      const items = metrics.listItemHeights(block.id)
      if (items && items.length > 0) return items[0]
      const lines = metrics.paragraphLines(block.id)
      if (lines && lines.length > 0)
         return lines.length > 1 ? lines[0].height + lines[1].height : lines[0].height
      return metrics.blockHeight(block.id)
   }

   // Extra height that must stay on the same sheet as a keeper placed just before `blocks[index]`. I chain
   // through a run of consecutive headings so the first heading keeps the whole cluster, and I stop the
   // chain at a heading the author pinned with a forced break (it keeps only itself, so keep-with-next
   // never silently undoes an explicit break). Bounded by the finite block run; 0 past the end.
   function trailingKeepHeight(blocks: Block[], index: number): number {
      if (index >= blocks.length) return 0
      const next = blocks[index]
      if (isHeadingType(next) && !breaksAfterBlockId.has(next.id))
         return metrics.blockHeight(next.id) + trailingKeepHeight(blocks, index + 1)
      return firstAtomHeight(next)
   }

   const pages: Page[] = []
   let pageId = FIRST_PAGE_ID
   let pageOrigin: Page['origin'] = 'first'
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
   // `origin` records how the new page came to exist (see Page.origin), stamped at creation time.
   function startPage(nextId: string, continuation: boolean, origin: Page['origin']): void {
      pages.push({ id: pageId, slices, origin: pageOrigin })
      pageId = nextId
      pageOrigin = origin
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
   // (a following section pushed down because its title would not fit). The `continuation` flag doubles as
   // the origin signal: a continuation page carries a block flowing off the previous sheet, while a
   // non-continuation auto page STARTS fresh content (a section push / empty section / keep-with-next).
   function autoBreak(nextStartKey: string, continuation: boolean): void {
      startPage(`${AUTO_PAGE_PREFIX}${nextStartKey}`, continuation, continuation ? 'continuation' : 'auto-start')
   }

   // Leading blank pages: each closes the current (empty) page and opens the next. These come from
   // explicit break markers, so they are `manual`.
   for (const pageBreak of leadingBreaks) startPage(pageBreak.id, false, 'manual')

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
            if (isStart) {
               // A section title is a keeper: never leave it stranded at a page bottom while its first
               // block flows onto the next sheet. I keep the original title-alone break (a fresh page is
               // strictly better when even the title cannot fit) and add keep-with-next only when the
               // title plus its first atom could actually fit a fresh page, else a break just re-orphans
               // the pair one sheet later.
               const titleHeight     = metrics.sectionTitleHeight(section.id)
               const need            = titleHeight + trailingKeepHeight(section.blocks, 0)
               const breakForTitle   = titleHeight > remaining()
               const breakForKeeping = need <= availableHeight && need > remaining()
               if (used > 0 && (breakForTitle || breakForKeeping)) {
                  // Push the whole section start to a new page.
                  autoBreak(`section-${section.id}`, false)
               }
            }
            openSlice = { section, blocks: [], isSectionStart: isStart, isSectionEnd: false }
            slices.push(openSlice)
            if (isStart) used += metrics.sectionTitleHeight(section.id)
         }

         const keepWith = ((isHeadingType(block) || block.keepWithNext === true) && !breaksAfterBlockId.has(block.id))
            ? trailingKeepHeight(section.blocks, blockIndex + 1)
            : 0
         placeBlock(block, keepWith)
         placedAnyBlockOfSection = true
         if (blockIndex === section.blocks.length - 1 && openSlice) openSlice.isSectionEnd = true

         // Explicit break(s) after this block: the first starts the next content page, extras are blanks.
         // Both are author-made, so `manual`.
         const cuts = breaksAfterBlockId.get(block.id)
         if (cuts) {
            for (const pageBreak of cuts) startPage(pageBreak.id, false, 'manual')
            openSlice = null
         }
      })
   }

   pages.push({ id: pageId, slices, origin: pageOrigin })
   return pages

   // Place one block on the current page, auto-breaking (and, for a splittable list or paragraph,
   // splitting) so it fits. `openSlice` is guaranteed non-null on entry. `keepWith` is the height that
   // must stay on this sheet with `block` (its keep-with-next companion): non-zero for a heading or a
   // block the author flagged keepWithNext, 0 for every other block, so unflagged non-heading placement is
   // byte-identical to before.
   function placeBlock(block: Block, keepWith: number): void {
      const itemHeights    = metrics.listItemHeights(block.id)
      const paragraphLines = metrics.paragraphLines(block.id)
      // A paragraph splits only when its lines are known AND it is not held whole (the editor / Pages
      // panel pass every paragraph id as atomic so they render whole; export passes none; a keepTogether
      // paragraph is held whole in both).
      const splitParagraph = !!paragraphLines && paragraphLines.length > 0 && !isHeldAtomic(block)

      // Manual keep-with-next for a SPLITTABLE keeper (a paragraph or list the user pinned to travel with
      // the block after it; the atomic branch already handles atomic keepers). The common case is a short
      // block that fits whole but whose companion would not fit after it: break so the pair starts a fresh
      // page together. Uses the block's whole height, so a block long enough to actually split still spans
      // pages (its tail is best-effort, I never manufacture a widow to force it). keepWith is 0 for any
      // block without the flag, and used > 0 gates the loop, so this is inert otherwise. After autoBreak
      // resets used to 0 the used > 0 guard is false, so it can never double-break.
      const isSplittableList = !!itemHeights && itemHeights.length > 0
      if (keepWith > 0 && used > 0 && !isHeldAtomic(block) && (splitParagraph || isSplittableList)) {
         const wholeHeight = metrics.blockHeight(block.id)
         if (wholeHeight + keepWith > remaining() && wholeHeight + keepWith <= availableHeight) autoBreak(block.id, true)
      }

      if (splitParagraph) {
         // Splittable paragraph: fill rendered lines across pages, cutting the richText at the char
         // offset ending the last line that fits. Continuation page keys use a continuation ORDINAL
         // (not the line index) so nudging the boundary while typing keeps the key stable, exactly like
         // the list branch below.
         const lines = paragraphLines!
         // The block's own top+bottom margin, backed out of its whole-block height minus its line sum
         // (blockHeight already includes it, same as the atomic branch below; the line sum does not, since
         // each ParagraphLine is a bare rendered-line height). It is bottom-only in the stylesheet, so it
         // belongs on the LAST page the paragraph occupies, never a mid-split page.
         const totalLineHeight = lines.reduce((accumulator, line) => accumulator + line.height, 0)
         const paragraphMargin = Math.max(0, metrics.blockHeight(block.id) - totalLineHeight)
         let startLine    = 0
         let charStart    = 0
         let continuation = 0
         while (startLine < lines.length) {
            let endLine = startLine
            let sum     = 0
            for (let index = startLine; index < lines.length; index += 1) {
               const next = sum + lines[index].height
               // Stop before the first line that crosses the boundary, but always take at least one line
               // when the page is otherwise empty (else an oversized line would loop forever).
               if (next > remaining() && (index > startLine || used > 0)) break
               sum = next
               endLine = index + 1
            }

            if (endLine === startLine) {
               autoBreak(`${block.id}:c${continuation}`, true)
               continuation += 1
               continue
            }

            const charEnd = lines[endLine - 1].charEnd
            const isTail  = endLine === lines.length
            // A single piece covering the whole richText means the paragraph fit without an auto-break:
            // it is NOT split, so push the ORIGINAL untagged block (which renders as a normal editable
            // paragraph). Only a genuine cross-page piece carries a `paragraphFragment` tag (which forces
            // the read-only fragment rendering). A paragraph pushed whole onto a fresh continuation page
            // still counts as whole here.
            const whole = charStart === 0 && endLine === lines.length
            openSlice!.blocks.push(whole ? block : sliceParagraphBlock(block, charStart, charEnd, isTail))
            used += sum
            // The tail piece (the one ending the paragraph) also spends the block's own margin, matching
            // the atomic branch's full blockHeight; a mid-block piece adds none (its break is not a real
            // margin, the paragraph keeps flowing).
            if (isTail) used += paragraphMargin
            charStart = charEnd
            startLine = endLine
            if (startLine < lines.length) {
               autoBreak(`${block.id}:c${continuation}`, true)
               continuation += 1
            }
         }
         return
      }

      if (!itemHeights || itemHeights.length === 0 || isHeldAtomic(block)) {
         // Atomic block: keep it whole. A splittable list held whole (keepTogether) also lands here, so it
         // is placed via its whole-list `blockHeight` instead of the item-split loop below. Move to a fresh
         // page when it (plus any keep-with-next companion)
         // does not fit under existing content; if it does not fit even on an empty page it is simply
         // taller than the page, place it anyway (the sheet clips it in print, exactly the pre-reflow
         // "too tall" case). I only break for a companion when the pair could fit a fresh page at all,
         // else a break re-orphans the keeper one sheet later. keepWith === 0 for every non-heading
         // block, so this reduces to the original height-only test and stays byte-identical there.
         const height        = metrics.blockHeight(block.id)
         const need          = height + keepWith
         const worthBreaking = keepWith === 0 || need <= availableHeight
         if (used > 0 && need > remaining() && worthBreaking) autoBreak(block.id, true)
         openSlice!.blocks.push(block)
         used += height
         return
      }

      // Splittable list: fill root items across pages, splitting at the last item that fits. The
      // continuation page key is the block id plus a continuation ORDINAL (0, 1, 2...), not the split
      // item index, so nudging the boundary by an item while typing keeps the same page key and never
      // remounts the continuation subtree (which would jump the caret and jitter the canvas).
      // The block's own top+bottom margin, backed out of its whole-block height minus its item sum, the
      // same reasoning as paragraphMargin above: blockHeight already counts it, the per-item sum does not.
      const totalItemHeight = itemHeights.reduce((accumulator, height) => accumulator + height, 0)
      const listMargin      = Math.max(0, metrics.blockHeight(block.id) - totalItemHeight)
      let start = 0
      let continuation = 0
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
            autoBreak(`${block.id}:c${continuation}`, true)
            continuation += 1
            continue
         }

         openSlice!.blocks.push(sliceListBlock(block, start, end))
         used += sum
         // The tail item piece (the one ending the list) also spends the block's own margin, matching the
         // atomic branch's full blockHeight; a mid-list piece adds none (the list keeps flowing).
         if (end === itemHeights.length) used += listMargin
         start = end
         if (start < itemHeights.length) {
            autoBreak(`${block.id}:c${continuation}`, true)
            continuation += 1
         }
      }
   }
}

// ####################
// # DOCUMENT LAYOUT  #
// ####################

/** One deterministic layout result: the paginated pages, the ids of pages whose single atomic block is
 *  taller than the physical sheet, and the measured heights the layout came from. Pages and too-tall ids
 *  are computed from the SAME heights, so a caller reading the too-tall note can never disagree with the
 *  pages it is annotating. `heights` is carried so App can cache the offscreen measurement pass's heights
 *  and re-paginate synchronously from them on every render. */
export interface DocumentPages { pages: Page[]; tooTallPageIds: Set<string>; heights: MeasuredHeights }

/**
 * The ids of pages whose ENTIRE content is a single block that cannot fit the physical sheet and cannot
 * reflow off it: only then can auto-reflow do nothing, so the editor notes it. A paragraph or list is
 * splittable, so it spans as many sheets as it needs and is NEVER too tall, UNLESS the author pinned it
 * whole with keepTogether (then it is atomic and can genuinely overflow one sheet). Every other block
 * type is inherently atomic. This is why the note no longer fires on each sheet a long paragraph flows
 * across: a spanning paragraph renders as same-id fragments, and a splittable fragment is skipped here.
 *
 * Measured against the TRUE `contentBoxHeightPx`, not the smaller pagination budget: too-tall is about
 * whether a block fits the real sheet, so the reserved slack band must not count against it. Flagged
 * against the SAME heights that produced `pages`, so the editor's too-tall note can never disagree with
 * the layout it annotates.
 */
export function findTooTallPageIds(pages: Page[], heights: MeasuredHeights, contentBoxHeight: number): Set<string> {
   const tooTall = new Set<string>()
   if (!(contentBoxHeight > 0)) return tooTall
   for (const page of pages) {
      const blocks = page.slices.flatMap(slice => slice.blocks)
      if (blocks.length !== 1) continue
      const only = blocks[0]
      // A splittable block (paragraph / list) reflows across sheets on its own, so it is never too tall
      // unless the author held it whole with keepTogether. Skip the reflowing case entirely.
      const splittable = only.type === 'p' || only.type === 'list' || only.type === 'checklist'
      if (splittable && only.keepTogether !== true) continue
      const height = heights.blockById.get(only.id)
      if (height !== undefined && height > contentBoxHeight) tooTall.add(page.id)
   }
   return tooTall
}

/**
 * Paginate a whole document from cached measured heights: the ONE budgeted, empty-atomic-set pagination
 * every on-screen surface and the export share. Pure arithmetic (no DOM, microseconds even for large
 * docs), so App calls it synchronously during render and the export calls it right after measuring fresh
 * heights; both go through this single call site, so the editor canvas, Pages panel, Preview, and the
 * PDF/HTML export can never diverge. Heights are per-block and width-stable, so after a structural edit
 * the surviving blocks keep their correct heights and re-paginate instantly; a brand-new block measures
 * 0 until the next measure lands (buildMetrics estimates/guards these), which is the optimism we want.
 */
export function paginateDocument(sections: Section[], format: DocFormat | undefined, heights: MeasuredHeights): DocumentPages {
   const metrics        = buildMetrics(heights, sections)
   const pages          = paginate(sections, format?.pages ?? [], paginationBudgetPx(format), metrics, new Set())
   const tooTallPageIds = findTooTallPageIds(pages, heights, contentBoxHeightPx(format))
   return { pages, tooTallPageIds, heights }
}

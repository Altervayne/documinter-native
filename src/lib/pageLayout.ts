/*
 * The measured paginator for the paged (A4) format: automatic reflow. partitionIntoPages cuts at
 * EXPLICIT breaks only, so a paragraph or list running past a sheet is forced whole onto the next,
 * leaving a gap. This module fills it: given the rendered HEIGHTS of the content (measured from the DOM,
 * never predicted) plus the available height, it greedily fills each sheet and splits a `list`/
 * `checklist` at the last root item that fits, a `p` at a rendered-line boundary (when its lines are
 * known and it is not held atomic). Other block types stay atomic.
 *
 * Reflow is a LAYOUT DERIVATION, never a model mutation: a spanning list is expressed as shallow-copied
 * list blocks holding only that page's item slice, a spanning paragraph as shallow `p` blocks holding
 * only that page's char slice, so the existing slice renderers need no fragment-awareness.
 *
 * Heights are width-stable (they depend only on content width, not where the break lands), so the caller
 * measures once per content version and this re-paginates purely, no feedback loop. Explicit breaks
 * still win; auto-flow only fills the space between them. Auto pages carry a synthetic id
 * (`AUTO_PAGE_PREFIX`) so the editor can tell a continuation sheet from an author-made one.
 */

import type { Block, Section } from '../types'
import { splitInlineContent } from './inline'
import { DEFAULT_A4_MARGINS, type DocFormat, type PageBreak } from './format'
import type { Page, PageSlice } from './pageModel'
import { FIRST_PAGE_ID, A4_PORTRAIT_WIDTH_PX, A4_LANDSCAPE_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_HEIGHT_PX, millimetresToPx } from './pageModel'

// #############
// # CONSTANTS #
// #############

// Auto (continuation) page ids carry this prefix, distinct from FIRST_PAGE_ID and PageBreak UUIDs. Lets
// the editor treat a continuation sheet as non-operable, and keeps React keys stable across re-measures
// (the id is derived from the content that starts the page).
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
 * The height oracle the paginator reads, in CSS px, supplied by the measuring hook from the real DOM.
 * Every height INCLUDES the element's own top + bottom margin, so summing consumed heights approximates
 * the rendered stack; a small over/under-estimate at a page seam is acceptable.
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
 * re-pagination (a split never changes a unit's width, hence never its height). The offscreen
 * measurement pass produces this; `buildMetrics` turns it into a `LayoutMetrics`.
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
 * list blocks and their root item ids). An unmeasured item (freshly added, before the next measure) is
 * ESTIMATED from the average of the list's measured items, so adding an item keeps the split stable
 * instead of flashing the list back onto one page. A list with ZERO measured items stays atomic.
 */
export function buildMetrics(heights: MeasuredHeights, sections: Section[]): LayoutMetrics {
   const listRootItemIds = new Map<string, string[]>()
   const paragraphBlockIds = new Set<string>()
   // Model char count per `p` block, so measured lines whose total no longer matches (an edit landed) are
   // rejected as stale rather than sliced at wrong offsets.
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
         // Only a `p` block splits, and only once its lines are measured (else it stays atomic).
         if (!paragraphBlockIds.has(blockId)) return null
         const lines = heights.paragraphLinesById.get(blockId)
         if (!lines || lines.length === 0) return null
         // The last line ends at the char count AT MEASURE TIME; if the model no longer holds that many
         // chars the measurement is stale, so keep the block whole until the next measure re-reads it.
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
 * Reconcile a re-measure pass's paragraph line data with the previous pass: keep a fresh set when one is
 * available, otherwise CARRY FORWARD the previous lines. Two cases need this: a paragraph split at rest
 * renders as read-only fragments with no measurable element (so it never re-measures and must keep its
 * last whole-render lines), and a whole render can momentarily report zero line boxes. Carrying stale
 * lines is safe because the buildMetrics length guard keeps the paragraph whole until a fresh
 * measurement lands after an edit. Only ids in `paragraphIds` are carried, so a removed paragraph drops.
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

/** A slack band left UNFILLED at the bottom of every auto-flowed sheet. Packing a sheet to the exact
 *  content box clips in print: a printed sheet holds a hair LESS than the CSS math says (sub-pixel line
 *  rounding over a page, font-metric drift between measurement and print, Chrome's `100vh` rounding), and
 *  a brim-full page spills past the fixed `height:100vh; overflow:hidden` sheet so the tail is cut.
 *  Reserving this gives every auto page breathing room; sized to cover a splittable block's own bottom
 *  margin (the line/item sums omit it) plus a line of drift. */
export const PAGE_FILL_RESERVE_PX = 40

/** The height the paginator may fill on one sheet: the content box minus the slack band. One budget
 *  shapes every surface (editor, Pages panel, Preview, export), so they can never disagree. */
export function paginationBudgetPx(format: DocFormat | undefined): number {
   return Math.max(0, contentBoxHeightPx(format) - PAGE_FILL_RESERVE_PX)
}

/**
 * The A4 content-box WIDTH (sheet width minus left/right margins) in CSS px: the width text wraps at, and
 * the same width the offscreen export measurement renders at, so both measure heights over one width. An
 * infinite / absent format returns 0, an explicit "no paged width" sentinel (it is never paginated).
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
 * Lay the section/block flow out into height-fitted pages. Honours explicit breaks like
 * `partitionIntoPages`, then auto-flows the content between them so nothing overruns a sheet. Always at
 * least one page; pure (shallow-copies fragments, never mutates `sections`). A `p` in `atomicBlockIds`
 * (or with unmeasured lines) stays whole; otherwise it splits at a line boundary.
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

   // A block placed WHOLE, never split. Two sources: `atomicBlockIds` (the editor holds the focused
   // paragraph whole while typing) and the persisted `keepTogether` flag. Reading both here means editor
   // and export honour the flag identically.
   function isHeldAtomic(block: Block): boolean {
      return atomicBlockIds.has(block.id) || block.keepTogether === true
   }

   // The smallest indivisible leading piece that must travel with a keeper above: the first item of a
   // splittable list, the first line (plus the second when present, so a heading is never followed by one
   // dangling line) of a splittable paragraph, the whole height of anything atomic. One atom is enough
   // because the split loops always place at least that atom once its room is held.
   function firstAtomHeight(block: Block): number {
      // A held block is never placed in pieces, so as a keeper's companion it reserves its WHOLE height.
      // Checked first so a held list is held whole, not reserved by its first item.
      if (isHeldAtomic(block)) return metrics.blockHeight(block.id)
      const items = metrics.listItemHeights(block.id)
      if (items && items.length > 0) return items[0]
      const lines = metrics.paragraphLines(block.id)
      if (lines && lines.length > 0)
         return lines.length > 1 ? lines[0].height + lines[1].height : lines[0].height
      return metrics.blockHeight(block.id)
   }

   // Extra height that must stay on the sheet with a keeper placed just before `blocks[index]`. Chains
   // through consecutive headings so the first keeps the whole cluster, but stops at a heading pinned by a
   // forced break, so keep-with-next never undoes an explicit break. 0 past the end.
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
   // no-title continuation slice; otherwise the next block re-opens a slice. `origin` records how the
   // new page came to exist.
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

   // An auto (height-driven) break: synthetic id derived from the content starting the next page, so it
   // stays stable across re-measures. `continuation` keeps the section open as a no-title slice (mid-flow)
   // and doubles as the origin signal: continuation = a block flowing off the previous sheet, otherwise
   // the page STARTS fresh content.
   function autoBreak(nextStartKey: string, continuation: boolean): void {
      startPage(`${AUTO_PAGE_PREFIX}${nextStartKey}`, continuation, continuation ? 'continuation' : 'auto-start')
   }

   // Leading blank pages from explicit markers, so `manual`.
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
               // A section title is a keeper: never stranded at a page bottom while its first block flows
               // onto the next sheet. Break for a title that cannot fit, and add keep-with-next only when
               // title plus first atom could fit a fresh page (else a break just re-orphans the pair).
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

         // Explicit break(s) after this block: first starts the next page, extras are blanks (all `manual`).
         const cuts = breaksAfterBlockId.get(block.id)
         if (cuts) {
            for (const pageBreak of cuts) startPage(pageBreak.id, false, 'manual')
            openSlice = null
         }
      })
   }

   pages.push({ id: pageId, slices, origin: pageOrigin })
   return pages

   // Place one block on the current page, auto-breaking (and splitting a splittable list / paragraph) so
   // it fits. `openSlice` is non-null on entry. `keepWith` is the height that must stay on this sheet with
   // `block` (its keep-with-next companion): non-zero for a heading or a keepWithNext block, else 0.
   function placeBlock(block: Block, keepWith: number): void {
      const itemHeights    = metrics.listItemHeights(block.id)
      const paragraphLines = metrics.paragraphLines(block.id)
      // A paragraph splits only when its lines are known AND it is not held whole (editor passes every
      // paragraph as atomic, export passes none, keepTogether holds it whole in both).
      const splitParagraph = !!paragraphLines && paragraphLines.length > 0 && !isHeldAtomic(block)

      // Manual keep-with-next for a SPLITTABLE keeper. The common case: a short block that fits whole but
      // whose companion would not fit after it, so break to start the pair on a fresh page. Uses the whole
      // height, so a block long enough to split still spans pages. Inert without the flag (keepWith 0), and
      // the used > 0 guard means autoBreak resetting used to 0 can never double-break.
      const isSplittableList = !!itemHeights && itemHeights.length > 0
      if (keepWith > 0 && used > 0 && !isHeldAtomic(block) && (splitParagraph || isSplittableList)) {
         const wholeHeight = metrics.blockHeight(block.id)
         if (wholeHeight + keepWith > remaining() && wholeHeight + keepWith <= availableHeight) autoBreak(block.id, true)
      }

      if (splitParagraph) {
         // Splittable paragraph: fill rendered lines across pages, cutting richText at the char offset
         // ending the last line that fits. Continuation keys use a continuation ORDINAL (not the line
         // index) so nudging the boundary while typing keeps the key stable.
         const lines = paragraphLines!
         // The block's own margin, backed out of its whole height minus the line sum (blockHeight includes
         // it, the line sum does not). Bottom-only in the stylesheet, so it belongs on the LAST page the
         // paragraph occupies, not a mid-split page.
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
            // A single piece covering the whole richText means the paragraph fit without a break: push the
            // ORIGINAL untagged block (a normal editable paragraph). Only a genuine cross-page piece
            // carries a `paragraphFragment` tag (forcing read-only fragment rendering).
            const whole = charStart === 0 && endLine === lines.length
            openSlice!.blocks.push(whole ? block : sliceParagraphBlock(block, charStart, charEnd, isTail))
            used += sum
            // The tail piece (ending the paragraph) also spends the block's margin; a mid-block piece adds
            // none (the paragraph keeps flowing).
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
         // Atomic block: keep it whole (a keepTogether list lands here too, placed via whole-list
         // blockHeight). Break to a fresh page when it plus any companion does not fit under existing
         // content; if it does not fit even on an empty page it is simply taller than the page, placed
         // anyway (clipped in print). Only break for a companion when the pair could fit a fresh page.
         const height        = metrics.blockHeight(block.id)
         const need          = height + keepWith
         const worthBreaking = keepWith === 0 || need <= availableHeight
         if (used > 0 && need > remaining() && worthBreaking) autoBreak(block.id, true)
         openSlice!.blocks.push(block)
         used += height
         return
      }

      // Splittable list: fill root items across pages, splitting at the last item that fits. The
      // continuation key uses a continuation ORDINAL, not the item index, so nudging the boundary while
      // typing keeps the key stable and never remounts the subtree. listMargin is the block's own margin,
      // backed out of whole height minus the item sum, same reasoning as paragraphMargin.
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
         // The tail item piece (ending the list) also spends the block's margin; a mid-list piece adds none.
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
 *  taller than the physical sheet, and the measured heights it came from (all from the SAME heights, so a
 *  too-tall note can never disagree with the pages). `heights` is carried so App can cache and
 *  re-paginate synchronously each render. */
export interface DocumentPages { pages: Page[]; tooTallPageIds: Set<string>; heights: MeasuredHeights }

/**
 * The ids of pages whose ENTIRE content is a single block that cannot fit the physical sheet and cannot
 * reflow off it: only then can auto-reflow do nothing, so the editor notes it. A paragraph or list is
 * splittable and NEVER too tall, unless pinned whole with keepTogether; every other block type is
 * atomic. Measured against the TRUE `contentBoxHeightPx`, not the pagination budget, since too-tall is
 * about the real sheet, and against the SAME heights that produced `pages`.
 */
export function findTooTallPageIds(pages: Page[], heights: MeasuredHeights, contentBoxHeight: number): Set<string> {
   const tooTall = new Set<string>()
   if (!(contentBoxHeight > 0)) return tooTall
   for (const page of pages) {
      const blocks = page.slices.flatMap(slice => slice.blocks)
      if (blocks.length !== 1) continue
      const only = blocks[0]
      // A splittable block reflows on its own, so it is never too tall unless held whole (keepTogether).
      const splittable = only.type === 'p' || only.type === 'list' || only.type === 'checklist'
      if (splittable && only.keepTogether !== true) continue
      const height = heights.blockById.get(only.id)
      if (height !== undefined && height > contentBoxHeight) tooTall.add(page.id)
   }
   return tooTall
}

/**
 * Paginate a whole document from cached measured heights: the ONE budgeted pagination every on-screen
 * surface and the export share. Pure arithmetic, so App calls it synchronously during render and the
 * export right after measuring; both through this single call site, so no surface can diverge. Heights
 * are per-block and width-stable, so surviving blocks re-paginate instantly after an edit; a brand-new
 * block measures 0 until the next measure lands (buildMetrics estimates/guards these).
 */
export function paginateDocument(sections: Section[], format: DocFormat | undefined, heights: MeasuredHeights): DocumentPages {
   const metrics        = buildMetrics(heights, sections)
   const pages          = paginate(sections, format?.pages ?? [], paginationBudgetPx(format), metrics, new Set())
   const tooTallPageIds = findTooTallPageIds(pages, heights, contentBoxHeightPx(format))
   return { pages, tooTallPageIds, heights }
}

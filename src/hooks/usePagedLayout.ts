// -- React Imports --
import { useEffect, useRef } from 'react'

// -- Lib Imports --
import { paginate, buildMetrics, EMPTY_HEIGHTS, type MeasuredHeights, type ParagraphLine } from '../lib/pageLayout'
import { caretCharOffsetAtPoint } from '../lib/inlineFormatting'
import type { Page } from '../lib/pageModel'
import type { PageBreak } from '../lib/format'
import type { Section } from '../types'

// #########
// # TYPES #
// #########

interface UsePagedLayoutOptions {
   /** Measure + reflow only in paged EDIT mode; otherwise the hook stays inert and returns the plain
    *  forced-break pagination (identical to partitionIntoPages, because zero heights never overflow). */
   enabled:         boolean
   sections:        Section[]
   forcedBreaks:    PageBreak[]
   /** The A4 content-box height in px (sheet height minus top/bottom margins), uniform across pages. */
   availableHeight: number
   /** The measured heights, OWNED by the caller (App) so the Pages panel and export paginate from the
    *  same source. This hook only measures the DOM and reports back through `onHeightsChange`. */
   heights:         MeasuredHeights
   onHeightsChange: (heights: MeasuredHeights) => void
   /** Block ids kept whole (never split) during pagination. The App feeds the single focused paragraph
    *  id here so it stays whole while the rest split at rest, in lockstep with the Pages panel (which
    *  paginates from the same set); export paginates with none, so paragraphs split there. */
   atomicBlockIds:  Set<string>
   /** The paragraph currently focused for editing, or null. While one is focused its typing lives only
    *  in the contentEditable DOM until blur commits it, so re-measuring would feed new heights, re-mount
    *  the editable from the stale committed model, and discard the in-progress text. Measurement freezes
    *  while this is set; the focus reflow itself is driven by `atomicBlockIds` and keeps working. */
   focusedParagraphId: string | null
}

interface UsePagedLayoutResult {
   /** Attach to the `.doc-pages` wrapper; the hook measures the sheets inside it. */
   containerRef:   (element: HTMLElement | null) => void
   /** The reflowed pages: forced breaks honoured, splittable lists auto-flowed across sheets. */
   pages:          Page[]
   /** Pages holding a single atomic block taller than the sheet (cannot be split): the editor shows a
    *  "block too tall" note there, the one overflow auto-reflow cannot resolve. */
   tooTallPageIds: Set<string>
}

// #############
// # CONSTANTS #
// #############

// How long to wait after the last edit / resize before re-measuring and reflowing. Long enough that a
// burst of keystrokes reflows once, on the pause, not per character; short enough to feel immediate.
const REFLOW_DEBOUNCE_MS = 180

// ###########
// # HELPERS #
// ###########

/** An element's consumed vertical space: border-box height plus its own top + bottom margin, rounded
 *  to a whole px so sub-pixel jitter never churns state or loops the measure effect. */
function outerHeight(element: HTMLElement): number {
   const rect = element.getBoundingClientRect()
   const style = getComputedStyle(element)
   const marginTop = Number.parseFloat(style.marginTop) || 0
   const marginBottom = Number.parseFloat(style.marginBottom) || 0
   return Math.round(rect.height + marginTop + marginBottom)
}

function sameNumberMap(left: Map<string, number>, right: Map<string, number>): boolean {
   if (left.size !== right.size) return false
   for (const [key, value] of left) if (right.get(key) !== value) return false
   return true
}

function sameLines(left: ParagraphLine[], right: ParagraphLine[]): boolean {
   if (left.length !== right.length) return false
   for (let index = 0; index < left.length; index += 1)
      if (left[index].height !== right[index].height || left[index].charEnd !== right[index].charEnd) return false
   return true
}

function sameParagraphLinesMap(left: Map<string, ParagraphLine[]>, right: Map<string, ParagraphLine[]>): boolean {
   if (left.size !== right.size) return false
   for (const [key, value] of left) {
      const other = right.get(key)
      if (!other || !sameLines(value, other)) return false
   }
   return true
}

function sameHeights(left: MeasuredHeights, right: MeasuredHeights): boolean {
   return left.header === right.header
      && sameNumberMap(left.titleBySection, right.titleBySection)
      && sameNumberMap(left.blockById, right.blockById)
      && sameNumberMap(left.listItemById, right.listItemById)
      && sameParagraphLinesMap(left.paragraphLinesById, right.paragraphLinesById)
}

/** The paragraph block ids in the flow paired with their model richText length (char count, `\n`
 *  counted once), so a measured line's end offset can be clamped to the paragraph's own length. Only
 *  top-level `p` blocks are measured (only those can be split by the paginator). */
function collectParagraphCharCounts(sections: Section[]): Map<string, number> {
   const counts = new Map<string, number>()
   for (const section of sections)
      for (const block of section.blocks)
         if (block.type === 'p')
            counts.set(block.id, (block.richText ?? []).reduce((sum, run) => sum + run.text.length, 0))
   return counts
}

/**
 * Measure the rendered visual lines of a paragraph's text element. Uses `Range.getClientRects()` over
 * the element content (one rect per line box, though rich runs split a line into several boxes, so the
 * rects are grouped back into lines by vertical band). Each line's END char offset comes from a
 * point-to-caret hit-test at the line's right edge, mapped to a flat offset; the last line is pinned to
 * the paragraph's own char length so a trailing-edge miss never drops the final characters.
 */
function measureParagraphLines(element: HTMLElement, totalChars: number): ParagraphLine[] {
   const range = document.createRange()
   range.selectNodeContents(element)
   const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0)
   if (rects.length === 0) return []

   // Group rects into visual lines: a rect on the same line vertically overlaps the current band; a
   // rect that drops below the band's bottom starts a new line.
   interface Band { top: number; bottom: number; right: number }
   const bands: Band[] = []
   for (const rect of rects) {
      const current = bands[bands.length - 1]
      if (current && rect.top < current.bottom - 1) {
         current.bottom = Math.max(current.bottom, rect.bottom)
         current.right  = Math.max(current.right, rect.right)
      } else {
         bands.push({ top: rect.top, bottom: rect.bottom, right: rect.right })
      }
   }

   const lines: ParagraphLine[] = []
   let previousCharEnd = 0
   for (let index = 0; index < bands.length; index += 1) {
      const band   = bands[index]
      const height = Math.round(band.bottom - band.top)
      const isLast = index === bands.length - 1
      let charEnd: number
      if (isLast) {
         charEnd = totalChars
      } else {
         const mapped = caretCharOffsetAtPoint(element, band.right, (band.top + band.bottom) / 2)
         charEnd = mapped < 0 ? previousCharEnd : mapped
      }
      // Keep offsets strictly increasing so no fragment is empty, and never past the paragraph length.
      if (charEnd <= previousCharEnd) charEnd = Math.min(previousCharEnd + 1, totalChars)
      lines.push({ height, charEnd })
      previousCharEnd = charEnd
   }
   return lines
}

/** Pages that hold a single atomic block taller than the whole content area: auto-reflow cannot help
 *  (the block is not splittable and nothing above it can be pushed up), so the editor notes it. */
function findTooTallPages(pages: Page[], heights: MeasuredHeights, availableHeight: number): Set<string> {
   const tooTall = new Set<string>()
   if (!(availableHeight > 0)) return tooTall
   for (const page of pages) {
      const blocks = page.slices.flatMap(slice => slice.blocks)
      if (blocks.length !== 1) continue
      const only = blocks[0]
      if (only.type === 'list' || only.type === 'checklist') continue   // splittable, handled by reflow
      const height = heights.blockById.get(only.id)
      if (height !== undefined && height > availableHeight) tooTall.add(page.id)
   }
   return tooTall
}

// #########
// # HOOK  #
// #########

/**
 * Measures each rendered sheet's content from the real DOM and reflows the paged layout so `list` /
 * `checklist` blocks split across sheets at a root-item boundary instead of jumping whole to the next
 * page. MEASURED, never predicted: it reads the header, each section title, each top-level block, and
 * each root list item by their stable data-* anchors and reports the heights up via `onHeightsChange`.
 * The caller (App) OWNS the heights and passes them back as `heights`, so the Pages panel and export
 * paginate from the identical source. Heights are width-stable, so re-paginating never re-wraps content
 * and the loop settles (a shallow-equal guard drops no-op re-measures). ResizeObserver + resize cover
 * async layout (fonts, images, MathML) the React tree does not re-render on. Reflow is a pure render
 * derivation: nothing here touches the serialized model.
 */
export function usePagedLayout(options: UsePagedLayoutOptions): UsePagedLayoutResult {
   const { enabled, sections, forcedBreaks, availableHeight, heights, onHeightsChange, atomicBlockIds, focusedParagraphId } = options

   const containerElementRef = useRef<HTMLElement | null>(null)
   const heightsRef = useRef(heights)
   heightsRef.current = heights

   // Reflow every render from the caller's measured heights: pure and cheap. Before measurement (empty
   // heights) this equals the plain forced-break partition, so first paint is stable, then the measured
   // heights arrive and the split resolves.
   const effectiveHeights = enabled ? heights : EMPTY_HEIGHTS
   const metrics = buildMetrics(effectiveHeights, sections)
   const pages = paginate(sections, forcedBreaks, availableHeight, metrics, atomicBlockIds)
   const tooTallPageIds = enabled ? findTooTallPages(pages, heights, availableHeight) : new Set<string>()

   function measure(): void {
      const container = containerElementRef.current
      if (!enabled || !container || !(availableHeight > 0)) {
         if (heightsRef.current !== EMPTY_HEIGHTS) onHeightsChange(EMPTY_HEIGHTS)
         return
      }

      // A paragraph is being edited: freeze measurement. Its uncommitted text lives only in the DOM,
      // and feeding new heights now would re-paginate and re-mount the editable from the stale committed
      // model, wiping the typing. Blur clears `focusedParagraphId`, which re-runs this via the effect
      // deps below, so the now-committed, longer paragraph is measured and split correctly. The focus
      // reflow (split -> whole, whole -> split) is driven by `atomicBlockIds` off the EXISTING heights,
      // so it keeps working while frozen.
      if (focusedParagraphId) return

      const headerElement = container.querySelector<HTMLElement>('.page-header')
      const next: MeasuredHeights = {
         header:             headerElement ? outerHeight(headerElement) : 0,
         titleBySection:     new Map(),
         blockById:          new Map(),
         listItemById:       new Map(),
         paragraphLinesById: new Map(),
      }
      for (const sectionElement of container.querySelectorAll<HTMLElement>('[data-section-id]')) {
         const sectionId = sectionElement.getAttribute('data-section-id')
         const titleElement = sectionElement.querySelector<HTMLElement>('h2')
         if (sectionId && titleElement && !next.titleBySection.has(sectionId))
            next.titleBySection.set(sectionId, outerHeight(titleElement))
      }
      for (const blockElement of container.querySelectorAll<HTMLElement>('[data-block-id]')) {
         const blockId = blockElement.getAttribute('data-block-id')
         if (blockId && !next.blockById.has(blockId)) next.blockById.set(blockId, outerHeight(blockElement))
      }
      for (const itemElement of container.querySelectorAll<HTMLElement>('[data-list-item-id]')) {
         const itemId = itemElement.getAttribute('data-list-item-id')
         if (itemId && !next.listItemById.has(itemId)) next.listItemById.set(itemId, outerHeight(itemElement))
      }
      // Paragraph line boxes: for each top-level `p` block, measure the rendered lines of its rich-text
      // element. A paragraph the editor is splitting at rest renders as read-only fragments (no
      // [data-rich]) and so cannot be measured; carry its last whole-render lines forward instead. The
      // lines are width-stable, and any text edit forces the paragraph whole (focused) before it commits,
      // which re-measures fresh, so a carried-over value is only stale after a width change (the
      // buildMetrics length guard then keeps the paragraph whole until it is measured again). First
      // occurrence wins for the same id across sheets.
      const paragraphCharCounts = collectParagraphCharCounts(sections)
      const previousParagraphLines = heightsRef.current.paragraphLinesById
      for (const blockElement of container.querySelectorAll<HTMLElement>('[data-block-id]')) {
         const blockId = blockElement.getAttribute('data-block-id')
         if (!blockId || !paragraphCharCounts.has(blockId) || next.paragraphLinesById.has(blockId)) continue
         const textElement = blockElement.querySelector<HTMLElement>('[data-rich]')
         if (textElement) {
            const lines = measureParagraphLines(textElement, paragraphCharCounts.get(blockId) ?? 0)
            if (lines.length > 0) next.paragraphLinesById.set(blockId, lines)
         } else {
            const carried = previousParagraphLines.get(blockId)
            if (carried) next.paragraphLinesById.set(blockId, carried)
         }
      }

      if (!sameHeights(heightsRef.current, next)) onHeightsChange(next)
   }

   const measureRef = useRef(measure)
   measureRef.current = measure

   // Re-measurement is DEBOUNCED: while the author types, the pagination stays frozen (the sheet grows
   // by min-height, no clipping) and the reflow lands once typing pauses. Measuring on every keystroke
   // would re-paginate and reshuffle sheets under the caret, jittering the whole canvas.
   const debounceTimerRef = useRef(0)
   function scheduleMeasure(): void {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = window.setTimeout(() => {
         debounceTimerRef.current = 0
         measureRef.current()
      }, REFLOW_DEBOUNCE_MS)
   }
   const scheduleRef = useRef(scheduleMeasure)
   scheduleRef.current = scheduleMeasure

   // Trigger 1: re-measure after every commit whose model / geometry changed (debounced). Includes
   // `focusedParagraphId` so clearing it on blur schedules the measure that splits the just-edited
   // paragraph, and setting it schedules a measure that early-returns (the freeze).
   useEffect(() => {
      scheduleRef.current()
   }, [enabled, sections, forcedBreaks, availableHeight, focusedParagraphId])

   // Trigger 2: async layout the React tree does not re-render on (fonts, image decode, MathML/SVG
   // settling, window resize), routed through the same debounce. Rebuilt only when `enabled` flips.
   useEffect(() => {
      const container = containerElementRef.current
      if (!enabled || !container || typeof ResizeObserver === 'undefined') return

      const schedule = () => scheduleRef.current()
      const observer = new ResizeObserver(schedule)
      observer.observe(container)
      window.addEventListener('resize', schedule)
      return () => {
         observer.disconnect()
         window.removeEventListener('resize', schedule)
         if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      }
   }, [enabled])

   function containerRef(element: HTMLElement | null): void {
      containerElementRef.current = element
   }

   return { containerRef, pages, tooTallPageIds }
}

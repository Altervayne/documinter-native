/*
 * Pure DOM measurement for the paged layout. Given a rendered container and its model, walk the real
 * DOM and read back the heights the paginator needs: the page header, each section title, each
 * top-level block, each root list item, and each splittable paragraph's line boxes. Reads nothing from
 * React state, refs, or the ambient document, so the live editor hook and an offscreen surface agree
 * by construction against their own container.
 */

// -- Lib Imports --
import { reconcileParagraphLines, type MeasuredHeights, type ParagraphLine } from './pageLayout'

// -- Type Imports --
import type { Section } from '../types'

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

/** Top-level `p` block ids (only those can be split) paired with their model richText length (`\n`
 *  counted once), so a measured line's end offset can be clamped to the paragraph's own length. */
function collectParagraphCharCounts(sections: Section[]): Map<string, number> {
   const counts = new Map<string, number>()
   for (const section of sections)
      for (const block of section.blocks)
         if (block.type === 'p')
            counts.set(block.id, (block.richText ?? []).reduce((sum, run) => sum + run.text.length, 0))
   return counts
}

/** One flattened run of a paragraph's rich element: a node and the char offset it starts at. Rich
 *  formatting splits text across several nodes, so a global char index is found by which node it lands in. */
interface CharSegment { node: Text | Element; start: number; length: number; isBreak: boolean }

/** Flatten the element into character segments in document order: each text node contributes its
 *  characters, each `<br>` the single "\n" it stands for. Counting a `<br>` as one character keeps this
 *  offset space identical to the model richText, where a line break IS a "\n". Without it a paragraph
 *  with line breaks measures its offsets in a shorter DOM space, so slicing the model there lands too
 *  early and over-fills the following page. */
function collectTextSegments(element: HTMLElement): { segments: CharSegment[]; total: number } {
   const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
   const segments: CharSegment[] = []
   let total = 0
   let node = walker.nextNode()
   while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
         const length = node.textContent?.length ?? 0
         segments.push({ node: node as Text, start: total, length, isBreak: false })
         total += length
      } else if ((node as Element).tagName === 'BR') {
         segments.push({ node: node as Element, start: total, length: 1, isBreak: true })
         total += 1
      }
      node = walker.nextNode()
   }
   return { segments, total }
}

/** Vertical centre of the character ending at `charEnd` (index `charEnd - 1`), from a Range rectangle.
 *  Range rectangles are real layout geometry, NOT viewport-clipped, so this locates a line boundary
 *  anywhere in the flow, unlike a point-to-caret hit-test which returns nothing below the viewport.
 *  Null when the offset falls outside the element's own characters. */
function characterMidpointY(segments: CharSegment[], charEnd: number): number | null {
   const charIndex = charEnd - 1
   for (const segment of segments) {
      if (charIndex >= segment.start && charIndex < segment.start + segment.length) {
         const range = (segment.node.ownerDocument ?? document).createRange()
         if (segment.isBreak) {
            range.selectNode(segment.node)
         } else {
            const localOffset = charIndex - segment.start
            range.setStart(segment.node, localOffset)
            range.setEnd(segment.node, localOffset + 1)
         }
         const rect = range.getBoundingClientRect()
         return (rect.top + rect.bottom) / 2
      }
   }
   return null
}

/**
 * Measure a paragraph's rendered visual lines via `Range.getClientRects()` (one rect per line box;
 * rich runs split a line into several, grouped back by vertical band). Each line's END char offset is
 * found by binary-searching the last character whose vertical centre still sits on that band; the last
 * line is pinned to the paragraph's char length so a trailing miss never drops the final characters.
 * Reading geometry, not a hit-test, is what maps a paragraph low in a tall offscreen pass correctly.
 * All Ranges run against the element's OWN document, so a detached or offscreen container measures.
 */
function measureParagraphLines(element: HTMLElement, totalChars: number): ParagraphLine[] {
   const range = element.ownerDocument.createRange()
   range.selectNodeContents(element)
   const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0)
   if (rects.length === 0) return []

   // Group rects into visual lines: a rect on the same line vertically overlaps the current band; a
   // rect that drops below the band's bottom starts a new line.
   interface Band { top: number; bottom: number }
   const bands: Band[] = []
   for (const rect of rects) {
      const current = bands[bands.length - 1]
      if (current && rect.top < current.bottom - 1) current.bottom = Math.max(current.bottom, rect.bottom)
      else bands.push({ top: rect.top, bottom: rect.bottom })
   }

   // A line's consumed height is its line-box ADVANCE (distance to the next line's top), NOT the glyph
   // box getClientRects reports. The glyph box excludes the line-height leading, so summing glyph boxes
   // under-counts the real height and the paginator over-packs the sheet. Measuring first-line top and
   // last-line bottom against the element's own box makes the line heights sum to the rendered height.
   const elementRect  = element.getBoundingClientRect()
   const firstLineTop = Math.min(bands[0].top, elementRect.top)
   const lastLineBottom = Math.max(bands[bands.length - 1].bottom, elementRect.bottom)

   const { segments, total: domTotal } = collectTextSegments(element)
   const lines: ParagraphLine[] = []
   let previousCharEnd = 0
   for (let index = 0; index < bands.length; index += 1) {
      const band   = bands[index]
      const isLast = index === bands.length - 1
      const lineTop    = index === 0 ? firstLineTop : band.top
      const lineBottom = isLast ? lastLineBottom : bands[index + 1].top
      const height = Math.round(lineBottom - lineTop)
      let charEnd: number
      if (isLast) {
         charEnd = totalChars
      } else {
         // The last character on this line is the largest offset whose midpoint has not yet dropped to
         // the next band. Characters run top to bottom in reading order, so this is a clean binary search.
         let low    = previousCharEnd + 1
         let high   = Math.min(totalChars, domTotal)
         let answer = previousCharEnd + 1
         while (low <= high) {
            const mid = (low + high) >> 1
            const midpointY = characterMidpointY(segments, mid)
            if (midpointY === null) high = mid - 1
            else if (midpointY < band.bottom - 1) { answer = mid; low = mid + 1 }
            else high = mid - 1
         }
         charEnd = answer
      }
      // Keep offsets strictly increasing so no fragment is empty, and never past the paragraph length.
      if (charEnd <= previousCharEnd) charEnd = Math.min(previousCharEnd + 1, totalChars)
      lines.push({ height, charEnd })
      previousCharEnd = charEnd
   }
   return lines
}

// #########
// # MEASURE #
// #########

/**
 * Walk `container` and produce the paginator's height oracle for `sections`, read by stable data-*
 * anchors ([data-section-id] h2, [data-block-id], [data-list-item-id], [data-rich]), first measurable
 * occurrence winning for a repeated id across sheets. Paragraph lines are reconciled against
 * `previousLines`: a paragraph with no fresh measurement this pass (split at rest with no [data-rich],
 * or a render momentarily reporting zero line boxes) keeps its last whole-render lines, which the
 * buildMetrics length guard keeps safe. Pass no `previousLines` for the bare fresh measurement.
 */
export function measureHeightsFromContainer(
   container:      HTMLElement,
   sections:       Section[],
   previousLines?: Map<string, ParagraphLine[]>,
): MeasuredHeights {
   const headerElement = container.querySelector<HTMLElement>('.page-header')
   const measured: MeasuredHeights = {
      header:             headerElement ? outerHeight(headerElement) : 0,
      titleBySection:     new Map(),
      blockById:          new Map(),
      listItemById:       new Map(),
      paragraphLinesById: new Map(),
   }
   for (const sectionElement of container.querySelectorAll<HTMLElement>('[data-section-id]')) {
      const sectionId = sectionElement.getAttribute('data-section-id')
      const titleElement = sectionElement.querySelector<HTMLElement>('h2')
      if (sectionId && titleElement && !measured.titleBySection.has(sectionId))
         measured.titleBySection.set(sectionId, outerHeight(titleElement))
   }
   for (const blockElement of container.querySelectorAll<HTMLElement>('[data-block-id]')) {
      const blockId = blockElement.getAttribute('data-block-id')
      if (blockId && !measured.blockById.has(blockId)) measured.blockById.set(blockId, outerHeight(blockElement))
   }
   for (const itemElement of container.querySelectorAll<HTMLElement>('[data-list-item-id]')) {
      const itemId = itemElement.getAttribute('data-list-item-id')
      if (itemId && !measured.listItemById.has(itemId)) measured.listItemById.set(itemId, outerHeight(itemElement))
   }
   // Paragraph line boxes: for each top-level `p` block, measure its rich-text element only when
   // rendered whole (a live [data-rich]). A paragraph split at rest (no [data-rich]) or one momentarily
   // reporting zero line boxes has no fresh measurement this pass and retains its last lines via
   // reconcile; the buildMetrics length guard keeps a just-edited paragraph whole, so a carried value
   // is never sliced at a stale offset.
   const paragraphCharCounts = collectParagraphCharCounts(sections)
   const freshParagraphLines = new Map<string, ParagraphLine[]>()
   for (const blockElement of container.querySelectorAll<HTMLElement>('[data-block-id]')) {
      const blockId = blockElement.getAttribute('data-block-id')
      if (!blockId || !paragraphCharCounts.has(blockId) || freshParagraphLines.has(blockId)) continue
      const textElement = blockElement.querySelector<HTMLElement>('[data-rich]')
      if (!textElement) continue
      const lines = measureParagraphLines(textElement, paragraphCharCounts.get(blockId) ?? 0)
      if (lines.length > 0) freshParagraphLines.set(blockId, lines)
   }
   measured.paragraphLinesById = reconcileParagraphLines(
      paragraphCharCounts.keys(), freshParagraphLines, previousLines ?? new Map(),
   )
   return measured
}

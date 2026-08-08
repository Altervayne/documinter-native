/*
 * Pure DOM measurement for the paged layout. Given a rendered container and the model it holds, walk the
 * real DOM and read back the heights the paginator needs: the page header, each section title, each
 * top-level block, each root list item, and each splittable paragraph's line boxes. The result is a fresh
 * MeasuredHeights value derived only from the passed container and sections; nothing here reads React
 * state, refs, or the ambient global document. Both the live editor hook and an offscreen measurement
 * surface call this same function against their own container, so they agree by construction.
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

/** A flattened text run of a paragraph's rich element: a text node and the char offset at which it
 *  starts within the element's overall text. Rich formatting (bold, links, colored spans) splits the
 *  text across several nodes, so a global char index is addressed by finding the node it lands in. */
interface CharSegment { node: Text | Element; start: number; length: number; isBreak: boolean }

/** Flatten the element into character segments in document order: each descendant text node contributes
 *  its characters, and each `<br>` contributes the single "\n" it stands for. Counting a `<br>` as one
 *  character is what keeps this offset space identical to the model richText, where a line break IS a
 *  "\n" character. Without it a paragraph that contains line breaks measures its line offsets in a
 *  shorter DOM space (the "\n"s vanish into `<br>`s), so slicing the model at those offsets lands too
 *  early and over-fills the following page. Rich formatting (bold, links, colored spans) only wraps text
 *  nodes, so those are handled by the text-node case. */
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

/** The vertical centre of the single character ending at `charEnd` (its char index is `charEnd - 1`),
 *  read from a Range rectangle. Range rectangles are real layout geometry and are NOT clipped to the
 *  viewport, so this locates a line boundary for content anywhere in the flow, unlike a point-to-caret
 *  hit-test which returns nothing below the viewport. A "\n" character is a `<br>`, measured by its own
 *  box. Returns null when the offset falls outside the element's own characters. */
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
 * Measure the rendered visual lines of a paragraph's text element. Uses `Range.getClientRects()` over
 * the element content (one rect per line box, though rich runs split a line into several boxes, so the
 * rects are grouped back into lines by vertical band). Each line's END char offset is found by
 * binary-searching the last character whose vertical centre still sits on that line's band, read from
 * Range geometry rather than a viewport hit-test; the last line is pinned to the paragraph's own char
 * length so a trailing miss never drops the final characters. Because it reads geometry and not a
 * point-to-caret hit-test, a paragraph low in a tall offscreen measurement pass maps its lines
 * correctly instead of collapsing to one character per line. All Ranges run against the element's OWN
 * document, so a container in a detached or offscreen document measures correctly.
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

   // A line's consumed height is its line-box ADVANCE (the distance to the next line's top), NOT the
   // glyph bounding box that getClientRects reports. The glyph box excludes the line-height leading, so
   // summing the glyph boxes badly under-counts the paragraph's real height (a paragraph the paginator
   // then over-packs onto a sheet, which the print overflow clips). Measuring first-line top and
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
 * Walk `container` and produce the paginator's height oracle for `sections`: the header, each section
 * title, each top-level block, each root list item, and each splittable paragraph's line boxes. Read by
 * their stable data-* anchors ([data-section-id] h2, [data-block-id], [data-list-item-id], [data-rich]),
 * with the first measurable occurrence winning for a repeated id across sheets. Paragraph lines are
 * reconciled against `previousLines`: a paragraph split at rest renders as read-only fragments with no
 * measurable [data-rich], and a whole render can momentarily report zero line boxes, so a paragraph with
 * no fresh measurement this pass keeps its last whole-render lines (carried lines are safe because the
 * buildMetrics length guard keeps a just-edited paragraph whole until a fresh measurement lands). Pass no
 * `previousLines` to get the bare fresh measurement. Pure: the returned MeasuredHeights depends only on
 * the container and sections given.
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
   // Paragraph line boxes: for each top-level `p` block, measure the rendered lines of its rich-text
   // element WHEN it is rendered whole (a live [data-rich]). A paragraph the editor is splitting at rest
   // renders as read-only fragments (no [data-rich]) and so cannot be measured, and a whole render can
   // momentarily report zero line boxes before layout settles; either way the paragraph has no fresh
   // measurement this pass and retains its last whole-render lines via reconcile. The lines are
   // width-stable, and the buildMetrics length guard keeps a just-edited paragraph whole until a fresh
   // measurement lands, so a carried value is never sliced at a stale offset.
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

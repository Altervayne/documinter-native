// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Lib Imports --
import { paginate, type LayoutMetrics } from '../lib/pageLayout'
import type { Page } from '../lib/pageModel'
import type { PageBreak } from '../lib/format'
import type { Section } from '../types'

// #########
// # TYPES #
// #########

/** The rendered heights read from the DOM (CSS px, rounded), keyed by stable model id so they survive
 *  re-pagination (a split changes which sheet a unit sits on, never its width, hence never its height). */
interface MeasuredHeights {
   header:         number
   titleBySection: Map<string, number>
   blockById:      Map<string, number>
   listItemById:   Map<string, number>
}

interface UsePagedLayoutOptions {
   /** Measure + reflow only in paged EDIT mode; otherwise the hook stays inert and returns the plain
    *  forced-break pagination (identical to partitionIntoPages, because zero heights never overflow). */
   enabled:         boolean
   sections:        Section[]
   forcedBreaks:    PageBreak[]
   /** The A4 content-box height in px (sheet height minus top/bottom margins), uniform across pages. */
   availableHeight: number
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

const EMPTY_HEIGHTS: MeasuredHeights = {
   header: 0, titleBySection: new Map(), blockById: new Map(), listItemById: new Map(),
}

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

function sameHeights(left: MeasuredHeights, right: MeasuredHeights): boolean {
   return left.header === right.header
      && sameNumberMap(left.titleBySection, right.titleBySection)
      && sameNumberMap(left.blockById, right.blockById)
      && sameNumberMap(left.listItemById, right.listItemById)
}

/** Build the pure paginator's height oracle from the measured heights and the model (which names the
 *  splittable list blocks and their root item ids). A list is only offered for splitting once EVERY
 *  root item is measured; until then it is treated as one atomic unit so a half-measured list never
 *  splits at the wrong place. */
function buildMetrics(heights: MeasuredHeights, sections: Section[]): LayoutMetrics {
   const listRootItemIds = new Map<string, string[]>()
   for (const section of sections)
      for (const block of section.blocks)
         if ((block.type === 'list' || block.type === 'checklist') && block.items && block.items.length > 0)
            listRootItemIds.set(block.id, block.items.map(item => item.id))

   return {
      headerHeight:       heights.header,
      sectionTitleHeight: (sectionId) => heights.titleBySection.get(sectionId) ?? 0,
      blockHeight:        (blockId) => heights.blockById.get(blockId) ?? 0,
      listItemHeights:    (blockId) => {
         const rootIds = listRootItemIds.get(blockId)
         if (!rootIds) return null
         const itemHeights = rootIds.map(itemId => heights.listItemById.get(itemId))
         if (itemHeights.some(height => height === undefined)) return null
         return itemHeights as number[]
      },
   }
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
 * each root list item by their stable data-* anchors, feeds the heights to the pure `paginate`, and
 * returns the resulting pages. Heights are width-stable, so re-paginating never re-wraps content and
 * the measure -> paginate -> render loop settles in one extra frame (a shallow-equal guard drops no-op
 * re-measures). ResizeObserver + resize cover async layout (fonts, images, MathML) the React tree does
 * not re-render on. Editor-only and ephemeral: nothing here touches the serialized model.
 */
export function usePagedLayout(options: UsePagedLayoutOptions): UsePagedLayoutResult {
   const { enabled, sections, forcedBreaks, availableHeight } = options

   const containerElementRef = useRef<HTMLElement | null>(null)
   const [heights, setHeights] = useState<MeasuredHeights>(EMPTY_HEIGHTS)
   const heightsRef = useRef(heights)
   heightsRef.current = heights

   // Reflow every render from the current measured heights: pure and cheap. Before measurement (empty
   // heights) this equals the plain forced-break partition, so first paint is stable, then the measured
   // heights arrive and the split resolves.
   const metrics = buildMetrics(enabled ? heights : EMPTY_HEIGHTS, sections)
   const pages = paginate(sections, forcedBreaks, availableHeight, metrics)
   const tooTallPageIds = enabled ? findTooTallPages(pages, heights, availableHeight) : new Set<string>()

   function measure(): void {
      const container = containerElementRef.current
      if (!enabled || !container || !(availableHeight > 0)) {
         if (heightsRef.current !== EMPTY_HEIGHTS) setHeights(EMPTY_HEIGHTS)
         return
      }

      const headerElement = container.querySelector<HTMLElement>('.page-header')
      const next: MeasuredHeights = {
         header:         headerElement ? outerHeight(headerElement) : 0,
         titleBySection: new Map(),
         blockById:      new Map(),
         listItemById:   new Map(),
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

      if (!sameHeights(heightsRef.current, next)) setHeights(next)
   }

   const measureRef = useRef(measure)
   measureRef.current = measure

   // Trigger 1: re-measure after every commit whose model / geometry changed (useEffect, after paint).
   useEffect(() => {
      measureRef.current()
   }, [enabled, sections, forcedBreaks, availableHeight])

   // Trigger 2: async layout the React tree does not re-render on (fonts, image decode, MathML/SVG
   // settling, window resize). Coalesced into one rAF; rebuilt only when `enabled` flips.
   useEffect(() => {
      const container = containerElementRef.current
      if (!enabled || !container || typeof ResizeObserver === 'undefined') return

      let frame = 0
      const schedule = () => {
         if (frame) return
         frame = requestAnimationFrame(() => { frame = 0; measureRef.current() })
      }
      const observer = new ResizeObserver(schedule)
      observer.observe(container)
      window.addEventListener('resize', schedule)
      return () => {
         if (frame) cancelAnimationFrame(frame)
         observer.disconnect()
         window.removeEventListener('resize', schedule)
      }
   }, [enabled])

   function containerRef(element: HTMLElement | null): void {
      containerElementRef.current = element
   }

   return { containerRef, pages, tooTallPageIds }
}

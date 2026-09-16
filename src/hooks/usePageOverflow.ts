// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Lib Imports --
import { computeOverflowCut } from '../lib/pageOverflow'
import type { Page } from '../lib/pageModel'

// #########
// # TYPES #
// #########

/** One paged sheet's measured overflow verdict (editor-only, ephemeral, never persisted). */
export interface PageOverflowMeasurement {
   /** The last-fitting block's id, "Split here" breaks AFTER it. `null` in the too-tall case. */
   cutAfterBlockId: string | null
   /** The first overflowing block is taller than the page itself: show a note, not a Split button. */
   blockTooTall:    boolean
}

interface UsePageOverflowOptions {
   /** Measure only in paged EDIT mode; infinite/readOnly leaves this false and the hook is inert. */
   enabled:           boolean
   /** The derived pages (null in infinite mode). Identity changes on any model edit, which re-measures. */
   pages:             Page[] | null
   /** The A4 content-box height in px (sheet height minus top/bottom margins), uniform across pages. */
   availableHeightPx: number
}

interface UsePageOverflowResult {
   /** Attach to the `.doc-pages` wrapper; the hook measures the `[data-page-id]` sheets inside it. */
   containerRef:     (element: HTMLElement | null) => void
   /** page.id maps to its overflow verdict; a page absent from the map is not overflowing. */
   overflowByPageId: Map<string, PageOverflowMeasurement>
}

// #############
// # CONSTANTS #
// #############

const EMPTY_MEASUREMENTS = new Map<string, PageOverflowMeasurement>()

// ###########
// # HELPERS #
// ###########

/** CSS-escape an id for a `[data-*="..."]` selector (ids are UUIDs, but stay defensive). */
function escapeForSelector(value: string): string {
   return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replace(/["\\]/g, '\\$&')
}

/** Shallow-equal two measurement maps so an unchanged measurement never churns React state (which
 *  would let the measure effect loop by re-committing the same result). */
function sameMeasurements(
   left:  Map<string, PageOverflowMeasurement>,
   right: Map<string, PageOverflowMeasurement>,
): boolean {
   if (left.size !== right.size) return false
   for (const [pageId, leftEntry] of left) {
      const rightEntry = right.get(pageId)
      if (!rightEntry) return false
      if (rightEntry.cutAfterBlockId !== leftEntry.cutAfterBlockId) return false
      if (rightEntry.blockTooTall !== leftEntry.blockTooTall) return false
   }
   return true
}

// #########
// # HOOK  #
// #########

/**
 * Measures each rendered A4 page's content height from the real DOM and asks pure `computeOverflowCut`
 * where (if anywhere) to split it. Block heights come from the bottom edge of each top-level
 * `[data-block-id]` relative to the page content-box top, so leading chrome (header, section title) is
 * folded in. Two triggers keep the verdict fresh without a feedback loop: an effect after every commit
 * that changed `pages`/`availableHeightPx`, and a ResizeObserver + resize listener for async layout the
 * tree doesn't re-render on (fonts, images, MathML/SVG). The ribbon it drives is absolutely positioned,
 * so it never alters flow; a shallow-equality guard drops no-op re-measurements. Editor-only, ephemeral.
 */
export function usePageOverflow(options: UsePageOverflowOptions): UsePageOverflowResult {
   const { enabled, pages, availableHeightPx } = options

   const containerElementRef = useRef<HTMLElement | null>(null)
   const [measurements, setMeasurements] = useState<Map<string, PageOverflowMeasurement>>(EMPTY_MEASUREMENTS)
   // Mirror of the committed measurements, read synchronously inside `measure` to compare-before-set.
   const measurementsRef = useRef(measurements)
   measurementsRef.current = measurements

   // A ref keeps the RO / resize callbacks calling the LATEST measure, not a stale mount-time closure
   // (the RO effect has no per-render deps, so the observer isn't torn down and rebuilt on every edit).
   function measure(): void {
      const container = containerElementRef.current
      if (!enabled || !container || !pages || !(availableHeightPx > 0)) {
         if (measurementsRef.current.size !== 0) setMeasurements(EMPTY_MEASUREMENTS)
         return
      }

      const next = new Map<string, PageOverflowMeasurement>()
      for (const page of pages) {
         const pageElement = container.querySelector<HTMLElement>(`[data-page-id="${escapeForSelector(page.id)}"]`)
         if (!pageElement) continue
         const renderElement = pageElement.querySelector<HTMLElement>('.doc-render')
         if (!renderElement) continue

         // Content-box top = render top + its top padding (the page margin). Block bottoms measure from
         // here, so leading chrome (header, titles) counts as the space it consumes.
         const paddingTop = Number.parseFloat(getComputedStyle(renderElement).paddingTop) || 0
         const contentTop = renderElement.getBoundingClientRect().top + paddingTop

         const blockIds = page.slices.flatMap(slice => slice.blocks.map(block => block.id))
         if (blockIds.length === 0) continue

         // Heights as deltas of successive block BOTTOM edges, so inter-block margins and leading chrome
         // fold into the running total rather than being dropped.
         let previousBottom = 0
         const blockHeights: number[] = []
         for (const blockId of blockIds) {
            const blockElement = pageElement.querySelector<HTMLElement>(`[data-block-id="${escapeForSelector(blockId)}"]`)
            const bottom = blockElement
               ? blockElement.getBoundingClientRect().bottom - contentTop
               : previousBottom   // not laid out yet: contributes zero, keeps indices aligned
            blockHeights.push(bottom - previousBottom)
            previousBottom = bottom
         }

         const cut = computeOverflowCut(blockHeights, availableHeightPx)
         if (!cut.overflows) continue
         next.set(page.id, {
            cutAfterBlockId: cut.cutAfterIndex !== null ? blockIds[cut.cutAfterIndex] : null,
            blockTooTall:    cut.blockTooTall,
         })
      }

      if (!sameMeasurements(measurementsRef.current, next)) {
         setMeasurements(next)
      }
   }

   const measureRef = useRef(measure)
   measureRef.current = measure

   // Trigger 1: re-measure after every commit that changed model / geometry. useEffect (not layout)
   // runs after the sheets are laid out, so the getBoundingClientRect reads are final.
   useEffect(() => {
      measureRef.current()
   }, [enabled, pages, availableHeightPx])

   // Trigger 2: async layout the tree doesn't re-render on (font swap, image decode, MathML/SVG,
   // resize). Coalesced into one rAF so a burst of RO callbacks measures once. Rebuilt only when
   // `enabled` flips (infinite vs paged), never per edit.
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

   return { containerRef, overflowByPageId: measurements }
}

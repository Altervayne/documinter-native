// -- React Imports --
import { useEffect, useRef } from 'react'

// -- Lib Imports --
import { paginate, buildMetrics, EMPTY_HEIGHTS, type MeasuredHeights, type ParagraphLine } from '../lib/pageLayout'
import { measureHeightsFromContainer } from '../lib/domMeasure'
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
   /** The height the paginator may fill on one sheet: the content box MINUS the slack band
    *  (`paginationBudgetPx`), so the canvas packs each sheet exactly as the Pages panel and the export do.
    *  This is the pagination budget, NOT the physical content box, so all surfaces agree on page count. */
   availableHeight: number
   /** The TRUE A4 content-box height in px (sheet height minus top/bottom margins), uniform across pages.
    *  Used only to flag a block taller than the physical sheet: too-tall is about the real page, not the
    *  reflow budget, so it stays on the full content box even though pagination fills the smaller budget. */
   contentBoxHeight: number
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
   const { enabled, sections, forcedBreaks, availableHeight, contentBoxHeight, heights, onHeightsChange, atomicBlockIds, focusedParagraphId } = options

   const containerElementRef = useRef<HTMLElement | null>(null)
   const heightsRef = useRef(heights)
   heightsRef.current = heights

   // Reflow every render from the caller's measured heights: pure and cheap. Before measurement (empty
   // heights) this equals the plain forced-break partition, so first paint is stable, then the measured
   // heights arrive and the split resolves.
   const effectiveHeights = enabled ? heights : EMPTY_HEIGHTS
   const metrics = buildMetrics(effectiveHeights, sections)
   const pages = paginate(sections, forcedBreaks, availableHeight, metrics, atomicBlockIds)
   // Too-tall is measured against the physical sheet (`contentBoxHeight`), not the smaller pagination
   // budget: a block only earns the "too tall" note when it cannot fit the real page, so the reserved
   // slack band at the bottom must not count against it.
   const tooTallPageIds = enabled ? findTooTallPages(pages, heights, contentBoxHeight) : new Set<string>()

   function measure(): void {
      const container = containerElementRef.current
      if (!enabled || !container || !(availableHeight > 0)) {
         // Not measuring this pass (disabled surface, no container yet, or no paged geometry). Keep the
         // last measured heights instead of zeroing App's oracle: writing EMPTY_HEIGHTS here collapsed the
         // Pages panel, and in a read-only Preview it flattened the whole document, because empty heights
         // make every splittable block look atomic and the layout falls back to forced breaks only. A
         // genuine reset (tab switch) is App's job, not this early-out's.
         return
      }

      // A paragraph is being edited: freeze measurement. Its uncommitted text lives only in the DOM,
      // and feeding new heights now would re-paginate and re-mount the editable from the stale committed
      // model, wiping the typing. Blur clears `focusedParagraphId`, which re-runs this via the effect
      // deps below, so the now-committed, longer paragraph is measured and split correctly. The focus
      // reflow (split -> whole, whole -> split) is driven by `atomicBlockIds` off the EXISTING heights,
      // so it keeps working while frozen.
      if (focusedParagraphId) return

      // Split-at-rest paragraphs have no fresh line measurement this pass, so carry forward the current
      // paragraph lines: the pure measure reconciles fresh boxes against them and a split paragraph's
      // line data survives every re-measure.
      const next = measureHeightsFromContainer(container, sections, heightsRef.current.paragraphLinesById)

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

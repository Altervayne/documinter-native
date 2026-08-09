// -- Type Imports --
import type { Section } from '../types'
import type { DocFormat, PageMargins } from '../lib/format'
import type { Page } from '../lib/pageModel'
import type { T } from '../lib/i18n'

// -- Lib / Context Imports --
import { DEFAULT_A4_MARGINS, normalizeFormat } from '../lib/format'
import {
   partitionIntoPages, reorderPages, duplicatePage, deletePage, insertBlankPageAfter, removePageBreak,
   A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_WIDTH_PX, A4_LANDSCAPE_HEIGHT_PX,
} from '../lib/pageModel'
import { isAutoPageId } from '../lib/pageLayout'
import { useToast } from '../contexts/ToastContext'

// #########
// # TYPES #
// #########

export interface PagesPanelData {
   pages:         Page[]
   margins:       PageMargins
   sheetWidthPx:  number
   sheetHeightPx: number
   onReorder:     (fromIndex: number, toIndex: number) => void
   onDuplicate:   (pageIndex: number) => void
   onDelete:      (pageIndex: number) => void
   onInsertAfter: (pageIndex: number) => void
   onRemoveBreak: (displayIndex: number) => void
   onAddPage:     () => void
   onJump:        (pageId: string) => void
}

// ########
// # HOOK #
// ########

/**
 * Derives everything the Pages panel needs from the active document's sections + format, plus the
 * reorder / duplicate / delete / jump handlers, so the panel body can be hosted anywhere in the dock.
 *
 * DISPLAY vs OPERATE split: the panel SHOWS the measured, reflowed `laidOutPages` (App-computed) so its
 * count and thumbnails match the editor, auto (continuation) sheets included. Page OPERATIONS still run
 * on the forced-break model (`forcedPages` = `partitionIntoPages`), the only place the paged format
 * mutates the real flow. A displayed page index is mapped back to its forced index by matching page id:
 * real pages carry the same id in both lists (page 1 = FIRST_PAGE_ID, later pages = their PageBreak id),
 * while auto pages (`isAutoPageId`) exist only in the display list and are not independently operable.
 *
 * Each mutation routes through the same pure pageModel transforms and commits BOTH the section flow and
 * the break markers in one event (React batches the two setState calls). Jump-to-page is a global DOM
 * query, so it works regardless of where the panel is hosted. When the document is not paged this
 * returns an empty page list; the dock only shows the Pages panel for a paged document anyway.
 */
export function usePagesPanelData(
   sections:                 Section[],
   format:                   DocFormat | undefined,
   onCommitSectionsAndFormat: (sections: Section[], format: DocFormat | undefined) => void,
   t:                        T,
   laidOutPages:             Page[],
): PagesPanelData {
   const { showToast, dismissToast } = useToast()

   const paged        = !!format && format.kind !== 'infinite'
   const pageBreaks   = format?.pages ?? []
   // What the panel DISPLAYS: the reflowed pages (matches the editor). Page ops still key on forcedPages.
   const pages        = paged ? laidOutPages : []
   const forcedPages  = paged ? partitionIntoPages(sections, pageBreaks) : []

   // Map a displayed page index to its index in the forced-break model. Auto (continuation) pages have
   // no forced counterpart, so they return -1: not independently operable.
   function forcedIndexForDisplayIndex(displayIndex: number): number {
      const page = pages[displayIndex]
      if (!page || isAutoPageId(page.id)) return -1
      return forcedPages.findIndex(forcedPage => forcedPage.id === page.id)
   }

   const margins       = format?.margins ?? DEFAULT_A4_MARGINS
   const isLandscape   = format?.kind === 'a4-landscape'
   const sheetWidthPx  = isLandscape ? A4_LANDSCAPE_WIDTH_PX  : A4_PORTRAIT_WIDTH_PX
   const sheetHeightPx = isLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX

   // Commit a page operation's result: the moved block ranges AND the re-derived break markers, in one
   // history entry (the combined lever records sections + format together). An empty break list drops
   // the `pages` key so an untouched, non-default format stays clean.
   function commitPageOperation(result: { sections: Section[]; pages: DocFormat['pages'] }): void {
      const base = normalizeFormat(format)
      let nextFormat: DocFormat | undefined
      if (!result.pages || result.pages.length === 0) {
         const { pages: _dropped, ...rest } = base
         nextFormat = rest
      } else {
         nextFormat = { ...base, pages: result.pages }
      }
      onCommitSectionsAndFormat(result.sections, nextFormat)
   }

   function onReorder(fromIndex: number, toIndex: number): void {
      // Both endpoints must be real pages: an auto continuation belongs to the block flowing onto it, so
      // it cannot be reordered, nor can another page take its slot.
      const fromForced = forcedIndexForDisplayIndex(fromIndex)
      const toForced   = forcedIndexForDisplayIndex(toIndex)
      if (fromForced === -1 || toForced === -1) return
      commitPageOperation(reorderPages(sections, pageBreaks, fromForced, toForced))
   }

   function onDuplicate(pageIndex: number): void {
      const forcedIndex = forcedIndexForDisplayIndex(pageIndex)
      if (forcedIndex === -1) return
      commitPageOperation(duplicatePage(sections, pageBreaks, forcedIndex))
   }

   function onDelete(pageIndex: number): void {
      const forcedIndex = forcedIndexForDisplayIndex(pageIndex)
      if (forcedIndex === -1) return
      const result = deletePage(sections, pageBreaks, forcedIndex)
      if (result.sections === sections) return   // single-page guard: nothing changed
      const previousSections = sections
      const previousFormat   = format
      commitPageOperation(result)
      const toastId = showToast(t.pageSorterDeleted, {
         action: {
            label:   t.undo,
            onClick: () => {
               onCommitSectionsAndFormat(previousSections, previousFormat)
               dismissToast(toastId)
            },
         },
      })
   }

   // Manual page creation: a blank page after the given displayed index. Inserting after an auto
   // continuation lands the blank after that page's governing REAL page (the nearest preceding non-auto
   // sheet), so the blank comes out after the whole block flow rather than mid-continuation.
   function onInsertAfter(pageIndex: number): void {
      let displayIndex = pageIndex
      while (displayIndex >= 0 && pages[displayIndex] && isAutoPageId(pages[displayIndex].id)) displayIndex -= 1
      const forcedIndex = forcedIndexForDisplayIndex(displayIndex)
      if (forcedIndex === -1) return
      commitPageOperation(insertBlankPageAfter(sections, pageBreaks, forcedIndex))
   }
   function onAddPage(): void {
      // Append after the last FORCED page (the displayed list may end on an auto continuation).
      commitPageOperation(insertBlankPageAfter(sections, pageBreaks, Math.max(0, forcedPages.length - 1)))
   }

   // Dissolve a manual break WITHOUT dropping its blocks (the non-destructive opposite of onDelete): the
   // page's content merges back onto the previous sheet. Only an author page carries a removable break, so
   // auto continuations (forced index -1) and page 1 (forced index 0, no break to remove) are skipped.
   function onRemoveBreak(displayIndex: number): void {
      const forcedIndex = forcedIndexForDisplayIndex(displayIndex)
      if (forcedIndex <= 0) return
      const forcedPage = forcedPages[forcedIndex]
      commitPageOperation({ sections, pages: removePageBreak(pageBreaks, forcedPage.id) })
   }

   // Jump-to-page: scroll the clicked thumbnail's sheet into view. The paged sheets carry a unique
   // [data-page-id]; only the active tab's pages are ever in the DOM, so a document query is safe.
   function onJump(pageId: string): void {
      document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
   }

   return { pages, margins, sheetWidthPx, sheetHeightPx, onReorder, onDuplicate, onDelete, onInsertAfter, onRemoveBreak, onAddPage, onJump }
}

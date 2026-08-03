// -- Type Imports --
import type { Section } from '../types'
import type { DocFormat, PageMargins } from '../lib/format'
import type { Page } from '../lib/pageModel'
import type { T } from '../lib/i18n'

// -- Lib / Context Imports --
import { DEFAULT_A4_MARGINS, normalizeFormat } from '../lib/format'
import {
   partitionIntoPages, reorderPages, duplicatePage, deletePage,
   A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_WIDTH_PX, A4_LANDSCAPE_HEIGHT_PX,
} from '../lib/pageModel'
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
   onJump:        (pageId: string) => void
}

// ########
// # HOOK #
// ########

/**
 * Derives everything the Pages panel needs from the active document's sections + format, plus the
 * reorder / duplicate / delete / jump handlers. This used to live inside WysiwygArea (where the sorter
 * was mounted); it moves up to App so the Pages body can be hosted by the App-level dock. Each mutation
 * routes through the same pure pageModel transforms and commits BOTH the section flow and the break
 * markers in one event (React batches the two setState calls). Jump-to-page is a global DOM query, so it
 * works regardless of where the panel is hosted. When the document is not paged this returns an empty
 * page list; the dock only shows the Pages panel for a paged document anyway.
 */
export function usePagesPanelData(
   sections:          Section[],
   format:            DocFormat | undefined,
   onReplaceSections: (sections: Section[]) => void,
   onFormatChange:    (format: DocFormat | undefined) => void,
   t:                 T,
): PagesPanelData {
   const { showToast, dismissToast } = useToast()

   const paged        = !!format && format.kind !== 'infinite'
   const pageBreaks   = format?.pages ?? []
   const pages        = paged ? partitionIntoPages(sections, pageBreaks) : []

   const margins       = format?.margins ?? DEFAULT_A4_MARGINS
   const isLandscape   = format?.kind === 'a4-landscape'
   const sheetWidthPx  = isLandscape ? A4_LANDSCAPE_WIDTH_PX  : A4_PORTRAIT_WIDTH_PX
   const sheetHeightPx = isLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX

   // Commit a page operation's result: the moved block ranges AND the re-derived break markers, in one
   // event. An empty break list drops the `pages` key so an untouched, non-default format stays clean.
   function commitPageOperation(result: { sections: Section[]; pages: DocFormat['pages'] }): void {
      onReplaceSections(result.sections)
      const base = normalizeFormat(format)
      if (!result.pages || result.pages.length === 0) {
         const { pages: _dropped, ...rest } = base
         onFormatChange(rest)
      } else {
         onFormatChange({ ...base, pages: result.pages })
      }
   }

   function onReorder(fromIndex: number, toIndex: number): void {
      commitPageOperation(reorderPages(sections, pageBreaks, fromIndex, toIndex))
   }

   function onDuplicate(pageIndex: number): void {
      commitPageOperation(duplicatePage(sections, pageBreaks, pageIndex))
   }

   function onDelete(pageIndex: number): void {
      const result = deletePage(sections, pageBreaks, pageIndex)
      if (result.sections === sections) return   // single-page guard: nothing changed
      const previousSections = sections
      const previousFormat   = format
      commitPageOperation(result)
      const toastId = showToast(t.pageSorterDeleted, {
         action: {
            label:   t.undo,
            onClick: () => {
               onReplaceSections(previousSections)
               onFormatChange(previousFormat)
               dismissToast(toastId)
            },
         },
      })
   }

   // Jump-to-page: scroll the clicked thumbnail's sheet into view. The paged sheets carry a unique
   // [data-page-id]; only the active tab's pages are ever in the DOM, so a document query is safe.
   function onJump(pageId: string): void {
      document.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
   }

   return { pages, margins, sheetWidthPx, sheetHeightPx, onReorder, onDuplicate, onDelete, onJump }
}

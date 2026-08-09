/**
 * PageBreaksContext, the paged-format page-break actions the block context menu consumes.
 *
 * The "Start a new page here / Remove page break" menu item lives deep in the WysiwygBlock subtree,
 * but the page-break model (format.pages) + its committer live at WysiwygArea. Rather than prop-drill
 * through WysiwygSection -> WysiwygBlock, WysiwygArea publishes a tiny read+mutate API here (mirroring
 * DocumentMutationsContext). A default no-op value keeps any consumer outside a provider (a container
 * inner block, a stray render) safe: `paged` is false, so the menu item never appears.
 *
 * The verb is break-BEFORE framed: the actions read as "make THIS block begin a fresh page", which is
 * where a break visually belongs (at the top of the pushed-down block). Under the hood the stored break
 * is still after-anchored on this block's flat predecessor (the model is after-only, see pageModel.ts),
 * so nothing about serialization changes.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'

export interface PageBreaksApi {
   /** Whether the document is in a paged (A4) format, the only mode the break actions apply in. */
   paged: boolean
   /** Whether this block can be made to start a fresh page (false for the document's first block). */
   canStartOnNewPage: (blockId: string) => boolean
   /** Whether a break already sits so this block starts a fresh page (a break after its predecessor). */
   startsFreshPage: (blockId: string) => boolean
   /** Make this block start a fresh page (a break after its flat predecessor). */
   startOnNewPage: (blockId: string) => void
   /** Merge this block back onto the previous page (drop the break after its predecessor). */
   mergeWithPrevious: (blockId: string) => void
}

const NO_PAGE_BREAKS: PageBreaksApi = {
   paged:             false,
   canStartOnNewPage: () => false,
   startsFreshPage:   () => false,
   startOnNewPage:    () => {},
   mergeWithPrevious: () => {},
}

export const PageBreaksContext = createContext<PageBreaksApi>(NO_PAGE_BREAKS)

export function usePageBreaks(): PageBreaksApi {
   return useContext(PageBreaksContext)
}

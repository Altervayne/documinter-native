/**
 * PageBreaksContext, the paged-format page-break actions the block context menu consumes.
 *
 * The "Insert / Remove page break after this block" menu item lives deep in the WysiwygBlock
 * subtree, but the page-break model (format.pages) + its committer (onFormatChange) live at
 * WysiwygArea. Rather than prop-drill through WysiwygSection -> WysiwygBlock, WysiwygArea
 * publishes a tiny read+mutate API here (mirroring DocumentMutationsContext). A default no-op value
 * keeps any consumer outside a provider (a container inner block, a stray render) safe: `paged` is
 * false, so the menu item never appears.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'

export interface PageBreaksApi {
   /** Whether the document is in a paged (A4) format, the only mode the break actions apply in. */
   paged: boolean
   /** Whether a break can be placed after this block (false for the document's last block). */
   canBreakAfter: (blockId: string) => boolean
   /** Whether a break already sits immediately after this block. */
   hasBreakAfter: (blockId: string) => boolean
   /** Insert a page break after this block (before its successor in the flat flow). */
   insertBreakAfter: (blockId: string) => void
   /** Remove the page break sitting after this block, if any. */
   removeBreakAfter: (blockId: string) => void
}

const NO_PAGE_BREAKS: PageBreaksApi = {
   paged:            false,
   canBreakAfter:    () => false,
   hasBreakAfter:    () => false,
   insertBreakAfter: () => {},
   removeBreakAfter: () => {},
}

export const PageBreaksContext = createContext<PageBreaksApi>(NO_PAGE_BREAKS)

export function usePageBreaks(): PageBreaksApi {
   return useContext(PageBreaksContext)
}

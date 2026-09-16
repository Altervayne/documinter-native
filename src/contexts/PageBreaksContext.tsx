/*
 * The paged-format page-break actions the block context menu consumes. The menu item lives deep in
 * WysiwygBlock but the break model lives at WysiwygArea, so WysiwygArea publishes this read+mutate
 * API instead of prop-drilling. The default no-op keeps `paged` false, so the item never appears
 * outside a provider.
 *
 * The verb is break-BEFORE framed ("make THIS block begin a fresh page"), but the stored break is
 * after-anchored on this block's flat predecessor (the model is after-only, see pageModel.ts).
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'

export interface PageBreaksApi {
   /** True only in a paged (A4) format, the one mode the break actions apply in. */
   paged: boolean
   /** False for the document's first block, which cannot start a fresh page. */
   canStartOnNewPage: (blockId: string) => boolean
   /** False for the document's last block: with no successor it has nothing to keep with. */
   canBreakAfter: (blockId: string) => boolean
   /** Whether a break already sits after this block's predecessor, so it starts a fresh page. */
   startsFreshPage: (blockId: string) => boolean
   startOnNewPage: (blockId: string) => void
   mergeWithPrevious: (blockId: string) => void
}

const NO_PAGE_BREAKS: PageBreaksApi = {
   paged:             false,
   canStartOnNewPage: () => false,
   canBreakAfter:     () => false,
   startsFreshPage:   () => false,
   startOnNewPage:    () => {},
   mergeWithPrevious: () => {},
}

export const PageBreaksContext = createContext<PageBreaksApi>(NO_PAGE_BREAKS)

export function usePageBreaks(): PageBreaksApi {
   return useContext(PageBreaksContext)
}

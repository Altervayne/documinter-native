// -- Library Imports --
import { Anchor, Hash } from 'lucide-react'

// -- Type Imports --
import type { Section } from '../types'

// -- Lib / Hook Imports --
import { getAnchoredBlocks } from '../hooks/useLinkMode'
import { scrollAndFlash } from '../lib/treeNavigation'
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface AnchorsPanelBodyProps {
   sections: Section[]
}

// #############
// # COMPONENT #
// #############

/** The Anchors panel body: a flat list of every deep-link handle in the document (container inner
 *  blocks included). Clicking a row scrolls the block into view and flashes it. Chrome-free, so it
 *  renders the same docked or floating; navigation works in preview too ([data-block-id] survives). */
export function AnchorsPanelBody({ sections }: AnchorsPanelBodyProps) {
   const { t } = useLang()
   const anchors = getAnchoredBlocks(sections)

   if (anchors.length === 0) {
      return (
         <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-4">
            <div className="mt-1 flex flex-col items-center gap-2 py-6 px-3 rounded-lg border border-dashed border-accent/25 bg-accent/[0.03] text-center">
               <Anchor size={20} className="text-accent/35" />
               <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-muted/60">{t.anchorsPanelEmpty}</span>
                  <span className="text-xs font-medium text-accent/55">{t.anchorsPanelEmptyHint}</span>
               </div>
            </div>
         </div>
      )
   }

   return (
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-4 flex flex-col gap-0.5">
         {anchors.map(({ block, sectionIndex }) => {
            const sectionTitle = sections[sectionIndex]?.title?.trim() || `${t.linkPanelSectionFallback} ${sectionIndex + 1}`
            return (
               <button
                  key={block.id}
                  type="button"
                  onClick={() => scrollAndFlash(`[data-block-id="${block.id}"]`, 'nearest')}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-text/70 hover:text-text hover:bg-accent/10 transition-colors cursor-pointer"
                  title={`#${block.handle}`}
               >
                  <Hash size={13} className="shrink-0 text-accent/70" />
                  <span className="flex flex-col min-w-0">
                     <span className="truncate text-sm font-medium">#{block.handle}</span>
                     <span className="truncate text-[0.68rem] text-muted/70">{sectionTitle}</span>
                  </span>
               </button>
            )
         })}
      </div>
   )
}

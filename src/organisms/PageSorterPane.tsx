// -- Icon Imports --
import { PanelRightClose, PanelRightOpen, Layers } from 'lucide-react'

// -- Organism / Lib / Context Imports --
import { PagesPanelBody } from './PagesPanelBody'
import type { Page } from '../lib/pageModel'
import type { PageMargins } from '../lib/format'
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface PageSorterPaneProps {
   open:         boolean
   onToggle:     () => void
   pages:        Page[]
   docTheme:     'light' | 'dark'
   docAccent:    string
   margins:      PageMargins
   sheetWidthPx: number
   sheetHeightPx:number
   onReorder:    (fromIndex: number, toIndex: number) => void
   onDuplicate:  (pageIndex: number) => void
   onDelete:     (pageIndex: number) => void
   onJump:       (pageId: string) => void
}

// ####################################################
// # THE PANE: a right-docked, sliding page-sorter aside
// ####################################################

/**
 * The page-sorter (Document Formats PHASE 4): a sliding pane, mounted ONLY in paged (A4) EDIT mode,
 * that shows the document's derived pages as scaled thumbnails and lets the author reorder them, jump
 * to one, and duplicate / delete one. The thumbnail column + drag behavior live in PagesPanelBody;
 * this pane is only the surrounding aside (rail + header). Mirrors the Panel's always-mounted
 * width-transition, one axis over.
 */
export function PageSorterPane({
   open, onToggle, pages, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   onReorder, onDuplicate, onDelete, onJump,
}: PageSorterPaneProps) {
   const { t } = useLang()

   const countLabel = `${pages.length} ${pages.length === 1 ? t.pageSorterCount : t.pageSorterCountPlural}`

   return (
      <aside
         style={{ width: open ? '13rem' : '2.5rem' }}
         className="shrink-0 bg-raised border-l border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden transition-[width] duration-[180ms] ease-in-out motion-reduce:transition-none"
      >
         {!open ? (
            // Collapsed rail: a single open affordance, mirroring the Panel rail.
            <div className="flex flex-col items-center p-2">
               <button
                  onClick={onToggle}
                  title={t.pageSorterOpen}
                  aria-label={t.pageSorterOpen}
                  className="text-muted hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
               >
                  <PanelRightOpen size={18} />
               </button>
               <span className="mt-1 text-muted/50" aria-hidden="true"><Layers size={15} /></span>
            </div>
         ) : (
            <>
               {/* Header: title + page count + collapse. */}
               <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                  <div className="flex flex-col min-w-0">
                     <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold select-none">
                        {t.pageSorterTitle}
                     </span>
                     <span className="text-[0.68rem] text-muted/60 select-none">{countLabel}</span>
                  </div>
                  <button
                     onClick={onToggle}
                     title={t.pageSorterClose}
                     aria-label={t.pageSorterClose}
                     className="text-muted hover:text-accent p-1.5 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
                  >
                     <PanelRightClose size={15} />
                  </button>
               </div>

               <PagesPanelBody
                  pages={pages}
                  docTheme={docTheme}
                  docAccent={docAccent}
                  margins={margins}
                  sheetWidthPx={sheetWidthPx}
                  sheetHeightPx={sheetHeightPx}
                  onReorder={onReorder}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                  onJump={onJump}
               />
            </>
         )}
      </aside>
   )
}

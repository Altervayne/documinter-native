// -- Type Imports --
import type { Section } from '../types'

// -- Icon Imports --
import {
   PanelLeft, PanelRight,
   PanelLeftClose, PanelRightClose,
   PanelLeftOpen, PanelRightOpen,
} from 'lucide-react'

// -- Organism / Context Imports --
import { StructurePanelBody } from './StructurePanelBody'
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface PanelProps {
   open:              boolean
   onToggle:          () => void
   dockSide:          'left' | 'right'
   onToggleDockSide:  () => void
   sections:          Section[]
   onAddSection:      () => void
   onToggleSec:       (secId: string) => void
   onDuplicateSec:    (secId: string) => void
   onRemoveSec:       (secId: string) => void
   onReorderSections: (oldIdx: number, newIdx: number) => void
   onReorderBlocks:   (secId: string, oldIdx: number, newIdx: number) => void
}

// #############
// # COMPONENT #
// #############

export function Panel({
   open, onToggle,
   dockSide, onToggleDockSide,
   sections,
   onAddSection, onToggleSec, onDuplicateSec, onRemoveSec,
   onReorderSections, onReorderBlocks,
}: PanelProps) {
   const { t } = useLang()

   const isLeft         = dockSide === 'left'
   const borderClass    = isLeft ? 'border-r' : 'border-l'
   const DockToggleIcon = isLeft ? PanelRight : PanelLeft
   const CloseIcon      = isLeft ? PanelLeftClose : PanelRightClose
   const OpenIcon       = isLeft ? PanelLeftOpen  : PanelRightOpen
   const dockLabel      = isLeft ? t.dockToRight : t.dockToLeft

   // ==============================================================================
   //  Always-mounted aside, width transitions between rail (3rem) and full (18rem)
   // ==============================================================================

   return (
      <aside
         style={{ order: isLeft ? 0 : 2, width: open ? '18rem' : '3rem' }}
         className={`shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden transition-[width] duration-[180ms] ease-in-out motion-reduce:transition-none`}
      >
         {!open ? (
            // ===============
            //  Collapsed rail
            // ===============
            <div className="flex flex-col items-center p-2">
               <button
                  onClick={onToggle}
                  title={t.openPanel}
                  className="text-muted hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
               >
                  <OpenIcon size={18} />
               </button>
            </div>
         ) : (
            // ===============
            //  Expanded panel
            // ===============
            <>
               {/* Header */}
               <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                  <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold select-none">
                     {t.structure}
                  </span>
                  <div className="flex items-center gap-0.5">
                     <button
                        onClick={onToggleDockSide}
                        title={dockLabel}
                        className="text-muted hover:text-accent p-1.5 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
                     >
                        <DockToggleIcon size={15} />
                     </button>
                     <button
                        onClick={onToggle}
                        title={t.collapsePanel}
                        className="text-muted hover:text-accent p-1.5 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
                     >
                        <CloseIcon size={15} />
                     </button>
                  </div>
               </div>

               <StructurePanelBody
                  sections={sections}
                  onAddSection={onAddSection}
                  onToggleSec={onToggleSec}
                  onDuplicateSec={onDuplicateSec}
                  onRemoveSec={onRemoveSec}
                  onReorderSections={onReorderSections}
                  onReorderBlocks={onReorderBlocks}
               />
            </>
         )}
      </aside>
   )
}

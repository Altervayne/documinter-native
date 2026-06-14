import { useState } from 'react'

import type { Section } from '../types'
import { SectionItem } from '../molecules/SectionItem'
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
   Plus, SquareDashed,
   GripVertical, ChevronDown,
   PanelLeft, PanelRight,
   PanelLeftClose, PanelRightClose,
   PanelLeftOpen, PanelRightOpen,
} from 'lucide-react'
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
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

   const isLeft         = dockSide === 'left'
   const borderClass    = isLeft ? 'border-r' : 'border-l'
   const DockToggleIcon = isLeft ? PanelRight : PanelLeft
   const CloseIcon      = isLeft ? PanelLeftClose : PanelRightClose
   const OpenIcon       = isLeft ? PanelLeftOpen  : PanelRightOpen
   const dockLabel      = isLeft ? t.dockToRight : t.dockToLeft

   function handleDragStart(event: DragStartEvent) {
      setActiveSectionId(String(event.active.id))
   }

   function handleDragEnd(event: DragEndEvent) {
      setActiveSectionId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = sections.findIndex(section => section.id === active.id)
      const newIdx = sections.findIndex(section => section.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) onReorderSections(oldIdx, newIdx)
   }

   function handleDragCancel() {
      setActiveSectionId(null)
   }

   // ==============================================================================
   //  Always-mounted aside — width transitions between rail (3rem) and full (18rem)
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

               {/* Scrollable section tree — add-section button flows inside as sticky last child */}
               <div className="overflow-y-auto flex-1 min-h-0 px-2 pt-2 pb-4">
                  {sections.length === 0 ? (
                     <button
                        onClick={onAddSection}
                        className="w-full flex flex-col items-center gap-2 mt-1 py-5 px-3 rounded-lg border border-dashed border-accent/25 bg-accent/[0.03] hover:bg-accent/[0.07] hover:border-accent/40 text-center cursor-pointer transition-colors select-none"
                     >
                        <SquareDashed size={20} className="text-accent/35" />
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-medium text-muted/60">{t.panelNoSections}</span>
                           <span className="text-xs font-medium text-accent/55">{t.panelNoSectionsHint}</span>
                        </div>
                     </button>
                  ) : (
                     <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragCancel={handleDragCancel}
                     >
                        <SortableContext items={sections.map(section => section.id)} strategy={verticalListSortingStrategy}>
                           {sections.map(section => (
                              <SectionItem
                                 key={section.id}
                                 section={section}
                                 onToggle={()     => onToggleSec(section.id)}
                                 onDuplicate={() => onDuplicateSec(section.id)}
                                 onRemove={()    => onRemoveSec(section.id)}
                                 onReorderBlocks={(oldIdx, newIdx) => onReorderBlocks(section.id, oldIdx, newIdx)}
                              />
                           ))}
                        </SortableContext>

                        <DragOverlay>
                           {activeSectionId && (() => {
                              const activeSection = sections.find(section => section.id === activeSectionId)
                              return activeSection ? (
                                 <div
                                    className="flex items-center gap-1 h-8 rounded-md bg-raised border border-border shadow-lg px-0.5 pointer-events-none"
                                    style={{ opacity: 0.92 }}
                                 >
                                    <span className="shrink-0 px-0.5 text-muted/50">
                                       <GripVertical size={16} />
                                    </span>
                                    <span className="shrink-0 p-0.5 text-muted/50">
                                       <ChevronDown size={12} />
                                    </span>
                                    <span className="flex-1 min-w-0 truncate text-xs font-medium text-text/80 select-none">
                                       {activeSection.title || t.untitledDoc}
                                    </span>
                                 </div>
                              ) : null
                           })()}
                        </DragOverlay>
                     </DndContext>
                  )}

                  {/* Sticky add-section button — only shown when sections already exist */}
                  {/* The empty-state card above handles the zero-section case */}
                  {sections.length > 0 && (
                     <div className="sticky bottom-0 bg-raised mt-4">
                        <button
                           onClick={onAddSection}
                           className="w-full flex items-center justify-center gap-2 px-2 py-1.5 text-xs font-medium text-accent/50 hover:text-accent hover:bg-accent/8 rounded-md border border-dashed border-accent/25 hover:border-accent/50 transition-colors cursor-pointer"
                        >
                           <Plus size={13} />
                           {t.addSection}
                        </button>
                     </div>
                  )}
               </div>
            </>
         )}
      </aside>
   )
}

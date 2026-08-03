// -- React Imports --
import { useState } from 'react'

// -- Library Imports --
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, SquareDashed, GripVertical, ChevronDown } from 'lucide-react'

// -- Type Imports --
import type { Section } from '../types'

// -- Molecule / Context Imports --
import { SectionItem } from '../molecules/SectionItem'
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface StructurePanelBodyProps {
   sections:          Section[]
   onAddSection:      () => void
   onToggleSec:       (secId: string) => void
   onDuplicateSec:    (secId: string) => void
   onRemoveSec:       (secId: string) => void
   onReorderSections: (oldIndex: number, newIndex: number) => void
   onReorderBlocks:   (secId: string, oldIndex: number, newIndex: number) => void
}

// #############
// # COMPONENT #
// #############

/**
 * The Structure panel's body: the scrollable, drag-reorderable section tree plus the add-section
 * affordance. This is the panel content only, with no surrounding header, rail, or dock chrome, so it
 * renders identically whether it is hosted by the dock (DockHost) or, later, a floating window.
 */
export function StructurePanelBody({
   sections,
   onAddSection, onToggleSec, onDuplicateSec, onRemoveSec,
   onReorderSections, onReorderBlocks,
}: StructurePanelBodyProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

   function handleDragStart(event: DragStartEvent) {
      setActiveSectionId(String(event.active.id))
   }

   function handleDragEnd(event: DragEndEvent) {
      setActiveSectionId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = sections.findIndex(section => section.id === active.id)
      const newIndex = sections.findIndex(section => section.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) onReorderSections(oldIndex, newIndex)
   }

   function handleDragCancel() {
      setActiveSectionId(null)
   }

   return (
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
                  {sections.map((section, index) => (
                     <SectionItem
                        key={section.id}
                        section={section}
                        index={index}
                        isLastSection={index === sections.length - 1}
                        onToggle={()     => onToggleSec(section.id)}
                        onDuplicate={() => onDuplicateSec(section.id)}
                        onRemove={()    => onRemoveSec(section.id)}
                        onReorderBlocks={(oldIndex, newIndex) => onReorderBlocks(section.id, oldIndex, newIndex)}
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

         {/* Sticky add-section button, only shown when sections already exist (the empty-state card
             above handles the zero-section case). */}
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
   )
}

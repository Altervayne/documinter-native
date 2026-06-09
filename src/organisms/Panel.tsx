import type { Section } from '../types'
import { SectionItem } from '../molecules/SectionItem'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
   Plus,
   PanelLeft, PanelRight,
   PanelLeftClose, PanelRightClose,
   PanelLeftOpen, PanelRightOpen,
} from 'lucide-react'
import { useLang } from '../contexts/LangContext'

// ============================================================
// Types
// ============================================================

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

// ============================================================
// Component
// ============================================================

export function Panel({
   open, onToggle,
   dockSide, onToggleDockSide,
   sections,
   onAddSection, onToggleSec, onDuplicateSec, onRemoveSec,
   onReorderSections, onReorderBlocks,
}: PanelProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   const isLeft        = dockSide === 'left'
   const borderClass   = isLeft ? 'border-r' : 'border-l'
   const orderStyle    = { order: isLeft ? 0 : 2 }
   const DockToggleIcon = isLeft ? PanelRight : PanelLeft
   const CloseIcon      = isLeft ? PanelLeftClose : PanelRightClose
   const OpenIcon       = isLeft ? PanelLeftOpen  : PanelRightOpen
   const dockLabel      = isLeft ? t.dockToRight : t.dockToLeft

   function handleDragEnd(event: DragEndEvent) {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = sections.findIndex(section => section.id === active.id)
      const newIdx = sections.findIndex(section => section.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) onReorderSections(oldIdx, newIdx)
   }

   // ── Collapsed rail ─────────────────────────────────────────

   if (!open) {
      return (
         <aside
            style={orderStyle}
            className={`w-12 shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex flex-col items-center p-2 h-full overflow-hidden`}
         >
            <button
               onClick={onToggle}
               title={t.openPanel}
               className="text-muted hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
            >
               <OpenIcon size={18} />
            </button>
         </aside>
      )
   }

   // ── Expanded panel ─────────────────────────────────────────

   return (
      <aside
         style={orderStyle}
         className={`w-72 shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden`}
      >
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
         <div className="overflow-y-auto flex-1 min-h-0 px-2 pt-2 pb-10">
            {sections.length === 0 ? (
               <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
                  <div className="text-muted/15 text-5xl leading-none select-none">⊞</div>
                  <p className="text-muted text-xs font-mono leading-relaxed">
                     {t.noSections}<br />
                     <span className="text-accent/60">{t.noSectionsHint}</span>
                  </p>
               </div>
            ) : (
               <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
               </DndContext>
            )}

            {/* Sticky add-section button — flows below short lists, sticks at bottom when scrollable */}
            <div className="sticky bottom-0 bg-raised pt-1">
               <button
                  onClick={onAddSection}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted hover:text-text hover:bg-accent/8 rounded-md transition-colors cursor-pointer"
               >
                  <Plus size={13} />
                  {t.addSection}
               </button>
            </div>
         </div>
      </aside>
   )
}

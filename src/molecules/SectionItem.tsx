// -- React Imports --
import { useRef, useState } from 'react'

// -- Type Imports --
import type { Block, BlockType, Section } from '../types'

// -- Lib / Util Imports --
import { scrollAndFlash } from '../lib/treeNavigation'

// -- Library Imports --
import { BlockItem } from './BlockItem'
import { BlockTypePicker } from './BlockTypePicker'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { GripVertical, Copy, Trash2, ChevronRight, ChevronDown, Plus } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../contexts/DocumentMutationsContext'
import { useLang } from '../contexts/LangContext'

// ============================================================
// Types
// ============================================================

interface SectionItemProps {
   section:         Section
   onToggle:        () => void
   onDuplicate:     () => void
   onRemove:        () => void
   onReorderBlocks: (oldIdx: number, newIdx: number) => void
}

// ============================================================
// Component
// ============================================================

export function SectionItem({
   section,
   onToggle,
   onDuplicate,
   onRemove,
   onReorderBlocks,
}: SectionItemProps) {
   const { t }   = useLang()
   const ctx     = useDocumentMutations()
   const [hovered, setHovered] = useState(false)
   const [pickerOpen, setPickerOpen] = useState(false)
   const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null)
   const addBlockButtonRef = useRef<HTMLButtonElement>(null)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   function handleDragEnd(event: DragEndEvent) {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = section.blocks.findIndex(block => block.id === active.id)
      const newIdx = section.blocks.findIndex(block => block.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) onReorderBlocks(oldIdx, newIdx)
   }

   function handleTitleClick() {
      scrollAndFlash(`[data-section-id="${section.id}"]`, 'start')
   }

   return (
      <div
         ref={setNodeRef} style={style} {...attributes}
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => setHovered(false)}
      >
         {/* ── Section header row ── */}
         <div className="flex items-center gap-1 h-8 rounded-md hover:bg-accent/8 transition-colors group/header">

            {/* Drag grip */}
            <span
               {...listeners}
               className="shrink-0 px-0.5 text-muted/50 group-hover/header:text-muted/90 cursor-grab transition-colors"
               title={t.dragToReorder}
               onClick={event => event.stopPropagation()}
            >
               <GripVertical size={16} />
            </span>

            {/* Collapse chevron — click toggles only */}
            <button
               onClick={(event) => { event.stopPropagation(); onToggle() }}
               className="shrink-0 p-0.5 text-muted/50 hover:text-muted transition-colors cursor-pointer"
               title={section.collapsed ? t.emptySection : t.structure}
            >
               {section.collapsed
                  ? <ChevronRight size={12} />
                  : <ChevronDown size={12} />
               }
            </button>

            {/* Title — click scrolls to section on canvas */}
            <span
               className={`flex-1 min-w-0 truncate text-xs font-medium cursor-pointer select-none
                  ${section.title ? 'text-text/80' : 'text-muted/50 italic'}`}
               onClick={handleTitleClick}
               title={section.title || t.noSections}
            >
               {section.title || t.untitledDoc}
            </span>

            {/* Hover-revealed: add block + duplicate + delete */}
            <div className={`flex items-center gap-0.5 shrink-0 pr-1 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
               <button
                  ref={addBlockButtonRef}
                  onClick={() => {
                     setPickerAnchorRect(addBlockButtonRef.current?.getBoundingClientRect() ?? null)
                     setPickerOpen(true)
                  }}
                  title={t.addBlock}
                  className="p-1 text-muted hover:text-accent rounded transition-colors cursor-pointer"
               >
                  <Plus size={11} />
               </button>
               <button
                  onClick={onDuplicate}
                  title={t.duplicateSection}
                  className="p-1 text-muted hover:text-accent rounded transition-colors cursor-pointer"
               >
                  <Copy size={11} />
               </button>
               <button
                  onClick={onRemove}
                  title={t.deleteSection}
                  className="p-1 text-muted hover:text-red-500 rounded transition-colors cursor-pointer"
               >
                  <Trash2 size={11} />
               </button>
            </div>
         </div>

         {/* ── Block list / empty stub ── */}
         {!section.collapsed && (
            <div className="ml-5 flex flex-col">
               {section.blocks.length === 0 ? (
                  <button
                     onClick={(event) => {
                        setPickerAnchorRect(event.currentTarget.getBoundingClientRect())
                        setPickerOpen(true)
                     }}
                     className="h-7 w-full flex items-center gap-1.5 pl-2 rounded-md border border-dashed border-accent/20 text-xs text-accent/45 hover:text-accent/75 hover:bg-accent/8 hover:border-accent/35 transition-colors cursor-pointer select-none"
                  >
                     <Plus size={10} className="shrink-0" />
                     {t.panelEmptyBlocks}
                  </button>
               ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                     <SortableContext items={section.blocks.map(block => block.id)} strategy={verticalListSortingStrategy}>
                        {section.blocks.map((block: Block) => (
                           <BlockItem key={block.id} block={block} secId={section.id} />
                        ))}
                     </SortableContext>
                  </DndContext>
               )}
            </div>
         )}

         {/* Block type picker — opened by the + button in the hover bar */}
         {pickerOpen && (
            <BlockTypePicker
               anchorRect={pickerAnchorRect ?? new DOMRect(0, 0, 0, 0)}
               onSelect={(type: BlockType) => {
                  ctx.addBlock(section.id, type)
                  setPickerOpen(false)
               }}
               onClose={() => setPickerOpen(false)}
            />
         )}
      </div>
   )
}

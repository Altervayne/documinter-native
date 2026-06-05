import { useState } from 'react'
import type { Block, BlockType, Section } from '../types'
import { Badge } from '../atoms/Badge'
import { Button } from '../atoms/Button'
import { BlockItem } from './BlockItem'
import { AddBlockRow } from './AddBlockRow'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { GripVertical, ArrowUp, ArrowDown, Copy, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { useLang } from '../contexts/LangContext'

interface SectionItemProps {
   section:    Section
   index:      number
   onToggle:   () => void
   onMoveUp:   () => void
   onMoveDown: () => void
   onDuplicate:() => void
   onRemove:   () => void
   onAddBlock: (type: BlockType) => void
   onMoveBlkUp:     (blkId: string) => void
   onMoveBlkDown:   (blkId: string) => void
   onRemoveBlk:     (blkId: string) => void
   onReorderBlocks: (oldIdx: number, newIdx: number) => void
}

export function SectionItem({
   section, index,
   onToggle, onMoveUp, onMoveDown, onDuplicate, onRemove,
   onAddBlock, onMoveBlkUp, onMoveBlkDown, onRemoveBlk, onReorderBlocks,
}: SectionItemProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const isEmpty = section.blocks.length === 0

   function handleDragEnd(event: DragEndEvent) {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = section.blocks.findIndex(block => block.id === active.id)
      const newIdx = section.blocks.findIndex(block => block.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) onReorderBlocks(oldIdx, newIdx)
   }

   return (
      <div
         ref={setNodeRef} style={style} {...attributes}
         className="shrink-0 rounded-lg overflow-hidden border border-border bg-el"
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => setHovered(false)}
      >
         {/* Header — fixed height, always visible */}
         <div
            className="flex items-center gap-2 px-3 h-10 cursor-pointer select-none hover:bg-accent/10 transition-colors"
            onClick={onToggle}
         >
            {/* Drag handle */}
            <span
               {...listeners}
               className={`shrink-0 transition-colors cursor-grab ${hovered ? 'text-muted/60' : 'text-muted/25'}`}
               onClick={event => event.stopPropagation()}
               title={t.dragToReorder}
            >
               <GripVertical size={14} />
            </span>

            <Badge label={String(index + 1).padStart(2, '0')} dim={isEmpty} />

            <span className={`flex-1 min-w-0 text-sm font-medium truncate ${isEmpty ? 'text-muted/60' : 'text-text'}`}>
               {section.title}
            </span>

            {/* Expand chevron */}
            <span className={`shrink-0 transition-colors ${hovered ? 'text-muted/70' : 'text-muted/40'}`}>
               {section.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
         </div>

         {/* Action bar — revealed on hover via grid-rows transition */}
         <div className={`grid transition-[grid-template-rows] duration-150 ${hovered ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
               <div className="flex items-center gap-0.5 p-1 justify-end">
                  <Button variant="ghost" size="icon" onClick={onMoveUp}   title={t.moveUp}>
                     <ArrowUp size={13} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onMoveDown} title={t.moveDown}>
                     <ArrowDown size={13} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onDuplicate} title={t.duplicateSection}>
                     <Copy size={13} />
                  </Button>
                  <Button variant="danger" size="icon" onClick={onRemove}  title={t.deleteSection}>
                     <Trash2 size={13} />
                  </Button>
               </div>
            </div>
         </div>

         {/* Block body */}
         {!section.collapsed && (
            <div className="border-t border-border/60 px-3 py-3 flex flex-col gap-1">
               <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={section.blocks.map(block => block.id)} strategy={verticalListSortingStrategy}>
                     {section.blocks.map((block: Block) => (
                        <BlockItem
                           key={block.id}
                           block={block}
                           onMoveUp={() => onMoveBlkUp(block.id)}
                           onMoveDown={() => onMoveBlkDown(block.id)}
                           onRemove={() => onRemoveBlk(block.id)}
                        />
                     ))}
                  </SortableContext>
               </DndContext>
               <AddBlockRow onAdd={onAddBlock} />
            </div>
         )}
      </div>
   )
}

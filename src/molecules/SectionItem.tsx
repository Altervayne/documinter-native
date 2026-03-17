import type { Block, BlockType, Section } from '../types'
import { Badge } from '../atoms/Badge'
import { Button } from '../atoms/Button'
import { BlockItem } from './BlockItem'
import { AddBlockRow } from './AddBlockRow'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { GripVertical, ArrowUp, ArrowDown, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { useLang } from '../lib/LangContext'

interface SectionItemProps {
  section:    Section
  index:      number
  onToggle:   () => void
  onMoveUp:   () => void
  onMoveDown: () => void
  onRemove:   () => void
  onAddBlock: (type: BlockType) => void
  onMoveBlkUp:     (blkId: number) => void
  onMoveBlkDown:   (blkId: number) => void
  onRemoveBlk:     (blkId: number) => void
  onReorderBlocks: (oldIdx: number, newIdx: number) => void
}

export function SectionItem({
  section, index,
  onToggle, onMoveUp, onMoveDown, onRemove,
  onAddBlock, onMoveBlkUp, onMoveBlkDown, onRemoveBlk, onReorderBlocks,
}: SectionItemProps) {
  const { t } = useLang()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = section.blocks.findIndex(b => b.id === active.id)
    const newIdx = section.blocks.findIndex(b => b.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) onReorderBlocks(oldIdx, newIdx)
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="shrink-0 rounded-lg overflow-hidden border border-border bg-el">
      {/* Header */}
      <div
        className="group flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none hover:bg-white/4 transition-colors"
        onClick={onToggle}
      >
        {/* Drag handle */}
        <span
          {...listeners}
          className="text-muted/25 group-hover:text-muted/60 cursor-grab shrink-0 transition-colors"
          onClick={e => e.stopPropagation()}
          title={t.dragToReorder}
        >
          <GripVertical size={14} />
        </span>

        <Badge label={String(index + 1).padStart(2, '0')} />

        <span className="flex-1 text-sm font-medium text-text truncate">
          {section.title}
        </span>

        {/* Actions — revealed on hover */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <Button variant="ghost" size="icon" onClick={onMoveUp}   title={t.moveUp}><ArrowUp size={13} /></Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown} title={t.moveDown}><ArrowDown size={13} /></Button>
          <Button variant="danger" size="icon" onClick={onRemove}  title={t.deleteSection}><Trash2 size={13} /></Button>
        </div>

        {/* Expand chevron */}
        <span className="text-muted/40 group-hover:text-muted/70 shrink-0 transition-colors">
          {section.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>

      {/* Body */}
      {!section.collapsed && (
        <div className="border-t border-border/60 px-3 py-3 flex flex-col gap-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={section.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
              {section.blocks.map((blk: Block) => (
                <BlockItem
                  key={blk.id}
                  block={blk}
                  onMoveUp={()   => onMoveBlkUp(blk.id)}
                  onMoveDown={() => onMoveBlkDown(blk.id)}
                  onRemove={() =>   onRemoveBlk(blk.id)}
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

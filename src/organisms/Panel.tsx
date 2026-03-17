import type { BlockType, Section } from '../types'
import { Button } from '../atoms/Button'
import { SectionItem } from '../molecules/SectionItem'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface PanelProps {
  open: boolean
  onToggle: () => void
  sections: Section[]
  onAddSection:  () => void
  onToggleSec:   (secId: number) => void
  onMoveSecUp:   (secId: number) => void
  onMoveSecDown: (secId: number) => void
  onRemoveSec:   (secId: number) => void
  onAddBlock:    (secId: number, type: BlockType) => void
  onMoveBlkUp:   (secId: number, blkId: number) => void
  onMoveBlkDown: (secId: number, blkId: number) => void
  onRemoveBlk:   (secId: number, blkId: number) => void
  onReorderSections: (oldIdx: number, newIdx: number) => void
  onReorderBlocks:   (secId: number, oldIdx: number, newIdx: number) => void
}

export function Panel({
  open, onToggle,
  sections,
  onAddSection, onToggleSec, onMoveSecUp, onMoveSecDown, onRemoveSec,
  onAddBlock, onMoveBlkUp, onMoveBlkDown, onRemoveBlk,
  onReorderSections, onReorderBlocks,
}: PanelProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sections.findIndex(s => s.id === active.id)
    const newIdx = sections.findIndex(s => s.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) onReorderSections(oldIdx, newIdx)
  }

  if (!open) {
    return (
      <aside
        className="w-10 shrink-0 bg-raised border-r border-border border-t-2 border-t-accent/30 flex flex-col items-center pt-3 h-full overflow-hidden"
        style={{ transition: 'width 0.2s ease' }}
      >
        <button
          onClick={onToggle}
          title="Open panel"
          className="text-muted hover:text-accent p-2 rounded hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
        >
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="w-80 shrink-0 bg-raised border-r border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden"
      style={{ transition: 'width 0.2s ease' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold">Structure</span>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={onAddSection}><Plus size={13} />Section</Button>
          <Button variant="ghost" size="sm" onClick={onToggle} title="Collapse panel"><PanelLeftClose size={14} /></Button>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="overflow-y-auto flex-1 min-h-0 p-3 flex flex-col gap-1.5">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
            <div className="text-muted/15 text-5xl leading-none select-none">⊞</div>
            <p className="text-muted text-xs font-mono leading-relaxed">
              No sections yet.<br />
              <span className="text-accent/60">+ Section</span> to get started.
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {sections.map((sec, index) => (
                <SectionItem
                  key={sec.id}
                  section={sec}
                  index={index}
                  onToggle={()    => onToggleSec(sec.id)}
                  onMoveUp={()    => onMoveSecUp(sec.id)}
                  onMoveDown={()  => onMoveSecDown(sec.id)}
                  onRemove={()    => onRemoveSec(sec.id)}
                  onAddBlock={type  => onAddBlock(sec.id, type)}
                  onMoveBlkUp={id   => onMoveBlkUp(sec.id, id)}
                  onMoveBlkDown={id => onMoveBlkDown(sec.id, id)}
                  onRemoveBlk={id   => onRemoveBlk(sec.id, id)}
                  onReorderBlocks={(oldIdx, newIdx) => onReorderBlocks(sec.id, oldIdx, newIdx)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  )
}

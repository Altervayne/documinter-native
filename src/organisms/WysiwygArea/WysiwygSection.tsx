import type { Block, BlockType, Section } from '../../types'
import { ContentEditable } from '../../atoms/ContentEditable'
import { WysiwygBlock } from './WysiwygBlock'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AlignLeft, Heading3, Heading4, Info, Code2, List, Table, GripVertical, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface WysiwygSectionProps {
  section:    Section
  index:      number
  onUpdateTitle: (secId: number, title: string) => void
  onUpdateBlock: (secId: number, blkId: number, patch: Partial<Block>) => void
  onAddBlock:      (type: BlockType) => void
  onRemoveSec:     () => void
  onRemoveBlk:     (blkId: number) => void
  onAddListItem:    (blkId: number) => void
  onRemoveLastItem: (blkId: number) => void
  onAddTableRow:    (blkId: number) => void
  onRemoveLastRow:  (blkId: number) => void
  onAddTableCol:    (blkId: number) => void
  onReorderBlocks: (oldIdx: number, newIdx: number) => void
}

const BLOCK_BUTTONS: { type: BlockType; icon: LucideIcon; label: string }[] = [
  { type: 'p',       icon: AlignLeft, label: 'Paragraph' },
  { type: 'h3',      icon: Heading3,  label: 'Heading 3' },
  { type: 'h4',      icon: Heading4,  label: 'Heading 4' },
  { type: 'callout', icon: Info,      label: 'Callout'   },
  { type: 'code',    icon: Code2,     label: 'Code block'},
  { type: 'list',    icon: List,      label: 'List'      },
  { type: 'table',   icon: Table,     label: 'Table'     },
]

export function WysiwygSection({
  section, index,
  onUpdateTitle, onUpdateBlock,
  onAddBlock, onRemoveSec, onRemoveBlk,
  onAddListItem, onRemoveLastItem,
  onAddTableRow, onRemoveLastRow, onAddTableCol,
  onReorderBlocks,
}: WysiwygSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = section.blocks.findIndex(b => b.id === active.id)
    const newIdx = section.blocks.findIndex(b => b.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) onReorderBlocks(oldIdx, newIdx)
  }

  const h2Content = `${index + 1}. ${section.title}`

  function handleTitleBlur(raw: string) {
    const stripped = raw.replace(/^\d+\.\s*/, '').trim()
    onUpdateTitle(section.id, stripped || section.title)
  }

  return (
    <div ref={setNodeRef} style={style} className="sec-wrap" {...attributes}>

      {/* Drag handle — lives in the left padding gutter, full-height easy target */}
      <div {...listeners} className="sec-drag-handle" title="Drag to reorder section">
        <GripVertical size={16} />
      </div>

      {/* Section content */}
      <div className="doc-section">

        {/* Delete — appears top-right on hover */}
        <button className="sec-delete" onClick={onRemoveSec} title="Delete section">
          <Trash2 size={14} />
        </button>

        <ContentEditable
          tag="h2"
          content={h2Content}
          onBlur={handleTitleBlur}
        />

        {section.blocks.length === 0 && (
          <p className="section-empty">No blocks yet — add one below ↓</p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={section.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            {section.blocks.map((blk: Block) => (
              <WysiwygBlock
                key={blk.id}
                secId={section.id}
                block={blk}
                onUpdate={onUpdateBlock}
                onRemove={() => onRemoveBlk(blk.id)}
                onAddListItem={() => onAddListItem(blk.id)}
                onRemoveLastItem={() => onRemoveLastItem(blk.id)}
                onAddTableRow={() => onAddTableRow(blk.id)}
                onRemoveLastRow={() => onRemoveLastRow(blk.id)}
                onAddTableCol={() => onAddTableCol(blk.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Inline add block row */}
        <div className="inline-add-row">
          <span style={{ fontSize: '0.65rem', color: '#9ca3af', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>add</span>
          {BLOCK_BUTTONS.map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              title={label}
              className="wysiwyg-add-btn"
              onClick={() => onAddBlock(type)}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

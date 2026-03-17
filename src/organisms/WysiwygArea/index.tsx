import './doc.css'
import type { Block, BlockType, DocMeta, Section } from '../../types'
import { ContentEditable } from '../../atoms/ContentEditable'
import { WysiwygSection } from './WysiwygSection'
import { DndContext, closestCenter, type DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useLang } from '../../lib/LangContext'

interface WysiwygAreaProps {
  meta:       DocMeta
  sections:   Section[]
  docTheme:   'light' | 'dark'
  docAccent:  string
  onUpdateMeta:  (patch: Partial<DocMeta>) => void
  onUpdateTitle: (secId: number, title: string) => void
  onUpdateBlock: (secId: number, blkId: number, patch: Partial<Block>) => void
  onAddBlock:    (secId: number, type: BlockType) => void
  onRemoveSec:   (secId: number) => void
  onRemoveBlk:   (secId: number, blkId: number) => void
  onAddListItem:    (secId: number, blkId: number) => void
  onRemoveLastItem: (secId: number, blkId: number) => void
  onAddTableRow:    (secId: number, blkId: number) => void
  onRemoveLastRow:  (secId: number, blkId: number) => void
  onAddTableCol:    (secId: number, blkId: number) => void
  onReorderSections: (oldIdx: number, newIdx: number) => void
  onReorderBlocks:   (secId: number, oldIdx: number, newIdx: number) => void
}

export function WysiwygArea({
  meta, sections, docTheme, docAccent,
  onUpdateMeta, onUpdateTitle, onUpdateBlock,
  onAddBlock, onRemoveSec, onRemoveBlk,
  onAddListItem, onRemoveLastItem,
  onAddTableRow, onRemoveLastRow, onAddTableCol,
  onReorderSections, onReorderBlocks,
}: WysiwygAreaProps) {
  const { t } = useLang()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sections.findIndex(s => s.id === active.id)
    const newIdx = sections.findIndex(s => s.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) onReorderSections(oldIdx, newIdx)
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-canvas)' }}>
      <div
        className={`max-w-215 mx-auto my-8 shadow-lg rounded-sm border-t-4 ${docTheme === 'dark' ? 'doc-dark' : ''}`}
        style={{
          background: docTheme === 'dark' ? '#161b22' : '#ffffff',
          borderTopColor: docAccent,
          '--doc-accent': docAccent,
        } as React.CSSProperties}
      >
      <div className="doc-render">
        {/* Page header */}
        <div className="page-header">
          <ContentEditable
            tag="div"
            className="page-module"
            content={meta.module || t.placeholderModule}
            onBlur={v => onUpdateMeta({ module: v.trim() })}
          />
          <ContentEditable
            tag="h1"
            content={meta.title || t.placeholderTitle}
            onBlur={v => onUpdateMeta({ title: v.trim() })}
          />
          <div className="page-meta">
            <ContentEditable
              tag="span"
              content={meta.env || t.placeholderEnv}
              onBlur={v => onUpdateMeta({ env: v.trim() })}
            />
            <ContentEditable
              tag="span"
              content={meta.date ? `${t.prefixUpdated} ${meta.date}` : t.placeholderDate}
              onBlur={v => {
                const stripped = v.startsWith(t.prefixUpdated)
                  ? v.slice(t.prefixUpdated.length).trim()
                  : v.replace(/^[^:]+:\s*/, '').trim() || v.trim()
                onUpdateMeta({ date: stripped })
              }}
            />
            <ContentEditable
              tag="span"
              content={meta.author ? `${t.prefixAuthor} ${meta.author}` : t.placeholderAuthor}
              onBlur={v => {
                const stripped = v.startsWith(t.prefixAuthor)
                  ? v.slice(t.prefixAuthor.length).trim()
                  : v.replace(/^[^:]+:\s*/, '').trim() || v.trim()
                onUpdateMeta({ author: stripped })
              }}
            />
          </div>
        </div>

        {/* Empty state */}
        {sections.length === 0 && (
          <div className="wysiwyg-empty">
            <strong>{t.nothingYet}</strong>
            <code style={{ background: `color-mix(in srgb, ${docAccent} 10%, ${docTheme === 'dark' ? '#161b22' : '#fff'})`, color: docAccent, padding: '0.1em 0.35em', borderRadius: 3, fontSize: '0.85em' }}>+ {t.addSection}</code> {t.nothingYetHint}
          </div>
        )}

        {/* Sections */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map((sec, index) => (
              <div key={sec.id}>
                <WysiwygSection
                  section={sec}
                  index={index}
                  onUpdateTitle={onUpdateTitle}
                  onUpdateBlock={onUpdateBlock}
                  onAddBlock={type => onAddBlock(sec.id, type)}
                  onRemoveSec={() => onRemoveSec(sec.id)}
                  onRemoveBlk={id => onRemoveBlk(sec.id, id)}
                  onAddListItem={id => onAddListItem(sec.id, id)}
                  onRemoveLastItem={id => onRemoveLastItem(sec.id, id)}
                  onAddTableRow={id => onAddTableRow(sec.id, id)}
                  onRemoveLastRow={id => onRemoveLastRow(sec.id, id)}
                  onAddTableCol={id => onAddTableCol(sec.id, id)}
                  onReorderBlocks={(oldIdx, newIdx) => onReorderBlocks(sec.id, oldIdx, newIdx)}
                />
                {index < sections.length - 1 && <hr />}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>
      </div>
    </div>
  )
}

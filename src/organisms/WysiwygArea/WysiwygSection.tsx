// -- Library Imports --
import { useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

const noopStrategy: SortingStrategy = () => null
import { GripVertical, Trash2 } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../lib/DocumentMutationsContext'
import { useLang } from '../../lib/LangContext'

// -- Component Imports --
import { ContentEditable } from '../../atoms/ContentEditable'
import { WysiwygBlock } from './WysiwygBlock'
import { BLOCK_ICONS } from '../../lib/constants'

// -- Type Imports --
import type { Block, BlockType, Section } from '../../types'

interface WysiwygSectionProps {
   section:         Section
   index:           number
   activeSectionId: string | null
}

export function WysiwygSection({ section, index, activeSectionId }: WysiwygSectionProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)
   const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
   const [dragWidth, setDragWidth] = useState<number | null>(null)
   const containerRef = useRef<HTMLDivElement>(null)
   const { addBlock, removeSection, reorderBlocks, updateTitle, containerMutations } = useDocumentMutations()

   const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: section.id })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   function handleBlockDragStart(event: DragStartEvent) {
      setActiveBlockId(String(event.active.id))
      setDragWidth(containerRef.current?.offsetWidth ?? null)
   }

   function handleDragEnd(event: DragEndEvent) {
      setActiveBlockId(null)
      setDragWidth(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = section.blocks.findIndex(block => block.id === active.id)
      const newIdx = section.blocks.findIndex(block => block.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) {
         const adjustedIdx = oldIdx < newIdx ? newIdx - 1 : newIdx
         reorderBlocks(section.id, oldIdx, adjustedIdx)
      }
   }

   function handleTitleBlur(raw: string) {
      const stripped = raw.replace(/^\d+\.\s*/, '').trim()
      updateTitle(section.id, stripped || section.title)
   }

   return (
      <div
         ref={setNodeRef} style={style} className="sec-wrap" {...attributes}
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => setHovered(false)}
      >
         {/* DnD section insertion indicator — absolute so it doesn't affect layout height */}
         {isOver && activeSectionId !== section.id && (
            <div className="dnd-insert-line" />
         )}

         {/* Drag handle — always in DOM to hold the 2rem gutter; icon shown only while hovered */}
         <div {...listeners} className="sec-drag-handle" title={hovered ? t.dragSection : undefined}>
            {hovered && <GripVertical size={16} />}
         </div>

         {/* Section content */}
         <div className="doc-section">

            {/* Delete — appears top-right only while hovered */}
            {hovered && (
               <button className="sec-delete" onClick={() => removeSection(section.id)} title={t.deleteSection}>
                  <Trash2 size={14} />
               </button>
            )}

            <ContentEditable
               tag="h2"
               content={`${index + 1}. ${section.title}`}
               onBlur={handleTitleBlur}
               singleLine
            />

            {section.blocks.length === 0 && (
               <p className="section-empty">{t.noBlocks}</p>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleBlockDragStart} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveBlockId(null); setDragWidth(null) }}>
               <div ref={containerRef}>
                  <SortableContext items={section.blocks.map(block => block.id)} strategy={noopStrategy}>
                     {section.blocks.map((block: Block) => (
                        <WysiwygBlock
                           key={block.id}
                           secId={section.id}
                           block={block}
                           containerMutations={containerMutations}
                           activeBlockId={activeBlockId}
                        />
                     ))}
                  </SortableContext>
               </div>
               <DragOverlay>
                  {activeBlockId && (() => {
                     const activeBlock = section.blocks.find(block => block.id === activeBlockId)
                     return activeBlock ? (
                        <div style={{ width: dragWidth ?? undefined, pointerEvents: 'none', opacity: 0.9 }}>
                           <WysiwygBlock
                              secId={section.id}
                              block={activeBlock}
                              inner
                              onUpdate={() => {}}
                              onRemove={() => {}}
                           />
                        </div>
                     ) : null
                  })()}
               </DragOverlay>
            </DndContext>

            {/* Inline add block row */}
            <div className="inline-add-row">
               <span style={{ fontSize: '0.65rem', color: '#9ca3af', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.add}</span>
               {BLOCK_ICONS.map(({ type, icon: Icon }) => {
                  const labels: Record<BlockType, string> = {
                     p: t.blockParagraph, h3: t.blockH3, h4: t.blockH4,
                     callout: t.blockCallout, code: t.blockCode, list: t.blockList, table: t.blockTable,
                     image: t.blockImage, container: t.blockContainer,
                  }
                  return (
                     <button
                        key={type}
                        title={labels[type]}
                        className="wysiwyg-add-btn"
                        onClick={() => addBlock(section.id, type)}
                     >
                        <Icon size={13} />
                     </button>
                  )
               })}
            </div>
         </div>
      </div>
   )
}

// -- Library Imports --
import { useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

const noopStrategy: SortingStrategy = () => null
import { GripVertical, Trash2 } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { ContentEditable } from '../../atoms/ContentEditable'
import { AddBlockRow } from '../../molecules/AddBlockRow'
import { WysiwygBlock } from './WysiwygBlock'

// -- Type Imports --
import type { Block, Section } from '../../types'

interface WysiwygSectionProps {
   section:         Section
   index:           number
   activeSectionId: string | null
   readOnly?:       boolean
}

export function WysiwygSection({ section, index, activeSectionId, readOnly }: WysiwygSectionProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)
   const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
   const [dragWidth, setDragWidth] = useState<number | null>(null)
   const containerRef = useRef<HTMLDivElement>(null)
   const { addBlock, removeSection, reorderBlocks, updateTitle, containerMutations } = useDocumentMutations()

   const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: section.id, disabled: !!readOnly })
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
         ref={readOnly ? undefined : setNodeRef}
         style={style}
         className="sec-wrap"
         {...(readOnly ? {} : attributes)}
         onMouseEnter={readOnly ? undefined : () => setHovered(true)}
         onMouseLeave={readOnly ? undefined : () => setHovered(false)}
      >
         {/* DnD section insertion indicator */}
         {!readOnly && isOver && activeSectionId !== section.id && (
            <div className="absolute -top-px left-0 right-0 h-0.5 rounded-sm opacity-70 pointer-events-none" style={{ background: 'var(--doc-accent, var(--color-accent))' }} />
         )}

         {/* Drag handle — always in DOM to hold the 2rem gutter */}
         <div
            {...(readOnly ? {} : listeners)}
            className="sec-drag-handle"
            title={!readOnly && hovered ? t.dragSection : undefined}
         >
            {!readOnly && hovered && <GripVertical size={16} />}
         </div>

         {/* Section content */}
         <div className="doc-section">

            {/* Delete — appears top-right only while hovered, never in readOnly */}
            {!readOnly && hovered && (
               <button className="sec-delete" onClick={() => removeSection(section.id)} title={t.deleteSection}>
                  <Trash2 size={14} />
               </button>
            )}

            <ContentEditable
               tag="h2"
               content={`${index + 1}. ${section.title}`}
               onBlur={handleTitleBlur}
               singleLine
               readOnly={readOnly}
            />

            {section.blocks.length === 0 && (
               <p className="section-empty">{t.noBlocks}</p>
            )}

            {readOnly ? (
               <div ref={containerRef}>
                  {section.blocks.map((block: Block) => (
                     <WysiwygBlock
                        key={block.id}
                        secId={section.id}
                        block={block}
                        readOnly
                     />
                  ))}
               </div>
            ) : (
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
            )}

            {!readOnly && <AddBlockRow docStyle onAdd={type => addBlock(section.id, type)} />}
         </div>
      </div>
   )
}

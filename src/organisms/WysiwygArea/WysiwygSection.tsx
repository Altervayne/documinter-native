// -- Library Imports --
import { useRef, useState } from 'react'
import type React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

const noopStrategy: SortingStrategy = () => null
import {
   GripVertical, SquareDashed, Trash2,
   ArrowUpFromLine, ArrowDownToLine, ChevronUp, ChevronDown,
   Copy, Pencil,
} from 'lucide-react'
import { BlockTypePicker } from '../../molecules/BlockTypePicker'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { PlainEditable } from '../../atoms/PlainEditable'
import { AddBlockRow } from '../../molecules/AddBlockRow'
import { BottomDropZone } from '../../atoms/BottomDropZone'
import { DropIndicator } from '../../atoms/DropIndicator'
import { WysiwygBlock } from './WysiwygBlock'

// -- Lib Imports --
import { mkSection } from '../../lib/document'

// -- Type Imports --
import type { Block, Section } from '../../types'

interface WysiwygSectionProps {
   section:         Section
   index:           number
   /** Whether this is the last section in the document, disables the section menu's Move down. */
   isLastSection?:  boolean
   activeSectionId: string | null
   readOnly?:       boolean
}

export function WysiwygSection({ section, index, isLastSection, activeSectionId, readOnly }: WysiwygSectionProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)
   const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
   const [dragWidth, setDragWidth] = useState<number | null>(null)
   const [emptyPickerOpen, setEmptyPickerOpen] = useState(false)
   const [emptyPickerRect, setEmptyPickerRect] = useState<DOMRect | null>(null)
   const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number } | null>(null)
   const emptyCardRef = useRef<HTMLDivElement>(null)
   const containerRef = useRef<HTMLDivElement>(null)
   const {
      addBlock, insertBlockAt, removeSection, reorderBlocks, updateTitle, containerMutations,
      insertSectionAt, moveSecUp, moveSecDown, duplicateSec,
   } = useDocumentMutations()

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
      if (oldIdx === -1) return
      const newIdx = section.blocks.findIndex(block => block.id === over.id)
      if (newIdx === -1) {
         // Dropped on the bottom zone, move item to the last position
         const lastIdx = section.blocks.length - 1
         if (oldIdx !== lastIdx) reorderBlocks(section.id, oldIdx, lastIdx)
         return
      }
      const adjustedIdx = oldIdx < newIdx ? newIdx - 1 : newIdx
      reorderBlocks(section.id, oldIdx, adjustedIdx)
   }

   function handleTitleBlur(raw: string) {
      const stripped = raw.replace(/^\d+\.\s*/, '').trim()
      updateTitle(section.id, stripped || section.title)
   }

   // ====================================
   //  Section context menu (right-click on the gutter / title chrome)
   // ====================================
   function handleSectionContextMenu(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      setSectionMenu({ x: event.clientX, y: event.clientY })
   }

   /** Focuses the section title for editing, the "Rename" menu action. Queried by the section's
    *  own data-section-id rather than a ref, since PlainEditable doesn't forward one. */
   function focusTitle() {
      const titleEl = document.querySelector<HTMLElement>(`[data-section-id="${section.id}"] h2`)
      titleEl?.focus()
   }

   function buildSectionMenuEntries(): ContextMenuEntry[] {
      return [
         { label: t.sectionMenuInsertAbove, icon: <ArrowUpFromLine size={13} />, onSelect: () => insertSectionAt(index, mkSection(t.defaultSectionTitle)) },
         { label: t.sectionMenuInsertBelow, icon: <ArrowDownToLine size={13} />, onSelect: () => insertSectionAt(index + 1, mkSection(t.defaultSectionTitle)) },
         { type: 'separator' },
         { label: t.sectionMenuMoveUp,   icon: <ChevronUp size={13} />,   disabled: index === 0, onSelect: () => moveSecUp(section.id) },
         { label: t.sectionMenuMoveDown, icon: <ChevronDown size={13} />, disabled: !!isLastSection, onSelect: () => moveSecDown(section.id) },
         { label: t.sectionMenuDuplicate, icon: <Copy size={13} />, onSelect: () => duplicateSec(section.id) },
         { type: 'separator' },
         { label: t.sectionMenuRename, icon: <Pencil size={13} />, onSelect: focusTitle },
         { type: 'separator' },
         { label: t.sectionMenuDelete, icon: <Trash2 size={13} />, danger: true, onSelect: () => removeSection(section.id) },
      ]
   }

   return (
      <div
         ref={readOnly ? undefined : setNodeRef}
         style={style}
         className="sec-wrap"
         data-section-id={section.id}
         {...(readOnly ? {} : attributes)}
         onMouseEnter={readOnly ? undefined : () => setHovered(true)}
         onMouseLeave={readOnly ? undefined : () => setHovered(false)}
      >
         {/* DnD section insertion indicator */}
         {!readOnly && isOver && activeSectionId !== section.id && <DropIndicator />}

         {/* Drag handle, always in DOM to hold the 2rem gutter, section chrome, opens the section menu */}
         <div
            {...(readOnly ? {} : listeners)}
            className="sec-drag-handle"
            title={!readOnly && hovered ? t.dragSection : undefined}
            onContextMenu={readOnly ? undefined : handleSectionContextMenu}
         >
            {!readOnly && hovered && <GripVertical size={22} />}
         </div>

         {/* Section content */}
         <div className="doc-section">

            {/* Delete, appears top-right only while hovered, never in readOnly */}
            {!readOnly && hovered && (
               <button className="sec-delete" onClick={() => removeSection(section.id)} title={t.deleteSection}>
                  <Trash2 size={16} />
               </button>
            )}

            {/* Title chrome, also opens the section menu */}
            <div onContextMenu={readOnly ? undefined : handleSectionContextMenu}>
               <PlainEditable
                  tag="h2"
                  content={`${index + 1}. ${section.title}`}
                  onBlur={handleTitleBlur}
                  singleLine
                  readOnly={readOnly}
               />
            </div>

            {!readOnly && sectionMenu && (
               <ContextMenu
                  position={sectionMenu}
                  entries={buildSectionMenuEntries()}
                  onClose={() => setSectionMenu(null)}
               />
            )}

            {section.blocks.length === 0 && !readOnly && (
               <>
                  <div
                     ref={emptyCardRef}
                     onClick={() => {
                        setEmptyPickerRect(emptyCardRef.current?.getBoundingClientRect() ?? null)
                        setEmptyPickerOpen(true)
                     }}
                     className="doc-empty-section w-full flex flex-col items-center gap-3 py-10 px-6 rounded-xl border border-dashed text-center my-2 cursor-pointer select-none"
                  >
                     <SquareDashed size={32} style={{ color: 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 30%, transparent)' }} />
                     <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium opacity-60">{t.emptySection}</p>
                        <p className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 60%, transparent)' }}>{t.emptySectionHint}</p>
                     </div>
                  </div>
                  {emptyPickerOpen && emptyPickerRect && (
                     <BlockTypePicker
                        anchorRect={emptyPickerRect}
                        onSelect={type => { addBlock(section.id, type); setEmptyPickerOpen(false) }}
                        onClose={() => setEmptyPickerOpen(false)}
                     />
                  )}
               </>
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
                        {section.blocks.map((block: Block, blockIndex: number) => (
                           <WysiwygBlock
                              key={block.id}
                              secId={section.id}
                              block={block}
                              containerMutations={containerMutations}
                              activeBlockId={activeBlockId}
                              onInsertBefore={type => insertBlockAt(section.id, blockIndex, type)}
                              onInsertAfter={type => insertBlockAt(section.id, blockIndex + 1, type)}
                              onMoveUp={blockIndex > 0 ? () => reorderBlocks(section.id, blockIndex, blockIndex - 1) : undefined}
                              onMoveDown={blockIndex < section.blocks.length - 1 ? () => reorderBlocks(section.id, blockIndex, blockIndex + 1) : undefined}
                           />
                        ))}
                     </SortableContext>
                     {activeBlockId !== null && <BottomDropZone id={`${section.id}-bottom`} />}
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

            {!readOnly && section.blocks.length > 0 && (
               <AddBlockRow onAdd={type => addBlock(section.id, type)} />
            )}
         </div>
      </div>
   )
}

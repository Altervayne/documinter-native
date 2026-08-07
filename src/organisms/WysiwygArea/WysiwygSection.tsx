// -- Library Imports --
import { useRef, useState } from 'react'
import type React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
   /** Id of the block being dragged anywhere on the canvas (the shared block DnD context lives in
    *  index.tsx). Drives this section's block insertion lines + its bottom drop zone. */
   activeBlockId?:  string | null
   readOnly?:       boolean
   // ==========================================================
   //  Paged-format slice rendering. When a section spans a page break it is rendered as several
   //  slices (one per page it touches), each a WysiwygSection over a SUBSET of the section's
   //  blocks. Absent = infinite mode = the whole-section render (byte-identical).
   // ==========================================================
   /** Render only these blocks (a page slice). Block indices are still resolved ABSOLUTELY against
    *  section.blocks, so insert/move/reorder stay correct. Absent = render the whole section. */
   renderBlocks?:   Block[]
   /** Render the section title chrome + empty-state (the slice that STARTS the section). Default true. */
   showTitle?:      boolean
   /** Render the trailing add-block row + bottom drop zone (the slice that ENDS the section). Default true. */
   showAddRow?:     boolean
   /** The dnd-kit sortable id for this instance. Per-slice-unique in paged mode so a split section's
    *  two slices never register the same id twice. Default = section.id (infinite mode). */
   sortableId?:     string
   /** Disable canvas section drag-reorder (paged mode routes section reorder through the sidebar /
    *  the section context menu instead, since a split section can't drag across sheets). Default false. */
   sectionDragDisabled?: boolean
   /** Hide the end-of-section block drop zone (paged mode uses a per-page end zone instead, so a page
    *  that ends mid-section still has an append target). The add-block row is kept. Default false. */
   suppressEndDropZone?: boolean
}

export function WysiwygSection({
   section, index, isLastSection, activeSectionId, activeBlockId, readOnly,
   renderBlocks, showTitle = true, showAddRow = true, sortableId, sectionDragDisabled, suppressEndDropZone,
}: WysiwygSectionProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)
   const [emptyPickerOpen, setEmptyPickerOpen] = useState(false)
   const [emptyPickerRect, setEmptyPickerRect] = useState<DOMRect | null>(null)
   const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number } | null>(null)
   const emptyCardRef = useRef<HTMLDivElement>(null)
   const {
      addBlock, insertBlockAt, removeSection, reorderBlocks, updateTitle, containerMutations,
      insertSectionAt, moveSecUp, moveSecDown, duplicateSec,
   } = useDocumentMutations()

   const sectionDragOff = !!readOnly || !!sectionDragDisabled
   const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: sortableId ?? section.id, disabled: sectionDragOff, data: { type: 'section' } })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

   // The blocks this instance renders: a page slice's subset in paged mode, else the whole section.
   // Absolute indices are always resolved against section.blocks so mutations address the right block.
   const blocksToRender = renderBlocks ?? section.blocks
   const bottomZoneId   = `${sortableId ?? section.id}-bottom`
   // This section body's block-array location (drag data for the shared block DnD handler).
   const sectionLoc = { kind: 'section' as const, sectionId: section.id }

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
         ref={sectionDragOff ? undefined : setNodeRef}
         style={style}
         className="sec-wrap"
         data-section-id={section.id}
         {...(sectionDragOff ? {} : attributes)}
         onMouseEnter={readOnly ? undefined : () => setHovered(true)}
         onMouseLeave={readOnly ? undefined : () => setHovered(false)}
      >
         {/* DnD section insertion indicator */}
         {!sectionDragOff && isOver && activeSectionId !== section.id && <DropIndicator />}

         {/* Drag handle, always in DOM to hold the 2rem gutter, section chrome, opens the section menu.
             In paged mode canvas section drag is off (a split section can't drag across sheets), so the
             grip + listeners are suppressed; the section context menu (right-click) still works. */}
         <div
            {...(sectionDragOff ? {} : listeners)}
            className="sec-drag-handle"
            title={!sectionDragOff && hovered ? t.dragSection : undefined}
            onContextMenu={readOnly ? undefined : handleSectionContextMenu}
         >
            {!sectionDragOff && hovered && <GripVertical size={22} />}
         </div>

         {/* Section content */}
         <div className="doc-section">

            {/* Delete, appears top-right only while hovered, on the section-start slice, never readOnly */}
            {!readOnly && showTitle && hovered && (
               <button className="sec-delete" onClick={() => removeSection(section.id)} title={t.deleteSection}>
                  <Trash2 size={16} />
               </button>
            )}

            {/* Title chrome, also opens the section menu. Only the slice that STARTS the section shows
                the title; a page-continuation slice renders its blocks with no title. */}
            {showTitle && (
               <div onContextMenu={readOnly ? undefined : handleSectionContextMenu}>
                  <PlainEditable
                     tag="h2"
                     content={`${index + 1}. ${section.title}`}
                     onBlur={handleTitleBlur}
                     singleLine
                     readOnly={readOnly}
                  />
               </div>
            )}

            {!readOnly && sectionMenu && (
               <ContextMenu
                  position={sectionMenu}
                  entries={buildSectionMenuEntries()}
                  onClose={() => setSectionMenu(null)}
               />
            )}

            {section.blocks.length === 0 && showTitle && !readOnly && (
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
               <div>
                  {blocksToRender.map((block: Block) => (
                     <WysiwygBlock
                        key={block.id}
                        secId={section.id}
                        block={block}
                        readOnly
                     />
                  ))}
               </div>
            ) : (
               // The block SortableContext lives under the ONE shared DnD context (index.tsx); this
               // section owns no DndContext, so a drag can cross into other sections / sheets.
               <div>
                  <SortableContext items={blocksToRender.map(block => block.id)} strategy={noopStrategy}>
                     {blocksToRender.map((block: Block) => {
                        // Absolute index in section.blocks (blocksToRender may be a page-slice subset),
                        // so insert / move / reorder always address the right position in the section.
                        const blockIndex = section.blocks.findIndex(candidate => candidate.id === block.id)
                        return (
                        <WysiwygBlock
                           key={block.id}
                           secId={section.id}
                           block={block}
                           blockLoc={sectionLoc}
                           containerMutations={containerMutations}
                           activeBlockId={activeBlockId}
                           onInsertBefore={type => insertBlockAt(section.id, blockIndex, type)}
                           onInsertAfter={type => insertBlockAt(section.id, blockIndex + 1, type)}
                           onMoveUp={blockIndex > 0 ? () => reorderBlocks(section.id, blockIndex, blockIndex - 1) : undefined}
                           onMoveDown={blockIndex < section.blocks.length - 1 ? () => reorderBlocks(section.id, blockIndex, blockIndex + 1) : undefined}
                        />
                        )
                     })}
                  </SortableContext>
                  {activeBlockId != null && showAddRow && !suppressEndDropZone && <BottomDropZone id={bottomZoneId} data={{ type: 'block-zone', loc: sectionLoc }} />}
               </div>
            )}

            {!readOnly && showAddRow && section.blocks.length > 0 && (
               <AddBlockRow onAdd={type => addBlock(section.id, type)} />
            )}
         </div>
      </div>
   )
}

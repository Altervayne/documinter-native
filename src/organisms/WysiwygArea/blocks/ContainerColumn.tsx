// -- React Imports --
import { useRef, useState } from 'react'

// -- Library Imports --
import {
   DndContext, DragOverlay, closestCenter,
   type DragEndEvent, type DragStartEvent,
   useSensor, useSensors, PointerSensor,
} from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

// -- Context / Hook Imports --
import { useLang } from '../../../contexts/LangContext'

// -- Component Imports --
// NOTE: WysiwygBlock is imported here creating a circular dep (ContainerColumn → WysiwygBlock → ContainerBlock → ContainerColumn).
// This is intentional and safe: both references are inside function bodies, never at module-evaluation time.
import { WysiwygBlock } from '../WysiwygBlock'
import { AddBlockRow } from '../../../molecules/AddBlockRow'
import { BottomDropZone } from '../../../atoms/BottomDropZone'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations, InlineContent, ListItem, Side } from '../../../types'

// ######################################################################
// # DND STRATEGY, ITEMS STAY IN PLACE; DRAGOVERLAY PROVIDES THE GHOST #
// ######################################################################

const noopStrategy: SortingStrategy = () => null

// #########
// # TYPES #
// #########

interface ContainerColumnProps {
   secId:     string
   blkId:     string
   side:      Side
   blocks:    Block[]
   cm:        ContainerMutations
   readOnly?: boolean
}

// #############
// # COMPONENT #
// #############

export function ContainerColumn({ secId, blkId, side, blocks, cm, readOnly }: ContainerColumnProps) {
   const { t } = useLang()

   const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
   const [dragWidth, setDragWidth] = useState<number | null>(null)
   const containerRef = useRef<HTMLDivElement>(null)

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   function handleDragStart(event: DragStartEvent) {
      setActiveBlockId(String(event.active.id))
      setDragWidth(containerRef.current?.offsetWidth ?? null)
   }

   function handleDragEnd(event: DragEndEvent) {
      setActiveBlockId(null)
      setDragWidth(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = blocks.findIndex(block => block.id === active.id)
      if (oldIdx === -1) return
      const newIdx = blocks.findIndex(block => block.id === over.id)
      if (newIdx === -1) {
         // Dropped on the bottom zone, move item to the last position
         const lastIdx = blocks.length - 1
         if (oldIdx !== lastIdx) cm.moveBlock(secId, blkId, side, oldIdx, lastIdx)
         return
      }
      const adjustedIdx = oldIdx < newIdx ? newIdx - 1 : newIdx
      cm.moveBlock(secId, blkId, side, oldIdx, adjustedIdx)
   }

   function handleDragCancel() {
      setActiveBlockId(null)
      setDragWidth(null)
   }

   // ===========================
   //  Build inner-block prop set
   // ===========================

   function makeInnerProps(innerBlock: Block, idx: number) {
      return {
         secId,
         block:    innerBlock,
         inner:    true as const,
         draggable: true,
         gripSide:  side === 'right' ? 'right' as const : 'left' as const,
         activeBlockId,
         onUpdate: (_sid: string, innerBlkId: string, patch: Partial<Block>) =>
            cm.updateBlock(secId, blkId, side, innerBlkId, patch),
         onRemove:        () => cm.removeBlock(secId, blkId, side, innerBlock.id),
         onDuplicate:     () => cm.duplicateBlock(secId, blkId, side, innerBlock.id),
         onInsertBefore:  (type: BlockType) => cm.insertBlockAt(secId, blkId, side, idx, type),
         onInsertAfter:   (type: BlockType) => cm.insertBlockAt(secId, blkId, side, idx + 1, type),
         onMoveUp:         idx > 0                ? () => cm.moveBlock(secId, blkId, side, idx, idx - 1) : undefined,
         onMoveDown:       idx < blocks.length - 1 ? () => cm.moveBlock(secId, blkId, side, idx, idx + 1) : undefined,
         onAddListItem:       () => cm.addListItem(secId, blkId, side, innerBlock.id),
         onAddTableRow:       () => cm.addTableRow(secId, blkId, side, innerBlock.id),
         onRemoveLastRow:     () => cm.removeLastRow(secId, blkId, side, innerBlock.id),
         onAddTableCol:       () => cm.addTableCol(secId, blkId, side, innerBlock.id),
         onInsertTableRowAt:  (rowIndex: number) => cm.insertTableRowAt(secId, blkId, side, innerBlock.id, rowIndex),
         onDeleteTableRowAt:  (rowIndex: number) => cm.deleteTableRowAt(secId, blkId, side, innerBlock.id, rowIndex),
         onInsertTableColAt:  (colIndex: number) => cm.insertTableColAt(secId, blkId, side, innerBlock.id, colIndex),
         onDeleteTableColAt:  (colIndex: number) => cm.deleteTableColAt(secId, blkId, side, innerBlock.id, colIndex),
         onMoveListItemUp:        (itemId: string) => cm.moveListItemUp(secId, blkId, side, innerBlock.id, itemId),
         onMoveListItemDown:      (itemId: string) => cm.moveListItemDown(secId, blkId, side, innerBlock.id, itemId),
         onIndentListItem:        (itemId: string) => cm.indentListItem(secId, blkId, side, innerBlock.id, itemId),
         onUnindentListItem:      (itemId: string) => cm.unindentListItem(secId, blkId, side, innerBlock.id, itemId),
         onRemoveListItem:        (itemId: string) => cm.removeListItem(secId, blkId, side, innerBlock.id, itemId),
         onInsertListItemAfter:   (afterItemId: string, newItem: ListItem) => cm.insertListItemAfter(secId, blkId, side, innerBlock.id, afterItemId, newItem),
         onUpdateListItemRichText:(itemId: string, richText: InlineContent) => cm.updateListItemRichText(secId, blkId, side, innerBlock.id, itemId, richText),
         onReorderListItems:      (parentItemId: string | null, oldIndex: number, newIndex: number) => cm.reorderListItemsUnderParent(secId, blkId, side, innerBlock.id, parentItemId, oldIndex, newIndex),
      }
   }

   // =======
   //  Render
   // =======

   return (
      <div className="container-col">
         <div className="container-col-label">{side === 'left' ? t.leftColumn : t.rightColumn}</div>

         {readOnly ? (
            blocks.map((block, idx) => (
               <WysiwygBlock key={block.id} {...makeInnerProps(block, idx)} readOnly />
            ))
         ) : (
            <DndContext
               sensors={sensors}
               collisionDetection={closestCenter}
               onDragStart={handleDragStart}
               onDragEnd={handleDragEnd}
               onDragCancel={handleDragCancel}
            >
               <div ref={containerRef}>
                  <SortableContext items={blocks.map(block => block.id)} strategy={noopStrategy}>
                     {blocks.map((block, idx) => (
                        <WysiwygBlock key={block.id} {...makeInnerProps(block, idx)} />
                     ))}
                  </SortableContext>
                  {activeBlockId !== null && <BottomDropZone id={`${blkId}-${side}-bottom`} />}
               </div>
               <DragOverlay>
                  {activeBlockId && (() => {
                     const activeBlock = blocks.find(block => block.id === activeBlockId)
                     return activeBlock ? (
                        <div style={{ width: dragWidth ?? undefined, pointerEvents: 'none', opacity: 0.9 }}>
                           <WysiwygBlock
                              secId={secId}
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

         {!readOnly && <AddBlockRow insideContainer onAdd={(type: BlockType) => cm.addBlock(secId, blkId, side, type)} />}
      </div>
   )
}

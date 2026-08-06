// -- Library Imports --
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

// -- Context / Hook Imports --
import { useLang } from '../../../contexts/LangContext'

// -- Component Imports --
// WysiwygBlock is imported here, creating a circular dependency (ContainerColumn -> WysiwygBlock ->
// ContainerBlock -> ContainerColumn). This is safe: both references are used inside function bodies,
// never at module-evaluation time.
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
   /** Id of the block being dragged anywhere on the canvas (the shared block DnD context lives in
    *  index.tsx). Drives this column's inner insertion lines + its bottom drop zone. */
   activeBlockId?: string | null
   readOnly?: boolean
}

// #############
// # COMPONENT #
// #############

export function ContainerColumn({ secId, blkId, side, blocks, cm, activeBlockId, readOnly }: ContainerColumnProps) {
   const { t } = useLang()

   // This column's block-array location, attached to inner blocks + the bottom zone as drag data so the
   // shared block DnD handler can move a block into / out of this container.
   const columnLoc = { kind: 'column' as const, sectionId: secId, blockId: blkId, side }

   // ===========================
   //  Build inner-block prop set
   // ===========================

   function makeInnerProps(innerBlock: Block, idx: number) {
      return {
         secId,
         block:    innerBlock,
         blockLoc: columnLoc,
         inner:    true as const,
         draggable: true,
         gripSide:  side === 'right' ? 'right' as const : 'left' as const,
         activeBlockId,
         onUpdate: (_sid: string, innerBlkId: string, patch: Partial<Block>) =>
            cm.updateBlock(secId, blkId, side, innerBlkId, patch),
         onRemove:        () => cm.removeBlock(secId, blkId, side, innerBlock.id),
         onDuplicate:     () => cm.duplicateBlock(secId, blkId, side, innerBlock.id),
         onInsertBlockAfter: (newBlock: Block) => cm.insertBlockAfter(secId, blkId, side, innerBlock.id, newBlock),
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
         onToggleChecklistItem:   (itemId: string) => cm.toggleChecklistItem(secId, blkId, side, innerBlock.id, itemId),
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
            // The column's block SortableContext lives under the ONE shared DnD context (index.tsx),
            // so a block can be dragged into / out of this container (the drag ghost is shared too).
            <div>
               <SortableContext items={blocks.map(block => block.id)} strategy={noopStrategy}>
                  {blocks.map((block, idx) => (
                     <WysiwygBlock key={block.id} {...makeInnerProps(block, idx)} />
                  ))}
               </SortableContext>
               {activeBlockId != null && <BottomDropZone id={`${blkId}-${side}-bottom`} data={{ type: 'block-zone', loc: columnLoc }} />}
            </div>
         )}

         {!readOnly && <AddBlockRow insideContainer onAdd={(type: BlockType) => cm.addBlock(secId, blkId, side, type)} />}
      </div>
   )
}

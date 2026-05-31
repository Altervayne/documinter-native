// -- Context / Hook Imports --
import { useLang } from '../../../contexts/LangContext'

// -- Component Imports --
// NOTE: WysiwygBlock is imported here creating a circular dep (ContainerColumn → WysiwygBlock → ContainerBlock → ContainerColumn).
// This is intentional and safe: both references are inside function bodies, never at module-evaluation time.
import { WysiwygBlock } from '../WysiwygBlock'

// -- Component Imports --
import { AddBlockRow } from '../../../molecules/AddBlockRow'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations } from '../../../types'

interface ContainerColumnProps {
   secId:     string
   blkId:     string
   side:      'left' | 'right'
   blocks:    Block[]
   cm:        ContainerMutations
   readOnly?: boolean
}

export function ContainerColumn({ secId, blkId, side, blocks, cm, readOnly }: ContainerColumnProps) {
   const { t } = useLang()

   function makeInnerProps(innerBlock: Block, idx: number) {
      return {
         secId,
         block: innerBlock,
         inner: true as const,
         onUpdate: (_sid: string, innerBlkId: string, patch: Partial<Block>) =>
            cm.updateBlock(secId, blkId, side, innerBlkId, patch),
         onRemove: () => cm.removeBlock(secId, blkId, side, innerBlock.id),
         onMoveUp:         idx > 0                ? () => cm.moveBlock(secId, blkId, side, idx, idx - 1) : undefined,
         onMoveDown:       idx < blocks.length - 1 ? () => cm.moveBlock(secId, blkId, side, idx, idx + 1) : undefined,
         onAddListItem:    () => cm.addListItem(secId, blkId, side, innerBlock.id),
         onRemoveLastItem: () => cm.removeLastItem(secId, blkId, side, innerBlock.id),
         onAddTableRow:    () => cm.addTableRow(secId, blkId, side, innerBlock.id),
         onRemoveLastRow:  () => cm.removeLastRow(secId, blkId, side, innerBlock.id),
         onAddTableCol:    () => cm.addTableCol(secId, blkId, side, innerBlock.id),
      }
   }

   return (
      <div className="container-col">
         <div className="container-col-label">{side === 'left' ? t.leftColumn : t.rightColumn}</div>
         {blocks.map((block, idx) => (
            <WysiwygBlock key={block.id} {...makeInnerProps(block, idx)} readOnly={readOnly} />
         ))}
         {!readOnly && <AddBlockRow insideContainer docStyle onAdd={(type: BlockType) => cm.addBlock(secId, blkId, side, type)} />}
      </div>
   )
}

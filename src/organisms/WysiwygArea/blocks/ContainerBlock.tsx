// -- React Imports --
import type React from 'react'

// -- Context / Hook Imports --
import { useLang } from '../../../lib/LangContext'

// -- Component Imports --
import { AddBlockRow } from '../../../molecules/AddBlockRow'
// NOTE: WysiwygBlock is imported here creating a circular dep (ContainerBlock → WysiwygBlock → ContainerBlock).
// This is intentional and safe: both references are inside function bodies, never at module-evaluation time.
import { WysiwygBlock } from '../WysiwygBlock'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations } from '../../../types'

// ── ContainerColumn ───────────────────────────────────────────────────────────

interface ContainerColumnProps {
   secId:  string
   blkId:  string
   side:   'left' | 'right'
   blocks: Block[]
   cm:     ContainerMutations
}

function ContainerColumn({ secId, blkId, side, blocks, cm }: ContainerColumnProps) {
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
            <WysiwygBlock key={block.id} {...makeInnerProps(block, idx)} />
         ))}
         <AddBlockRow insideContainer docStyle onAdd={(type: BlockType) => cm.addBlock(secId, blkId, side, type)} />
      </div>
   )
}

// ── ContainerBlock ────────────────────────────────────────────────────────────

export interface ContainerBlockProps {
   block:              Block
   patch:              (partial: Partial<Block>) => void
   containerMutations: ContainerMutations
   secId:              string
}

export function ContainerBlock({ block, patch, containerMutations, secId }: ContainerBlockProps) {
   const ratio = block.ratio ?? 0.5

   function handleDividerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      event.preventDefault()
      const parent = event.currentTarget.parentElement!
      const rect   = parent.getBoundingClientRect()
      function onMove(pointerEvent: PointerEvent) {
         const newRatio = Math.max(0.1, Math.min(0.9, (pointerEvent.clientX - rect.left) / rect.width))
         patch({ ratio: Math.round(newRatio * 100) / 100 })
      }
      function onUp() {
         document.removeEventListener('pointermove', onMove)
         document.removeEventListener('pointerup',   onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup',   onUp)
   }

   return (
      <div className="container-block">
         <div className="container-cols">
            <div style={{ flex: ratio, minWidth: 0 }}>
               <ContainerColumn
                  secId={secId} blkId={block.id} side="left"
                  blocks={block.left ?? []} cm={containerMutations}
               />
            </div>
            <div className="container-divider" onPointerDown={handleDividerPointerDown}>
               <span className="container-ratio-badge">
                  {Math.round(ratio * 100)}/{Math.round((1 - ratio) * 100)}
               </span>
            </div>
            <div style={{ flex: 1 - ratio, minWidth: 0 }}>
               <ContainerColumn
                  secId={secId} blkId={block.id} side="right"
                  blocks={block.right ?? []} cm={containerMutations}
               />
            </div>
         </div>
      </div>
   )
}

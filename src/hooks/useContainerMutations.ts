// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Lib / Util Imports --
import { cloneBlock, mkBlock, moveItem, mutateSec } from '../lib/document'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations, Section, Side } from '../types'
import type { T } from '../lib/i18n'

function mutateContainer(
   setSections: Dispatch<SetStateAction<Section[]>>,
   secId: string,
   blkId: string,
   side: Side,
   fn: (blocks: Block[]) => Block[],
) {
   mutateSec(setSections, secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(block => {
         if (block.id !== blkId || block.type !== 'container') return block
         return { ...block, [side]: fn(block[side] ?? []) }
      }),
   }))
}

export function useContainerMutations(
   setSections: Dispatch<SetStateAction<Section[]>>,
   t: T,
): ContainerMutations {
   return {
      updateBlock: useCallback((secId, blkId, side, innerBlkId, patch) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => block.id === innerBlkId ? { ...block, ...patch } : block)
         )
      }, [setSections]),

      addBlock: useCallback((secId, blkId, side, type: BlockType) => {
         mutateContainer(setSections, secId, blkId, side, blocks => [...blocks, mkBlock(type, t)])
      }, [setSections, t]),

      insertBlockAt: useCallback((secId, blkId, side, index, type: BlockType) => {
         mutateContainer(setSections, secId, blkId, side, blocks => {
            const next = [...blocks]
            next.splice(index, 0, mkBlock(type, t))
            return next
         })
      }, [setSections, t]),

      duplicateBlock: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks => {
            const blockIndex = blocks.findIndex(block => block.id === innerBlkId)
            if (blockIndex === -1) return blocks
            const clone = cloneBlock(blocks[blockIndex])
            const next  = [...blocks]
            next.splice(blockIndex + 1, 0, clone)
            return next
         })
      }, [setSections]),

      removeBlock: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks => blocks.filter(block => block.id !== innerBlkId))
      }, [setSections]),

      moveBlock: useCallback((secId, blkId, side, from, to) => {
         mutateContainer(setSections, secId, blkId, side, blocks => moveItem(blocks, from, to))
      }, [setSections]),

      addListItem: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block =>
               block.id === innerBlkId && block.type === 'list'
                  ? { ...block, items: [...(block.items ?? []), { id: crypto.randomUUID(), richText: [{ text: t.newItem }], children: [] }] }
                  : block
            )
         )
      }, [setSections, t]),

      removeLastItem: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block =>
               block.id === innerBlkId && block.type === 'list' && (block.items?.length ?? 0) > 1
                  ? { ...block, items: block.items!.slice(0, -1) }
                  : block
            )
         )
      }, [setSections]),

      addTableRow: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               const columnCount = (block.richHeaders ?? []).length
               const emptyRow: import('../types').InlineContent[] = Array.from({ length: columnCount }, () => [])
               return {
                  ...block,
                  richRows: [...(block.richRows ?? []), emptyRow],
               }
            })
         )
      }, [setSections]),

      removeLastRow: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               if ((block.richRows ?? []).length <= 1) return block
               return {
                  ...block,
                  richRows: block.richRows?.slice(0, -1),
               }
            })
         )
      }, [setSections]),

      addTableCol: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               return {
                  ...block,
                  richHeaders: [...(block.richHeaders ?? []), [{ text: t.newColumn }]],
                  richRows:    (block.richRows ?? []).map(row => [...row, []]),
               }
            })
         )
      }, [setSections, t]),

      insertTableRowAt: useCallback((secId, blkId, side, innerBlkId, rowIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               const columnCount = (block.richHeaders ?? []).length
               const emptyRow: import('../types').InlineContent[] = Array.from({ length: columnCount }, () => [])
               const newRichRows = [...(block.richRows ?? [])]
               newRichRows.splice(rowIndex, 0, emptyRow)
               return { ...block, richRows: newRichRows }
            })
         )
      }, [setSections]),

      deleteTableRowAt: useCallback((secId, blkId, side, innerBlkId, rowIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               if ((block.richRows ?? []).length <= 1) return block
               return {
                  ...block,
                  richRows: block.richRows?.filter((_, index) => index !== rowIndex),
               }
            })
         )
      }, [setSections]),

      insertTableColAt: useCallback((secId, blkId, side, innerBlkId, colIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               const newRichHeaders = [...(block.richHeaders ?? [])]
               newRichHeaders.splice(colIndex, 0, [{ text: t.newColumn }])
               const newRichRows = (block.richRows ?? []).map(row => {
                  const nextRow = [...row]
                  nextRow.splice(colIndex, 0, [])
                  return nextRow
               })
               return { ...block, richHeaders: newRichHeaders, richRows: newRichRows }
            })
         )
      }, [setSections, t]),

      deleteTableColAt: useCallback((secId, blkId, side, innerBlkId, colIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               if ((block.richHeaders ?? []).length <= 1) return block
               const newRichHeaders = (block.richHeaders ?? []).filter((_, index) => index !== colIndex)
               const newRichRows    = (block.richRows    ?? []).map(row => row.filter((_, index) => index !== colIndex))
               return { ...block, richHeaders: newRichHeaders, richRows: newRichRows }
            })
         )
      }, [setSections]),

      updateRatio: useCallback((secId, blkId, ratio) => {
         mutateSec(setSections, secId, sec => ({
            ...sec,
            blocks: sec.blocks.map(block => block.id === blkId ? { ...block, ratio } : block),
         }))
      }, [setSections]),
   }
}

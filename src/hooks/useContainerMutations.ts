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
         mutateContainer(setSections, secId, blkId, side, blocks => [...blocks, mkBlock(type)])
      }, [setSections]),

      insertBlockAt: useCallback((secId, blkId, side, index, type: BlockType) => {
         mutateContainer(setSections, secId, blkId, side, blocks => {
            const next = [...blocks]
            next.splice(index, 0, mkBlock(type))
            return next
         })
      }, [setSections]),

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
                  ? { ...block, items: [...(block.items ?? []), { id: crypto.randomUUID(), text: t.newItem, children: [] }] }
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
            blocks.map(block =>
               block.id === innerBlkId && block.type === 'table'
                  ? { ...block, rows: [...(block.rows ?? []), (block.headers ?? []).map(() => '')] }
                  : block
            )
         )
      }, [setSections]),

      removeLastRow: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block =>
               block.id === innerBlkId && block.type === 'table' && (block.rows?.length ?? 0) > 1
                  ? { ...block, rows: block.rows!.slice(0, -1) }
                  : block
            )
         )
      }, [setSections]),

      addTableCol: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block =>
               block.id === innerBlkId && block.type === 'table'
                  ? { ...block, headers: [...(block.headers ?? []), t.newColumn], rows: (block.rows ?? []).map(row => [...row, '']) }
                  : block
            )
         )
      }, [setSections, t]),

      insertTableRowAt: useCallback((secId, blkId, side, innerBlkId, rowIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               const newRow = (block.headers ?? []).map(() => '')
               const newRows = [...(block.rows ?? [])]
               newRows.splice(rowIndex, 0, newRow)
               return { ...block, rows: newRows }
            })
         )
      }, [setSections]),

      deleteTableRowAt: useCallback((secId, blkId, side, innerBlkId, rowIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               if ((block.rows?.length ?? 0) <= 1) return block
               return { ...block, rows: (block.rows ?? []).filter((_, index) => index !== rowIndex) }
            })
         )
      }, [setSections]),

      insertTableColAt: useCallback((secId, blkId, side, innerBlkId, colIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               const newHeaders = [...(block.headers ?? [])]
               newHeaders.splice(colIndex, 0, t.newColumn)
               const newRows = (block.rows ?? []).map(row => {
                  const newRow = [...row]
                  newRow.splice(colIndex, 0, '')
                  return newRow
               })
               return { ...block, headers: newHeaders, rows: newRows }
            })
         )
      }, [setSections, t]),

      deleteTableColAt: useCallback((secId, blkId, side, innerBlkId, colIndex) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(block => {
               if (block.id !== innerBlkId || block.type !== 'table') return block
               if ((block.headers?.length ?? 0) <= 1) return block
               const newHeaders = (block.headers ?? []).filter((_, index) => index !== colIndex)
               const newRows = (block.rows ?? []).map(row => row.filter((_, index) => index !== colIndex))
               return { ...block, headers: newHeaders, rows: newRows }
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

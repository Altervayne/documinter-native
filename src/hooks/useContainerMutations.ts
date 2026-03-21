// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Lib / Util Imports --
import { mkBlock } from '../lib/state'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations, Section, Side } from '../types'
import type { T } from '../lib/i18n'

function moveItem<T>(arr: T[], from: number, to: number): T[] {
   if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
   const next = [...arr]
   ;[next[from], next[to]] = [next[to], next[from]]
   return next
}

function mutateSec(
   setSections: Dispatch<SetStateAction<Section[]>>,
   secId: string,
   fn: (sec: Section) => Section,
) {
   setSections(sections => sections.map(sec => sec.id === secId ? fn(sec) : sec))
}

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
                  ? { ...block, items: [...(block.items ?? []), { text: t.newItem, children: [] }] }
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

      updateRatio: useCallback((secId, blkId, ratio) => {
         mutateSec(setSections, secId, sec => ({
            ...sec,
            blocks: sec.blocks.map(block => block.id === blkId ? { ...block, ratio } : block),
         }))
      }, [setSections]),
   }
}

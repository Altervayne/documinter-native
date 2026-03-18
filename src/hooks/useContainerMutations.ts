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
   setSections(s => s.map(sec => sec.id === secId ? fn(sec) : sec))
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
      blocks: sec.blocks.map(b => {
         if (b.id !== blkId || b.type !== 'container') return b
         return { ...b, [side]: fn(b[side] ?? []) }
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
            blocks.map(b => b.id === innerBlkId ? { ...b, ...patch } : b)
         )
      }, [setSections]),

      addBlock: useCallback((secId, blkId, side, type: BlockType) => {
         mutateContainer(setSections, secId, blkId, side, blocks => [...blocks, mkBlock(type)])
      }, [setSections]),

      removeBlock: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks => blocks.filter(b => b.id !== innerBlkId))
      }, [setSections]),

      moveBlock: useCallback((secId, blkId, side, from, to) => {
         mutateContainer(setSections, secId, blkId, side, blocks => moveItem(blocks, from, to))
      }, [setSections]),

      addListItem: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(b =>
               b.id === innerBlkId && b.type === 'list'
                  ? { ...b, items: [...(b.items ?? []), t.newItem] }
                  : b
            )
         )
      }, [setSections, t]),

      removeLastItem: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(b =>
               b.id === innerBlkId && b.type === 'list' && (b.items?.length ?? 0) > 1
                  ? { ...b, items: b.items!.slice(0, -1) }
                  : b
            )
         )
      }, [setSections]),

      addTableRow: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(b =>
               b.id === innerBlkId && b.type === 'table'
                  ? { ...b, rows: [...(b.rows ?? []), (b.headers ?? []).map(() => '')] }
                  : b
            )
         )
      }, [setSections]),

      removeLastRow: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(b =>
               b.id === innerBlkId && b.type === 'table' && (b.rows?.length ?? 0) > 1
                  ? { ...b, rows: b.rows!.slice(0, -1) }
                  : b
            )
         )
      }, [setSections]),

      addTableCol: useCallback((secId, blkId, side, innerBlkId) => {
         mutateContainer(setSections, secId, blkId, side, blocks =>
            blocks.map(b =>
               b.id === innerBlkId && b.type === 'table'
                  ? { ...b, headers: [...(b.headers ?? []), t.newColumn], rows: (b.rows ?? []).map(r => [...r, '']) }
                  : b
            )
         )
      }, [setSections, t]),

      updateRatio: useCallback((secId, blkId, ratio) => {
         mutateSec(setSections, secId, sec => ({
            ...sec,
            blocks: sec.blocks.map(b => b.id === blkId ? { ...b, ratio } : b),
         }))
      }, [setSections]),
   }
}

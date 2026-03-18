// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { cloneBlock, mkBlock } from '../lib/state'

// -- Type Imports --
import type { Block, BlockType, Section } from '../types'
import type { T } from '../lib/i18n'

type ToastAction = { label: string; onClick: () => void }

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

export function useBlockMutations(
   setSections: Dispatch<SetStateAction<Section[]>>,
   showToast: (msg: string, action?: ToastAction) => void,
   clearToast: () => void,
   t: T,
) {
   const addBlock = useCallback((secId: string, type: BlockType) => {
      mutateSec(setSections, secId, sec => ({ ...sec, blocks: [...sec.blocks, mkBlock(type)] }))
   }, [setSections])

   const updateBlock = useCallback((secId: string, blkId: string, patch: Partial<Block>) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(b => b.id === blkId ? { ...b, ...patch } : b),
      }))
   }, [setSections])

   const removeBlk = useCallback((secId: string, blkId: string) => {
      setSections(s => s.map(sec => {
         if (sec.id !== secId) return sec
         const idx = sec.blocks.findIndex(b => b.id === blkId)
         const block = sec.blocks[idx]
         if (!block) return sec
         showToast(t.blockDeleted, {
            label: t.undo,
            onClick: () => {
               setSections(cur => cur.map(s2 => {
                  if (s2.id !== secId) return s2
                  const next = [...s2.blocks]
                  next.splice(idx, 0, block)
                  return { ...s2, blocks: next }
               }))
               clearToast()
            },
         })
         return { ...sec, blocks: sec.blocks.filter(b => b.id !== blkId) }
      }))
   }, [setSections, showToast, clearToast, t])

   const moveBlkUp = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => {
         const i = sec.blocks.findIndex(b => b.id === blkId)
         return { ...sec, blocks: moveItem(sec.blocks, i, i - 1) }
      })
   }, [setSections])

   const moveBlkDown = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => {
         const i = sec.blocks.findIndex(b => b.id === blkId)
         return { ...sec, blocks: moveItem(sec.blocks, i, i + 1) }
      })
   }, [setSections])

   const reorderBlocks = useCallback((secId: string, oldIdx: number, newIdx: number) => {
      mutateSec(setSections, secId, sec => ({ ...sec, blocks: arrayMove(sec.blocks, oldIdx, newIdx) }))
   }, [setSections])

   const duplicateBlock = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => {
         const idx = sec.blocks.findIndex(b => b.id === blkId)
         if (idx === -1) return sec
         const clone = cloneBlock(sec.blocks[idx])
         const next = [...sec.blocks]
         next.splice(idx + 1, 0, clone)
         return { ...sec, blocks: next }
      })
   }, [setSections])

   const addListItem = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(b =>
            b.id === blkId && b.type === 'list'
               ? { ...b, items: [...(b.items ?? []), t.newItem] }
               : b
         ),
      }))
   }, [setSections, t])

   const removeLastItem = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(b =>
            b.id === blkId && b.type === 'list' && (b.items?.length ?? 0) > 1
               ? { ...b, items: b.items!.slice(0, -1) }
               : b
         ),
      }))
   }, [setSections])

   const addTableRow = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(b =>
            b.id === blkId && b.type === 'table'
               ? { ...b, rows: [...(b.rows ?? []), (b.headers ?? []).map(() => '')] }
               : b
         ),
      }))
   }, [setSections])

   const removeLastRow = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(b =>
            b.id === blkId && b.type === 'table' && (b.rows?.length ?? 0) > 1
               ? { ...b, rows: b.rows!.slice(0, -1) }
               : b
         ),
      }))
   }, [setSections])

   const addTableCol = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(b =>
            b.id === blkId && b.type === 'table'
               ? { ...b, headers: [...(b.headers ?? []), t.newColumn], rows: (b.rows ?? []).map(r => [...r, '']) }
               : b
         ),
      }))
   }, [setSections, t])

   return {
      addBlock, updateBlock, removeBlk,
      moveBlkUp, moveBlkDown, reorderBlocks, duplicateBlock,
      addListItem, removeLastItem,
      addTableRow, removeLastRow, addTableCol,
   }
}

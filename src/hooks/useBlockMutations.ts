// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { cloneBlock, mkBlock, moveItem, mutateSec } from '../lib/document'

// -- Type Imports --
import type { Block, BlockType, Section } from '../types'
import type { T } from '../lib/i18n'

type ToastAction = { label: string; onClick: () => void }

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
         blocks: sec.blocks.map(block => block.id === blkId ? { ...block, ...patch } : block),
      }))
   }, [setSections])

   const removeBlk = useCallback((secId: string, blkId: string) => {
      setSections(sections => sections.map(sec => {
         if (sec.id !== secId) return sec
         const blockIndex = sec.blocks.findIndex(block => block.id === blkId)
         const block = sec.blocks[blockIndex]
         if (!block) return sec
         showToast(t.blockDeleted, {
            label: t.undo,
            onClick: () => {
               setSections(current => current.map(otherSection => {
                  if (otherSection.id !== secId) return otherSection
                  const next = [...otherSection.blocks]
                  next.splice(blockIndex, 0, block)
                  return { ...otherSection, blocks: next }
               }))
               clearToast()
            },
         })
         return { ...sec, blocks: sec.blocks.filter(block => block.id !== blkId) }
      }))
   }, [setSections, showToast, clearToast, t])

   const moveBlkUp = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => {
         const index = sec.blocks.findIndex(block => block.id === blkId)
         return { ...sec, blocks: moveItem(sec.blocks, index, index - 1) }
      })
   }, [setSections])

   const moveBlkDown = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => {
         const index = sec.blocks.findIndex(block => block.id === blkId)
         return { ...sec, blocks: moveItem(sec.blocks, index, index + 1) }
      })
   }, [setSections])

   const reorderBlocks = useCallback((secId: string, oldIdx: number, newIdx: number) => {
      mutateSec(setSections, secId, sec => ({ ...sec, blocks: arrayMove(sec.blocks, oldIdx, newIdx) }))
   }, [setSections])

   const duplicateBlock = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => {
         const blockIndex = sec.blocks.findIndex(block => block.id === blkId)
         if (blockIndex === -1) return sec
         const clone = cloneBlock(sec.blocks[blockIndex])
         const next = [...sec.blocks]
         next.splice(blockIndex + 1, 0, clone)
         return { ...sec, blocks: next }
      })
   }, [setSections])

   const addListItem = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && block.type === 'list'
               ? { ...block, items: [...(block.items ?? []), { text: t.newItem, children: [] }] }
               : block
         ),
      }))
   }, [setSections, t])

   const removeLastItem = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && block.type === 'list' && (block.items?.length ?? 0) > 1
               ? { ...block, items: block.items!.slice(0, -1) }
               : block
         ),
      }))
   }, [setSections])

   const addTableRow = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && block.type === 'table'
               ? { ...block, rows: [...(block.rows ?? []), (block.headers ?? []).map(() => '')] }
               : block
         ),
      }))
   }, [setSections])

   const removeLastRow = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && block.type === 'table' && (block.rows?.length ?? 0) > 1
               ? { ...block, rows: block.rows!.slice(0, -1) }
               : block
         ),
      }))
   }, [setSections])

   const addTableCol = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && block.type === 'table'
               ? { ...block, headers: [...(block.headers ?? []), t.newColumn], rows: (block.rows ?? []).map(row => [...row, '']) }
               : block
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

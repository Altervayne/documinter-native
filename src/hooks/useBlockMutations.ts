// -- React Imports --
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { cloneBlock, mkBlock, moveItem, mutateSec } from '../lib/document'
import * as listItemTree from '../lib/listItemTree'

// -- Context Imports --
import { useToast } from '../contexts/ToastContext'

// -- Type Imports --
import type { Block, BlockType, InlineContent, ListItem, Section } from '../types'
import type { T } from '../lib/i18n'

export function useBlockMutations(
   setSections: Dispatch<SetStateAction<Section[]>>,
   t: T,
) {
   const { showToast, dismissToast } = useToast()

   const addBlock = useCallback((secId: string, type: BlockType) => {
      mutateSec(setSections, secId, sec => ({ ...sec, blocks: [...sec.blocks, mkBlock(type, t)] }))
   }, [setSections, t])

   const insertBlockAt = useCallback((secId: string, index: number, type: BlockType) => {
      mutateSec(setSections, secId, sec => {
         const next = [...sec.blocks]
         next.splice(index, 0, mkBlock(type, t))
         return { ...sec, blocks: next }
      })
   }, [setSections, t])

   const updateBlock = useCallback((secId: string, blkId: string, patch: Partial<Block>) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => block.id === blkId ? { ...block, ...patch } : block),
      }))
   }, [setSections])

   const removeBlk = useCallback((secId: string, blkId: string) => {
      let deletedBlock: Block | undefined
      let deletedIndex = -1
      setSections(sections => sections.map(sec => {
         if (sec.id !== secId) return sec
         deletedIndex = sec.blocks.findIndex(block => block.id === blkId)
         deletedBlock = sec.blocks[deletedIndex]
         if (!deletedBlock) return sec
         return { ...sec, blocks: sec.blocks.filter(block => block.id !== blkId) }
      }))
      if (!deletedBlock) return
      const blockSnapshot = deletedBlock
      const indexSnapshot = deletedIndex
      const toastId = showToast(t.blockDeleted, {
         action: {
            label:   t.undo,
            onClick: () => {
               setSections(current => current.map(sec => {
                  if (sec.id !== secId) return sec
                  const next = [...sec.blocks]
                  next.splice(indexSnapshot, 0, blockSnapshot)
                  return { ...sec, blocks: next }
               }))
               dismissToast(toastId)
            },
         },
      })
   }, [setSections, showToast, dismissToast, t])

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

   // Inserts an already-built block right after blkId. Mirrors duplicateBlock's find-splice
   // shape, but the caller supplies the whole block instead of a clone (the graph<->table
   // one-shot extract actions: "Create chart from this table" / "Extract data to a table").
   const insertBlockAfter = useCallback((secId: string, blkId: string, newBlock: Block) => {
      mutateSec(setSections, secId, sec => {
         const blockIndex = sec.blocks.findIndex(block => block.id === blkId)
         if (blockIndex === -1) return sec
         const next = [...sec.blocks]
         next.splice(blockIndex + 1, 0, newBlock)
         return { ...sec, blocks: next }
      })
   }, [setSections])

   const addListItem = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: [...(block.items ?? []), { id: crypto.randomUUID(), richText: [{ text: t.newItem }], children: [] }] }
               : block
         ),
      }))
   }, [setSections, t])

   const removeLastItem = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist') && (block.items?.length ?? 0) > 1
               ? { ...block, items: block.items!.slice(0, -1) }
               : block
         ),
      }))
   }, [setSections])

   const addTableRow = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            const columnCount = (block.richHeaders ?? []).length
            const emptyRow: import('../types').InlineContent[] = Array.from({ length: columnCount }, () => [])
            return {
               ...block,
               richRows: [...(block.richRows ?? []), emptyRow],
            }
         }),
      }))
   }, [setSections])

   const removeLastRow = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            if ((block.richRows ?? []).length <= 1) return block
            return {
               ...block,
               richRows: block.richRows?.slice(0, -1),
            }
         }),
      }))
   }, [setSections])

   const insertTableRowAt = useCallback((secId: string, blkId: string, rowIndex: number) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            const columnCount = (block.richHeaders ?? []).length
            const emptyRow: import('../types').InlineContent[] = Array.from({ length: columnCount }, () => [])
            const newRichRows = [...(block.richRows ?? [])]
            newRichRows.splice(rowIndex, 0, emptyRow)
            return { ...block, richRows: newRichRows }
         }),
      }))
   }, [setSections])

   const deleteTableRowAt = useCallback((secId: string, blkId: string, rowIndex: number) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            if ((block.richRows ?? []).length <= 1) return block
            return {
               ...block,
               richRows: block.richRows?.filter((_, index) => index !== rowIndex),
            }
         }),
      }))
   }, [setSections])

   const insertTableColAt = useCallback((secId: string, blkId: string, colIndex: number) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            const newRichHeaders = [...(block.richHeaders ?? [])]
            newRichHeaders.splice(colIndex, 0, [{ text: t.newColumn }])
            const newRichRows = (block.richRows ?? []).map(row => {
               const nextRow = [...row]
               nextRow.splice(colIndex, 0, [])
               return nextRow
            })
            return { ...block, richHeaders: newRichHeaders, richRows: newRichRows }
         }),
      }))
   }, [setSections, t])

   const deleteTableColAt = useCallback((secId: string, blkId: string, colIndex: number) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            if ((block.richHeaders ?? []).length <= 1) return block
            const newRichHeaders = (block.richHeaders ?? []).filter((_, index) => index !== colIndex)
            const newRichRows    = (block.richRows    ?? []).map(row => row.filter((_, index) => index !== colIndex))
            return { ...block, richHeaders: newRichHeaders, richRows: newRichRows }
         }),
      }))
   }, [setSections])

   const addTableCol = useCallback((secId: string, blkId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block => {
            if (block.id !== blkId || block.type !== 'table') return block
            return {
               ...block,
               richHeaders: [...(block.richHeaders ?? []), [{ text: t.newColumn }]],
               richRows:    (block.richRows ?? []).map(row => [...row, []]),
            }
         }),
      }))
   }, [setSections, t])

   // ============================================================
   //  List-item structural edits, backed by the listItemTree.ts pure helpers.
   //  Each operates on the matching list block's items array.
   // ============================================================

   const moveListItemUp = useCallback((secId: string, blkId: string, itemId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.moveListItemUp(block.items ?? [], itemId) }
               : block
         ),
      }))
   }, [setSections])

   const moveListItemDown = useCallback((secId: string, blkId: string, itemId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.moveListItemDown(block.items ?? [], itemId) }
               : block
         ),
      }))
   }, [setSections])

   const indentListItem = useCallback((secId: string, blkId: string, itemId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.indentListItem(block.items ?? [], itemId) }
               : block
         ),
      }))
   }, [setSections])

   const unindentListItem = useCallback((secId: string, blkId: string, itemId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.unindentListItem(block.items ?? [], itemId) }
               : block
         ),
      }))
   }, [setSections])

   const removeListItem = useCallback((secId: string, blkId: string, itemId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.removeListItemById(block.items ?? [], itemId) }
               : block
         ),
      }))
   }, [setSections])

   const insertListItemAfter = useCallback((secId: string, blkId: string, afterItemId: string, newItem: ListItem) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.insertListItemAfter(block.items ?? [], afterItemId, newItem) }
               : block
         ),
      }))
   }, [setSections])

   const updateListItemRichText = useCallback((secId: string, blkId: string, itemId: string, richText: InlineContent) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.updateListItemRichText(block.items ?? [], itemId, richText) }
               : block
         ),
      }))
   }, [setSections])

   const reorderListItemsUnderParent = useCallback((secId: string, blkId: string, parentItemId: string | null, oldIndex: number, newIndex: number) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.reorderListItemsUnderParent(block.items ?? [], parentItemId, oldIndex, newIndex) }
               : block
         ),
      }))
   }, [setSections])

   // Toggle a checklist item's checked flag, reusing the generic tree-walk primitive.
   const toggleChecklistItem = useCallback((secId: string, blkId: string, itemId: string) => {
      mutateSec(setSections, secId, sec => ({
         ...sec,
         blocks: sec.blocks.map(block =>
            block.id === blkId && (block.type === 'list' || block.type === 'checklist')
               ? { ...block, items: listItemTree.mutateListItem(block.items ?? [], itemId, item => ({ ...item, checked: !item.checked })) }
               : block
         ),
      }))
   }, [setSections])

   return {
      addBlock, insertBlockAt, insertBlockAfter, updateBlock, removeBlk,
      moveBlkUp, moveBlkDown, reorderBlocks, duplicateBlock,
      addListItem, removeLastItem,
      addTableRow, removeLastRow, addTableCol,
      insertTableRowAt, deleteTableRowAt, insertTableColAt, deleteTableColAt,
      moveListItemUp, moveListItemDown, indentListItem, unindentListItem,
      removeListItem, insertListItemAfter, updateListItemRichText, reorderListItemsUnderParent,
      toggleChecklistItem,
   }
}

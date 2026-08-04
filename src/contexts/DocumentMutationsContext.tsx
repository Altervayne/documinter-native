/**
 * DocumentMutationsContext, Provides all document mutation functions to the
 * component tree below App.tsx.
 *
 * Exports: DocumentMutations (interface), DocumentMutationsContext,
 *          useDocumentMutations
 *
 * Kept as a context rather than prop-drilling because mutations are consumed
 * at many levels of the WysiwygArea subtree.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'
import type { Block, BlockType, ContainerMutations, InlineContent, ListItem, Section } from '../types'
import type { BlockLoc } from '../lib/document'

export interface DocumentMutations {
   updateBlock:       (secId: string, blkId: string, patch: Partial<Block>) => void
   addBlock:          (secId: string, type: BlockType) => void
   insertBlockAt:     (secId: string, index: number, type: BlockType) => void
   /** Inserts an already-built block right after `blkId` (no `mkBlock` default, the caller
    *  supplies the full block, e.g. the graph<->table one-shot extract actions). */
   insertBlockAfter:  (secId: string, blkId: string, newBlock: Block) => void
   removeBlock:       (secId: string, blkId: string) => void
   duplicateBlock:    (secId: string, blkId: string) => void
   reorderBlocks:     (secId: string, oldIdx: number, newIdx: number) => void
   /** Cross-array block move (block DnD): relocate a block between section bodies and/or container
    *  columns, inserting before `beforeBlockId` (append when null). */
   moveBlockAcross:   (from: BlockLoc, blockId: string, to: BlockLoc, beforeBlockId: string | null) => void
   addListItem:       (secId: string, blkId: string) => void
   removeLastItem:    (secId: string, blkId: string) => void
   addTableRow:       (secId: string, blkId: string) => void
   removeLastRow:     (secId: string, blkId: string) => void
   addTableCol:       (secId: string, blkId: string) => void
   insertTableRowAt:  (secId: string, blkId: string, rowIndex: number) => void
   deleteTableRowAt:  (secId: string, blkId: string, rowIndex: number) => void
   insertTableColAt:  (secId: string, blkId: string, colIndex: number) => void
   deleteTableColAt:  (secId: string, blkId: string, colIndex: number) => void
   moveListItemUp:              (secId: string, blkId: string, itemId: string) => void
   moveListItemDown:            (secId: string, blkId: string, itemId: string) => void
   indentListItem:              (secId: string, blkId: string, itemId: string) => void
   unindentListItem:            (secId: string, blkId: string, itemId: string) => void
   removeListItem:              (secId: string, blkId: string, itemId: string) => void
   insertListItemAfter:         (secId: string, blkId: string, afterItemId: string, newItem: ListItem) => void
   updateListItemRichText:      (secId: string, blkId: string, itemId: string, richText: InlineContent) => void
   reorderListItemsUnderParent: (secId: string, blkId: string, parentItemId: string | null, oldIndex: number, newIndex: number) => void
   toggleChecklistItem:         (secId: string, blkId: string, itemId: string) => void
   containerMutations: ContainerMutations
   updateTitle:       (secId: string, title: string) => void
   removeSection:     (secId: string) => void
   reorderSections:   (oldIdx: number, newIdx: number) => void
   addSection:        () => void
   /** Insert an already-built section at a specific index (section-menu insert above/below). */
   insertSectionAt:   (index: number, section: Section) => void
   duplicateSec:      (secId: string) => void
   moveSecUp:         (secId: string) => void
   moveSecDown:       (secId: string) => void
   toggleSec:         (secId: string) => void
}

export const DocumentMutationsContext = createContext<DocumentMutations>(null!)

export function useDocumentMutations(): DocumentMutations {
   return useContext(DocumentMutationsContext)
}

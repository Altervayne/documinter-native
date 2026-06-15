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
import type { Block, BlockType, ContainerMutations } from '../types'

export interface DocumentMutations {
   updateBlock:       (secId: string, blkId: string, patch: Partial<Block>) => void
   addBlock:          (secId: string, type: BlockType) => void
   insertBlockAt:     (secId: string, index: number, type: BlockType) => void
   removeBlock:       (secId: string, blkId: string) => void
   duplicateBlock:    (secId: string, blkId: string) => void
   reorderBlocks:     (secId: string, oldIdx: number, newIdx: number) => void
   addListItem:       (secId: string, blkId: string) => void
   removeLastItem:    (secId: string, blkId: string) => void
   addTableRow:       (secId: string, blkId: string) => void
   removeLastRow:     (secId: string, blkId: string) => void
   addTableCol:       (secId: string, blkId: string) => void
   insertTableRowAt:  (secId: string, blkId: string, rowIndex: number) => void
   deleteTableRowAt:  (secId: string, blkId: string, rowIndex: number) => void
   insertTableColAt:  (secId: string, blkId: string, colIndex: number) => void
   deleteTableColAt:  (secId: string, blkId: string, colIndex: number) => void
   containerMutations: ContainerMutations
   updateTitle:       (secId: string, title: string) => void
   removeSection:     (secId: string) => void
   reorderSections:   (oldIdx: number, newIdx: number) => void
}

export const DocumentMutationsContext = createContext<DocumentMutations>(null!)

export function useDocumentMutations(): DocumentMutations {
   return useContext(DocumentMutationsContext)
}

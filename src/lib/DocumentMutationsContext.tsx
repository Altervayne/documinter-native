// -- React Imports --
import { createContext, useContext } from 'react'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations } from '../types'

export interface DocumentMutations {
   updateBlock:       (secId: string, blkId: string, patch: Partial<Block>) => void
   addBlock:          (secId: string, type: BlockType) => void
   removeBlock:       (secId: string, blkId: string) => void
   duplicateBlock:    (secId: string, blkId: string) => void
   reorderBlocks:     (secId: string, oldIdx: number, newIdx: number) => void
   addListItem:       (secId: string, blkId: string) => void
   removeLastItem:    (secId: string, blkId: string) => void
   addTableRow:       (secId: string, blkId: string) => void
   removeLastRow:     (secId: string, blkId: string) => void
   addTableCol:       (secId: string, blkId: string) => void
   containerMutations: ContainerMutations
   updateTitle:       (secId: string, title: string) => void
   removeSection:     (secId: string) => void
   reorderSections:   (oldIdx: number, newIdx: number) => void
}

export const DocumentMutationsContext = createContext<DocumentMutations>(null!)

export function useDocumentMutations(): DocumentMutations {
   return useContext(DocumentMutationsContext)
}

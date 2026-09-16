// -- Library Imports --
import { Copy, Trash2 } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../contexts/DocumentMutationsContext'
import { useLang } from '../contexts/LangContext'

// -- Component Imports --
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

// #########
// # TYPES #
// #########

interface TreeBlockMenuProps {
   secId:    string
   blockId:  string
   position: { x: number; y: number }
   onClose:  () => void
}

// #############
// # COMPONENT #
// #############

/** Panel-tree block right-click menu (Duplicate + Delete); thin adapter over the shared <ContextMenu>. */
export function TreeBlockMenu({ secId, blockId, position, onClose }: TreeBlockMenuProps) {
   const documentMutations = useDocumentMutations()
   const { t } = useLang()

   const entries: ContextMenuEntry[] = [
      { label: t.duplicateBlock, icon: <Copy size={12} />, onSelect: () => documentMutations.duplicateBlock(secId, blockId) },
      { label: t.deleteBlock,    icon: <Trash2 size={12} />, danger: true, onSelect: () => documentMutations.removeBlock(secId, blockId) },
   ]

   return <ContextMenu position={position} entries={entries} onClose={onClose} className="min-w-[160px]" />
}

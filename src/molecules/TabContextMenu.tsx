// -- Library Imports --
import { Copy, Pencil, X } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

// -- Component Imports --
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

// #########
// # TYPES #
// #########

interface TabContextMenuProps {
   position:    { x: number; y: number }
   onDuplicate: () => void
   onRename:    () => void
   onClose:     () => void
   onDismiss:   () => void
}

// #############
// # COMPONENT #
// #############

/** Right-click menu for a tab; thin adapter over <ContextMenu>. `onClose` closes the tab (not the
 *  menu); `onDismiss` dismisses the menu. */
export function TabContextMenu({ position, onDuplicate, onRename, onClose, onDismiss }: TabContextMenuProps) {
   const { t } = useLang()

   const entries: ContextMenuEntry[] = [
      { label: t.tabDuplicate, icon: <Copy size={12} />,   onSelect: onDuplicate },
      { label: t.tabRename,    icon: <Pencil size={12} />, onSelect: onRename },
      { label: t.tabClose,     icon: <X size={12} />,      onSelect: onClose },
   ]

   return <ContextMenu position={position} entries={entries} onClose={onDismiss} className="min-w-[160px]" />
}

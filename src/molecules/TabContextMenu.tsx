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
   onClose:     () => void   // the tab action (close the tab, non-destructive)
   onDismiss:   () => void   // close the menu itself
}

// #############
// # COMPONENT #
// #############

/**
 * Right-click context menu for a tab. Thin adapter over the shared <ContextMenu>, it owns
 * the portal, the viewport clamp, keyboard nav, and dismissal. The menu's own dismissal maps
 * to `onDismiss`; `onClose` stays the tab-close action (distinct, closing a tab isn't the
 * same as dismissing the menu).
 */
export function TabContextMenu({ position, onDuplicate, onRename, onClose, onDismiss }: TabContextMenuProps) {
   const { t } = useLang()

   const entries: ContextMenuEntry[] = [
      { label: t.tabDuplicate, icon: <Copy size={12} />,   onSelect: onDuplicate },
      { label: t.tabRename,    icon: <Pencil size={12} />, onSelect: onRename },
      { label: t.tabClose,     icon: <X size={12} />,      onSelect: onClose },
   ]

   return <ContextMenu position={position} entries={entries} onClose={onDismiss} className="min-w-[160px]" />
}

// -- React Imports --
import { useEffect, useRef } from 'react'

// -- Library Imports --
import { createPortal } from 'react-dom'
import { Copy, Pencil, X } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface TabContextMenuProps {
   position:    { x: number; y: number }
   onDuplicate: () => void
   onRename:    () => void
   onClose:     () => void   // the tab action (close the tab — non-destructive)
   onDismiss:   () => void   // close the menu itself
}

// #############
// # CONSTANTS #
// #############

const MENU_WIDTH  = 160
const MENU_HEIGHT = 112   // 3 items × ~32px + 16px padding

// #############
// # COMPONENT #
// #############

/**
 * Right-click context menu for a tab. Mirrors TreeBlockMenu: portal to body, fixed + viewport-
 * clamped, dismissed on outside-pointerdown or Escape. Close is styled neutral — closing a tab
 * isn't deleting the document.
 */
export function TabContextMenu({ position, onDuplicate, onRename, onClose, onDismiss }: TabContextMenuProps) {
   const { t }   = useLang()
   const menuRef = useRef<HTMLDivElement>(null)

   const left = Math.min(position.x, window.innerWidth  - MENU_WIDTH  - 8)
   const top  = Math.min(position.y, window.innerHeight - MENU_HEIGHT - 8)

   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         if (!menuRef.current?.contains(event.target as Node)) onDismiss()
      }
      function handleKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onDismiss()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      document.addEventListener('keydown',     handleKeyDown)
      return () => {
         document.removeEventListener('pointerdown', handlePointerDown)
         document.removeEventListener('keydown',     handleKeyDown)
      }
   }, [onDismiss])

   const itemClass = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text/80 hover:text-text hover:bg-accent/10 transition-colors cursor-pointer'

   return createPortal(
      <div
         ref={menuRef}
         className="fixed z-[9999] rounded-lg border border-border bg-raised shadow-2xl overflow-hidden"
         style={{ top, left, width: MENU_WIDTH, animation: 'menu-in 120ms ease-out both' }}
      >
         <button onClick={onDuplicate} className={itemClass}>
            <Copy size={12} className="shrink-0 text-muted" />
            {t.tabDuplicate}
         </button>
         <button onClick={onRename} className={itemClass}>
            <Pencil size={12} className="shrink-0 text-muted" />
            {t.tabRename}
         </button>
         <button onClick={onClose} className={itemClass}>
            <X size={12} className="shrink-0 text-muted" />
            {t.tabClose}
         </button>
      </div>,
      document.body,
   )
}

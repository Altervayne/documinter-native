// -- React Imports --
import { useEffect, useRef } from 'react'

// -- Library Imports --
import { createPortal } from 'react-dom'
import { Copy, Trash2 } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../contexts/DocumentMutationsContext'
import { useLang } from '../contexts/LangContext'

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
// # CONSTANTS #
// #############

const MENU_WIDTH  = 160
const MENU_HEIGHT = 80   // 2 items × ~32px + 16px padding

// #############
// # COMPONENT #
// #############

export function TreeBlockMenu({ secId, blockId, position, onClose }: TreeBlockMenuProps) {
   const ctx     = useDocumentMutations()
   const { t }   = useLang()
   const menuRef = useRef<HTMLDivElement>(null)

   // Clamp position to viewport so the menu never clips off-screen
   const left = Math.min(position.x, window.innerWidth  - MENU_WIDTH  - 8)
   const top  = Math.min(position.y, window.innerHeight - MENU_HEIGHT - 8)

   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         if (!menuRef.current?.contains(event.target as Node)) onClose()
      }
      function handleKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      document.addEventListener('keydown',     handleKeyDown)
      return () => {
         document.removeEventListener('pointerdown', handlePointerDown)
         document.removeEventListener('keydown',     handleKeyDown)
      }
   }, [onClose])

   function handleDuplicate() {
      ctx.duplicateBlock(secId, blockId)
      onClose()
   }

   function handleDelete() {
      ctx.removeBlock(secId, blockId)
      onClose()
   }

   return createPortal(
      <div
         ref={menuRef}
         className="fixed z-[9999] rounded-lg border border-border bg-raised shadow-2xl overflow-hidden py-1"
         style={{
            top,
            left,
            width: MENU_WIDTH,
            animation: 'menu-in 120ms ease-out both',
         }}
      >
         <button
            onClick={handleDuplicate}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text/80 hover:text-text hover:bg-accent/10 transition-colors cursor-pointer"
         >
            <Copy size={12} className="shrink-0 text-muted" />
            {t.duplicateBlock}
         </button>
         <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
         >
            <Trash2 size={12} className="shrink-0" />
            {t.deleteBlock}
         </button>
      </div>,
      document.body,
   )
}

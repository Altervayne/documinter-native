import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, FolderPlus, Trash2 } from 'lucide-react'
import { useLang } from '../contexts/LangContext'

interface BinderFolderMenuProps {
   x:              number
   y:              number
   onClose:        () => void
   onRename:       () => void
   onNewSubfolder: () => void
   onDelete:       () => void
}

const MENU_WIDTH  = 200
const MENU_HEIGHT = 140

/** Folder context menu — shared by the ⋯ button and right-click. Portal-rendered. */
export function BinderFolderMenu({ x, y, onClose, onRename, onNewSubfolder, onDelete }: BinderFolderMenuProps) {
   const { t } = useLang()
   const menuRef = useRef<HTMLDivElement>(null)

   useEffect(() => {
      function onMouseDown(event: MouseEvent) {
         if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
      }
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') onClose()
      }
      document.addEventListener('mousedown', onMouseDown)
      document.addEventListener('keydown', onKeyDown)
      return () => {
         document.removeEventListener('mousedown', onMouseDown)
         document.removeEventListener('keydown', onKeyDown)
      }
   }, [onClose])

   const left = Math.min(x, window.innerWidth  - MENU_WIDTH  - 8)
   const top  = Math.min(y, window.innerHeight - MENU_HEIGHT - 8)

   function run(action: () => void) {
      action()
      onClose()
   }

   return createPortal(
      <div
         ref={menuRef}
         className="fixed z-[10000] min-w-[180px] rounded-lg border border-border bg-raised shadow-xl overflow-hidden py-1"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
      >
         <button onClick={() => run(onRename)}       className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-text hover:bg-border/50 transition-colors cursor-pointer">
            <span className="text-muted"><Pencil size={13} /></span><span className="flex-1">{t.binderRenameFolder}</span>
         </button>
         <button onClick={() => run(onNewSubfolder)} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-text hover:bg-border/50 transition-colors cursor-pointer">
            <span className="text-muted"><FolderPlus size={13} /></span><span className="flex-1">{t.binderNewSubfolder}</span>
         </button>
         <div className="h-px bg-border my-1 mx-2" />
         <button onClick={() => run(onDelete)}       className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-red hover:bg-red/10 transition-colors cursor-pointer">
            <span className="text-red"><Trash2 size={13} /></span><span className="flex-1">{t.binderDeleteFolder}</span>
         </button>
      </div>,
      document.body,
   )
}

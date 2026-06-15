import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Copy, Download, FileDown, Trash2 } from 'lucide-react'
import { useLang } from '../contexts/LangContext'

interface BinderContextMenuProps {
   x:                number
   y:                number
   onClose:          () => void
   onOpen:           () => void
   onDuplicate:      () => void
   onDelete:         () => void
   onExportHtml:     () => void
   onExportMarkdown: () => void
   onExportMintdown: () => void
}

const MENU_WIDTH  = 220
const MENU_HEIGHT = 300

/** Card context menu, shared by the ⋯ button and right-click. Portal-rendered. */
export function BinderContextMenu({
   x, y, onClose, onOpen, onDuplicate, onDelete, onExportHtml, onExportMarkdown, onExportMintdown,
}: BinderContextMenuProps) {
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

   // Keep the menu within the viewport.
   const left = Math.min(x, window.innerWidth  - MENU_WIDTH  - 8)
   const top  = Math.min(y, window.innerHeight - MENU_HEIGHT - 8)

   function run(action: () => void) {
      action()
      onClose()
   }

   return createPortal(
      <div
         ref={menuRef}
         className="fixed z-[10000] min-w-[200px] rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
      >
         <MenuItem icon={<FolderOpen size={13} />} label={t.binderOpenAction} onClick={() => run(onOpen)} />
         <MenuItem icon={<Copy size={13} />}       label={t.binderDuplicate}  onClick={() => run(onDuplicate)} />
         <Separator />
         <MenuItem icon={<Download size={13} />} label={t.exportHtml}     onClick={() => run(onExportHtml)} />
         <MenuItem icon={<FileDown size={13} />} label={t.exportMarkdown} onClick={() => run(onExportMarkdown)} />
         <MenuItem icon={<FileDown size={13} />} label={t.exportMintdown} onClick={() => run(onExportMintdown)} />
         <Separator />
         <MenuItem icon={<Trash2 size={13} />} label={t.binderDelete} onClick={() => run(onDelete)} danger />
      </div>,
      document.body,
   )
}

// ======================
//  File-local primitives
// ======================

interface MenuItemProps {
   icon:    React.ReactNode
   label:   string
   onClick: () => void
   danger?: boolean
}

function MenuItem({ icon, label, onClick, danger }: MenuItemProps) {
   return (
      <button
         onClick={onClick}
         className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer
            ${danger ? 'text-red hover:bg-red/10' : 'text-text hover:bg-border/50'}`}
      >
         <span className={danger ? 'text-red' : 'text-muted'}>{icon}</span>
         <span className="flex-1">{label}</span>
      </button>
   )
}

function Separator() {
   return <div className="h-px bg-border my-1 mx-2" />
}

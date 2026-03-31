// -- Library Imports --
import { GripVertical, Trash2, ChevronUp, ChevronDown, Copy, Anchor, TriangleAlert } from 'lucide-react'
import type { useSortable } from '@dnd-kit/sortable'

// -- Context / Hook Imports --
import { useLang } from '../../../lib/LangContext'
import { useDocumentHandles } from '../../../lib/DocumentHandlesContext'

// -- Type Imports --
import type { Block } from '../../../types'

interface BlockSidebarProps {
   inner:          boolean
   block:          Block
   onMoveUp?:      () => void
   onMoveDown?:    () => void
   onDuplicate?:   () => void
   onAnchorEdit:   () => void
   onRemove:       () => void
   onMouseEnter:   () => void
   onMouseLeave:   () => void
   dragListeners?: ReturnType<typeof useSortable>['listeners']
}

const btnBase = 'flex items-center justify-center w-full border-0 bg-transparent cursor-pointer p-1 rounded-md transition-colors doc-dark:text-[#484f58]'
const btnStd  = `${btnBase} text-gray-500 hover:text-accent hover:bg-accent/14`
const btnDgr  = `${btnBase} text-gray-500 hover:text-rose-600 hover:bg-rose-500/12`

export function BlockSidebar({
   inner, block, onMoveUp, onMoveDown, onDuplicate,
   onAnchorEdit, onRemove, onMouseEnter, onMouseLeave, dragListeners,
}: BlockSidebarProps) {
   const { t } = useLang()
   const allHandles    = useDocumentHandles()
   const isAnchorDupe  = !!block.handle && allHandles.filter(handle => handle === block.handle).length > 1

   return (
      <div
         className="absolute right-full top-0 mr-2.5 flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-[10px] border border-gray-300 bg-[#eef0f3] shadow-sm select-none min-w-[1.9rem] z-10 animate-[sidebar-fadein_0.12s_ease] doc-dark:bg-[#21262d] doc-dark:border-[#30363d]"
         onMouseEnter={onMouseEnter}
         onMouseLeave={onMouseLeave}
      >
         {inner ? (
            <>
               {onMoveUp   && <button className={btnStd} onClick={onMoveUp}   title={t.moveUp}><ChevronUp size={14} /></button>}
               {onMoveDown && <button className={btnStd} onClick={onMoveDown} title={t.moveDown}><ChevronDown size={14} /></button>}
            </>
         ) : (
            <div
               {...dragListeners}
               className="flex items-center justify-center w-full cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-900 hover:bg-black/[6%] p-1 rounded-md transition-colors doc-dark:text-[#484f58] doc-dark:hover:text-[#8b949e]"
               title={t.dragToReorder}
            >
               <GripVertical size={16} />
            </div>
         )}
         {onDuplicate && (
            <button className={btnStd} onClick={onDuplicate} title={t.duplicateBlock}>
               <Copy size={14} />
            </button>
         )}
         <button
            className={btnStd}
            style={isAnchorDupe
               ? { color: 'rgb(245 158 11)' }
               : block.handle
                  ? { color: 'var(--doc-accent, var(--color-accent))' }
                  : {}
            }
            title={isAnchorDupe
               ? `#${block.handle} — ${t.duplicateAnchor}`
               : block.handle
                  ? `#${block.handle} — ${t.editAnchor}`
                  : t.addAnchor
            }
            onClick={onAnchorEdit}
         >
            {isAnchorDupe ? <TriangleAlert size={14} /> : <Anchor size={14} />}
         </button>
         <button className={btnDgr} onClick={onRemove} title={t.deleteBlock}>
            <Trash2 size={14} />
         </button>
      </div>
   )
}

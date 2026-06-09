// -- React Imports --
import { useState } from 'react'

// -- Type Imports --
import type { Block } from '../types'

// -- Lib / Util Imports --
import { blkPreview } from '../lib/document'
import { BLOCK_ICONS_MAP } from '../lib/constants'
import { scrollAndFlash } from '../lib/treeNavigation'

// -- Library Imports --
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

// -- Context / Hook Imports --
import { useLang } from '../contexts/LangContext'

// -- Component Imports --
import { TreeBlockMenu } from './TreeBlockMenu'

// ============================================================
// Types
// ============================================================

interface BlockItemProps {
   block: Block
   secId: string
}

// ============================================================
// Component
// ============================================================

export function BlockItem({ block, secId }: BlockItemProps) {
   const { t } = useLang()
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })
   const style    = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
   const TypeIcon = BLOCK_ICONS_MAP[block.type]

   const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)

   function handleClick() {
      scrollAndFlash(`[data-block-id="${block.id}"]`, 'nearest')
   }

   function handleContextMenu(event: React.MouseEvent) {
      event.preventDefault()
      setContextMenuPos({ x: event.clientX, y: event.clientY })
   }

   return (
      <>
         <div
            ref={setNodeRef} style={style} {...attributes}
            className="group flex items-center gap-1.5 pl-1 h-7 rounded-md text-xs text-muted hover:bg-accent/8 hover:text-text transition-colors cursor-pointer"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
         >
            {/* Drag handle */}
            <span
               {...listeners}
               className="text-muted/50 group-hover:text-muted/90 cursor-grab shrink-0 transition-colors"
               title={t.dragToReorder}
               onClick={event => event.stopPropagation()}
            >
               <GripVertical size={16} />
            </span>

            {/* Type icon */}
            <span className="text-muted/40 group-hover:text-muted/70 shrink-0 transition-colors">
               {TypeIcon && <TypeIcon size={12} />}
            </span>

            {/* Preview text */}
            <span className="flex-1 min-w-0 truncate text-xs leading-none">
               {blkPreview(block)}
            </span>
         </div>

         {contextMenuPos && (
            <TreeBlockMenu
               secId={secId}
               blockId={block.id}
               position={contextMenuPos}
               onClose={() => setContextMenuPos(null)}
            />
         )}
      </>
   )
}

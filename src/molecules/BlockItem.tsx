import { useState } from 'react'
import type { Block } from '../types'
import { Button } from '../atoms/Button'
import { blkPreview } from '../lib/document'
import { BLOCK_ICONS_MAP } from '../lib/constants'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { useLang } from '../contexts/LangContext'

interface BlockItemProps {
   block:      Block
   onMoveUp:   () => void
   onMoveDown: () => void
   onRemove:   () => void
}

export function BlockItem({ block, onMoveUp, onMoveDown, onRemove }: BlockItemProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
   const TypeIcon = BLOCK_ICONS_MAP[block.type]

   return (
      <div
         ref={setNodeRef} style={style} {...attributes}
         className="group flex items-center gap-2 pl-2 h-8 rounded-lg text-xs text-muted hover:bg-white/4 hover:text-text transition-colors"
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => setHovered(false)}
      >
         {/* Drag handle */}
         <span
            {...listeners}
            className="text-muted/20 group-hover:text-muted/60 cursor-grab shrink-0 transition-colors"
            title={t.dragToReorder}
         >
            <GripVertical size={13} />
         </span>

         {/* Type icon */}
         <span className="text-muted/50 group-hover:text-muted/80 shrink-0 transition-colors">
            {TypeIcon && <TypeIcon size={13} />}
         </span>

         {/* Preview text */}
         <span className="flex-1 min-w-0 truncate text-xs">
            {blkPreview(block)}
         </span>

         {/* Action buttons — always in DOM, opacity toggled. Fixed width prevents layout shift. */}
         <div className="flex items-center gap-0.5 shrink-0 w-16.5 p-1 justify-end">
            <Button
               variant="ghost" size="icon"
               onClick={onMoveUp}
               title={t.moveUp}
               className={hovered ? '' : 'opacity-0 pointer-events-none'}
            >
               <ArrowUp size={13} />
            </Button>
            <Button
               variant="ghost" size="icon"
               onClick={onMoveDown}
               title={t.moveDown}
               className={hovered ? '' : 'opacity-0 pointer-events-none'}
            >
               <ArrowDown size={13} />
            </Button>
            <Button
               variant="danger" size="icon"
               onClick={onRemove}
               title={t.deleteBlock}
               className={hovered ? '' : 'opacity-0 pointer-events-none'}
            >
               <Trash2 size={13} />
            </Button>
         </div>
      </div>
   )
}

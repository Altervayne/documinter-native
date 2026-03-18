import type { Block } from '../types'
import { Button } from '../atoms/Button'
import { blkPreview } from '../lib/helpers'
import { BLOCK_ICONS_MAP } from '../lib/constants'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { useLang } from '../lib/LangContext'

interface BlockItemProps {
   block: Block
   onMoveUp:   () => void
   onMoveDown: () => void
   onRemove:   () => void
}

export function BlockItem({ block, onMoveUp, onMoveDown, onRemove }: BlockItemProps) {
   const { t } = useLang()
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
   const TypeIcon = BLOCK_ICONS_MAP[block.type]

   return (
      <div ref={setNodeRef} style={style} {...attributes} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted hover:bg-white/4 hover:text-text transition-colors">
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
         <span className="flex-1 truncate text-xs">
            {blkPreview(block)}
         </span>

         {/* Actions — revealed on hover */}
         <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button variant="ghost" size="icon" onClick={onMoveUp}   title={t.moveUp}><ArrowUp size={13} /></Button>
            <Button variant="ghost" size="icon" onClick={onMoveDown} title={t.moveDown}><ArrowDown size={13} /></Button>
            <Button variant="danger" size="icon" onClick={onRemove}  title={t.deleteBlock}><Trash2 size={13} /></Button>
         </div>
      </div>
   )
}

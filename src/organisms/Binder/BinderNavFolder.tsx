import { useEffect, useRef } from 'react'
import { Folder, MoreHorizontal, GripVertical, CornerDownRight } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BinderFolderRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'

interface BinderNavFolderProps {
   folder:             BinderFolderRecord
   documentCount:      number
   isSelected:         boolean
   isEditing:          boolean
   isDocumentDragging: boolean
   isSourceFolder:     boolean   // the dragged document already lives here, not a valid drop target
   nestHighlight:      boolean   // a dragged folder is hovering this row's center (nest target)
   reorderEdge:        'before' | 'after' | null   // a dragged folder is hovering this row's edge (reorder)
   onSelect:           () => void
   onEnter:            () => void
   onContextMenu:      (event: React.MouseEvent) => void
   onMoreClick:        (event: React.MouseEvent) => void
   onCommitRename:     (name: string) => void
   onCancelRename:     () => void
}

/**
 * A folder row in the drill-down nav. Single-click selects, double-click enters. The grip
 * reorders folders among siblings; the row is also a drop target for document cards
 * (highlights when a card is dragged over it).
 */
export function BinderNavFolder({
   folder, documentCount, isSelected, isEditing, isDocumentDragging, isSourceFolder, nestHighlight, reorderEdge,
   onSelect, onEnter, onContextMenu, onMoreClick, onCommitRename, onCancelRename,
}: BinderNavFolderProps) {
   const { t } = useLang()
   const inputRef = useRef<HTMLInputElement>(null)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
      useSortable({ id: `folder:${folder.id}` })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

   useEffect(() => {
      if (isEditing) {
         inputRef.current?.focus()
         inputRef.current?.select()
      }
   }, [isEditing])

   if (isEditing) {
      const commit = () => onCommitRename(inputRef.current?.value.trim() || folder.name)
      return (
         <div ref={setNodeRef} style={style} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md">
            <Folder size={14} className="text-muted shrink-0" />
            <input
               ref={inputRef}
               defaultValue={folder.name}
               onKeyDown={event => {
                  if (event.key === 'Enter')  commit()
                  if (event.key === 'Escape') onCancelRename()
               }}
               onBlur={commit}
               className="flex-1 min-w-0 bg-el border border-accent rounded px-1 py-0.5 text-sm text-text outline-none"
            />
         </div>
      )
   }

   // Highlight when this row is the active drop target: a card dropped onto it (doc drag), or a
   // folder nested into it (folder drag, center zone). Never the dragged document's own folder.
   const dropHighlight = (isOver && isDocumentDragging && !isSourceFolder) || nestHighlight

   return (
      <div
         ref={setNodeRef}
         style={style}
         {...attributes}
         data-folder-id={folder.id}
         onClick={onSelect}
         onDoubleClick={onEnter}
         onContextMenu={onContextMenu}
         className={`group relative flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition-colors select-none
            ${dropHighlight ? 'bg-accent/15 ring-1 ring-accent' : isSelected ? 'bg-accent/15' : 'hover:bg-accent/10'}`}
      >
         {reorderEdge && (
            <div
               className={`absolute left-1 right-1 h-0.5 rounded-full bg-accent ${reorderEdge === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'}`}
            />
         )}
         <span
            {...listeners}
            aria-label={t.dragToReorder}
            title={t.dragToReorder}
            onClick={event => event.stopPropagation()}
            className="shrink-0 text-muted/40 group-hover:text-muted/80 cursor-grab active:cursor-grabbing transition-colors"
         >
            <GripVertical size={12} />
         </span>
         <Folder size={14} className={`shrink-0 ${dropHighlight ? 'text-accent' : 'text-muted'}`} />
         <span className={`flex-1 truncate text-sm ${dropHighlight ? 'text-accent' : 'text-text'}`}>{folder.name}</span>
         {dropHighlight ? (
            <span className="shrink-0 flex items-center gap-1 text-[0.6rem] font-semibold text-accent">
               <CornerDownRight size={11} />
               {t.binderMoveHere}
            </span>
         ) : (
            <>
               {documentCount > 0 && (
                  <span className="shrink-0 text-[0.65rem] font-mono text-muted/70">{documentCount}</span>
               )}
               <button
                  type="button"
                  aria-label="Folder actions"
                  onClick={event => { event.stopPropagation(); onMoreClick(event) }}
                  className="shrink-0 p-0.5 rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-accent/20 transition-opacity cursor-pointer"
               >
                  <MoreHorizontal size={14} />
               </button>
            </>
         )}
      </div>
   )
}

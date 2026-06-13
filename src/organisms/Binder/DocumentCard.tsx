import { useState } from 'react'
import { MoreHorizontal, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BinderDocumentRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { DocumentCardMeta } from './DocumentCardMeta'
import { DocumentCardPreview } from './DocumentCardPreview'
import { BinderContextMenu } from '../../molecules/BinderContextMenu'

interface DocumentCardProps {
   record:           BinderDocumentRecord
   isCurrent:        boolean
   isSelected:       boolean
   isDraggable:      boolean   // manual sort active (not searching) — shows the drag handle
   onSelect:         () => void
   onOpen:           () => void
   onDuplicate:      () => void
   onDelete:         () => void
   onExportHtml:     () => void
   onExportMarkdown: () => void
   onExportMintdown: () => void
}

/**
 * A document card: scaled preview (left) + metadata (right). Single-click selects,
 * double-click opens; the ⋯ button and right-click open the context menu. When manual
 * sort is active, a grip handle (top-right) makes the card draggable to reorder or to
 * drop onto a nav folder.
 */
export function DocumentCard({
   record, isCurrent, isSelected, isDraggable, onSelect, onOpen, onDuplicate, onDelete, onExportHtml, onExportMarkdown, onExportMintdown,
}: DocumentCardProps) {
   const { t } = useLang()
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
      useSortable({ id: `doc:${record.id}`, disabled: !isDraggable })
   const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }

   function openMenu(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      setMenuPosition({ x: event.clientX, y: event.clientY })
   }

   // Ring priority: selected (strong) > current (subtle). Current also shows the badge.
   const outlineClass = isSelected
      ? 'border-accent ring-2 ring-accent'
      : isCurrent
         ? 'border-accent/40 ring-2 ring-accent/40'
         : 'border-border hover:border-accent/40'

   return (
      <>
         <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            onClick={onSelect}
            onDoubleClick={onOpen}
            onContextMenu={openMenu}
            className={`group relative flex items-stretch rounded-lg border bg-raised overflow-hidden cursor-pointer transition-colors select-none ${outlineClass}`}
         >
            <DocumentCardPreview
               meta={record.meta}
               previewSections={record.previewSections}
               docTheme={record.docTheme}
               docAccent={record.docAccent}
            />

            <DocumentCardMeta record={record} />

            {isCurrent && (
               <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md text-[0.6rem] font-mono font-semibold bg-accent text-on-accent shadow-md ring-1 ring-black/20">
                  {t.binderCurrentlyEditing}
               </div>
            )}

            {isDraggable && (
               <button
                  type="button"
                  aria-label={t.dragToReorder}
                  title={t.dragToReorder}
                  {...listeners}
                  onClick={event => event.stopPropagation()}
                  className="absolute top-2 right-2 z-10 p-1 rounded-md bg-raised/80 text-muted hover:text-text shadow-sm ring-1 ring-border cursor-grab active:cursor-grabbing"
               >
                  <GripVertical size={14} />
               </button>
            )}

            <button
               type="button"
               aria-label="More actions"
               onClick={openMenu}
               className="absolute bottom-2 right-2 p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-opacity cursor-pointer"
            >
               <MoreHorizontal size={16} />
            </button>
         </div>

         {menuPosition && (
            <BinderContextMenu
               x={menuPosition.x}
               y={menuPosition.y}
               onClose={() => setMenuPosition(null)}
               onOpen={onOpen}
               onDuplicate={onDuplicate}
               onDelete={onDelete}
               onExportHtml={onExportHtml}
               onExportMarkdown={onExportMarkdown}
               onExportMintdown={onExportMintdown}
            />
         )}
      </>
   )
}

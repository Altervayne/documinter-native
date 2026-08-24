import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BinderDocumentRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { DocumentCardMeta } from './DocumentCardMeta'
import { DocumentCardPreview } from './DocumentCardPreview'
import { BinderContextMenu } from '../../molecules/BinderContextMenu'

interface DocumentCardProps {
   record:           BinderDocumentRecord
   isActive:         boolean   // open in the active tab -> "Currently editing"
   isOpen:           boolean   // open in some tab (active or not) -> "Open"
   isSelected:       boolean
   reorderable:      boolean   // manual sort active, only then do siblings shift to preview a reorder
   onSelect:         () => void
   onOpen:           () => void
   onDuplicate:      () => void
   onDelete:         () => void
   onExportHtml:     () => void
   onExportMarkdown: () => void
   onSaveAsTemplate: () => void
}

/**
 * A document card: scaled preview (left) + metadata (right). The whole card is grabbable,
 * drag it onto a nav folder to move it, or (under manual sort) onto another card to reorder.
 * A 5px drag threshold keeps single-click (select) and double-click (open) working; the
 * more-actions button and right-click open the context menu.
 */
export function DocumentCard({
   record, isActive, isOpen, isSelected, reorderable, onSelect, onOpen, onDuplicate, onDelete, onExportHtml, onExportMarkdown, onSaveAsTemplate,
}: DocumentCardProps) {
   const { t } = useLang()
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
      useSortable({ id: `doc:${record.id}` })
   // Apply the sortable position transform only when reordering is live; otherwise (drag-to-folder
   // in a non-manual sort) the dragged card is just hidden, siblings must not shift around.
   const style = reorderable
      ? { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }
      : { opacity: isDragging ? 0 : 1 }

   function openMenu(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      setMenuPosition({ x: event.clientX, y: event.clientY })
   }

   // Ring priority: selected (strong) > active (subtle) > open (faint). Active/open also badge.
   const outlineClass = isSelected
      ? 'border-accent ring-2 ring-accent'
      : isActive
         ? 'border-accent/40 ring-2 ring-accent/40'
         : isOpen
            ? 'border-accent/25 ring-1 ring-accent/25'
            : 'border-border hover:border-accent/40'

   return (
      <>
         <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={onSelect}
            onDoubleClick={onOpen}
            onContextMenu={openMenu}
            className={`group relative flex items-stretch rounded-lg border bg-raised overflow-hidden cursor-grab active:cursor-grabbing transition-colors select-none ${outlineClass}`}
         >
            <DocumentCardPreview
               meta={record.meta}
               previewSections={record.previewSections}
               docTheme={record.docTheme}
               docAccent={record.docAccent}
            />

            <DocumentCardMeta record={record} />

            {isActive ? (
               <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md text-[0.6rem] font-mono font-semibold bg-accent text-on-accent shadow-md ring-1 ring-black/20">
                  {t.binderCurrentlyEditing}
               </div>
            ) : isOpen && (
               <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md text-[0.6rem] font-mono font-semibold bg-raised text-accent shadow-md ring-1 ring-accent/40">
                  {t.binderOpenTab}
               </div>
            )}

            <button
               type="button"
               aria-label="More actions"
               onClick={openMenu}
               onPointerDown={event => event.stopPropagation()}
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
               onSaveAsTemplate={onSaveAsTemplate}
            />
         )}
      </>
   )
}

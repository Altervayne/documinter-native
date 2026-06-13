import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { BinderDocumentRecord } from '../../types'
import { useLang } from '../../contexts/LangContext'
import { DocumentCardMeta } from './DocumentCardMeta'
import { DocumentCardPreview } from './DocumentCardPreview'
import { BinderContextMenu } from '../../molecules/BinderContextMenu'

interface DocumentCardProps {
   record:           BinderDocumentRecord
   isCurrent:        boolean
   onOpen:           () => void
   onDuplicate:      () => void
   onDelete:         () => void
   onExportHtml:     () => void
   onExportMarkdown: () => void
   onExportMintdown: () => void
}

/**
 * A document card: scaled preview (left) + metadata (right). Clicking the card opens
 * the document; the ⋯ button and right-click both open the context menu.
 */
export function DocumentCard({
   record, isCurrent, onOpen, onDuplicate, onDelete, onExportHtml, onExportMarkdown, onExportMintdown,
}: DocumentCardProps) {
   const { t } = useLang()
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   function openMenu(event: React.MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      setMenuPosition({ x: event.clientX, y: event.clientY })
   }

   return (
      <>
         <div
            onClick={onOpen}
            onContextMenu={openMenu}
            className={`group relative flex items-stretch rounded-lg border bg-raised overflow-hidden cursor-pointer transition-colors
               ${isCurrent ? 'border-accent/40 ring-2 ring-accent/40' : 'border-border hover:border-accent/40'}`}
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

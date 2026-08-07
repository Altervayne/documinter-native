import { useDroppable } from '@dnd-kit/core'
import { FilePlus2 } from 'lucide-react'

// ############################################################
// BlankPageDropZone, the fill-the-sheet drop target on a blank
// paged page. Dropping a block here makes it that page's content
// (handled in WysiwygArea's shared block DnD handler via the
// `blank-page` drag data). A resting hint marks the page as an
// intentional empty page; the target highlights while a block is
// being dragged over it.
// ############################################################

interface BlankPageDropZoneProps {
   id:      string
   pageId:  string
   label:   string
   hint:    string
   dragging: boolean
}

export function BlankPageDropZone({ id, pageId, label, hint, dragging }: BlankPageDropZoneProps) {
   const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'blank-page', pageId } })
   return (
      <div
         ref={setNodeRef}
         className={`blank-page-drop${dragging ? ' blank-page-drop-armed' : ''}${isOver ? ' blank-page-drop-over' : ''}`}
      >
         <FilePlus2 size={22} className="blank-page-drop-icon" />
         <span className="blank-page-drop-label">{label}</span>
         {dragging && <span className="blank-page-drop-hint">{hint}</span>}
      </div>
   )
}

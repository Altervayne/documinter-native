import { useDroppable } from '@dnd-kit/core'
import { FilePlus2 } from 'lucide-react'

/*
 * The fill-the-sheet drop target on a blank paged page. A drop makes the block that page's content
 * (WysiwygArea's shared DnD handler reads the `blank-page` drag data). The target highlights while a
 * block is dragged over it.
 */

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

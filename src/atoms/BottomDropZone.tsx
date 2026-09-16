import { useDroppable } from '@dnd-kit/core'

/*
 * Invisible droppable sentinel at the end of a noopStrategy sortable list. Without it the last
 * position is unreachable (hovering the last item yields lastIdx - 1); a drop here triggers the
 * "move to end" branch in handleDragEnd. Mounted only mid-drag.
 */

interface BottomDropZoneProps {
   id: string
   /** Drag data for the shared block DnD handler: which array an end-drop appends to. */
   data?: Record<string, unknown>
}

export function BottomDropZone({ id, data }: BottomDropZoneProps) {
   const { setNodeRef, isOver } = useDroppable({ id, data })
   // A generous hit area with a dashed guide, so the end-of-list target reads clearly.
   return (
      <div
         ref={setNodeRef}
         className="h-7 my-0.5 rounded-md border border-dashed transition-colors"
         style={{
            borderColor: isOver ? 'transparent' : 'color-mix(in srgb, var(--color-border) 60%, transparent)',
            background:  isOver ? 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 14%, transparent)' : undefined,
            outline:     isOver ? '2px solid var(--doc-accent, var(--color-accent))' : undefined,
            outlineOffset: '-2px',
         }}
      />
   )
}

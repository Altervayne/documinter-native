import { useDroppable } from '@dnd-kit/core'

// ############################################################
// BottomDropZone, invisible droppable sentinel at the end of a
// noopStrategy sortable list.
//
// Without this, the last position is unreachable: hovering over
// the last item produces adjustedIdx = lastIdx - 1 (one short).
// Dropping here triggers a "move to end" branch in handleDragEnd.
// Only rendered while a drag is active so it takes no space at rest.
// ############################################################

interface BottomDropZoneProps {
   id: string
   /** Drag data for the shared block DnD handler: which array an end-drop appends to. */
   data?: Record<string, unknown>
}

export function BottomDropZone({ id, data }: BottomDropZoneProps) {
   const { setNodeRef, isOver } = useDroppable({ id, data })
   // A generous hit area (only mounted mid-drag, so the extra height costs nothing at rest), with a
   // resting dashed guide so the end-of-list target reads clearly for a block coming from elsewhere.
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

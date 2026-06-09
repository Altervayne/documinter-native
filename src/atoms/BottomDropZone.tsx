import { useDroppable } from '@dnd-kit/core'

// ============================================================
// BottomDropZone — invisible droppable sentinel at the end of a
// noopStrategy sortable list.
//
// Without this, the last position is unreachable: hovering over
// the last item produces adjustedIdx = lastIdx - 1 (one short).
// Dropping here triggers a "move to end" branch in handleDragEnd.
// Only rendered while a drag is active so it takes no space at rest.
// ============================================================

interface BottomDropZoneProps {
   id: string
}

export function BottomDropZone({ id }: BottomDropZoneProps) {
   const { setNodeRef, isOver } = useDroppable({ id })
   return (
      <div ref={setNodeRef} className="h-3 relative">
         {isOver && (
            <div
               className="absolute inset-x-0 top-0 h-0.5 rounded-sm opacity-70 pointer-events-none"
               style={{ background: 'var(--doc-accent, var(--color-accent))' }}
            />
         )}
      </div>
   )
}

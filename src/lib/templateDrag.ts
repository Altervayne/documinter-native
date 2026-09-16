import type { DocumentTemplate } from './documentTemplate'

// The MIME set on `dataTransfer` during a template-card drag: its presence in `dataTransfer.types` is
// how the drop target tells a template drag from a file or other native drag. dataTransfer carries only
// strings, so the actual DocumentTemplate rides in the module-local channel below (set on dragstart,
// read on drop, cleared on dragend), safe because both ends run in the same page.
export const TEMPLATE_DRAG_MIME = 'application/x-documinter-template'

let draggedTemplate: DocumentTemplate | null = null

export function setDraggedTemplate(template: DocumentTemplate): void {
   draggedTemplate = template
}

export function getDraggedTemplate(): DocumentTemplate | null {
   return draggedTemplate
}

export function clearDraggedTemplate(): void {
   draggedTemplate = null
}

import type { DocumentTemplate } from './documentTemplate'

// The custom MIME `dataTransfer` carries during a template-card drag: its presence on
// `event.dataTransfer.types` is how a drop target (the WYSIWYG canvas) tells "a template is being
// dragged" apart from a file drag or any other native drag. `dataTransfer` can only carry strings
// (the entry set here is the template's id, not useful on its own), so the actual DocumentTemplate
// rides in the module-local channel below instead: set on dragstart, read on drop, cleared on
// dragend. Works because both the drag source (TemplateCard) and the drop target (WysiwygArea) run
// in the same page, so a plain module-scoped variable is enough, there is no need to serialize the
// whole template through dataTransfer.
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

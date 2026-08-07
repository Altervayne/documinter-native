import { ListBlock, type ListItemOperations } from './ListBlock'
import type { Block } from '../../../types'

interface ChecklistBlockProps {
   block:     Block
   itemOps:   ListItemOperations
   onAddItem: () => void
   readOnly?: boolean
   gripSide?: 'left' | 'right'
   /** See ListBlockProps.isListTail: gates the add-item button on a split checklist's last fragment. */
   isListTail?: boolean
}

/**
 * A checklist is a list with a per-item checkbox. It reuses ListBlock's recursive row family
 * verbatim, same indent / Enter / Tab / Backspace / drag behaviour, in checklist mode, which
 * renders a checkbox marker (wired to itemOps.toggle) instead of a bullet. No forked recursion.
 */
export function ChecklistBlock(props: ChecklistBlockProps) {
   return <ListBlock {...props} checklist />
}

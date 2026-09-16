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

/** A checklist is ListBlock in checklist mode: the same recursive row family, rendering a checkbox
 *  marker (wired to itemOps.toggle) instead of a bullet. No forked recursion. */
export function ChecklistBlock(props: ChecklistBlockProps) {
   return <ListBlock {...props} checklist />
}

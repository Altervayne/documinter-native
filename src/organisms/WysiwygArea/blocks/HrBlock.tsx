// -- Type Imports --
import type { Block } from '../../../types'

// #########
// # TYPES #
// #########

interface HrBlockProps {
   block:     Block
   patch:     (partial: Partial<Block>) => void
   readOnly?: boolean
}

// #############
// # COMPONENT #
// #############

/**
 * Renders a horizontal rule — a pure visual divider with no editable content.
 * The block and patch props are accepted for contract consistency with all other
 * block components but are never used.
 *
 * Edit mode: the <hr> is wrapped in a padded div with a dashed border so the
 * block has enough height and visual presence to hover, right-click, and delete
 * without having to fall back to the tree panel.
 *
 * Read-only / export: the bare <hr> with margin: 0 so the block wrapper's my-4
 * controls vertical spacing. The export generates its own <hr> via exportBlock
 * and lets the inlined stylesheet apply the full 3rem margin.
 */
export function HrBlock({ block: _block, patch: _patch, readOnly }: HrBlockProps) {
   if (readOnly) return <hr style={{ margin: 0 }} />
   return (
      <div className="hr-edit-wrap p-2.5 rounded-sm border border-dashed">
         <hr style={{ margin: 0 }} />
      </div>
   )
}

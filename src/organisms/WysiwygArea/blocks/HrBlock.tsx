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
 * A horizontal rule, a pure visual divider. block/patch are accepted for block-component contract
 * consistency but never used. Edit mode wraps the <hr> in a padded dashed-border box so the block has
 * enough height to hover / right-click / delete. Read-only emits a bare margin-0 <hr>, letting the
 * block wrapper's my-4 (and the export stylesheet's full margin) control spacing.
 */
export function HrBlock({ block: _block, patch: _patch, readOnly }: HrBlockProps) {
   if (readOnly) return <hr style={{ margin: 0 }} />
   return (
      <div className="hr-edit-wrap p-2.5 rounded-sm border border-dashed">
         <hr style={{ margin: 0 }} />
      </div>
   )
}

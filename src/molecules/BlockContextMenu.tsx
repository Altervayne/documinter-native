// -- Library Imports --
import {
   ArrowUpFromLine, ArrowDownToLine,
   ChevronUp, ChevronDown,
   Copy, Anchor, TriangleAlert, Trash2,
   IndentIncrease, IndentDecrease,
   BetweenHorizontalStart, BetweenHorizontalEnd,
   BetweenVerticalStart, BetweenVerticalEnd,
   SeparatorHorizontal, Magnet, Link2,
} from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

// -- Component Imports --
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

// #########
// # TYPES #
// #########

export interface TableCellContextActions {
   rowIndex:         number   // -1 for header row
   colIndex:         number
   rowCount:         number
   colCount:         number
   onInsertRowAbove: () => void
   onInsertRowBelow: () => void
   onInsertColLeft:  () => void
   onInsertColRight: () => void
   onDeleteRow:      () => void
   onDeleteCol:      () => void
}

export interface ListItemContextActions {
   canMoveUp:   boolean
   canMoveDown: boolean
   canIndent:   boolean
   canUnindent: boolean
   onMoveUp:    () => void
   onMoveDown:  () => void
   onIndent:    () => void
   onUnindent:  () => void
   onDelete:    () => void
}

export interface BlockContextMenuProps {
   position:     { x: number; y: number }
   canMoveUp:    boolean
   canMoveDown:  boolean
   hasAnchor:    boolean
   isAnchorDupe: boolean
   onInsertBefore: () => void
   onInsertAfter:  () => void
   onMoveUp:       (() => void) | undefined
   onMoveDown:     (() => void) | undefined
   onDuplicate:    () => void
   onAnchorEdit:   () => void
   onDelete:       () => void
   onClose:        () => void
   listItem?:      ListItemContextActions
   tableCell?:     TableCellContextActions
   /** Paged-format page-break action. Present only in paged mode for an outer block that has a place
    *  to break (or already has a break) after it. `insert` adds a break after this block, `remove`
    *  drops the one already there. */
   pageBreak?:     { mode: 'insert' | 'remove'; onSelect: () => void }
   /** Paged-format keep-together toggle. Present only in paged mode for an outer splittable block.
    *  `active` = the block is currently held whole; the label / action swaps on it. */
   keepTogether?:  { active: boolean; onSelect: () => void }
   /** Paged-format keep-with-next toggle. Present only in paged mode for an outer block that has a
    *  following top-level block. `active` = a break is currently forbidden after this block; the label /
    *  action swaps on it. */
   keepWithNext?:  { active: boolean; onSelect: () => void }
}

// #############
// # COMPONENT #
// #############

/**
 * WYSIWYG block right-click menu: a base Block section plus conditional List-item and
 * Table-cell sections. This is a thin adapter over the shared <ContextMenu>, it maps the
 * per-context actions to a declarative `entries` array; the shared component owns the
 * portal, the (measured, two-sided) viewport clamp, keyboard nav, and dismissal.
 */
export function BlockContextMenu({
   position, canMoveUp, canMoveDown,
   hasAnchor, isAnchorDupe,
   onInsertBefore, onInsertAfter,
   onMoveUp, onMoveDown,
   onDuplicate, onAnchorEdit, onDelete,
   onClose,
   listItem,
   tableCell,
   pageBreak,
   keepTogether,
   keepWithNext,
}: BlockContextMenuProps) {
   const { t } = useLang()

   // ============ Block section ============
   const entries: ContextMenuEntry[] = [
      { type: 'header', label: t.blockSection },
      { label: t.insertBefore, icon: <ArrowUpFromLine size={13} />, onSelect: onInsertBefore },
      { label: t.insertAfter,  icon: <ArrowDownToLine size={13} />, onSelect: onInsertAfter },
      { type: 'separator' },
      { label: t.moveUp,   icon: <ChevronUp size={13} />,   disabled: !canMoveUp,   onSelect: () => onMoveUp?.() },
      { label: t.moveDown, icon: <ChevronDown size={13} />, disabled: !canMoveDown, onSelect: () => onMoveDown?.() },
      { label: t.duplicateBlock, icon: <Copy size={13} />, onSelect: onDuplicate },
      {
         label: hasAnchor
            ? (isAnchorDupe ? `${t.duplicateAnchor}` : t.editAnchor)
            : t.addAnchor,
         icon: isAnchorDupe
            ? <TriangleAlert size={13} className="text-amber-400" />
            : <Anchor size={13} />,
         onSelect: onAnchorEdit,
      },
      { type: 'separator' },
      { label: t.deleteBlock, icon: <Trash2 size={13} />, danger: true, onSelect: onDelete },
   ]

   // ============ Pagination section (paged format only) ============
   // The three actions below are each conditional on the paged layout having a place for them, so
   // the header only goes up when at least one is present; the present ones then sit together under
   // it as one group, no separators between them.
   if (pageBreak || keepTogether || keepWithNext) {
      entries.push(
         { type: 'separator' },
         { type: 'header', label: t.paginationSection },
      )
   }

   // Page-break entry: inserts a break after this block, or (once one is already there) removes it.
   if (pageBreak) {
      const isRemove = pageBreak.mode === 'remove'
      entries.push({
         label:    isRemove ? t.blockRemovePageBreak : t.blockInsertPageBreak,
         icon:     <SeparatorHorizontal size={13} />,
         danger:   isRemove,
         onSelect: pageBreak.onSelect,
      })
   }

   // Keep-together toggle: the menu has no checkbox affordance, so the state reads from the label +
   // verb swap: held blocks offer "allow splitting", unheld blocks offer "keep on one page".
   if (keepTogether) {
      entries.push({
         label:    keepTogether.active ? t.blockAllowSplit : t.blockKeepTogether,
         icon:     <Magnet size={13} />,
         onSelect: keepTogether.onSelect,
      })
   }

   // Keep-with-next toggle: distinct from keep-together, this forbids a break AFTER the block
   // (pinning it to its follower), not a split WITHIN it. Same label + verb swap as above.
   if (keepWithNext) {
      entries.push({
         label:    keepWithNext.active ? t.blockAllowBreakAfter : t.blockKeepWithNext,
         icon:     <Link2 size={13} />,
         onSelect: keepWithNext.onSelect,
      })
   }

   // ============ List-item section ============
   if (listItem) {
      entries.push(
         { type: 'separator' },
         { type: 'header', label: t.listItemSection },
         { label: t.moveUp,   icon: <ChevronUp size={13} />,       disabled: !listItem.canMoveUp,   onSelect: listItem.onMoveUp },
         { label: t.moveDown, icon: <ChevronDown size={13} />,     disabled: !listItem.canMoveDown, onSelect: listItem.onMoveDown },
         { label: t.indent,   icon: <IndentIncrease size={13} />,  disabled: !listItem.canIndent,   onSelect: listItem.onIndent },
         { label: t.unindent, icon: <IndentDecrease size={13} />,  disabled: !listItem.canUnindent, onSelect: listItem.onUnindent },
         { type: 'separator' },
         { label: t.deleteListItem, icon: <Trash2 size={13} />, danger: true, onSelect: listItem.onDelete },
      )
   }

   // ============ Table-cell section ============
   if (tableCell) {
      const isHeaderRow = tableCell.rowIndex === -1
      entries.push(
         { type: 'separator' },
         { type: 'header', label: t.tableCellSection },
         { label: t.insertRowAbove, icon: <BetweenHorizontalStart size={13} />, disabled: isHeaderRow, onSelect: tableCell.onInsertRowAbove },
         { label: t.insertRowBelow, icon: <BetweenHorizontalEnd size={13} />,   disabled: isHeaderRow, onSelect: tableCell.onInsertRowBelow },
         { label: t.insertColLeft,  icon: <BetweenVerticalStart size={13} />,   onSelect: tableCell.onInsertColLeft },
         { label: t.insertColRight, icon: <BetweenVerticalEnd size={13} />,     onSelect: tableCell.onInsertColRight },
         { type: 'separator' },
         { label: t.deleteTableRow, icon: <Trash2 size={13} />, danger: true, disabled: isHeaderRow || tableCell.rowCount <= 1, onSelect: tableCell.onDeleteRow },
         { label: t.deleteTableCol, icon: <Trash2 size={13} />, danger: true, disabled: tableCell.colCount <= 1,                onSelect: tableCell.onDeleteCol },
      )
   }

   return <ContextMenu position={position} entries={entries} onClose={onClose} />
}

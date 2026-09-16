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
   /** Paged mode only, for an outer block with a place to break after it. `insert` adds a break,
    *  `remove` drops one already there. */
   pageBreak?:     { mode: 'insert' | 'remove'; onSelect: () => void }
   /** Paged mode only. `active` = the block is held whole; the label and action swap on it. */
   keepTogether?:  { active: boolean; onSelect: () => void }
   /** Paged mode only. `active` = a break is forbidden after this block; the label and action swap on it. */
   keepWithNext?:  { active: boolean; onSelect: () => void }
}

// #############
// # COMPONENT #
// #############

/**
 * WYSIWYG block right-click menu: a base Block section plus conditional Pagination, List-item, and
 * Table-cell sections. Thin adapter over <ContextMenu>, mapping the per-context actions to `entries`.
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
   // Each action is conditional, so the header only goes up when at least one is present.
   if (pageBreak || keepTogether || keepWithNext) {
      entries.push(
         { type: 'separator' },
         { type: 'header', label: t.paginationSection },
      )
   }

   if (pageBreak) {
      const isRemove = pageBreak.mode === 'remove'
      entries.push({
         label:    isRemove ? t.blockRemovePageBreak : t.blockInsertPageBreak,
         icon:     <SeparatorHorizontal size={13} />,
         danger:   isRemove,
         onSelect: pageBreak.onSelect,
      })
   }

   // No checkbox affordance: held blocks offer "allow splitting", unheld offer "keep on one page".
   if (keepTogether) {
      entries.push({
         label:    keepTogether.active ? t.blockAllowSplit : t.blockKeepTogether,
         icon:     <Magnet size={13} />,
         onSelect: keepTogether.onSelect,
      })
   }

   // Forbids a break AFTER the block (pinning it to its follower), not a split WITHIN it.
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

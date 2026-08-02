// -- Library Imports --
import {
   ArrowUpFromLine, ArrowDownToLine,
   ChevronUp, ChevronDown,
   Copy, Anchor, TriangleAlert, Trash2,
   IndentIncrease, IndentDecrease,
   BetweenHorizontalStart, BetweenHorizontalEnd,
   BetweenVerticalStart, BetweenVerticalEnd,
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
}: BlockContextMenuProps) {
   const { t } = useLang()

   // ============ Base block section ============
   const entries: ContextMenuEntry[] = [
      { label: t.insertBefore, icon: <ArrowUpFromLine size={13} />, onSelect: onInsertBefore },
      { label: t.insertAfter,  icon: <ArrowDownToLine size={13} />, onSelect: onInsertAfter },
      { type: 'separator' },
      { label: t.moveUp,   icon: <ChevronUp size={13} />,   disabled: !canMoveUp,   onSelect: () => onMoveUp?.() },
      { label: t.moveDown, icon: <ChevronDown size={13} />, disabled: !canMoveDown, onSelect: () => onMoveDown?.() },
      { type: 'separator' },
      { label: t.duplicateBlock, icon: <Copy size={13} />, onSelect: onDuplicate },
      { type: 'separator' },
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

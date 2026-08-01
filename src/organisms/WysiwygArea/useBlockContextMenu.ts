// -- React Imports --
import { useState } from 'react'
import type { RefObject } from 'react'

// -- Lib Imports --
// getListItemContext is a read (computes the menu's enable/disable flags), not a mutation.
import { getListItemContext } from '../../lib/listItemTree'

// -- Type Imports --
import type { Block } from '../../types'
import type { BlockContextMenuProps, ListItemContextActions, TableCellContextActions } from '../../molecules/BlockContextMenu'

interface UseBlockContextMenuOptions {
   block:        Block
   /** The block's wrapper element, scopes table-cell hit-testing to this block. */
   blockDivRef:  RefObject<HTMLDivElement | null>
   isAnchorDupe: boolean
   onMoveUp?:    () => void
   onMoveDown?:  () => void
   onDuplicate:  () => void
   onDelete:     () => void
   onAnchorEdit: () => void
   onRequestInsertBefore: () => void
   onRequestInsertAfter:  () => void
   // List-item operations, already inner/outer-routed by the caller.
   onMoveListItemUp:   (itemId: string) => void
   onMoveListItemDown: (itemId: string) => void
   onIndentListItem:   (itemId: string) => void
   onUnindentListItem: (itemId: string) => void
   onRemoveListItem:   (itemId: string) => void
   // Table operations, already inner/outer-routed by the caller.
   onInsertTableRowAt: (rowIndex: number) => void
   onDeleteTableRowAt: (rowIndex: number) => void
   onInsertTableColAt: (colIndex: number) => void
   onDeleteTableColAt: (colIndex: number) => void
}

interface UseBlockContextMenuResult {
   /** Fully-assembled props for <BlockContextMenu>, or null when the menu is closed. */
   contextMenuProps: BlockContextMenuProps | null
   /** Right-click handler: detects list-item / table-cell context and opens the menu. */
   openContextMenu:  (event: React.MouseEvent) => void
   closeContextMenu: () => void
}

/**
 * Context-menu state for a WysiwygBlock: open position, the list-item / table-cell detection
 * from the right-click target's DOM, and assembly of the per-context action objects. The
 * list-item and table actions are caller-supplied handlers backed by the mutation hooks; this
 * hook computes no list mutation itself (getListItemContext is a read for the enable flags).
 */
export function useBlockContextMenu({
   block, blockDivRef, isAnchorDupe,
   onMoveUp, onMoveDown, onDuplicate, onDelete, onAnchorEdit,
   onRequestInsertBefore, onRequestInsertAfter,
   onMoveListItemUp, onMoveListItemDown, onIndentListItem, onUnindentListItem, onRemoveListItem,
   onInsertTableRowAt, onDeleteTableRowAt, onInsertTableColAt, onDeleteTableColAt,
}: UseBlockContextMenuOptions): UseBlockContextMenuResult {
   const [contextMenu,           setContextMenu]           = useState<{ x: number; y: number } | null>(null)
   const [contextMenuListItemId, setContextMenuListItemId] = useState<string | null>(null)
   const [contextMenuTableCell,  setContextMenuTableCell]  = useState<{ rowIndex: number; colIndex: number; isHeader: boolean } | null>(null)

   function openContextMenu(event: React.MouseEvent) {
      event.preventDefault()
      // Block chrome isn't a DOM/React-tree ancestor of the section's gutter or title, so this
      // wouldn't currently reach the section menu either way — stopped defensively anyway, matching
      // the same portal-bubbling guard used by BlockEditorWindow, in case the section's attach
      // point ever widens to the whole .doc-section.
      event.stopPropagation()
      const target = event.target as Element

      // List item detection
      const listItemEl = target.closest('[data-list-item-id]')
      setContextMenuListItemId(listItemEl?.getAttribute('data-list-item-id') ?? null)

      // Table cell detection, derive row/col indices from the DOM structure
      if (block.type === 'table' && blockDivRef.current) {
         const cell = target.closest('td, th')
         if (cell && blockDivRef.current.contains(cell)) {
            const isHeader = cell.tagName.toLowerCase() === 'th'
            const row = cell.closest('tr')
            const colIndex = row
               ? Array.from(row.querySelectorAll(isHeader ? 'th' : 'td')).findIndex(el => el === cell)
               : 0
            const rowIndex = isHeader
               ? -1
               : (() => {
                  const tbody = cell.closest('tbody')
                  return tbody && row
                     ? Array.from(tbody.querySelectorAll('tr')).findIndex(el => el === row)
                     : 0
               })()
            setContextMenuTableCell({ rowIndex, colIndex, isHeader })
         } else {
            setContextMenuTableCell(null)
         }
      } else {
         setContextMenuTableCell(null)
      }

      setContextMenu({ x: event.clientX, y: event.clientY })
   }

   function closeContextMenu() {
      setContextMenu(null)
      setContextMenuListItemId(null)
      setContextMenuTableCell(null)
   }

   let contextMenuProps: BlockContextMenuProps | null = null
   if (contextMenu) {
      let listItemActions: ListItemContextActions | undefined
      if (contextMenuListItemId && block.type === 'list') {
         const itemCtx = getListItemContext(block.items ?? [], contextMenuListItemId)
         if (itemCtx) {
            const itemId = contextMenuListItemId
            listItemActions = {
               canMoveUp:   itemCtx.indexInParent > 0,
               canMoveDown: itemCtx.indexInParent < itemCtx.siblingsCount - 1,
               canIndent:   itemCtx.indexInParent > 0,
               canUnindent: itemCtx.depth > 0,
               onMoveUp:    () => onMoveListItemUp(itemId),
               onMoveDown:  () => onMoveListItemDown(itemId),
               onIndent:    () => onIndentListItem(itemId),
               onUnindent:  () => onUnindentListItem(itemId),
               onDelete:    () => onRemoveListItem(itemId),
            }
         }
      }
      let tableCellActions: TableCellContextActions | undefined
      if (contextMenuTableCell && block.type === 'table') {
         const { rowIndex, colIndex } = contextMenuTableCell
         const rowCount = block.richRows?.length ?? 0
         const colCount = block.richHeaders?.length ?? 0
         tableCellActions = {
            rowIndex,
            colIndex,
            rowCount,
            colCount,
            onInsertRowAbove: () => onInsertTableRowAt(rowIndex === -1 ? 0 : rowIndex),
            onInsertRowBelow: () => onInsertTableRowAt(rowIndex === -1 ? 0 : rowIndex + 1),
            onInsertColLeft:  () => onInsertTableColAt(colIndex),
            onInsertColRight: () => onInsertTableColAt(colIndex + 1),
            onDeleteRow:      () => { if (rowIndex >= 0) onDeleteTableRowAt(rowIndex) },
            onDeleteCol:      () => onDeleteTableColAt(colIndex),
         }
      }

      contextMenuProps = {
         position:     contextMenu,
         canMoveUp:    !!onMoveUp,
         canMoveDown:  !!onMoveDown,
         hasAnchor:    !!block.handle,
         isAnchorDupe,
         onInsertBefore: onRequestInsertBefore,
         onInsertAfter:  onRequestInsertAfter,
         onMoveUp,
         onMoveDown,
         onDuplicate,
         onAnchorEdit,
         onDelete,
         onClose:    closeContextMenu,
         listItem:   listItemActions,
         tableCell:  tableCellActions,
      }
   }

   return { contextMenuProps, openContextMenu, closeContextMenu }
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
   ArrowUpFromLine, ArrowDownToLine,
   ChevronUp, ChevronDown,
   Copy, Anchor, TriangleAlert, Trash2,
   IndentIncrease, IndentDecrease,
   BetweenHorizontalStart, BetweenHorizontalEnd,
   BetweenVerticalStart, BetweenVerticalEnd,
} from 'lucide-react'
import { useLang } from '../contexts/LangContext'

interface MenuItem {
   id:        string
   label:     string
   icon:      React.ReactElement
   danger?:   boolean
   disabled?: boolean
   action:    () => void
}

type MenuEntry = MenuItem | 'divider' | { type: 'header'; label: string }

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
   const menuRef = useRef<HTMLDivElement>(null)
   const [focused, setFocused] = useState(0)

   const entries: MenuEntry[] = [
      {
         id: 'insert-before', label: t.insertBefore,
         icon: <ArrowUpFromLine size={13} />,
         action: () => { onClose(); onInsertBefore() },
      },
      {
         id: 'insert-after', label: t.insertAfter,
         icon: <ArrowDownToLine size={13} />,
         action: () => { onClose(); onInsertAfter() },
      },
      'divider',
      {
         id: 'move-up', label: t.moveUp,
         icon: <ChevronUp size={13} />,
         disabled: !canMoveUp,
         action: () => { if (onMoveUp) { onMoveUp(); onClose() } },
      },
      {
         id: 'move-down', label: t.moveDown,
         icon: <ChevronDown size={13} />,
         disabled: !canMoveDown,
         action: () => { if (onMoveDown) { onMoveDown(); onClose() } },
      },
      'divider',
      {
         id: 'duplicate', label: t.duplicateBlock,
         icon: <Copy size={13} />,
         action: () => { onDuplicate(); onClose() },
      },
      'divider',
      {
         id: 'anchor',
         label: hasAnchor
            ? (isAnchorDupe ? `${t.duplicateAnchor}` : t.editAnchor)
            : t.addAnchor,
         icon: isAnchorDupe
            ? <TriangleAlert size={13} className="text-amber-400" />
            : <Anchor size={13} />,
         action: () => { onAnchorEdit(); onClose() },
      },
      'divider',
      {
         id: 'delete', label: t.deleteBlock,
         icon: <Trash2 size={13} />,
         danger: true,
         action: () => { onDelete(); onClose() },
      },
   ]

   if (listItem) {
      entries.push('divider')
      entries.push({ type: 'header', label: t.listItemSection })
      entries.push({
         id: 'item-move-up', label: t.moveUp,
         icon: <ChevronUp size={13} />,
         disabled: !listItem.canMoveUp,
         action: () => { listItem.onMoveUp(); onClose() },
      })
      entries.push({
         id: 'item-move-down', label: t.moveDown,
         icon: <ChevronDown size={13} />,
         disabled: !listItem.canMoveDown,
         action: () => { listItem.onMoveDown(); onClose() },
      })
      entries.push({
         id: 'item-indent', label: t.indent,
         icon: <IndentIncrease size={13} />,
         disabled: !listItem.canIndent,
         action: () => { listItem.onIndent(); onClose() },
      })
      entries.push({
         id: 'item-unindent', label: t.unindent,
         icon: <IndentDecrease size={13} />,
         disabled: !listItem.canUnindent,
         action: () => { listItem.onUnindent(); onClose() },
      })
      entries.push('divider')
      entries.push({
         id: 'item-delete', label: t.deleteListItem,
         icon: <Trash2 size={13} />,
         danger: true,
         action: () => { listItem.onDelete(); onClose() },
      })
   }

   if (tableCell) {
      const isHeaderRow = tableCell.rowIndex === -1
      entries.push('divider')
      entries.push({ type: 'header', label: t.tableCellSection })
      entries.push({
         id: 'table-insert-row-above', label: t.insertRowAbove,
         icon: <BetweenHorizontalStart size={13} />,
         disabled: isHeaderRow,
         action: () => { tableCell.onInsertRowAbove(); onClose() },
      })
      entries.push({
         id: 'table-insert-row-below', label: t.insertRowBelow,
         icon: <BetweenHorizontalEnd size={13} />,
         disabled: isHeaderRow,
         action: () => { tableCell.onInsertRowBelow(); onClose() },
      })
      entries.push({
         id: 'table-insert-col-left', label: t.insertColLeft,
         icon: <BetweenVerticalStart size={13} />,
         action: () => { tableCell.onInsertColLeft(); onClose() },
      })
      entries.push({
         id: 'table-insert-col-right', label: t.insertColRight,
         icon: <BetweenVerticalEnd size={13} />,
         action: () => { tableCell.onInsertColRight(); onClose() },
      })
      entries.push('divider')
      entries.push({
         id: 'table-delete-row', label: t.deleteTableRow,
         icon: <Trash2 size={13} />,
         danger: true,
         disabled: isHeaderRow || tableCell.rowCount <= 1,
         action: () => { tableCell.onDeleteRow(); onClose() },
      })
      entries.push({
         id: 'table-delete-col', label: t.deleteTableCol,
         icon: <Trash2 size={13} />,
         danger: true,
         disabled: tableCell.colCount <= 1,
         action: () => { tableCell.onDeleteCol(); onClose() },
      })
   }

   const selectableItems = entries.filter(
      (entry): entry is MenuItem => entry !== 'divider' && !('type' in entry)
   )

   // Clamp menu to viewport
   const menuWidth  = 200
   const menuHeight = entries.length * 28 + 8
   const viewportWidth  = window.innerWidth
   const viewportHeight = window.innerHeight
   const left = Math.min(position.x, viewportWidth  - menuWidth  - 8)
   const top  = Math.min(position.y, viewportHeight - menuHeight - 8)

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
         if (event.key === 'ArrowDown') {
            event.preventDefault()
            setFocused(current => {
               let next = (current + 1) % selectableItems.length
               while (selectableItems[next]?.disabled) next = (next + 1) % selectableItems.length
               return next
            })
            return
         }
         if (event.key === 'ArrowUp') {
            event.preventDefault()
            setFocused(current => {
               let prev = (current - 1 + selectableItems.length) % selectableItems.length
               while (selectableItems[prev]?.disabled) prev = (prev - 1 + selectableItems.length) % selectableItems.length
               return prev
            })
            return
         }
         if (event.key === 'Enter') {
            event.preventDefault()
            const item = selectableItems[focused]
            if (item && !item.disabled) item.action()
            return
         }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [focused, selectableItems, onClose])

   useEffect(() => {
      function onPointerDown(event: PointerEvent) {
         if (!menuRef.current?.contains(event.target as Node)) onClose()
      }
      function onScroll() { onClose() }
      document.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('scroll', onScroll, { capture: true, passive: true })
      return () => {
         document.removeEventListener('pointerdown', onPointerDown)
         window.removeEventListener('scroll', onScroll, { capture: true })
      }
   }, [onClose])

   let selectableCount = -1

   return createPortal(
      <div
         ref={menuRef}
         className="fixed z-[9999] rounded-xl border border-border bg-raised shadow-2xl min-w-[172px] overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
      >
         {entries.map((entry, entryIndex) => {
            if (entry === 'divider') {
               return <div key={`divider-${entryIndex}`} className="my-0.5 h-px mx-2 bg-border" />
            }
            if ('type' in entry) {
               return (
                  <div key={`header-${entryIndex}`} className="px-3 pt-2 pb-1 text-[0.6rem] uppercase tracking-wider text-muted/60 font-semibold select-none">
                     {entry.label}
                  </div>
               )
            }
            selectableCount++
            const itemSelectableIndex = selectableCount
            const isFocused = focused === itemSelectableIndex
            return (
               <button
                  key={entry.id}
                  disabled={entry.disabled}
                  className={[
                     'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs cursor-pointer border-0 transition-colors text-left',
                     entry.disabled
                        ? 'opacity-30 cursor-default'
                        : entry.danger
                           ? isFocused ? 'text-red bg-red/10'       : 'text-red/80 hover:text-red hover:bg-red/10'
                           : isFocused ? 'text-text bg-accent/10' : 'text-text/75 hover:text-text hover:bg-accent/10',
                  ].join(' ')}
                  onPointerEnter={() => !entry.disabled && setFocused(itemSelectableIndex)}
                  onClick={entry.disabled ? undefined : entry.action}
               >
                  <span className="shrink-0">{entry.icon}</span>
                  <span>{entry.label}</span>
               </button>
            )
         })}
      </div>,
      document.body,
   )
}

// -- React Imports --
import { useState } from 'react'

// -- Library Imports --
import {
   DndContext, DragOverlay, closestCenter,
   type DragEndEvent, type DragStartEvent,
   useSensor, useSensors, PointerSensor,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, CirclePlus } from 'lucide-react'

// -- Context / Atom Imports --
import { ContentEditable } from '../../../atoms/ContentEditable'
import { useLang } from '../../../contexts/LangContext'

// -- Lib Imports --
import {
   updateListItemRichText,
   reorderListItemsUnderParent,
   indentListItem,
   unindentListItem,
   removeListItemById,
   insertListItemAfter,
} from '../../../lib/document'

// -- Type Imports --
import type { Block, InlineContent, ListItem } from '../../../types'

// ============================================================
// Utilities
// ============================================================

/**
 * Returns true when the cursor (selection) is at the very start of the element's
 * text content — works correctly for rich contenteditable elements with nested tags.
 */
function isCursorAtStart(element: HTMLElement): boolean {
   const selection = window.getSelection()
   if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false
   const range = selection.getRangeAt(0)
   const preRange = document.createRange()
   preRange.selectNodeContents(element)
   preRange.setEnd(range.startContainer, range.startOffset)
   return preRange.toString().length === 0
}

// ============================================================
// ListItemRow — one sortable row at a given nesting level
// ============================================================

interface ListItemRowProps {
   item:           ListItem
   depth:          number
   rootItems:      ListItem[]
   onUpdateItems:  (newItems: ListItem[]) => void
   readOnly?:      boolean
   isDragOverlay?: boolean
   gripSide?:      'left' | 'right'
}

const BULLETS = ['•', '◦', '▸', '▹']

function ListItemRow({ item, depth, rootItems, onUpdateItems, readOnly, isDragOverlay, gripSide = 'left' }: ListItemRowProps) {
   const [hovered, setHovered] = useState(false)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id:       item.id,
      disabled: !!readOnly || !!isDragOverlay,
   })

   const style = isDragOverlay
      ? undefined
      : { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }

   const bullet = BULLETS[Math.min(depth, BULLETS.length - 1)]

   function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
      const element = event.currentTarget

      // Tab / Shift+Tab — indent / unindent
      // preventDefault is critical: stops browser focus-change behaviour.
      // After the state update the item moves in the DOM; we restore focus explicitly.
      if (event.key === 'Tab') {
         event.preventDefault()
         const currentItemId = item.id
         if (event.shiftKey) {
            if (depth > 0) onUpdateItems(unindentListItem(rootItems, item.id))
         } else {
            onUpdateItems(indentListItem(rootItems, item.id))
         }
         requestAnimationFrame(() => {
            const target = document.querySelector(`[data-list-item-id="${currentItemId}"] [contenteditable]`)
            if (target instanceof HTMLElement) target.focus()
         })
         return
      }

      // Enter — create new sibling immediately after (Shift+Enter falls through to <br>)
      if (event.key === 'Enter' && !event.shiftKey) {
         event.preventDefault()
         const newItem: ListItem = { id: crypto.randomUUID(), richText: [], children: [] }
         onUpdateItems(insertListItemAfter(rootItems, item.id, newItem))
         requestAnimationFrame(() => {
            const newEl = document.querySelector(`[data-list-item-id="${newItem.id}"] [contenteditable]`)
            if (newEl instanceof HTMLElement) newEl.focus()
         })
         return
      }

      // Backspace at start — unindent or delete
      if (event.key === 'Backspace' && isCursorAtStart(element)) {
         if (depth > 0) {
            event.preventDefault()
            onUpdateItems(unindentListItem(rootItems, item.id))
            return
         }
         if (element.textContent?.trim() === '') {
            event.preventDefault()
            onUpdateItems(removeListItemById(rootItems, item.id))
            return
         }
         // depth === 0, non-empty: default browser behavior
      }
   }

   return (
      <div
         ref={isDragOverlay ? undefined : setNodeRef}
         style={style}
         {...(isDragOverlay ? {} : attributes)}
         data-list-item-id={item.id}
         onMouseEnter={readOnly ? undefined : () => setHovered(true)}
         onMouseLeave={readOnly ? undefined : () => setHovered(false)}
      >
         {/* Item row */}
         <div className="flex items-baseline gap-1.5 py-0.5 min-h-[1.5rem]">
            {/* Drag handle — uses negative margin to float outside the content area.
                Left column (default): marginLeft -16 places it before the bullet.
                Right column: order:3 sends it to the flex end; marginRight -16 floats it right. */}
            {!readOnly && !isDragOverlay && (
               <span
                  {...listeners}
                  className={`shrink-0 cursor-grab active:cursor-grabbing text-muted transition-opacity ${hovered ? 'opacity-50' : 'opacity-0'}`}
                  style={
                     gripSide === 'right'
                        ? { order: 3, marginRight: -16, marginLeft: 4, width: 14 }
                        : { marginLeft: -16, marginRight: 0, width: 14 }
                  }
               >
                  <GripVertical size={16} />
               </span>
            )}

            {/* Bullet */}
            <span className="shrink-0 select-none text-muted/50 font-mono text-xs mt-px" style={{ minWidth: '1ch' }}>
               {bullet}
            </span>

            {/* Text */}
            <ContentEditable
               tag="span"
               content={(item.richText ?? []) as InlineContent}
               onCommit={richText => onUpdateItems(updateListItemRichText(rootItems, item.id, richText))}
               onKeyDown={readOnly ? undefined : handleKeyDown}
               placeholder="Item"
               style={{ flex: 1 }}
               readOnly={readOnly}
            />
         </div>

         {/* Children — recursive, indented */}
         {item.children.length > 0 && (
            <div style={{ paddingLeft: 20 }}>
               <ListLevel
                  items={item.children}
                  parentItemId={item.id}
                  depth={depth + 1}
                  rootItems={rootItems}
                  onUpdateItems={onUpdateItems}
                  readOnly={readOnly}
                  gripSide={gripSide}
               />
            </div>
         )}
      </div>
   )
}

// ============================================================
// ListLevel — one isolated DnD context for a sibling group
// ============================================================

interface ListLevelProps {
   items:         ListItem[]
   parentItemId:  string | null
   depth:         number
   rootItems:     ListItem[]
   onUpdateItems: (newItems: ListItem[]) => void
   readOnly?:     boolean
   gripSide?:     'left' | 'right'
}

function ListLevel({ items, parentItemId, depth, rootItems, onUpdateItems, readOnly, gripSide = 'left' }: ListLevelProps) {
   const [activeDragId, setActiveDragId] = useState<string | null>(null)
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const activeItem = activeDragId ? items.find(item => item.id === activeDragId) ?? null : null

   function handleDragStart(event: DragStartEvent) {
      setActiveDragId(String(event.active.id))
   }

   function handleDragEnd(event: DragEndEvent) {
      setActiveDragId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = items.findIndex(item => item.id === active.id)
      const newIndex = items.findIndex(item => item.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
         onUpdateItems(reorderListItemsUnderParent(rootItems, parentItemId, oldIndex, newIndex))
      }
   }

   if (readOnly) {
      return (
         <>
            {items.map(item => (
               <ListItemRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  rootItems={rootItems}
                  onUpdateItems={onUpdateItems}
                  readOnly
                  gripSide={gripSide}
               />
            ))}
         </>
      )
   }

   return (
      <DndContext
         sensors={sensors}
         collisionDetection={closestCenter}
         onDragStart={handleDragStart}
         onDragEnd={handleDragEnd}
         onDragCancel={() => setActiveDragId(null)}
      >
         <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
            {items.map(item => (
               <ListItemRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  rootItems={rootItems}
                  onUpdateItems={onUpdateItems}
                  gripSide={gripSide}
               />
            ))}
         </SortableContext>

         <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {activeItem && (
               <div className="rounded-lg border shadow-xl px-2 py-1 opacity-90" style={{ borderColor: 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 25%, transparent)', background: 'var(--doc-canvas-bg)' }}>
                  <ListItemRow
                     item={activeItem}
                     depth={depth}
                     rootItems={rootItems}
                     onUpdateItems={() => {}}
                     readOnly
                     isDragOverlay
                     gripSide={gripSide}
                  />
               </div>
            )}
         </DragOverlay>
      </DndContext>
   )
}

// ============================================================
// ListBlock — public component
// ============================================================

interface ListBlockProps {
   block:     Block
   patch:     (partial: Partial<Block>) => void
   onAddItem: () => void
   readOnly?: boolean
   gripSide?: 'left' | 'right'
}

export function ListBlock({ block, patch, onAddItem, readOnly, gripSide = 'left' }: ListBlockProps) {
   const { t } = useLang()
   const rootItems = block.items ?? []

   function onUpdateItems(newItems: ListItem[]) {
      patch({ items: newItems })
   }

   return (
      <div>
         <ListLevel
            items={rootItems}
            parentItemId={null}
            depth={0}
            rootItems={rootItems}
            onUpdateItems={onUpdateItems}
            readOnly={readOnly}
            gripSide={gripSide}
         />

         {!readOnly && (
            <div className="mt-4 p-2">
               <button
                  onClick={onAddItem}
                  className="doc-add-btn w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm border border-dashed cursor-pointer"
               >
                  <CirclePlus size={14} />
                  <span>{t.addItem}</span>
               </button>
            </div>
         )}
      </div>
   )
}

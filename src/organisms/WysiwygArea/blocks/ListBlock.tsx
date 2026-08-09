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

// -- Component Imports --
import { ListMarkerControl } from './ListMarkerControl'

// -- Library Imports (pure) --
import { markerOrDefault, isOrderedMarker, formatOrderedMarker } from '../../../lib/listMarkers'

// -- Type Imports --
import type { Block, InlineContent, ListItem, ListMarker } from '../../../types'

// #############
// # UTILITIES #
// #############

/**
 * The list-item structural operations a ListBlock performs, each pre-bound to this block by the
 * caller (top-level blocks via useBlockMutations, inner blocks via containerMutations). Bundled
 * into one object and threaded through the recursive levels, mirroring how ContainerMutations is
 * threaded into ContainerColumn. The underlying algorithms live in lib/listItemTree.ts; the
 * components only invoke these handlers, they never compute a list mutation themselves.
 */
export interface ListItemOperations {
   indent:         (itemId: string) => void
   unindent:       (itemId: string) => void
   insertAfter:    (afterItemId: string, newItem: ListItem) => void
   remove:         (itemId: string) => void
   updateRichText: (itemId: string, richText: InlineContent) => void
   reorder:        (parentItemId: string | null, oldIndex: number, newIndex: number) => void
   /** Toggle an item's checked flag. Only supplied (and only used) in checklist mode. */
   toggle?:        (itemId: string) => void
}

/**
 * Returns true when the cursor (selection) is at the very start of the element's
 * text content, works correctly for rich contenteditable elements with nested tags.
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

// ###########################################################
// # LISTITEMROW, ONE SORTABLE ROW AT A GIVEN NESTING LEVEL #
// ###########################################################

interface ListItemRowProps {
   item:           ListItem
   depth:          number
   /** This row's 0-based position among its siblings, used to number an ordered marker. */
   index:          number
   itemOps:        ListItemOperations
   /** THIS sub-list's marker (list only): the root sub-list uses `block.listMarker`, a nested one
    *  the owning parent item's `childMarker`. Default `dot`. Ignored in checklist mode. */
   marker:         ListMarker
   /** Root-item offset of a page-split list fragment, so an ordered top level keeps counting across
    *  sheets. Only applied at depth 0 (children never split). Default 0 for a whole list. */
   itemOffset?:    number
   /** Render a checkbox marker (checklist) instead of a bullet (list). */
   checklist?:     boolean
   readOnly?:      boolean
   isDragOverlay?: boolean
   gripSide?:      'left' | 'right'
}

/** The glyph drawn for each unordered marker in the editor's custom list rows. */
const UNORDERED_MARKER_GLYPH: Record<'dot' | 'circle' | 'square' | 'dash' | 'arrow', string> = {
   dot:    '•',
   circle: '◦',
   square: '▪',
   dash:   '–',
   arrow:  '▸',
}

function ListItemRow({ item, depth, index, itemOps, marker, itemOffset = 0, checklist, readOnly, isDragOverlay, gripSide = 'left' }: ListItemRowProps) {
   const { t } = useLang()
   const [hovered, setHovered] = useState(false)

   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id:       item.id,
      disabled: !!readOnly || !!isDragOverlay,
   })

   const style = isDragOverlay
      ? undefined
      : { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }

   // The marker shown before the row, drawn from THIS sub-list's marker (default dot). An ordered
   // marker renders the item's ordinal (the top level continues numbering across a page-split via
   // itemOffset); an unordered marker renders its glyph.
   let bullet: string
   if (isOrderedMarker(marker)) {
      const ordinal = (depth === 0 ? itemOffset : 0) + index + 1
      bullet = `${formatOrderedMarker(marker, ordinal)}.`
   } else {
      bullet = UNORDERED_MARKER_GLYPH[marker as 'dot' | 'circle' | 'square' | 'dash' | 'arrow']
   }

   function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
      const element = event.currentTarget

      // Tab / Shift+Tab: indent / unindent.
      // preventDefault is critical: it stops the browser's focus-change behavior.
      // After the state update the item moves in the DOM, so focus is restored explicitly below.
      if (event.key === 'Tab') {
         event.preventDefault()
         const currentItemId = item.id
         if (event.shiftKey) {
            if (depth > 0) itemOps.unindent(item.id)
         } else {
            itemOps.indent(item.id)
         }
         requestAnimationFrame(() => {
            const target = document.querySelector(`[data-list-item-id="${currentItemId}"] [contenteditable]`)
            if (target instanceof HTMLElement) target.focus()
         })
         return
      }

      // Enter, create new sibling immediately after (Shift+Enter falls through to <br>)
      if (event.key === 'Enter' && !event.shiftKey) {
         event.preventDefault()
         const newItem: ListItem = { id: crypto.randomUUID(), richText: [], children: [], ...(checklist ? { checked: false } : {}) }
         itemOps.insertAfter(item.id, newItem)
         requestAnimationFrame(() => {
            const newEl = document.querySelector(`[data-list-item-id="${newItem.id}"] [contenteditable]`)
            if (newEl instanceof HTMLElement) newEl.focus()
         })
         return
      }

      // Backspace at start, unindent or delete
      if (event.key === 'Backspace' && isCursorAtStart(element)) {
         if (depth > 0) {
            event.preventDefault()
            itemOps.unindent(item.id)
            return
         }
         if (element.textContent?.trim() === '') {
            event.preventDefault()
            itemOps.remove(item.id)
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
         <div className="flex items-baseline gap-1.5 py-0.5 min-h-[1.5rem]">
            {/* Drag handle, uses negative margin to float outside the content area.
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

            {checklist ? (
               <input
                  type="checkbox"
                  checked={!!item.checked}
                  onChange={() => itemOps.toggle?.(item.id)}
                  disabled={readOnly}
                  className="shrink-0 mt-1 cursor-pointer disabled:cursor-default"
                  style={{ accentColor: 'var(--doc-accent, var(--color-accent))' }}
                  aria-label={t.checklistToggle}
               />
            ) : (
               <span className="shrink-0 select-none text-muted/50 font-mono text-xs mt-px" style={{ minWidth: '1ch' }}>
                  {bullet}
               </span>
            )}

            <ContentEditable
               tag="span"
               content={(item.richText ?? []) as InlineContent}
               onCommit={richText => itemOps.updateRichText(item.id, richText)}
               onKeyDown={readOnly ? undefined : handleKeyDown}
               placeholder={t.listItemPlaceholder}
               style={{ flex: 1 }}
               readOnly={readOnly}
            />
         </div>

         {/* Children, recursive, indented. Their sub-list draws THIS item's childMarker (default dot).
             Children never page-split, so their itemOffset stays 0. */}
         {item.children.length > 0 && (
            <div style={{ paddingLeft: 20 }}>
               <ListLevel
                  items={item.children}
                  parentItemId={item.id}
                  depth={depth + 1}
                  itemOps={itemOps}
                  marker={checklist ? 'dot' : markerOrDefault(item.childMarker)}
                  checklist={checklist}
                  readOnly={readOnly}
                  gripSide={gripSide}
               />
            </div>
         )}
      </div>
   )
}

// ############################################################
// # LISTLEVEL, ONE ISOLATED DND CONTEXT FOR A SIBLING GROUP #
// ############################################################

interface ListLevelProps {
   items:        ListItem[]
   parentItemId: string | null
   depth:        number
   itemOps:      ListItemOperations
   /** This sub-list's marker (default dot). Ignored in checklist mode. */
   marker:       ListMarker
   /** Root-item offset of a page-split fragment; only meaningful at depth 0. Default 0. */
   itemOffset?:  number
   checklist?:   boolean
   readOnly?:    boolean
   gripSide?:    'left' | 'right'
}

function ListLevel({ items, parentItemId, depth, itemOps, marker, itemOffset = 0, checklist, readOnly, gripSide = 'left' }: ListLevelProps) {
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
         itemOps.reorder(parentItemId, oldIndex, newIndex)
      }
   }

   if (readOnly) {
      return (
         <>
            {items.map((item, index) => (
               <ListItemRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  index={index}
                  itemOps={itemOps}
                  marker={marker}
                  itemOffset={itemOffset}
                  checklist={checklist}
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
            {items.map((item, index) => (
               <ListItemRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  index={index}
                  itemOps={itemOps}
                  marker={marker}
                  itemOffset={itemOffset}
                  checklist={checklist}
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
                     index={items.findIndex(candidate => candidate.id === activeItem.id)}
                     itemOps={itemOps}
                     marker={marker}
                     itemOffset={itemOffset}
                     checklist={checklist}
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

// ################################
// # LISTBLOCK, PUBLIC COMPONENT #
// ################################

interface ListBlockProps {
   block:     Block
   itemOps:   ListItemOperations
   onAddItem: () => void
   /** Render checkbox markers + enable the toggle (checklist block). */
   checklist?: boolean
   /** Block-level mutation lever (see WysiwygBlock's `patch`), used to commit `listMarker` /
    *  per-item `childMarker`. Only wired up for `list` blocks; a checklist never shows the marker
    *  picker so it never needs this. Optional so ChecklistBlock's prop spread stays untouched. */
   patch?:    (partialBlock: Partial<Block>) => void
   readOnly?: boolean
   gripSide?: 'left' | 'right'
   /** Whether this render holds the list's last root item. False only for a non-tail fragment of a
    *  list split across a page boundary (see pageLayout.ts), which shows no add-item button of its
    *  own since the button belongs on the last page the list spans. Default true. */
   isListTail?: boolean
   /** Root-item offset of a page-split list fragment, so an ordered top level keeps numbering across
    *  sheets (see pageLayout.ts sliceListBlock). 0 for a whole list. Ignored by checklists. */
   itemOffset?: number
}

export function ListBlock({ block, itemOps, onAddItem, checklist, patch, readOnly, gripSide = 'left', isListTail = true, itemOffset = 0 }: ListBlockProps) {
   const { t } = useLang()
   const rootItems = block.items ?? []

   return (
      <div>
         <ListLevel
            items={rootItems}
            parentItemId={null}
            depth={0}
            itemOps={itemOps}
            marker={checklist ? 'dot' : markerOrDefault(block.listMarker)}
            itemOffset={itemOffset}
            checklist={checklist}
            readOnly={readOnly}
            gripSide={gripSide}
         />

         {!readOnly && isListTail && (
            <div className="mt-4 p-2 flex items-center gap-2">
               {!checklist && patch && <ListMarkerControl block={block} patch={patch} />}
               <button
                  onClick={onAddItem}
                  className="doc-add-btn flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm border border-dashed cursor-pointer"
               >
                  <CirclePlus size={14} />
                  <span>{t.addItem}</span>
               </button>
            </div>
         )}
      </div>
   )
}

// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- DnD Imports --
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Icon Imports --
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// -- Type Imports --
import type { DocMeta, OpenDocument } from '../types'

// -- Lib Imports --
import { isEmptyDocument } from '../lib/document'

// -- Molecule Imports --
import { TabContextMenu } from '../molecules/TabContextMenu'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

// Keep the dragged overlay gliding along the rail (horizontal only); a tab never moves vertically.
const RAIL_MODIFIERS: Modifier[] = [({ transform }) => ({ ...transform, y: 0 })]

function tabChipClassName(isActive: boolean): string {
   return [
      'flex items-center h-7 pl-3 pr-1.5 gap-1.5 shrink-0 max-w-[14rem] rounded-t-md border border-b-0 cursor-pointer transition-colors touch-none',
      isActive ? 'border-border bg-raised' : 'border-transparent bg-transparent hover:bg-raised/50',
   ].join(' ')
}

// #########################
// # TABCHIPCONTENT (VISUAL)
// #########################

interface TabChipContentProps {
   openDocument:   OpenDocument
   isActive:       boolean
   isEditing:      boolean
   titleDraft:     string
   placeholder:    string
   editAriaLabel:  string
   closeAriaLabel: string
   inputRef:       React.RefObject<HTMLInputElement | null>
   onClose:        () => void
   onDraftChange:  (value: string) => void
   onTitleBlur:    () => void
   onTitleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

/** The inner chip visual (title / edit input, dirty dot, close x). Shared by the sortable row and
 *  the drag-overlay clone so the dragged tab looks identical without duplicating markup. */
function TabChipContent({
   openDocument, isActive, isEditing, titleDraft, placeholder, editAriaLabel, closeAriaLabel,
   inputRef, onClose, onDraftChange, onTitleBlur, onTitleKeyDown,
}: TabChipContentProps) {
   const isDirty = openDocument.saveStatus !== 'clean'
   // A scratch tab with real content has never been saved (no record, no autosave): flag its dot red,
   // the same danger colour as the header's "Never saved" pill. A pristine blank scratch tab shows no
   // dot at all, same as a clean saved tab.
   const neverSaved = openDocument.documentId === null && !isEmptyDocument(openDocument)
   const title      = openDocument.meta.title || placeholder

   return (
      <>
         {isEditing ? (
            <input
               ref={inputRef}
               type="text"
               aria-label={editAriaLabel}
               value={titleDraft}
               onChange={event => onDraftChange(event.target.value)}
               onBlur={onTitleBlur}
               onKeyDown={onTitleKeyDown}
               onClick={event => event.stopPropagation()}
               onPointerDown={event => event.stopPropagation()}   // don't start a drag from the input
               className="font-mono text-sm bg-transparent border-0 border-b border-accent/60 outline-none w-40 text-text"
            />
         ) : (
            <span className={`font-mono text-sm truncate select-none transition-colors ${isActive ? 'text-text/90' : 'text-text/50'}`}>
               {title}
            </span>
         )}

         {neverSaved
            ? <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red" />
            : isDirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-yellow" />}

         <button
            type="button"
            aria-label={closeAriaLabel}
            onClick={event => { event.stopPropagation(); onClose() }}
            onPointerDown={event => event.stopPropagation()}   // don't start a drag from the close button
            className="shrink-0 grid place-items-center w-4 h-4 rounded text-muted/60 hover:text-text hover:bg-border/60 transition-colors"
         >
            <X size={12} />
         </button>
      </>
   )
}

// #########################
// # TABCHIP (SORTABLE ROW)
// #########################

interface TabChipProps extends TabChipContentProps {
   onChipClick:       () => void
   onChipDoubleClick: () => void
   onChipContextMenu: (event: React.MouseEvent) => void
}

function TabChip({ onChipClick, onChipDoubleClick, onChipContextMenu, ...contentProps }: TabChipProps) {
   const { openDocument, isActive, placeholder } = contentProps
   // A 5px drag threshold (the shared PointerSensor) keeps a plain click landing as activate.
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: openDocument.tabKey })

   return (
      <div
         ref={setNodeRef}
         style={{
            // While dragging, the overlay clone represents this tab: hide the original and drop its
            // pointer-following transform (the sortable strategy still shifts the OTHER chips to open
            // the gap). This keeps the dragged tab out of the strip's clip + the bar at a fixed size.
            transform: isDragging ? undefined : CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0 : 1,
         }}
         {...attributes}
         {...listeners}
         onClick={onChipClick}
         onDoubleClick={onChipDoubleClick}
         onContextMenu={onChipContextMenu}
         title={openDocument.meta.title || placeholder}
         className={tabChipClassName(isActive)}
      >
         <TabChipContent {...contentProps} />
      </div>
   )
}

// #####################
// # DOCUMENTTITLEBAR  #
// #####################

interface DocumentTitleBarProps {
   openDocuments:  OpenDocument[]
   activeTabKey:   string
   onActivateTab:  (tabKey: string) => void
   onCloseTab:     (tabKey: string) => void
   onReorderTabs:  (fromIndex: number, toIndex: number) => void
   onDuplicateTab: (tabKey: string) => void
   onMetaChange:   (patch: Partial<DocMeta>) => void
}

/**
 * The tab strip (second bar, document mode). One chip per open document: single-click an inactive
 * tab to activate it; double-click a tab to rename it inline (committing through onMetaChange ->
 * the active tab's meta.title); right-click for Duplicate / Rename / Close. Each chip shows a
 * per-tab dirty dot + a close (x), and the strip is drag-reorderable via a DragOverlay clone (which
 * never changes the active tab or its content, and never resizes the bar).
 */
export function DocumentTitleBar({ openDocuments, activeTabKey, onActivateTab, onCloseTab, onReorderTabs, onDuplicateTab, onMetaChange }: DocumentTitleBarProps) {
   const { t } = useLang()
   // Which tab's title is being edited (null = none). Tracking the tabKey rather than a boolean means
   // a tab switch (or closing the edited tab) implicitly ends editing, the input only renders while
   // editingTabKey matches the active tab, so no reset-on-switch effect is needed.
   const [editingTabKey, setEditingTabKey] = useState<string | null>(null)
   const [titleDraft,    setTitleDraft]    = useState('')
   // The tab being dragged + its captured width, so the overlay clone matches the original.
   const [draggedTabKey, setDraggedTabKey] = useState<string | null>(null)
   const [dragWidth,     setDragWidth]     = useState<number | null>(null)
   // The tab whose right-click context menu is open, at the cursor.
   const [contextMenu, setContextMenu] = useState<{ tabKey: string; x: number; y: number } | null>(null)
   const titleInputRef       = useRef<HTMLInputElement>(null)
   const suppressNextBlurRef = useRef(false)
   // The horizontally-scrolling element; its overflow state drives the scroll arrows.
   const scrollContainerRef = useRef<HTMLDivElement>(null)
   const [canScrollLeft,  setCanScrollLeft]  = useState(false)
   const [canScrollRight, setCanScrollRight] = useState(false)

   const activeDocument = openDocuments.find(document => document.tabKey === activeTabKey)
   const activeTitle    = activeDocument?.meta.title ?? ''
   const draggedTab     = draggedTabKey !== null ? openDocuments.find(document => document.tabKey === draggedTabKey) : undefined

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   // Select all text once the input mounts.
   useEffect(() => { if (editingTabKey !== null) titleInputRef.current?.select() }, [editingTabKey])

   // Track horizontal overflow so the scroll arrows show only when there's somewhere to scroll
   // (1px tolerance absorbs sub-pixel rounding). Recompute on the container's own scroll + size
   // changes, and re-run on openDocuments since opening/closing/reordering tabs changes scrollWidth
   // (which a ResizeObserver on the fixed-width container wouldn't catch).
   useEffect(() => {
      const container = scrollContainerRef.current
      if (!container) return
      function recompute() {
         const element = scrollContainerRef.current
         if (!element) return
         setCanScrollLeft(element.scrollLeft > 0)
         setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth - 1)
      }
      recompute()
      container.addEventListener('scroll', recompute, { passive: true })
      const resizeObserver = new ResizeObserver(recompute)
      resizeObserver.observe(container)
      return () => {
         container.removeEventListener('scroll', recompute)
         resizeObserver.disconnect()
      }
   }, [openDocuments])

   // A plain vertical wheel scrolls the strip horizontally when it overflows. Attached non-passive
   // (React's onWheel is passive, so preventDefault would be ignored) and only hijacked on overflow.
   useEffect(() => {
      const container = scrollContainerRef.current
      if (!container) return
      function handleWheel(event: WheelEvent) {
         const element = scrollContainerRef.current
         if (!element || element.scrollWidth <= element.clientWidth || event.deltaY === 0) return
         event.preventDefault()
         element.scrollLeft += event.deltaY
      }
      container.addEventListener('wheel', handleWheel, { passive: false })
      return () => container.removeEventListener('wheel', handleWheel)
   }, [])

   function scrollByChunk(direction: -1 | 1) {
      const container = scrollContainerRef.current
      if (!container) return
      container.scrollBy({ left: direction * container.clientWidth * 0.8, behavior: 'smooth' })
   }

   const hasOverflow = canScrollLeft || canScrollRight

   // Single click: activate an inactive tab; the active tab is a no-op (renaming is double-click).
   function handleTabClick(tabKey: string) {
      if (tabKey !== activeTabKey) onActivateTab(tabKey)
   }

   // Enter inline title-edit (double-click or the context-menu Rename). Activates the tab first if
   // needed; editing only renders once it's active (the isEditing condition below).
   function startEditing(tabKey: string) {
      if (tabKey !== activeTabKey) onActivateTab(tabKey)
      const target = openDocuments.find(openDocument => openDocument.tabKey === tabKey)
      setTitleDraft(target?.meta.title ?? '')
      setEditingTabKey(tabKey)
   }

   function handleChipContextMenu(tabKey: string, event: React.MouseEvent) {
      event.preventDefault()
      setContextMenu({ tabKey, x: event.clientX, y: event.clientY })
   }

   function commitTitle(value: string) {
      const trimmed = value.trim()
      onMetaChange({ title: trimmed || activeTitle })   // empty value keeps the current title
      setEditingTabKey(null)
   }

   function handleTitleBlur() {
      if (suppressNextBlurRef.current) {
         suppressNextBlurRef.current = false
         return
      }
      commitTitle(titleDraft)
   }

   function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Enter') {
         event.preventDefault()
         suppressNextBlurRef.current = true   // prevent double-commit on the resulting blur
         commitTitle(titleDraft)
         titleInputRef.current?.blur()
      } else if (event.key === 'Escape') {
         suppressNextBlurRef.current = true
         setEditingTabKey(null)
         titleInputRef.current?.blur()
      }
   }

   function handleDragStart(event: DragStartEvent) {
      setDraggedTabKey(String(event.active.id))
      setDragWidth(event.active.rect.current.initial?.width ?? null)
   }

   function handleDragEnd(event: DragEndEvent) {
      setDraggedTabKey(null)
      setDragWidth(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = openDocuments.findIndex(document => document.tabKey === active.id)
      const toIndex   = openDocuments.findIndex(document => document.tabKey === over.id)
      if (fromIndex !== -1 && toIndex !== -1) onReorderTabs(fromIndex, toIndex)
   }

   function handleDragCancel() {
      setDraggedTabKey(null)
      setDragWidth(null)
   }

   return (
      <>
      <div className="shrink-0 flex items-end h-9 px-2 gap-1 bg-bg border-b border-border z-100">
         {/* Both arrow slots render together once the strip overflows, so toggling a single arrow's
             glyph (disabled -> opacity-0) never shifts the tabs; no slots at all when there's room. */}
         {hasOverflow && (
            <button
               type="button"
               aria-label={t.scrollTabsLeft}
               disabled={!canScrollLeft}
               onClick={() => scrollByChunk(-1)}
               className="shrink-0 self-end grid place-items-center w-6 h-7 rounded text-muted/70 hover:text-text bg-linear-to-r from-raised/70 to-transparent hover:from-raised transition-colors disabled:opacity-0 disabled:pointer-events-none"
            >
               <ChevronLeft size={16} />
            </button>
         )}

         <div
            ref={scrollContainerRef}
            className="flex items-end gap-1 flex-1 min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
         >
            <DndContext
               sensors={sensors}
               collisionDetection={closestCenter}
               modifiers={RAIL_MODIFIERS}
               onDragStart={handleDragStart}
               onDragEnd={handleDragEnd}
               onDragCancel={handleDragCancel}
            >
               <SortableContext items={openDocuments.map(openDocument => openDocument.tabKey)} strategy={horizontalListSortingStrategy}>
               {openDocuments.map(openDocument => (
                  <TabChip
                     key={openDocument.tabKey}
                     openDocument={openDocument}
                     isActive={openDocument.tabKey === activeTabKey}
                     isEditing={editingTabKey === openDocument.tabKey && openDocument.tabKey === activeTabKey}
                     titleDraft={titleDraft}
                     placeholder={t.untitledDoc}
                     editAriaLabel={t.docTitle}
                     closeAriaLabel={t.closeTab}
                     inputRef={titleInputRef}
                     onChipClick={() => handleTabClick(openDocument.tabKey)}
                     onChipDoubleClick={() => startEditing(openDocument.tabKey)}
                     onChipContextMenu={event => handleChipContextMenu(openDocument.tabKey, event)}
                     onClose={() => onCloseTab(openDocument.tabKey)}
                     onDraftChange={setTitleDraft}
                     onTitleBlur={handleTitleBlur}
                     onTitleKeyDown={handleTitleKeyDown}
                  />
               ))}
            </SortableContext>

            {/* The dragged tab rendered in dnd-kit's own fixed overlay layer, so it escapes the
                strip's clipping and follows the cursor without resizing the bar. Static + inert. */}
            <DragOverlay>
               {draggedTab && (
                  <div className={tabChipClassName(true)} style={{ width: dragWidth ?? undefined, pointerEvents: 'none' }}>
                     <TabChipContent
                        openDocument={draggedTab}
                        isActive
                        isEditing={false}
                        titleDraft=""
                        placeholder={t.untitledDoc}
                        editAriaLabel={t.docTitle}
                        closeAriaLabel={t.closeTab}
                        inputRef={titleInputRef}
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onTitleBlur={() => {}}
                        onTitleKeyDown={() => {}}
                     />
                  </div>
               )}
            </DragOverlay>
            </DndContext>
         </div>

         {hasOverflow && (
            <button
               type="button"
               aria-label={t.scrollTabsRight}
               disabled={!canScrollRight}
               onClick={() => scrollByChunk(1)}
               className="shrink-0 self-end grid place-items-center w-6 h-7 rounded text-muted/70 hover:text-text bg-linear-to-l from-raised/70 to-transparent hover:from-raised transition-colors disabled:opacity-0 disabled:pointer-events-none"
            >
               <ChevronRight size={16} />
            </button>
         )}
      </div>

      {contextMenu && (
         <TabContextMenu
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onDuplicate={() => { onDuplicateTab(contextMenu.tabKey); setContextMenu(null) }}
            onRename={() => { startEditing(contextMenu.tabKey); setContextMenu(null) }}
            onClose={() => { onCloseTab(contextMenu.tabKey); setContextMenu(null) }}
            onDismiss={() => setContextMenu(null)}
         />
      )}
      </>
   )
}

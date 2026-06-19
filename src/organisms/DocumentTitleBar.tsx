// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- DnD Imports --
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Icon Imports --
import { X } from 'lucide-react'

// -- Type Imports --
import type { DocMeta, OpenDocument } from '../types'

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

/** The inner chip visual (title / edit input, dirty dot, close ×). Shared by the sortable row and
 *  the drag-overlay clone so the dragged tab looks identical without duplicating markup. */
function TabChipContent({
   openDocument, isActive, isEditing, titleDraft, placeholder, editAriaLabel, closeAriaLabel,
   inputRef, onClose, onDraftChange, onTitleBlur, onTitleKeyDown,
}: TabChipContentProps) {
   const isDirty = openDocument.saveStatus !== 'clean'
   const title   = openDocument.meta.title || placeholder

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

         {isDirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-yellow" />}

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
   onChipClick: () => void
}

function TabChip({ onChipClick, ...contentProps }: TabChipProps) {
   const { openDocument, isActive, placeholder } = contentProps
   // A 5px drag threshold (the shared PointerSensor) keeps a plain click landing as activate/edit.
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
   openDocuments: OpenDocument[]
   activeTabKey:  string
   onActivateTab: (tabKey: string) => void
   onCloseTab:    (tabKey: string) => void
   onReorderTabs: (fromIndex: number, toIndex: number) => void
   onMetaChange:  (patch: Partial<DocMeta>) => void
}

/**
 * The tab strip (second bar, document mode). One chip per open document: click an inactive tab to
 * activate it, click the active tab to edit its title (the click-to-edit affordance commits through
 * onMetaChange → the active tab's meta.title). Each chip shows a per-tab dirty dot + a close (×),
 * and the strip is drag-reorderable via a DragOverlay clone (which never changes the active tab or
 * its content, and never resizes the bar).
 */
export function DocumentTitleBar({ openDocuments, activeTabKey, onActivateTab, onCloseTab, onReorderTabs, onMetaChange }: DocumentTitleBarProps) {
   const { t } = useLang()
   // Which tab's title is being edited (null = none). Tracking the tabKey rather than a boolean means
   // a tab switch (or closing the edited tab) implicitly ends editing — the input only renders while
   // editingTabKey matches the active tab — so no reset-on-switch effect is needed.
   const [editingTabKey, setEditingTabKey] = useState<string | null>(null)
   const [titleDraft,    setTitleDraft]    = useState('')
   // The tab being dragged + its captured width, so the overlay clone matches the original.
   const [draggedTabKey, setDraggedTabKey] = useState<string | null>(null)
   const [dragWidth,     setDragWidth]     = useState<number | null>(null)
   const titleInputRef       = useRef<HTMLInputElement>(null)
   const suppressNextBlurRef = useRef(false)

   const activeDocument = openDocuments.find(document => document.tabKey === activeTabKey)
   const activeTitle    = activeDocument?.meta.title ?? ''
   const draggedTab     = draggedTabKey !== null ? openDocuments.find(document => document.tabKey === draggedTabKey) : undefined

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   // Select all text once the input mounts.
   useEffect(() => { if (editingTabKey !== null) titleInputRef.current?.select() }, [editingTabKey])

   function handleTabClick(tabKey: string) {
      if (tabKey === activeTabKey) {
         setTitleDraft(activeTitle)
         setEditingTabKey(tabKey)
      } else {
         onActivateTab(tabKey)
      }
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
      <div className="shrink-0 flex items-end h-9 px-2 gap-1 bg-bg border-b border-border z-100 overflow-x-auto overflow-y-hidden">
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
   )
}

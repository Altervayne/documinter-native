// -- React Imports --
import { useState } from 'react'
import type React from 'react'

// -- DnD Imports --
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Icon Imports --
import { Copy, Trash2, FilePlus2, Plus, Printer, SeparatorHorizontal, MoreHorizontal } from 'lucide-react'

// -- Lib / Context Imports --
import { renderPagePreviewHtml } from '../lib/export'
import { millimetresToPx, type Page } from '../lib/pageModel'
import { isAutoPageId } from '../lib/pageLayout'
import type { PageMargins } from '../lib/format'
import type { DocMeta, Section } from '../types'
import { ContextMenu, type ContextMenuEntry } from '../molecules/ContextMenu'
import { useLang } from '../contexts/LangContext'

// #############
// # CONSTANTS #
// #############

// Thumbnail width in px; each thumbnail is a page's real A4 sheet rendered at full px and CSS-scaled,
// so this width over the sheet width gives the scale factor.
const THUMBNAIL_WIDTH_PX = 150

// #########
// # TYPES #
// #########

interface PagesPanelBodyProps {
   pages:         Page[]
   meta:          DocMeta
   sections:      Section[]
   docTheme:      'light' | 'dark'
   docAccent:     string
   margins:       PageMargins
   sheetWidthPx:  number
   sheetHeightPx: number
   onReorder:     (fromIndex: number, toIndex: number) => void
   onDuplicate:   (pageIndex: number) => void
   onDelete:      (pageIndex: number) => void
   onInsertAfter: (pageIndex: number) => void
   onRemoveBreak: (pageIndex: number) => void
   onAddPage:     () => void
   onSaveAsPdf:   () => void
   onJump:        (pageId: string) => void
}

// A drag unit: a lead page plus the continuation sheets a block flowing off it produced. Grouping
// keeps a block's start + continuations moving as one, so a drop only lands BETWEEN blocks.
interface PageGroup {
   lead:    Page
   members: { page: Page; index: number }[]   // lead first, then its continuations; index = flat page index
}

// ###########
// # HELPERS #
// ###########

// Fold the flat page list into drag-unit groups. A group opens at any non-continuation page and swallows
// the continuation sheets right after it; a stray leading continuation opens its own group.
function groupPagesIntoDragUnits(pages: Page[]): PageGroup[] {
   const groups: PageGroup[] = []
   pages.forEach((page, index) => {
      const isContinuation = page.origin === 'continuation' && groups.length > 0
      if (isContinuation) {
         groups[groups.length - 1].members.push({ page, index })
      } else {
         groups.push({ lead: page, members: [{ page, index }] })
      }
   })
   return groups
}

// #############################################################
// # ONE THUMBNAIL: a scaled read-only render of a page's flow #
// #############################################################

interface PageThumbnailProps {
   page:          Page
   pageIndex:     number
   pageCount:     number
   meta:          DocMeta
   sections:      Section[]
   docTheme:      'light' | 'dark'
   docAccent:     string
   margins:       PageMargins
   sheetWidthPx:  number
   sheetHeightPx: number
   canDelete:     boolean
   onJump:        (pageId: string) => void
   onDuplicate:   (pageIndex: number) => void
   onDelete:      (pageIndex: number) => void
   onInsertAfter: (pageIndex: number) => void
   onRemoveBreak: (pageIndex: number) => void
}

function PageThumbnail({
   page, pageIndex, pageCount, meta, sections, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   canDelete, onJump, onDuplicate, onDelete, onInsertAfter, onRemoveBreak,
}: PageThumbnailProps) {
   const { t } = useLang()
   // An auto page (continuation or auto-start) is a paginator push, not author-made: no duplicate / delete
   // / insert, so no actions menu (jump still works). A manual page also carries a dissolvable break.
   const isAutoPage    = isAutoPageId(page.id)
   const isManualBreak = page.origin === 'manual'

   // One shared menu drives both triggers (the "..." kebab and the card's right-click); its position is
   // the only thing that differs between them. Auto pages never open it.
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   function openMenuAt(x: number, y: number) {
      setMenuPosition({ x, y })
   }
   function handleContextMenu(event: React.MouseEvent) {
      if (isAutoPage) return
      event.preventDefault()
      openMenuAt(event.clientX, event.clientY)
   }
   function handleKebabClick(event: React.MouseEvent) {
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      openMenuAt(rect.right, rect.bottom)
   }

   // Insert-after, duplicate, remove-break (manual pages only), delete (disabled on a single-page document).
   const menuEntries: ContextMenuEntry[] = [
      { label: t.formatInsertPageAfter, icon: <FilePlus2 size={13} />,          onSelect: () => onInsertAfter(pageIndex) },
      { label: t.pageSorterDuplicate,   icon: <Copy size={13} />,               onSelect: () => onDuplicate(pageIndex) },
      ...(isManualBreak
         ? [{ label: t.pageSorterRemoveBreak, icon: <SeparatorHorizontal size={13} />, onSelect: () => onRemoveBreak(pageIndex) } as ContextMenuEntry]
         : []),
      { label: t.pageSorterDelete, icon: <Trash2 size={13} />, danger: true, disabled: !canDelete, onSelect: () => onDelete(pageIndex) },
   ]

   // Renders the page into self-contained doc HTML the same way the export does, so the thumbnail
   // reflects the real page. Image blocks use the cheap placeholder (no base64 needed at thumbnail size).
   const html = renderPagePreviewHtml(page, {
      isFirstPage: pageIndex === 0,
      meta, sections, accent: docAccent, theme: docTheme,
      fallbackTitle: t.untitledDoc, imagePlaceholder: true,
   })

   const scale       = THUMBNAIL_WIDTH_PX / sheetWidthPx
   const frameHeight = sheetHeightPx * scale

   return (
      <div className="page-thumb" onContextMenu={handleContextMenu}>
         <button
            type="button"
            className={`page-thumb-frame ${docTheme === 'dark' ? 'doc-dark' : ''}`}
            style={{ width: `${THUMBNAIL_WIDTH_PX}px`, height: `${frameHeight}px`, '--doc-accent': docAccent } as React.CSSProperties}
            title={t.pageSorterJump}
            aria-label={`${t.pageSorterJump} ${pageIndex + 1}`}
            onClick={() => onJump(page.id)}
         >
            <div
               className="page-thumb-scaler"
               style={{ width: `${sheetWidthPx}px`, height: `${sheetHeightPx}px`, transform: `scale(${scale})` }}
            >
               {/* .doc-dark rides the frame (an ANCESTOR), so the `.doc-dark .doc-render` descendant rules
                   match AND the frame's own dark canvas fills below short content. */}
               <div
                  className="doc-render page-thumb-render"
                  style={{
                     background:    'var(--doc-canvas-bg)',
                     paddingTop:    `${millimetresToPx(margins.top)}px`,
                     paddingRight:  `${millimetresToPx(margins.right)}px`,
                     paddingBottom: `${millimetresToPx(margins.bottom)}px`,
                     paddingLeft:   `${millimetresToPx(margins.left)}px`,
                  }}
                  dangerouslySetInnerHTML={{ __html: html }}
               />
            </div>
         </button>

         {/* Kebab: the actions menu's second trigger, over the sheet's top-right corner, revealed on
             hover / focus. onPointerDown stops the group drag from arming when the button is pressed. */}
         {!isAutoPage && (
            <button
               type="button"
               className="page-thumb-kebab"
               title={t.pageSorterMoreActions}
               aria-label={t.pageSorterMoreActions}
               onPointerDown={event => event.stopPropagation()}
               onClick={handleKebabClick}
            >
               <MoreHorizontal size={14} />
            </button>
         )}

         <div className="page-thumb-bar">
            <span className="page-thumb-number">{pageIndex + 1} / {pageCount}</span>
            {isManualBreak && (
               <span className="page-thumb-badge">
                  <SeparatorHorizontal size={11} />
                  {t.pageSorterManualBreak}
               </span>
            )}
            {isAutoPage && (
               // An auto sheet just labels its kind: a continuation carries a block flowing off the
               // previous page, an auto-start begins fresh pushed content.
               <span className="page-thumb-continuation">
                  {page.origin === 'auto-start' ? t.pageSorterAutoPage : t.pageSorterContinuation}
               </span>
            )}
         </div>

         {menuPosition && (
            <ContextMenu position={menuPosition} entries={menuEntries} onClose={() => setMenuPosition(null)} />
         )}
      </div>
   )
}

// ##########################################################
// # ONE GROUP: the drag unit wrapping a block's page span  #
// ##########################################################

interface PageThumbGroupProps {
   group:         PageGroup
   pageCount:     number
   meta:          DocMeta
   sections:      Section[]
   docTheme:      'light' | 'dark'
   docAccent:     string
   margins:       PageMargins
   sheetWidthPx:  number
   sheetHeightPx: number
   canDelete:     boolean
   onJump:        (pageId: string) => void
   onDuplicate:   (pageIndex: number) => void
   onDelete:      (pageIndex: number) => void
   onInsertAfter: (pageIndex: number) => void
   onRemoveBreak: (pageIndex: number) => void
}

function PageThumbGroup({
   group, pageCount, meta, sections, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   canDelete, onJump, onDuplicate, onDelete, onInsertAfter, onRemoveBreak,
}: PageThumbGroupProps) {
   // The GROUP is the drag unit, keyed on its lead page id. A group led by an author page reorders; one
   // led by a paginator push ('auto-start') is frozen, so drops only land between reorderable groups.
   const isReorderable = !isAutoPageId(group.lead.id)
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
      useSortable({ id: group.lead.id, disabled: !isReorderable })
   // Box only a genuine multi-sheet span; a lone page renders flush so single pages don't all wear a frame.
   const isMultiSheet = group.members.length > 1

   return (
      <div
         ref={setNodeRef}
         style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
         className={`page-thumb-group ${isMultiSheet ? 'page-thumb-group-multi' : ''}`}
         {...(isReorderable ? attributes : {})}
         {...(isReorderable ? listeners : {})}
      >
         {group.members.map(({ page, index }) => (
            <PageThumbnail
               key={page.id}
               page={page}
               pageIndex={index}
               pageCount={pageCount}
               meta={meta}
               sections={sections}
               docTheme={docTheme}
               docAccent={docAccent}
               margins={margins}
               sheetWidthPx={sheetWidthPx}
               sheetHeightPx={sheetHeightPx}
               canDelete={canDelete}
               onJump={onJump}
               onDuplicate={onDuplicate}
               onDelete={onDelete}
               onInsertAfter={onInsertAfter}
               onRemoveBreak={onRemoveBreak}
            />
         ))}
      </div>
   )
}

// #############
// # COMPONENT #
// #############

/** The Pages panel's body: the scrollable column of page thumbnails with drag-reorder, jump-to-page, and
 *  per-page actions ("..." menu + right-click). Chrome-free, so it renders the same docked or floating.
 *  Pages are DERIVED from the document's break markers; every action routes through the parent's handlers.
 *
 *  Pages fold into GROUPS (a block's start page + its continuation sheets) and the group is the drag unit,
 *  so reordering never splits a block that spans sheets. A group's reorder calls onReorder with its lead
 *  page's flat index, which the upstream hook maps to the forced-break model. */
export function PagesPanelBody({
   pages, meta, sections, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   onReorder, onDuplicate, onDelete, onInsertAfter, onRemoveBreak, onAddPage, onSaveAsPdf, onJump,
}: PagesPanelBodyProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null)

   const groups = groupPagesIntoDragUnits(pages)

   function handleDragStart(event: DragStartEvent) {
      setDraggingLeadId(String(event.active.id))
   }
   function handleDragEnd(event: DragEndEvent) {
      setDraggingLeadId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      // Both ids are group LEAD page ids; their flat index in `pages` is the display index the upstream
      // hook maps to the forced-break model.
      const fromIndex = pages.findIndex(page => page.id === active.id)
      const toIndex   = pages.findIndex(page => page.id === over.id)
      if (fromIndex !== -1 && toIndex !== -1) onReorder(fromIndex, toIndex)
   }
   function handleDragCancel() {
      setDraggingLeadId(null)
   }

   const draggingGroup = draggingLeadId !== null ? groups.find(group => group.lead.id === draggingLeadId) : undefined
   // The overlay clone labels the dragged block's page span: a lone number, or a first-to-last range.
   const overlayLabel = draggingGroup
      ? (draggingGroup.members.length > 1
         ? `${draggingGroup.members[0].index + 1}-${draggingGroup.members[draggingGroup.members.length - 1].index + 1}`
         : `${draggingGroup.members[0].index + 1}`)
      : ''
   // A single-page document can't lose its only page (that would empty it), so delete is disabled then.
   const canDelete = pages.length > 1

   return (
      <div className="overflow-y-auto flex-1 min-h-0 px-2 py-3 flex flex-col items-center gap-2">
         <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
         >
            <SortableContext items={groups.map(group => group.lead.id)} strategy={verticalListSortingStrategy}>
               {groups.map(group => (
                  <PageThumbGroup
                     key={group.lead.id}
                     group={group}
                     pageCount={pages.length}
                     meta={meta}
                     sections={sections}
                     docTheme={docTheme}
                     docAccent={docAccent}
                     margins={margins}
                     sheetWidthPx={sheetWidthPx}
                     sheetHeightPx={sheetHeightPx}
                     canDelete={canDelete}
                     onJump={onJump}
                     onDuplicate={onDuplicate}
                     onDelete={onDelete}
                     onInsertAfter={onInsertAfter}
                     onRemoveBreak={onRemoveBreak}
                  />
               ))}
            </SortableContext>

            <DragOverlay>
               {draggingGroup && (
                  <div
                     className="page-thumb-frame page-thumb-frame-overlay"
                     style={{
                        width:  `${THUMBNAIL_WIDTH_PX}px`,
                        height: `${sheetHeightPx * (THUMBNAIL_WIDTH_PX / sheetWidthPx)}px`,
                        '--doc-accent': docAccent,
                     } as React.CSSProperties}
                  >
                     <div className="page-thumb-overlay-label">{overlayLabel}</div>
                  </div>
               )}
            </DragOverlay>
         </DndContext>

         <div className="page-add-actions">
            <button type="button" className="page-add-button" onClick={onAddPage}>
               <Plus size={14} />
               <span>{t.formatAddPage}</span>
            </button>
            <button type="button" className="page-add-button" onClick={onSaveAsPdf}>
               <Printer size={14} />
               <span>{t.saveAsPdf}</span>
            </button>
         </div>
      </div>
   )
}

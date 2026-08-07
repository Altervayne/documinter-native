// -- React Imports --
import { useState } from 'react'
import type React from 'react'

// -- DnD Imports --
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Icon Imports --
import { Copy, Trash2, FilePlus2, Plus } from 'lucide-react'

// -- Lib / Context Imports --
import { renderPagePreviewHtml } from '../lib/export'
import { millimetresToPx, type Page } from '../lib/pageModel'
import type { PageMargins } from '../lib/format'
import type { DocMeta, Section } from '../types'
import { useLang } from '../contexts/LangContext'

// #############
// # CONSTANTS #
// #############

// The rendered thumbnail width in px; each thumbnail is a scaled-down render of the page's real A4
// sheet (renderBlocksToDocHtml at full sheet px, CSS-scaled), so this width divided by the sheet
// width gives the scale factor. Small + read-only, so it stays cheap.
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
   onAddPage:     () => void
   onJump:        (pageId: string) => void
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
}

function PageThumbnail({
   page, pageIndex, pageCount, meta, sections, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   canDelete, onJump, onDuplicate, onDelete, onInsertAfter,
}: PageThumbnailProps) {
   const { t } = useLang()
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })

   // Renders the page into self-contained doc HTML the same way the export builds it: the document header
   // (title + meta) on the first page, then each section slice's `<h2>` heading + its blocks, so the
   // thumbnail reflects the real page. Rendered at the real sheet px inside a scaled wrapper. Image blocks
   // use the cheap placeholder (a thumbnail needs no full base64 fidelity); graphs / diagrams are inline SVG.
   const html = renderPagePreviewHtml(page, {
      isFirstPage: pageIndex === 0,
      meta, sections, accent: docAccent, theme: docTheme,
      fallbackTitle: t.untitledDoc, imagePlaceholder: true,
   })

   const scale       = THUMBNAIL_WIDTH_PX / sheetWidthPx
   const frameHeight = sheetHeightPx * scale

   return (
      <div
         ref={setNodeRef}
         style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
         className="page-thumb"
      >
         <button
            type="button"
            className={`page-thumb-frame ${docTheme === 'dark' ? 'doc-dark' : ''}`}
            style={{ width: `${THUMBNAIL_WIDTH_PX}px`, height: `${frameHeight}px`, '--doc-accent': docAccent } as React.CSSProperties}
            title={t.pageSorterJump}
            aria-label={`${t.pageSorterJump} ${pageIndex + 1}`}
            onClick={() => onJump(page.id)}
            {...attributes}
            {...listeners}
         >
            <div
               className="page-thumb-scaler"
               style={{ width: `${sheetWidthPx}px`, height: `${sheetHeightPx}px`, transform: `scale(${scale})` }}
            >
               {/* .doc-dark rides the frame (an ANCESTOR), so the `.doc-dark .doc-render ...` descendant
                   rules match AND the frame's own dark canvas background fills below short content. */}
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

         <div className="page-thumb-bar">
            <span className="page-thumb-number">{pageIndex + 1} / {pageCount}</span>
            <div className="page-thumb-actions">
               <button
                  type="button"
                  className="page-thumb-action"
                  title={t.formatInsertPageAfter}
                  aria-label={t.formatInsertPageAfter}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); onInsertAfter(pageIndex) }}
               >
                  <FilePlus2 size={13} />
               </button>
               <button
                  type="button"
                  className="page-thumb-action"
                  title={t.pageSorterDuplicate}
                  aria-label={t.pageSorterDuplicate}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); onDuplicate(pageIndex) }}
               >
                  <Copy size={13} />
               </button>
               <button
                  type="button"
                  className="page-thumb-action page-thumb-action-danger"
                  title={t.pageSorterDelete}
                  aria-label={t.pageSorterDelete}
                  disabled={!canDelete}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); onDelete(pageIndex) }}
               >
                  <Trash2 size={13} />
               </button>
            </div>
         </div>
      </div>
   )
}

// #############
// # COMPONENT #
// #############

/**
 * The Pages panel's body: the scrollable column of page thumbnails with drag-reorder, jump-to-page,
 * and per-page duplicate / delete. This is the panel content only, with no surrounding aside, header,
 * rail, or dock chrome, so it renders identically whether hosted by the dock or a floating window.
 * Pages are DERIVED from the document's break markers; every action routes through the pure page
 * transforms upstream (the parent supplies the handlers).
 */
export function PagesPanelBody({
   pages, meta, sections, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   onReorder, onDuplicate, onDelete, onInsertAfter, onAddPage, onJump,
}: PagesPanelBodyProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [draggingPageId, setDraggingPageId] = useState<string | null>(null)

   function handleDragStart(event: DragStartEvent) {
      setDraggingPageId(String(event.active.id))
   }
   function handleDragEnd(event: DragEndEvent) {
      setDraggingPageId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = pages.findIndex(page => page.id === active.id)
      const toIndex   = pages.findIndex(page => page.id === over.id)
      if (fromIndex !== -1 && toIndex !== -1) onReorder(fromIndex, toIndex)
   }
   function handleDragCancel() {
      setDraggingPageId(null)
   }

   const draggingIndex = draggingPageId !== null ? pages.findIndex(page => page.id === draggingPageId) : -1
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
            <SortableContext items={pages.map(page => page.id)} strategy={verticalListSortingStrategy}>
               {pages.map((page, pageIndex) => (
                  <PageThumbnail
                     key={page.id}
                     page={page}
                     pageIndex={pageIndex}
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
                  />
               ))}
            </SortableContext>

            <DragOverlay>
               {draggingIndex !== -1 && (
                  <div
                     className="page-thumb-frame page-thumb-frame-overlay"
                     style={{
                        width:  `${THUMBNAIL_WIDTH_PX}px`,
                        height: `${sheetHeightPx * (THUMBNAIL_WIDTH_PX / sheetWidthPx)}px`,
                        '--doc-accent': docAccent,
                     } as React.CSSProperties}
                  >
                     <div className="page-thumb-overlay-label">{draggingIndex + 1}</div>
                  </div>
               )}
            </DragOverlay>
         </DndContext>

         <button type="button" className="page-add-button" onClick={onAddPage}>
            <Plus size={14} />
            <span>{t.formatAddPage}</span>
         </button>
      </div>
   )
}

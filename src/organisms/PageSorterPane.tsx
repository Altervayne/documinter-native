// -- React Imports --
import { useState } from 'react'
import type React from 'react'

// -- DnD Imports --
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Icon Imports --
import { PanelRightClose, PanelRightOpen, Copy, Trash2, Layers } from 'lucide-react'

// -- Lib / Context Imports --
import { renderBlocksToDocHtml } from '../lib/export'
import { millimetresToPx, type Page } from '../lib/pageModel'
import type { PageMargins } from '../lib/format'
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

interface PageSorterPaneProps {
   open:         boolean
   onToggle:     () => void
   pages:        Page[]
   docTheme:     'light' | 'dark'
   docAccent:    string
   margins:      PageMargins
   sheetWidthPx: number
   sheetHeightPx:number
   onReorder:    (fromIndex: number, toIndex: number) => void
   onDuplicate:  (pageIndex: number) => void
   onDelete:     (pageIndex: number) => void
   onJump:       (pageId: string) => void
}

// #############################################################
// # ONE THUMBNAIL: a scaled read-only render of a page's flow #
// #############################################################

interface PageThumbnailProps {
   page:          Page
   pageIndex:     number
   pageCount:     number
   docTheme:      'light' | 'dark'
   docAccent:     string
   margins:       PageMargins
   sheetWidthPx:  number
   sheetHeightPx: number
   canDelete:     boolean
   onJump:        (pageId: string) => void
   onDuplicate:   (pageIndex: number) => void
   onDelete:      (pageIndex: number) => void
}

function PageThumbnail({
   page, pageIndex, pageCount, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   canDelete, onJump, onDuplicate, onDelete,
}: PageThumbnailProps) {
   const { t } = useLang()
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })

   // The page's flat block flow (across its section slices) → self-contained doc HTML, rendered at the
   // real sheet px inside a scaled wrapper. Image blocks use the cheap placeholder (a thumbnail needs
   // no full base64 fidelity); graphs / diagrams are inline SVG and render as-is.
   const blocks = page.slices.flatMap(slice => slice.blocks)
   const html   = renderBlocksToDocHtml(blocks, { theme: docTheme, imagePlaceholder: true })

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
            className="page-thumb-frame"
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
               <div
                  className={`doc-render page-thumb-render ${docTheme === 'dark' ? 'doc-dark' : ''}`}
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

// ####################################################
// # THE PANE: a right-docked, sliding page-sorter aside
// ####################################################

/**
 * The page-sorter (Document Formats PHASE 4): a sliding pane, mounted ONLY in paged (A4) EDIT mode,
 * that shows the document's derived pages as scaled thumbnails and lets the author reorder them (dnd-
 * kit), jump to one (click), and duplicate / delete one. Pages are DERIVED from the break markers, so
 * every action routes through the pure `reorderPages` / `duplicatePage` / `deletePage` transforms in
 * lib/pageModel (which move the real block ranges + re-derive the breaks). Mirrors the Panel's always-
 * mounted width-transition (a collapsed rail ↔ full pane), one axis over.
 */
export function PageSorterPane({
   open, onToggle, pages, docTheme, docAccent, margins, sheetWidthPx, sheetHeightPx,
   onReorder, onDuplicate, onDelete, onJump,
}: PageSorterPaneProps) {
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
   const countLabel    = `${pages.length} ${pages.length === 1 ? t.pageSorterCount : t.pageSorterCountPlural}`
   // A single-page document can't lose its only page (that would empty it), so delete is disabled then.
   const canDelete     = pages.length > 1

   return (
      <aside
         style={{ width: open ? '13rem' : '2.5rem' }}
         className="shrink-0 bg-raised border-l border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden transition-[width] duration-[180ms] ease-in-out motion-reduce:transition-none"
      >
         {!open ? (
            // Collapsed rail: a single open affordance, mirroring the Panel rail.
            <div className="flex flex-col items-center p-2">
               <button
                  onClick={onToggle}
                  title={t.pageSorterOpen}
                  aria-label={t.pageSorterOpen}
                  className="text-muted hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
               >
                  <PanelRightOpen size={18} />
               </button>
               <span className="mt-1 text-muted/50" aria-hidden="true"><Layers size={15} /></span>
            </div>
         ) : (
            <>
               {/* Header: title + page count + collapse. */}
               <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                  <div className="flex flex-col min-w-0">
                     <span className="font-mono text-xs uppercase tracking-widest text-accent/70 font-semibold select-none">
                        {t.pageSorterTitle}
                     </span>
                     <span className="text-[0.68rem] text-muted/60 select-none">{countLabel}</span>
                  </div>
                  <button
                     onClick={onToggle}
                     title={t.pageSorterClose}
                     aria-label={t.pageSorterClose}
                     className="text-muted hover:text-accent p-1.5 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
                  >
                     <PanelRightClose size={15} />
                  </button>
               </div>

               {/* Scrollable thumbnail column. */}
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
                              docTheme={docTheme}
                              docAccent={docAccent}
                              margins={margins}
                              sheetWidthPx={sheetWidthPx}
                              sheetHeightPx={sheetHeightPx}
                              canDelete={canDelete}
                              onJump={onJump}
                              onDuplicate={onDuplicate}
                              onDelete={onDelete}
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
               </div>
            </>
         )}
      </aside>
   )
}

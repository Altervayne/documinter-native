import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
   DndContext, DragOverlay, pointerWithin, PointerSensor, useSensor, useSensors, useDndMonitor,
   type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Folder, ArrowDown, ArrowUp, FilePlus } from 'lucide-react'
import type { BinderFolderRecord, BinderDocumentRecord } from '../../types'
import { DOCUMENT_DATE_FIELDS, backfillSearchText, getFolderAncestors } from '../../lib/storage'
import type { DocumentSortBy, DocumentDateField, SearchCriteria, DateFilter, FieldQuery } from '../../lib/storage'
import { useBinderDocuments } from '../../hooks/useBinderDocuments'
import { useBinderNav } from '../../hooks/useBinderNav'
import { useLang } from '../../contexts/LangContext'
import { BinderTopbar } from './BinderTopbar'
import { BinderNav, type FolderDropTarget } from './BinderNav'
import { BinderBreadcrumb } from './BinderBreadcrumb'
import { BinderControls } from './BinderControls'
import { EMPTY_DATE_FILTER, EMPTY_FIELD_QUERY, dateDraftToFilter, fieldQueryDraftToCriteria } from './searchFilters'
import type { DateFilterDraft, SearchScope, FieldQueryDraft, FieldQueryKey } from './searchFilters'
import { DocumentCard } from './DocumentCard'
import { DocumentCardPreview } from './DocumentCardPreview'
import { DocumentCardMeta } from './DocumentCardMeta'
import { BinderFolderMenu } from '../../molecules/BinderFolderMenu'
import { ConfirmDialog } from '../../molecules/ConfirmDialog'
import './binderDragOverlay.css'

// Which drop a card-over-nav will perform: into the hovered folder (down a level), to the
// current folder's parent via the Back button (up a level), or nothing.
type DropIntent = 'down' | 'up' | null

// Spring-loaded navigation: dwelling on a folder / Back button for this long during a drag
// navigates there (drilling in / up) without ending the drag, so items can be moved many levels.
const SPRING_HOLD_MS = 900
type SpringTarget = { kind: 'folder'; id: string } | { kind: 'back' }

/** Lives inside the DndContext; reports whether the cursor is over a folder row (a down-drop). */
function FolderOverWatcher({ onChange }: { onChange: (overFolder: boolean) => void }) {
   useDndMonitor({
      onDragOver(event) { onChange(String(event.over?.id ?? '').startsWith('folder:')) },
      onDragEnd()       { onChange(false) },
      onDragCancel()    { onChange(false) },
   })
   return null
}

export interface BinderProps {
   /** Active app theme — the binder topbar logo matches the main topbar's theme-aware render. */
   theme:             'light' | 'dark'
   /** id of the document currently open in the editor (pinned + badged in its folder). */
   currentDocumentId: string | null
   /** Close the binder and return to the editor. */
   onClose:           () => void
   /** Open a stored document in the editor. */
   onOpenDocument:    (id: string) => void
   /** Create a blank document and open it. With a folderId, the new document is filed there. */
   onNewDocument:     (folderId?: string) => void
   /** Notify the editor that a document was deleted (so it can clear a now-stale current id). */
   onDocumentDeleted: (id: string) => void
}

const ROOT_FOLDER_ID = '0'

/** Drag ids are namespaced so onDragEnd can tell documents from folders. */
type DragItem = { type: 'doc' | 'folder'; id: string }
function parseDragId(raw: string): DragItem | null {
   if (raw.startsWith('doc:'))    return { type: 'doc',    id: raw.slice(4) }
   if (raw.startsWith('folder:')) return { type: 'folder', id: raw.slice(7) }
   return null
}

/**
 * Binder root — the in-app document library. Replaces the editor full-screen when open.
 * Two-pane drill-down: left folder nav + breadcrumb + document grid for the current folder.
 */
export function Binder({ theme, currentDocumentId, onClose, onOpenDocument, onNewDocument, onDocumentDeleted }: BinderProps) {
   const { t } = useLang()

   // ============================
   //  Navigation + shared refresh
   // ============================
   const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID)
   const [currentFolder, setCurrentFolder]     = useState<BinderFolderRecord | null>(null)
   const [dataVersion, setDataVersion]         = useState(0)
   const bumpData = useCallback(() => setDataVersion(version => version + 1), [])

   // =======================================================================================
   //  Search + sort (session-local; an active search is global, escaping the current folder)
   // =======================================================================================
   const [searchInput, setSearchInput]         = useState('')
   const [debouncedSearch, setDebouncedSearch] = useState('')
   const [sortBy, setSortBy]                   = useState<DocumentSortBy>('updatedAt')
   const [sortDir, setSortDir]                 = useState<'asc' | 'desc'>('desc')

   // Advanced filters: targeted per-field queries, an independent date constraint per field,
   // never-opened, and search scope.
   const [fieldQueries, setFieldQueries]               = useState<FieldQueryDraft>(EMPTY_FIELD_QUERY)
   const [debouncedFieldQueries, setDebouncedFieldQueries] = useState<FieldQueryDraft>(EMPTY_FIELD_QUERY)
   const [dateFilters, setDateFilters] = useState<Record<DocumentDateField, DateFilterDraft>>({
      updatedAt:    EMPTY_DATE_FILTER,
      createdAt:    EMPTY_DATE_FILTER,
      lastOpenedAt: EMPTY_DATE_FILTER,
   })
   const [hasNeverOpened, setHasNeverOpened] = useState(false)
   const [scope, setScope]                   = useState<SearchScope>('global')

   const setFieldQuery = useCallback((key: FieldQueryKey, value: string) => {
      setFieldQueries(previous => ({ ...previous, [key]: value }))
   }, [])
   const setDateFilter = useCallback((field: DocumentDateField, next: DateFilterDraft) => {
      setDateFilters(previous => ({ ...previous, [field]: next }))
   }, [])

   useEffect(() => {
      const timer = setTimeout(() => setDebouncedSearch(searchInput), 250)
      return () => clearTimeout(timer)
   }, [searchInput])

   useEffect(() => {
      const timer = setTimeout(() => setDebouncedFieldQueries(fieldQueries), 250)
      return () => clearTimeout(timer)
   }, [fieldQueries])

   const criteria = useMemo<SearchCriteria>(() => {
      const dates: Partial<Record<DocumentDateField, DateFilter>> = {}
      for (const field of DOCUMENT_DATE_FIELDS) {
         const filter = dateDraftToFilter(dateFilters[field])
         if (filter) dates[field] = filter
      }
      const fields: FieldQuery | undefined = fieldQueryDraftToCriteria(debouncedFieldQueries)
      return {
         text:           debouncedSearch.trim() || undefined,
         fields,
         dates:          Object.keys(dates).length > 0 ? dates : undefined,
         hasNeverOpened: hasNeverOpened || undefined,
      }
   }, [debouncedSearch, debouncedFieldQueries, dateFilters, hasNeverOpened])

   const hasActiveCriteria = Boolean(criteria.text || criteria.fields || criteria.dates || criteria.hasNeverOpened)

   const clearFilters = useCallback(() => {
      setFieldQueries(EMPTY_FIELD_QUERY)
      setDateFilters({ updatedAt: EMPTY_DATE_FILTER, createdAt: EMPTY_DATE_FILTER, lastOpenedAt: EMPTY_DATE_FILTER })
      setHasNeverOpened(false)
      setScope('global')
   }, [])

   // One-time: backfill contentText on documents saved before full-text search existed.
   useEffect(() => {
      let active = true
      backfillSearchText()
         .then(updated => { if (active && updated > 0) bumpData() })
         .catch(error => console.error('[binder] search-text backfill failed:', error))
      return () => { active = false }
   }, [bumpData])

   const nav  = useBinderNav(currentFolderId, dataVersion, bumpData)
   const docs = useBinderDocuments(
      {
         // An active search spans the whole binder unless the scope switch limits it to this folder.
         folderId: hasActiveCriteria && scope === 'global' ? undefined : currentFolderId,
         criteria: hasActiveCriteria ? criteria : undefined,
         sortBy,
         sortDir,
      },
      dataVersion,
      bumpData,
   )

   // ============================
   //  Selection / editing / menus
   // ============================
   const [selectedFolderId, setSelectedFolderId]     = useState<string | null>(null)
   const [editingFolderId, setEditingFolderId]       = useState<string | null>(null)
   const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
   const [folderMenu, setFolderMenu]                 = useState<{ folder: BinderFolderRecord; x: number; y: number } | null>(null)
   const [folderPendingDelete, setFolderPendingDelete] = useState<BinderFolderRecord | null>(null)

   const navigateTo = useCallback((folder: BinderFolderRecord | null) => {
      setCurrentFolder(folder)
      setCurrentFolderId(folder?.id ?? ROOT_FOLDER_ID)
      setSelectedFolderId(null)
      setSelectedDocumentId(null)
      setSearchInput('')          // navigating exits a global search
      setDebouncedSearch('')
      clearFilters()              // …and clears any advanced filters
   }, [clearFilters])

   // ===============
   //  Folder actions
   // ===============
   const handleNewFolder = useCallback(async () => {
      const id = await nav.createFolder(currentFolderId, t.binderNewFolder)
      setEditingFolderId(id)
   }, [nav, currentFolderId, t])

   const handleNewSubfolder = useCallback(async (folder: BinderFolderRecord) => {
      const id = await nav.createFolder(folder.id, t.binderNewFolder)
      navigateTo(folder)          // drill into the parent so the new subfolder is visible
      setEditingFolderId(id)
   }, [nav, navigateTo, t])

   const handleConfirmDeleteFolder = useCallback(() => {
      const folder = folderPendingDelete
      setFolderPendingDelete(null)
      if (!folder) return
      void nav.deleteFolder(folder.id)
      // If we're inside the deleted folder (or a descendant), pop back to root.
      if (currentFolderId === folder.id || nav.ancestors.some(ancestor => ancestor.id === folder.id)) {
         navigateTo(null)
      }
   }, [folderPendingDelete, nav, currentFolderId, navigateTo])

   // ============
   //  Drag & drop
   // ============
   // Cards are always grabbable (whole card), but card-on-card reordering only persists in
   // manual sort; in any other sort, only dropping a card onto a folder (a move) does anything.
   const manualSortActive = sortBy === 'manual' && !hasActiveCriteria
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [activeDrag, setActiveDrag] =
      useState<{ type: 'doc'; record: BinderDocumentRecord } | { type: 'folder'; id: string; label: string } | null>(null)
   // Drag overlay morph: over the nav, the card clone funnels into a cursor "puck" (dot + pill).
   const navRef          = useRef<HTMLDivElement>(null)
   const backRef         = useRef<HTMLButtonElement>(null)   // Back button — up-drop hit target
   const clusterRef      = useRef<HTMLDivElement>(null)      // the puck — pinned to the live cursor
   const overlayCardRef  = useRef<HTMLDivElement>(null)      // the full-card clone (funnels into the dot)
   const grabCapturedRef = useRef(false)                     // funnel origin captured once per drag
   const overBackRef     = useRef(false)                     // cursor over Back button (read at drop)
   const cancelRef       = useRef<HTMLDivElement>(null)      // Cancel-move dropzone hit target
   const overCancelRef   = useRef(false)                     // cursor over the Cancel-move zone (read at drop)
   const folderTargetRef = useRef<FolderDropTarget | null>(null)   // folder drag: hovered row + zone (read at drop)
   const [isOverNav, setIsOverNav]         = useState(false)
   const [overCancel, setOverCancel]       = useState(false)
   const [overBack, setOverBack]           = useState(false)
   const [isOverFolder, setIsOverFolder]   = useState(false)
   const [folderTarget, setFolderTarget]   = useState<FolderDropTarget | null>(null)
   const isDocDragging    = activeDrag?.type === 'doc'
   const isFolderDragging = activeDrag?.type === 'folder'
   const draggedFolderId  = activeDrag?.type === 'folder' ? activeDrag.id : null

   // Spring-loaded navigation state: a dwell timer, the current dwell target, and a progress ring.
   const springTimerRef  = useRef<number | null>(null)
   const springTargetRef = useRef<SpringTarget | null>(null)
   const [springActive, setSpringActive] = useState(false)   // ring visible
   const [springRunId, setSpringRunId]   = useState(0)        // bump to restart the ring animation
   // Kept fresh so the (delayed) dwell timer navigates against the current view, not a stale closure.
   const springDataRef = useRef({ subfolders: nav.subfolders, ancestors: nav.ancestors, navigateTo })

   const resetSpring = useCallback(() => {
      if (springTimerRef.current !== null) { clearTimeout(springTimerRef.current); springTimerRef.current = null }
      springTargetRef.current = null
      setSpringActive(false)
   }, [])

   // Sync the data the dwell timer needs every render (the timer fires long after the closure that
   // started it, possibly after a navigation, so it must read the live view).
   useEffect(() => {
      springDataRef.current = { subfolders: nav.subfolders, ancestors: nav.ancestors, navigateTo }
   })

   // Puck visibility + direction differ by drag kind: a card morphs over the whole nav; a folder
   // morphs only when it would actually move (nested into a folder, or up via the Back button).
   const folderNest   = isFolderDragging && folderTarget?.zone === 'nest'
   const puckVisible  = isDocDragging ? isOverNav : (isFolderDragging && (overBack || Boolean(folderNest)))
   const puckIntent: DropIntent = overBack ? 'up' : (isDocDragging ? (isOverFolder ? 'down' : null) : (folderNest ? 'down' : null))

   // While anything is dragging, follow the real cursor: pin the puck to it and flag the Back
   // button (up-drop). For a card: nav-panel hover (card→puck morph) + funnel origin. For a folder:
   // hit-test the folder rows to derive the hovered row + zone (top/bottom edge = reorder, center =
   // nest). Direct DOM writes where possible, no re-render unless a tracked value changes.
   useEffect(() => {
      if (!isDocDragging && !isFolderDragging) return
      const inside = (rect: DOMRect | undefined, x: number, y: number) =>
         Boolean(rect) && x >= rect!.left && x <= rect!.right && y >= rect!.top && y <= rect!.bottom

      // Restart / clear the dwell timer + ring as the navigable target changes; fire navigation
      // (drill into a folder, or up via Back) when the cursor holds the same target for SPRING_HOLD_MS.
      const updateSpring = (next: SpringTarget | null) => {
         const previous = springTargetRef.current
         const same = (!previous && !next)
            || (!!previous && !!next && previous.kind === next.kind
                && (previous.kind !== 'folder' || previous.id === (next as { id?: string }).id))
         if (same) return
         if (springTimerRef.current !== null) { clearTimeout(springTimerRef.current); springTimerRef.current = null }
         springTargetRef.current = next
         if (!next) { setSpringActive(false); return }
         setSpringActive(true)
         setSpringRunId(runId => runId + 1)
         springTimerRef.current = window.setTimeout(() => {
            springTimerRef.current = null
            springTargetRef.current = null
            setSpringActive(false)
            const { subfolders, ancestors, navigateTo: navTo } = springDataRef.current
            if (next.kind === 'back') navTo(ancestors.length > 0 ? ancestors[ancestors.length - 1] : null)
            else {
               const folder = subfolders.find(candidate => candidate.id === next.id)
               if (folder) navTo(folder)
            }
         }, SPRING_HOLD_MS)
      }

      const handlePointerMove = (event: PointerEvent) => {
         const { clientX: x, clientY: y } = event
         if (clusterRef.current) {
            clusterRef.current.style.left = `${x}px`
            clusterRef.current.style.top  = `${y}px`
         }
         const overNav      = inside(navRef.current?.getBoundingClientRect(),    x, y)
         const overBackNow  = inside(backRef.current?.getBoundingClientRect(),   x, y)
         const overCancelNow = inside(cancelRef.current?.getBoundingClientRect(), x, y)
         overBackRef.current   = overBackNow
         overCancelRef.current = overCancelNow
         setOverBack(overBackNow)
         setOverCancel(overCancelNow)

         // Folder row directly under the cursor (geometry; excludes the dragged folder itself).
         let hovered: FolderDropTarget | null = null
         if (!overBackNow && navRef.current) {
            for (const row of navRef.current.querySelectorAll<HTMLElement>('[data-folder-id]')) {
               const rect = row.getBoundingClientRect()
               if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
               const id = row.getAttribute('data-folder-id')
               if (id && id !== draggedFolderId) {
                  const ratio = (y - rect.top) / rect.height
                  hovered = { id, zone: ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'nest' }
               }
               break
            }
         }

         if (isDocDragging) {
            setIsOverNav(overNav)
            // Capture the grab point once (while the card is still full-size) so the collapse
            // funnels toward the cursor rather than the card's center.
            if (!grabCapturedRef.current && !overNav && overlayCardRef.current) {
               const cardRect = overlayCardRef.current.getBoundingClientRect()
               overlayCardRef.current.style.transformOrigin = `${x - cardRect.left}px ${y - cardRect.top}px`
               grabCapturedRef.current = true
            }
            // A card springs into any hovered folder, or up via Back.
            updateSpring(overBackNow ? { kind: 'back' } : hovered ? { kind: 'folder', id: hovered.id } : null)
            return
         }

         // Folder drag: nest highlight / reorder line come from the hovered row + zone.
         setFolderTarget(hovered)
         folderTargetRef.current = hovered
         // A folder springs into a hovered folder's center (nest zone), or up via Back.
         updateSpring(overBackNow ? { kind: 'back' } : hovered?.zone === 'nest' ? { kind: 'folder', id: hovered.id } : null)
      }
      window.addEventListener('pointermove', handlePointerMove)
      return () => {
         window.removeEventListener('pointermove', handlePointerMove)
         if (springTimerRef.current !== null) { clearTimeout(springTimerRef.current); springTimerRef.current = null }
      }
   }, [isDocDragging, isFolderDragging, draggedFolderId])

   const handleDragStart = useCallback((event: DragStartEvent) => {
      const item = parseDragId(String(event.active.id))
      if (!item) return
      setIsOverNav(false)
      setOverBack(false)
      setIsOverFolder(false)
      setFolderTarget(null)
      setOverCancel(false)
      overBackRef.current     = false
      overCancelRef.current   = false
      folderTargetRef.current = null
      grabCapturedRef.current = false
      resetSpring()
      if (item.type === 'doc') {
         const record = docs.documents.find(record => record.id === item.id)
         if (record) setActiveDrag({ type: 'doc', record })
      } else {
         const folder = nav.subfolders.find(folder => folder.id === item.id)
         setActiveDrag({ type: 'folder', id: item.id, label: folder?.name ?? '' })
      }
   }, [docs.documents, nav.subfolders, resetSpring])

   // Nest folder A into B — rejected if B is a descendant of A (would create a cycle). Among the
   // visible siblings a cycle is impossible, but the full ancestor walk is validated regardless.
   const nestFolder = useCallback(async (folderId: string, targetParentId: string) => {
      const ancestors = await getFolderAncestors(targetParentId)
      if (ancestors.some(ancestor => ancestor.id === folderId)) return
      await nav.moveFolder(folderId, targetParentId)
   }, [nav])

   const handleDragEnd = useCallback((event: DragEndEvent) => {
      const droppedOnBack   = overBackRef.current
      const droppedOnCancel = overCancelRef.current
      const folderTargetNow = folderTargetRef.current
      setActiveDrag(null)
      setIsOverNav(false)
      setOverBack(false)
      setOverCancel(false)
      setIsOverFolder(false)
      setFolderTarget(null)
      overBackRef.current     = false
      overCancelRef.current   = false
      folderTargetRef.current = null
      resetSpring()

      // Dropped on the Cancel-move zone → abort: no move, reorder, or navigation commit.
      if (droppedOnCancel) return

      const { active, over } = event
      const source = parseDragId(String(active.id))
      if (!source) return

      if (source.type === 'doc') {
         const record = docs.documents.find(item => item.id === source.id)
         const isForeign = !record   // arrived in this view via spring-navigation — not a local doc

         // Drop on the Back button → move the document up a level (to the current folder's parent).
         if (droppedOnBack && currentFolder) {
            if (!record || record.folderId !== currentFolder.parentId) {
               void docs.handleMove(source.id, currentFolder.parentId)
               setSelectedDocumentId(null)
            }
            return
         }
         const target = over && active.id !== over.id ? parseDragId(String(over.id)) : null
         if (target?.type === 'folder') {
            // Move into the dropped-on folder — unless it's already the doc's folder.
            if (record && record.folderId === target.id) return
            void docs.handleMove(source.id, target.id)
            setSelectedDocumentId(null)
            return
         }
         if (isForeign) {
            // Spring-navigated here from elsewhere → land the document in the current folder.
            void docs.handleMove(source.id, currentFolderId)
            setSelectedDocumentId(null)
            return
         }
         if (target?.type === 'doc') {
            // Reorder documents — only meaningful (and only persisted) under manual sort.
            if (!manualSortActive) return
            const ids = docs.documents.map(item => item.id)
            const oldIndex = ids.indexOf(source.id)
            const newIndex = ids.indexOf(target.id)
            if (oldIndex !== -1 && newIndex !== -1) void docs.handleReorder(arrayMove(ids, oldIndex, newIndex))
         }
         return
      }

      // Folder drag — drops are driven by our own zone/Back detection, not dnd-kit `over`.
      if (droppedOnBack && currentFolder) {
         void nav.moveFolder(source.id, currentFolder.parentId)   // up a level — always cycle-safe
         return
      }
      if (folderTargetNow?.zone === 'nest') {
         void nestFolder(source.id, folderTargetNow.id)
         return
      }
      const isNativeFolder = nav.subfolders.some(folder => folder.id === source.id)
      if (!isNativeFolder) {
         // A folder spring-navigated here (foreign to this level) → land it in the current folder.
         void nestFolder(source.id, currentFolderId)
      } else if (folderTargetNow) {
         // Reorder before/after the target among the visible siblings.
         const ids = nav.subfolders.map(folder => folder.id).filter(id => id !== source.id)
         const targetIndex = ids.indexOf(folderTargetNow.id)
         if (targetIndex !== -1) {
            ids.splice(folderTargetNow.zone === 'before' ? targetIndex : targetIndex + 1, 0, source.id)
            void nav.reorderFolders(ids)
         }
      }
   }, [docs, nav, manualSortActive, currentFolder, currentFolderId, nestFolder, resetSpring])

   return (
      <div className="flex flex-col flex-1 min-h-0 bg-bg">
         <BinderTopbar theme={theme} onClose={onClose} onNewDocument={() => onNewDocument(currentFolderId)} />

         {/* pointerWithin: the drop target is whatever sits directly under the cursor — so a card
             dropped onto a folder unambiguously lands in that folder, not the nearest-center one. */}
         <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { setActiveDrag(null); setIsOverNav(false); setOverBack(false); setOverCancel(false); setIsOverFolder(false); setFolderTarget(null); overBackRef.current = false; overCancelRef.current = false; folderTargetRef.current = null; resetSpring() }}
         >
         <FolderOverWatcher onChange={setIsOverFolder} />
         <div className="flex flex-1 min-h-0">
            <BinderNav
               currentFolder={currentFolder}
               subfolders={nav.subfolders}
               folderDocumentCounts={nav.folderDocumentCounts}
               selectedFolderId={selectedFolderId}
               editingFolderId={editingFolderId}
               isDocumentDragging={activeDrag?.type === 'doc'}
               draggingDocFolderId={activeDrag?.type === 'doc' ? activeDrag.record.folderId : null}
               folderDropTarget={isFolderDragging ? folderTarget : null}
               rootRef={navRef}
               backRef={backRef}
               isUpTarget={overBack}
               isDragging={!!activeDrag}
               cancelRef={cancelRef}
               isCancelTarget={overCancel}
               onNavigateUp={() => navigateTo(nav.ancestors.length > 0 ? nav.ancestors[nav.ancestors.length - 1] : null)}
               onSelectFolder={setSelectedFolderId}
               onEnterFolder={navigateTo}
               onNewFolder={handleNewFolder}
               onFolderMenu={(folder, event) => { event.preventDefault(); setFolderMenu({ folder, x: event.clientX, y: event.clientY }) }}
               onCommitRename={(id, name) => { setEditingFolderId(null); void nav.renameFolder(id, name) }}
               onCancelRename={() => setEditingFolderId(null)}
            />

            <div className="flex flex-1 flex-col min-h-0">
               <div className="px-6 pt-4 pb-3 border-b border-border flex flex-col gap-3">
                  <BinderBreadcrumb ancestors={nav.ancestors} currentFolder={currentFolder} onNavigate={navigateTo} />
                  <BinderControls
                     search={searchInput}
                     onSearchChange={setSearchInput}
                     sortBy={sortBy}
                     onSortByChange={setSortBy}
                     sortDir={sortDir}
                     onSortDirToggle={() => setSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
                     fieldQueries={fieldQueries}
                     onFieldQueryChange={setFieldQuery}
                     dateFilters={dateFilters}
                     onDateFilterChange={setDateFilter}
                     hasNeverOpened={hasNeverOpened}
                     onHasNeverOpenedToggle={() => setHasNeverOpened(value => !value)}
                     scope={scope}
                     onScopeChange={setScope}
                     onClearFilters={clearFilters}
                  />
               </div>

               <div className="flex-1 overflow-y-auto p-6">
                  {docs.isLoading ? (
                     <div className="text-muted text-sm">…</div>
                  ) : docs.documents.length === 0 ? (
                     hasActiveCriteria ? (
                        <div className="flex h-full items-center justify-center text-muted text-sm">{t.binderNoResults}</div>
                     ) : (
                        <div className="flex h-full items-center justify-center">
                           <button
                              type="button"
                              onClick={() => onNewDocument(currentFolderId)}
                              className="flex flex-col items-center gap-3 py-12 px-10 rounded-xl border border-dashed border-accent/30 hover:border-accent/50 hover:bg-accent/5 text-center cursor-pointer transition-colors select-none"
                           >
                              <FilePlus size={32} className="text-accent/40" />
                              <div className="flex flex-col gap-1">
                                 <span className="text-sm font-medium text-muted">{t.binderEmptyTitle}</span>
                                 <span className="text-xs font-medium text-accent/70">{t.binderEmptyHint}</span>
                              </div>
                           </button>
                        </div>
                     )
                  ) : (
                     <SortableContext items={docs.documents.map(record => `doc:${record.id}`)} strategy={rectSortingStrategy}>
                        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
                           {docs.documents.map(record => (
                              <DocumentCard
                                 key={record.id}
                                 record={record}
                                 isCurrent={record.id === currentDocumentId}
                                 isSelected={record.id === selectedDocumentId}
                                 reorderable={manualSortActive}
                                 onSelect={() => setSelectedDocumentId(record.id)}
                                 onOpen={() => onOpenDocument(record.id)}
                                 onDuplicate={() => docs.handleDuplicate(record.id)}
                                 onDelete={() => {
                                    void docs.handleDelete(record.id)
                                    if (record.id === currentDocumentId) onDocumentDeleted(record.id)
                                 }}
                                 onExportHtml={() => docs.handleExportHtml(record.id)}
                                 onExportMarkdown={() => docs.handleExportMarkdown(record.id)}
                                 onExportMintdown={() => docs.handleExportMintdown(record.id)}
                              />
                           ))}
                        </div>
                     </SortableContext>
                  )}
               </div>
            </div>
         </div>

         <DragOverlay>
            {activeDrag && (
               activeDrag.type === 'doc' ? (
                  // State A: full card clone, which funnels into the cursor puck (State B, below).
                  <div
                     ref={overlayCardRef}
                     data-over-nav={isOverNav ? 'true' : 'false'}
                     className="binder-overlay-card w-full h-full flex items-stretch rounded-lg border border-accent bg-raised overflow-hidden shadow-2xl"
                  >
                     <DocumentCardPreview
                        meta={activeDrag.record.meta}
                        previewSections={activeDrag.record.previewSections}
                        docTheme={activeDrag.record.docTheme}
                        docAccent={activeDrag.record.docAccent}
                     />
                     <DocumentCardMeta record={activeDrag.record} />
                  </div>
               ) : (
                  // Folder chip (State A) — cross-fades to the puck (State B) when over a nest/up target.
                  <div
                     data-over-nav={puckVisible ? 'true' : 'false'}
                     className="binder-overlay-chip flex items-center gap-1.5 rounded-md border border-accent bg-raised shadow-xl px-2 py-1.5 text-sm text-text"
                  >
                     <Folder size={14} className="text-muted shrink-0" />
                     <span className="truncate">{activeDrag.label}</span>
                  </div>
               )
            )}
         </DragOverlay>

         {/* State B of the morph: a "puck" pinned to the live cursor (fixed, outside the overlay so
             dnd-kit's transform can't offset it) — dot on the cursor, label pill top-right, and a
             direction arrow on the left. Mounted for the whole drag; faded in by CSS. A card uses
             its document accent + a title pill; a folder uses the app accent + a folder pill. */}
         {activeDrag && (
            <div
               ref={clusterRef}
               data-over-nav={puckVisible ? 'true' : 'false'}
               data-intent={puckIntent ?? 'none'}
               data-kind={activeDrag.type}
               className={`binder-overlay-cluster fixed z-[1000] pointer-events-none${activeDrag.type === 'doc' && activeDrag.record.docTheme === 'dark' ? ' doc-dark' : ''}`}
               style={activeDrag.type === 'doc' ? { '--doc-accent': activeDrag.record.docAccent } as CSSProperties : undefined}
            >
               {springActive && (
                  <svg key={springRunId} className="binder-spring-ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
                     <circle className="binder-spring-track" cx="14" cy="14" r="11" />
                     <circle className="binder-spring-fill" cx="14" cy="14" r="11" style={{ animationDuration: `${SPRING_HOLD_MS}ms` }} />
                  </svg>
               )}
               <div className="binder-overlay-dot" />
               <div className="binder-overlay-pill">
                  {activeDrag.type === 'doc' ? (
                     <>
                        <span className="pill-swatch" style={{ background: activeDrag.record.docAccent }} />
                        <span className="pill-title">{activeDrag.record.meta.title || t.untitledDoc}</span>
                     </>
                  ) : (
                     <>
                        <Folder size={12} className="pill-folder-icon shrink-0" />
                        <span className="pill-title">{activeDrag.label || t.binderNewFolder}</span>
                     </>
                  )}
               </div>
               <div className="binder-overlay-arrow binder-overlay-arrow-down"><ArrowDown size={15} strokeWidth={2.5} /></div>
               <div className="binder-overlay-arrow binder-overlay-arrow-up"><ArrowUp size={15} strokeWidth={2.5} /></div>
            </div>
         )}
         </DndContext>

         {folderMenu && (
            <BinderFolderMenu
               x={folderMenu.x}
               y={folderMenu.y}
               onClose={() => setFolderMenu(null)}
               onRename={() => setEditingFolderId(folderMenu.folder.id)}
               onNewSubfolder={() => void handleNewSubfolder(folderMenu.folder)}
               onDelete={() => setFolderPendingDelete(folderMenu.folder)}
            />
         )}

         {folderPendingDelete && (
            <ConfirmDialog
               title={t.binderDeleteFolder}
               message={t.binderDeleteFolderWarning}
               confirmLabel={t.binderDelete}
               cancelLabel={t.binderUnsavedCancel}
               danger
               onConfirm={handleConfirmDeleteFolder}
               onCancel={() => setFolderPendingDelete(null)}
            />
         )}
      </div>
   )
}

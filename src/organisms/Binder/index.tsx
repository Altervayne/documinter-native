import { useCallback, useEffect, useMemo, useState } from 'react'
import {
   DndContext, DragOverlay, pointerWithin, PointerSensor, useSensor, useSensors,
   type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Folder } from 'lucide-react'
import type { BinderFolderRecord, BinderDocumentRecord } from '../../types'
import { DOCUMENT_DATE_FIELDS, backfillSearchText } from '../../lib/storage'
import type { DocumentSortBy, DocumentDateField, SearchCriteria, DateFilter, FieldQuery } from '../../lib/storage'
import { useBinderDocuments } from '../../hooks/useBinderDocuments'
import { useBinderNav } from '../../hooks/useBinderNav'
import { useLang } from '../../contexts/LangContext'
import { BinderTopbar } from './BinderTopbar'
import { BinderNav } from './BinderNav'
import { BinderBreadcrumb } from './BinderBreadcrumb'
import { BinderControls } from './BinderControls'
import { EMPTY_DATE_FILTER, EMPTY_FIELD_QUERY, dateDraftToFilter, fieldQueryDraftToCriteria } from './searchFilters'
import type { DateFilterDraft, SearchScope, FieldQueryDraft, FieldQueryKey } from './searchFilters'
import { DocumentCard } from './DocumentCard'
import { DocumentCardPreview } from './DocumentCardPreview'
import { DocumentCardMeta } from './DocumentCardMeta'
import { BinderFolderMenu } from '../../molecules/BinderFolderMenu'
import { ConfirmDialog } from '../../molecules/ConfirmDialog'

export interface BinderProps {
   /** Active app theme — the binder topbar logo matches the main topbar's theme-aware render. */
   theme:             'light' | 'dark'
   /** id of the document currently open in the editor (pinned + badged in its folder). */
   currentDocumentId: string | null
   /** Close the binder and return to the editor. */
   onClose:           () => void
   /** Open a stored document in the editor. */
   onOpenDocument:    (id: string) => void
   /** Create a blank document and open it. */
   onNewDocument:     () => void
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
      useState<{ type: 'doc'; record: BinderDocumentRecord } | { type: 'folder'; label: string } | null>(null)

   const handleDragStart = useCallback((event: DragStartEvent) => {
      const item = parseDragId(String(event.active.id))
      if (!item) return
      if (item.type === 'doc') {
         const record = docs.documents.find(record => record.id === item.id)
         if (record) setActiveDrag({ type: 'doc', record })
      } else {
         const folder = nav.subfolders.find(folder => folder.id === item.id)
         setActiveDrag({ type: 'folder', label: folder?.name ?? '' })
      }
   }, [docs.documents, nav.subfolders])

   const handleDragEnd = useCallback((event: DragEndEvent) => {
      setActiveDrag(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const source = parseDragId(String(active.id))
      const target = parseDragId(String(over.id))
      if (!source || !target) return

      if (source.type === 'doc' && target.type === 'doc') {
         // Reorder documents — only meaningful (and only persisted) under manual sort.
         if (!manualSortActive) return
         const ids = docs.documents.map(record => record.id)
         const oldIndex = ids.indexOf(source.id)
         const newIndex = ids.indexOf(target.id)
         if (oldIndex !== -1 && newIndex !== -1) void docs.handleReorder(arrayMove(ids, oldIndex, newIndex))
      } else if (source.type === 'doc' && target.type === 'folder') {
         // Move the document into the dropped-on folder (works in any sort).
         void docs.handleMove(source.id, target.id)
         setSelectedDocumentId(null)
      } else if (source.type === 'folder' && target.type === 'folder') {
         // Reorder folders — only among the visible siblings (same parent). This makes a
         // cycle structurally impossible: a folder can never become its own descendant.
         const ids = nav.subfolders.map(folder => folder.id)
         const oldIndex = ids.indexOf(source.id)
         const newIndex = ids.indexOf(target.id)
         if (oldIndex !== -1 && newIndex !== -1) void nav.reorderFolders(arrayMove(ids, oldIndex, newIndex))
      }
   }, [docs, nav, manualSortActive])

   return (
      <div className="flex flex-col flex-1 min-h-0 bg-bg">
         <BinderTopbar theme={theme} onClose={onClose} onNewDocument={onNewDocument} />

         {/* pointerWithin: the drop target is whatever sits directly under the cursor — so a card
             dropped onto a folder unambiguously lands in that folder, not the nearest-center one. */}
         <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
         <div className="flex flex-1 min-h-0">
            <BinderNav
               currentFolder={currentFolder}
               subfolders={nav.subfolders}
               folderDocumentCounts={nav.folderDocumentCounts}
               selectedFolderId={selectedFolderId}
               editingFolderId={editingFolderId}
               isDocumentDragging={activeDrag?.type === 'doc'}
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
                     <div className="flex h-full items-center justify-center text-muted text-sm">
                        {hasActiveCriteria ? t.binderNoResults : currentFolder ? t.binderEmptyFolder : t.binderEmpty}
                     </div>
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
                  <div className="w-full h-full flex items-stretch rounded-lg border border-accent bg-raised overflow-hidden shadow-2xl cursor-grabbing opacity-80">
                     <DocumentCardPreview
                        meta={activeDrag.record.meta}
                        previewSections={activeDrag.record.previewSections}
                        docTheme={activeDrag.record.docTheme}
                        docAccent={activeDrag.record.docAccent}
                        eager
                     />
                     <DocumentCardMeta record={activeDrag.record} />
                  </div>
               ) : (
                  <div className="flex items-center gap-1.5 rounded-md border border-accent bg-raised shadow-xl px-2 py-1.5 text-sm text-text opacity-90">
                     <Folder size={14} className="text-muted shrink-0" />
                     <span className="truncate">{activeDrag.label}</span>
                  </div>
               )
            )}
         </DragOverlay>
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

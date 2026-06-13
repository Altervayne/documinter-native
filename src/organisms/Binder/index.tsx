import { useCallback, useEffect, useState } from 'react'
import {
   DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors,
   type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Folder } from 'lucide-react'
import type { BinderFolderRecord } from '../../types'
import type { DocumentSortBy } from '../../lib/storage'
import { useBinderDocuments } from '../../hooks/useBinderDocuments'
import { useBinderNav } from '../../hooks/useBinderNav'
import { useLang } from '../../contexts/LangContext'
import { BinderTopbar } from './BinderTopbar'
import { BinderNav } from './BinderNav'
import { BinderBreadcrumb } from './BinderBreadcrumb'
import { BinderControls } from './BinderControls'
import { DocumentCard } from './DocumentCard'
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

   // ── Navigation + shared refresh ───────────────────────────
   const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID)
   const [currentFolder, setCurrentFolder]     = useState<BinderFolderRecord | null>(null)
   const [dataVersion, setDataVersion]         = useState(0)
   const bumpData = useCallback(() => setDataVersion(version => version + 1), [])

   // ── Search + sort (session-local; search is global, escaping the current folder) ──
   const [searchInput, setSearchInput]         = useState('')
   const [debouncedSearch, setDebouncedSearch] = useState('')
   const [sortBy, setSortBy]                   = useState<DocumentSortBy>('updatedAt')
   const [sortDir, setSortDir]                 = useState<'asc' | 'desc'>('desc')

   useEffect(() => {
      const timer = setTimeout(() => setDebouncedSearch(searchInput), 250)
      return () => clearTimeout(timer)
   }, [searchInput])

   const isSearching = debouncedSearch.trim().length > 0

   const nav  = useBinderNav(currentFolderId, dataVersion, bumpData)
   const docs = useBinderDocuments(
      {
         folderId: isSearching ? undefined : currentFolderId,
         search:   isSearching ? debouncedSearch : undefined,
         sortBy,
         sortDir,
      },
      dataVersion,
      bumpData,
   )

   // ── Selection / editing / menus ───────────────────────────
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
   }, [])

   // ── Folder actions ────────────────────────────────────────
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

   // ── Drag & drop ───────────────────────────────────────────
   // Cards are draggable only with manual sort (and not while searching); folders always.
   const manualSortActive = sortBy === 'manual' && !isSearching
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [activeDrag, setActiveDrag] = useState<{ type: 'doc' | 'folder'; label: string } | null>(null)

   const handleDragStart = useCallback((event: DragStartEvent) => {
      const item = parseDragId(String(event.active.id))
      if (!item) return
      const label = item.type === 'doc'
         ? (docs.documents.find(record => record.id === item.id)?.meta.title || t.untitledDoc)
         : (nav.subfolders.find(folder => folder.id === item.id)?.name ?? '')
      setActiveDrag({ type: item.type, label })
   }, [docs.documents, nav.subfolders, t])

   const handleDragEnd = useCallback((event: DragEndEvent) => {
      setActiveDrag(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const source = parseDragId(String(active.id))
      const target = parseDragId(String(over.id))
      if (!source || !target) return

      if (source.type === 'doc' && target.type === 'doc') {
         // Reorder documents within the current folder.
         const ids = docs.documents.map(record => record.id)
         const oldIndex = ids.indexOf(source.id)
         const newIndex = ids.indexOf(target.id)
         if (oldIndex !== -1 && newIndex !== -1) void docs.handleReorder(arrayMove(ids, oldIndex, newIndex))
      } else if (source.type === 'doc' && target.type === 'folder') {
         // Move the document into the dropped-on folder.
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
   }, [docs, nav])

   return (
      <div className="flex flex-col flex-1 min-h-0 bg-bg">
         <BinderTopbar theme={theme} onClose={onClose} onNewDocument={onNewDocument} />

         <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
                  />
               </div>

               <div className="flex-1 overflow-y-auto p-6">
                  {docs.isLoading ? (
                     <div className="text-muted text-sm">…</div>
                  ) : docs.documents.length === 0 ? (
                     <div className="flex h-full items-center justify-center text-muted text-sm">
                        {currentFolder ? t.binderEmptyFolder : t.binderEmpty}
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
                                 isDraggable={manualSortActive}
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
                  <div className="rounded-lg border border-accent bg-raised shadow-xl px-3 py-2 text-sm text-text opacity-90 max-w-[260px] truncate">
                     {activeDrag.label}
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

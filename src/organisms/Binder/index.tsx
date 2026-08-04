import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { DndContext, DragOverlay, pointerWithin, useDndMonitor } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { Folder, ArrowDown, ArrowUp, FilePlus, FileJson } from 'lucide-react'
import type { BinderFolderRecord, BinderDocumentRecord } from '../../types'
import { backfillSearchText, loadDocument } from '../../lib/binderDocuments'
import type { DocumentSortBy } from '../../lib/binderSearch'
import type { DocumentTemplate } from '../../lib/documentTemplate'
import { useBinderDocuments } from '../../hooks/useBinderDocuments'
import { useBinderNav } from '../../hooks/useBinderNav'
import { useBinderSearch } from '../../hooks/useBinderSearch'
import { useBinderDragAndDrop, SPRING_HOLD_MS } from '../../hooks/useBinderDragAndDrop'
import { useTemplates } from '../../hooks/useTemplates'
import { useLang } from '../../contexts/LangContext'
import { useToast } from '../../contexts/ToastContext'
import { BinderNav } from './BinderNav'
import { BinderBreadcrumb } from './BinderBreadcrumb'
import { BinderControls } from './BinderControls'
import { DocumentCard } from './DocumentCard'
import { DocumentCardPreview } from './DocumentCardPreview'
import { DocumentCardMeta } from './DocumentCardMeta'
import { TemplatesPane } from './TemplatesPane'
import { BinderFolderMenu } from '../../molecules/BinderFolderMenu'
import { ConfirmDialog } from '../../molecules/ConfirmDialog'
import { PromptDialog } from '../../molecules/PromptDialog'
import { BinderFolderDeleteDialog } from '../../molecules/BinderFolderDeleteDialog'
import './binderDragOverlay.css'

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
   /** ids of every document with an open tab (badged "Open" in their folder). */
   openDocumentIds:   string[]
   /** id of the document in the active tab (badged "Currently editing"). null = active tab unsaved. */
   activeDocumentId:  string | null
   /** Folder to open into (the current document's folder); null = root. Seeds the initial view. */
   initialFolder:     BinderFolderRecord | null
   /** Which top-level view to open into (Documents by default; Templates from "New from template"). */
   initialView?:      'documents' | 'templates'
   /** Open a stored document in the editor (adds or focuses its tab). */
   onOpenDocument:    (id: string) => void
   /** Create a blank document and open it. With a folderId, the new document is filed there. */
   onNewDocument:     (folderId?: string) => void
   /** Create a new document pre-styled from a template and open it (filed into folderId when given). */
   onNewFromTemplate: (template: DocumentTemplate, folderId?: string) => void
   /** Notify the editor that a document was deleted (so it can close its tab if open). */
   onDocumentDeleted: (id: string) => void
}

const ROOT_FOLDER_ID = '0'

/**
 * Binder root, the in-app document library. Replaces the editor full-screen when open.
 * Two-pane drill-down: left folder nav + breadcrumb + document grid for the current folder.
 */
export function Binder({ openDocumentIds, activeDocumentId, initialFolder, initialView = 'documents', onOpenDocument, onNewDocument, onNewFromTemplate, onDocumentDeleted }: BinderProps) {
   const { t } = useLang()
   const { showToast } = useToast()

   // ============================
   //  Navigation + shared refresh
   // ============================
   // Seeded from initialFolder so the binder opens directly into the current document's folder.
   const [currentFolderId, setCurrentFolderId] = useState(initialFolder?.id ?? ROOT_FOLDER_ID)
   const [currentFolder, setCurrentFolder]     = useState<BinderFolderRecord | null>(initialFolder)
   const [view, setView]                       = useState<'documents' | 'templates'>(initialView)
   const [dataVersion, setDataVersion]         = useState(0)
   const bumpData = useCallback(() => setDataVersion(version => version + 1), [])

   // =======================================================================================
   //  Search + sort (session-local; an active search is global, escaping the current folder).
   //  Search/filter state lives in useBinderSearch; sort stays local to the root, composed with
   //  the hook's criteria into the document-list query below.
   // =======================================================================================
   const search = useBinderSearch()
   const { resetSearch } = search   // pulled out so navigateTo can depend on the stable callback
   const [sortBy, setSortBy]   = useState<DocumentSortBy>('updatedAt')
   const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

   // One-time: backfill contentText on documents saved before full-text search existed.
   useEffect(() => {
      let active = true
      backfillSearchText()
         .then(updated => { if (active && updated > 0) bumpData() })
         .catch(error => console.error('[binder] search-text backfill failed:', error))
      return () => { active = false }
   }, [bumpData])

   const templates = useTemplates(dataVersion, bumpData)
   const nav  = useBinderNav(currentFolderId, dataVersion, bumpData)
   const docs = useBinderDocuments(
      {
         // An active search spans the whole binder unless the scope switch limits it to this folder.
         folderId: search.hasActiveCriteria && search.scope === 'global' ? undefined : currentFolderId,
         criteria: search.hasActiveCriteria ? search.criteria : undefined,
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
   const [folderPendingDelete, setFolderPendingDelete]     = useState<BinderFolderRecord | null>(null)
   const [documentPendingDelete, setDocumentPendingDelete] = useState<BinderDocumentRecord | null>(null)
   // Text-input dialog shared by "save document as template" (mode 'save', keyed by the source
   // document id) and "rename template" (mode 'rename', keyed by the template id).
   const [templateNameDialog, setTemplateNameDialog]       = useState<
      | { mode: 'save'; documentId: string; initialName: string }
      | { mode: 'rename'; templateId: string; initialName: string }
      | null
   >(null)
   const [templatePendingDelete, setTemplatePendingDelete] = useState<DocumentTemplate | null>(null)

   const navigateTo = useCallback((folder: BinderFolderRecord | null) => {
      setView('documents')        // entering a folder is a Documents-view action
      setCurrentFolder(folder)
      setCurrentFolderId(folder?.id ?? ROOT_FOLDER_ID)
      setSelectedFolderId(null)
      setSelectedDocumentId(null)
      resetSearch()               // navigating exits a global search + clears advanced filters
   }, [resetSearch])

   // ==================
   //  Template actions
   // ==================
   // "Save as template" from a document card: name it, then capture that stored document's chrome.
   const openSaveAsTemplate = useCallback((record: BinderDocumentRecord) => {
      setTemplateNameDialog({ mode: 'save', documentId: record.id, initialName: record.meta.title ?? '' })
   }, [])

   const handleConfirmTemplateName = useCallback(async (name: string) => {
      const dialog = templateNameDialog
      setTemplateNameDialog(null)
      if (!dialog) return
      if (dialog.mode === 'rename') { void templates.handleRename(dialog.templateId, name); return }
      // Save mode: load the document's chrome (no content is captured) and store the template.
      const loaded = await loadDocument(dialog.documentId, { touch: false })
      if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
      await templates.handleSave(name, {
         meta:         loaded.meta,
         docTheme:     loaded.docTheme,
         docAccent:    loaded.docAccent,
         presentation: loaded.presentation,
         format:       loaded.format,
      })
   }, [templateNameDialog, templates, showToast, t])

   const handleConfirmDeleteTemplate = useCallback(() => {
      const template = templatePendingDelete
      setTemplatePendingDelete(null)
      if (template) void templates.handleDelete(template.id)
   }, [templatePendingDelete, templates])

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

   const handleConfirmDeleteFolder = useCallback((recursive: boolean) => {
      const folder = folderPendingDelete
      setFolderPendingDelete(null)
      if (!folder) return
      void nav.deleteFolder(folder.id, recursive).then(deletedDocumentIds => {
         // A recursive delete may have removed documents open in tabs; close each so a later
         // autosave doesn't resurrect it (saveDocument upserts a missing id).
         for (const deletedId of deletedDocumentIds) {
            if (openDocumentIds.includes(deletedId)) onDocumentDeleted(deletedId)
         }
      })
      // If we're inside the deleted folder (or a descendant), pop back to root.
      if (currentFolderId === folder.id || nav.ancestors.some(ancestor => ancestor.id === folder.id)) {
         navigateTo(null)
      }
   }, [folderPendingDelete, nav, currentFolderId, openDocumentIds, onDocumentDeleted, navigateTo])

   const handleConfirmDeleteDocument = useCallback(() => {
      const record = documentPendingDelete
      setDocumentPendingDelete(null)
      if (!record) return
      void docs.handleDelete(record.id)
      if (openDocumentIds.includes(record.id)) onDocumentDeleted(record.id)
   }, [documentPendingDelete, docs, openDocumentIds, onDocumentDeleted])

   // ============
   //  Drag & drop
   // ============
   // Cards are always grabbable (whole card), but card-on-card reordering only persists in
   // manual sort; in any other sort, only dropping a card onto a folder (a move) does anything.
   const manualSortActive = sortBy === 'manual' && !search.hasActiveCriteria
   const clearDocumentSelection = useCallback(() => setSelectedDocumentId(null), [])

   // The whole drag-and-drop subsystem (puck morph, spring folder-nav, back/cancel hit-tests, and
   // native file-drop import) lives in useBinderDragAndDrop. The root binds its handlers to the
   // DndContext and renders the overlay + nav drop targets from its returned state and refs.
   const {
      sensors, onDragStart, onDragEnd, onDragCancel, setIsOverFolder,
      navRef, backRef, cancelRef,
      activeDrag, isDocDragging, isFolderDragging, isOverNav, overBack, overCancel, folderTarget,
      overlayCardRef, clusterRef, puckVisible, puckIntent, springActive, springRunId,
      isFileDragOver, handleFileDragOver, handleFileDragLeave, handleFileDrop,
   } = useBinderDragAndDrop({
      docs,
      nav,
      navigateTo,
      currentFolder,
      currentFolderId,
      manualSortActive,
      clearDocumentSelection,
   })

   return (
      <div className="flex flex-col flex-1 min-h-0 bg-bg">
         {/* pointerWithin: the drop target is whatever sits directly under the cursor, so a card
             dropped onto a folder unambiguously lands in that folder, not the nearest-center one. */}
         <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
         >
         <FolderOverWatcher onChange={setIsOverFolder} />
         <div className="flex flex-1 min-h-0">
            <BinderNav
               view={view}
               onSelectDocuments={() => setView('documents')}
               onSelectTemplates={() => setView('templates')}
               currentFolder={currentFolder}
               subfolders={nav.subfolders}
               folderDocumentCounts={nav.folderDocumentCounts}
               selectedFolderId={selectedFolderId}
               editingFolderId={editingFolderId}
               isDocumentDragging={isDocDragging}
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

            {view === 'templates' ? (
               <TemplatesPane
                  templates={templates.templates}
                  isLoading={templates.isLoading}
                  onUse={template => onNewFromTemplate(template, currentFolderId)}
                  onDuplicate={template => void templates.handleDuplicate(template)}
                  onExport={template => templates.handleExport(template)}
                  onRename={template => setTemplateNameDialog({ mode: 'rename', templateId: template.id, initialName: template.name })}
                  onDelete={template => setTemplatePendingDelete(template)}
                  onImport={() => templates.handleImport()}
               />
            ) : (
            <div className="flex flex-1 flex-col min-h-0">
               <div className="px-6 pt-4 pb-3 border-b border-border flex flex-col gap-3">
                  <BinderBreadcrumb ancestors={nav.ancestors} currentFolder={currentFolder} onNavigate={navigateTo} />
                  <BinderControls
                     search={search.searchInput}
                     onSearchChange={search.setSearchInput}
                     sortBy={sortBy}
                     onSortByChange={setSortBy}
                     sortDir={sortDir}
                     onSortDirToggle={() => setSortDir(direction => direction === 'asc' ? 'desc' : 'asc')}
                     dateFilters={search.dateFilters}
                     onDateFilterChange={search.setDateFilter}
                     hasNeverOpened={search.hasNeverOpened}
                     onHasNeverOpenedToggle={() => search.setHasNeverOpened(value => !value)}
                     scope={search.scope}
                     onScopeChange={search.setScope}
                     onClearFilters={search.clearFilters}
                  />
               </div>

               <div
                  className="relative flex-1 overflow-y-auto p-6"
                  onDragOver={handleFileDragOver}
                  onDragLeave={handleFileDragLeave}
                  onDrop={handleFileDrop}
               >
                  {isFileDragOver && (
                     <div className="absolute inset-3 z-10 pointer-events-none flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-accent/60 bg-accent/10 text-accent">
                        <FileJson size={34} />
                        <span className="text-sm font-medium">{t.binderDropToImport}</span>
                     </div>
                  )}
                  {docs.isLoading ? (
                     <div className="text-muted text-sm">…</div>
                  ) : docs.documents.length === 0 ? (
                     search.hasActiveCriteria ? (
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
                                 isActive={record.id === activeDocumentId}
                                 isOpen={openDocumentIds.includes(record.id)}
                                 isSelected={record.id === selectedDocumentId}
                                 reorderable={manualSortActive}
                                 onSelect={() => setSelectedDocumentId(record.id)}
                                 onOpen={() => onOpenDocument(record.id)}
                                 onDuplicate={() => docs.handleDuplicate(record.id)}
                                 onDelete={() => setDocumentPendingDelete(record)}
                                 onExportHtml={() => docs.handleExportHtml(record.id)}
                                 onExportMarkdown={() => docs.handleExportMarkdown(record.id)}
                                 onExportMintdown={() => docs.handleExportMintdown(record.id)}
                                 onSaveAsTemplate={() => openSaveAsTemplate(record)}
                              />
                           ))}
                        </div>
                     </SortableContext>
                  )}
               </div>
            </div>
            )}
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
                  // Folder chip (State A), cross-fades to the puck (State B) when over a nest/up target.
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
             dnd-kit's transform can't offset it), dot on the cursor, label pill top-right, and a
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
            <BinderFolderDeleteDialog
               onConfirm={handleConfirmDeleteFolder}
               onCancel={() => setFolderPendingDelete(null)}
            />
         )}

         {documentPendingDelete && (
            <ConfirmDialog
               title={t.binderDeleteDocTitle}
               message={t.binderDeleteDocWarning}
               confirmLabel={t.binderDelete}
               cancelLabel={t.binderUnsavedCancel}
               danger
               onConfirm={handleConfirmDeleteDocument}
               onCancel={() => setDocumentPendingDelete(null)}
            />
         )}

         {templateNameDialog && (
            <PromptDialog
               title={templateNameDialog.mode === 'rename' ? t.templateRenameTitle : t.saveAsTemplateTitle}
               label={t.saveAsTemplateLabel}
               initialValue={templateNameDialog.initialName}
               confirmLabel={templateNameDialog.mode === 'rename' ? t.templateRenameConfirm : t.saveAsTemplateConfirm}
               cancelLabel={t.binderUnsavedCancel}
               onConfirm={name => void handleConfirmTemplateName(name)}
               onCancel={() => setTemplateNameDialog(null)}
            />
         )}

         {templatePendingDelete && (
            <ConfirmDialog
               title={t.templateDeleteTitle}
               message={t.templateDeleteWarning}
               confirmLabel={t.templateDelete}
               cancelLabel={t.binderUnsavedCancel}
               danger
               onConfirm={handleConfirmDeleteTemplate}
               onCancel={() => setTemplatePendingDelete(null)}
            />
         )}
      </div>
   )
}

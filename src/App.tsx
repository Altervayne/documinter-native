// -- React Imports --
import { useCallback, useEffect, useRef, useState } from 'react'

// -- Lib / Util Imports --
import { mkSection } from './lib/document'
import { translations, type Lang } from './lib/i18n'
import { readAutosave, clearLegacyAutosave } from './lib/autosaveStorage'
import { saveDocument, loadDocument, getDocumentFolderId, type LoadedDocument, type DocPresentation } from './lib/binderDocuments'
import { getFolder } from './lib/binderFolders'

// -- Hook Imports --
import { useSectionMutations } from './hooks/useSectionMutations'
import { useBlockMutations } from './hooks/useBlockMutations'
import { useContainerMutations } from './hooks/useContainerMutations'

// -- Context Imports --
import { DocumentMutationsContext } from './contexts/DocumentMutationsContext'
import { LangProvider } from './contexts/LangContext'
import { useToast } from './contexts/ToastContext'

// -- Component Imports --
import { HeaderMenuBar } from './organisms/HeaderMenuBar'
import { DocumentTitleBar } from './organisms/DocumentTitleBar'
import { Panel } from './organisms/Panel'
import { WysiwygArea } from './organisms/WysiwygArea'
import { MarkdownPanel } from './organisms/MarkdownPanel'
import { MintdownEditor } from './organisms/MintdownEditor'
import { WorkspaceLayout } from './organisms/WorkspaceLayout'
import { Binder } from './organisms/Binder'
import { ConfirmDialog } from './molecules/ConfirmDialog'
import { ToastContainer } from './atoms/ToastContainer'
import { UpdatePrompt } from './atoms/UpdatePrompt'

// -- Markdown Imports --
import { importMarkdownFile } from './lib/markdown'
import { importMintdownFile } from './lib/mintdown'

// -- Type Imports --
import type { BinderFolderRecord, DocMeta, DocState, Mode, SaveStatus, Section } from './types'
import { useWorkspaceState } from './hooks/useWorkspaceState'

const EMPTY_META: DocMeta = { module: '', title: '', author: '', date: '', env: '' }
const CURRENT_DOCUMENT_ID_KEY = 'documinter-current-document-id'
const DEFAULT_DOC_ACCENT = '#2dcea8'

export default function App() {
   // Document state starts blank; the real document is hydrated asynchronously from
   // IndexedDB on mount (see the hydration effect below).
   const [sections, setSections] = useState<Section[]>(() => {
      const initialLang = (localStorage.getItem('documinter-lang') as Lang) ?? 'en'
      return [mkSection(translations[initialLang].defaultSectionTitle)]
   })
   const [meta, setMeta]         = useState<DocMeta>(EMPTY_META)
   const [panelOpen, setPanelOpen] = useState(
      () => localStorage.getItem('documinter-panel-open') !== 'false'
   )
   useEffect(() => {
      localStorage.setItem('documinter-panel-open', String(panelOpen))
   }, [panelOpen])

   const [panelDockSide, setPanelDockSide] = useState<'left' | 'right'>(
      () => (localStorage.getItem('documinter-panel-dock') as 'left' | 'right') ?? 'left'
   )
   useEffect(() => {
      localStorage.setItem('documinter-panel-dock', panelDockSide)
   }, [panelDockSide])

   const handleTogglePanelDockSide = useCallback(() => {
      setPanelDockSide(current => current === 'left' ? 'right' : 'left')
   }, [])

   // Theme
   const [theme, setTheme] = useState<'dark' | 'light'>(
      () => (localStorage.getItem('documinter-theme') as 'dark' | 'light') ?? 'dark'
   )
   useEffect(() => {
      document.documentElement.dataset.theme = theme
      localStorage.setItem('documinter-theme', theme)
   }, [theme])
   const toggleTheme = useCallback(() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark'), [])

   // Language
   const [lang, setLang] = useState<Lang>(
      () => (localStorage.getItem('documinter-lang') as Lang) ?? 'en'
   )
   useEffect(() => { localStorage.setItem('documinter-lang', lang) }, [lang])
   const t = translations[lang]

   // Document appearance (independent of app theme; per-document, hydrated on mount)
   const [docTheme,  setDocTheme]  = useState<'light' | 'dark'>('light')
   const [docAccent, setDocAccent] = useState(DEFAULT_DOC_ACCENT)

   // ######################################
   // # SAVE STATUS + AUTOSAVE (INDEXEDDB) #
   // ######################################

   const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
   const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null)
   const { showToast } = useToast()

   const currentDocumentIdRef = useRef<string | null>(null)
   // Folder a freshly-created document should land in on its first save (set when "New" is used
   // from inside a binder folder; cleared once the document is saved or replaced). null = root.
   const pendingNewDocFolderRef = useRef<string | null>(null)
   const skipNextAutosaveRef  = useRef(true)   // skip the initial mount cycle (no spurious save)
   const hasHydratedRef       = useRef(false)
   const autosaveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
   // Captured during the first render so the pointer-persistence effect can't wipe it
   // before the hydration effect reads it.
   const initialPointerRef    = useRef<string | null>(localStorage.getItem(CURRENT_DOCUMENT_ID_KEY))

   // Keep a stable, always-current notifier so the autosave effect doesn't depend on t/showToast.
   const notifySaveFailedRef  = useRef<() => void>(() => {})
   useEffect(() => {
      notifySaveFailedRef.current = () => showToast(t.saveFailed, { type: 'error' })
   })

   // Apply a programmatically-loaded document without dirtying / re-saving it.
   const applyLoadedDocument = useCallback((loaded: LoadedDocument, id: string | null) => {
      skipNextAutosaveRef.current = true
      pendingNewDocFolderRef.current = null
      setMeta(loaded.meta)
      setSections(loaded.sections)
      setDocTheme(loaded.docTheme)
      setDocAccent(loaded.docAccent)
      currentDocumentIdRef.current = id
      setCurrentDocumentId(id)
   }, [])

   // Replace the in-editor document with fresh content that is NOT yet a binder record
   // (new / JSON load / file import). Resets currentDocumentId to null so the next edit
   // creates a new IndexedDB record rather than overwriting the previously-open document,
   // and skips the autosave cycle this replacement triggers. An optional presentation restores
   // the document's saved theme + accent (e.g. from a JSON backup); omit to keep the current ones.
   const replaceDocument = useCallback((nextMeta: DocMeta, nextSections: Section[], presentation?: DocPresentation) => {
      skipNextAutosaveRef.current = true
      pendingNewDocFolderRef.current = null   // a plain new/import/load lands in root unless set after
      setMeta(nextMeta)
      setSections(nextSections)
      if (presentation) {
         setDocTheme(presentation.docTheme)
         setDocAccent(presentation.docAccent)
      }
      currentDocumentIdRef.current = null
      setCurrentDocumentId(null)
   }, [])

   // One-time async hydration: migrate any legacy localStorage autosave, then load the
   // last-open document by pointer. The blank default shows until this resolves.
   useEffect(() => {
      let cancelled = false
      async function hydrate() {
         const pointer = initialPointerRef.current
         const legacy  = readAutosave()
         try {
            if (!pointer && legacy) {
               // Migrate legacy autosave → IndexedDB. Keep the old key until the write confirms.
               const migratedId = await saveDocument(
                  { meta: legacy.meta, sections: legacy.sections },
                  { docTheme: legacy.docTheme, docAccent: legacy.docAccent },
               )
               clearLegacyAutosave()
               if (cancelled) return
               applyLoadedDocument({ ...legacy }, migratedId)
            } else if (pointer) {
               const loaded = await loadDocument(pointer)
               if (cancelled) return
               if (loaded) applyLoadedDocument(loaded, pointer)
               else localStorage.removeItem(CURRENT_DOCUMENT_ID_KEY)   // stale pointer → stay blank
            }
         } catch {
            // IndexedDB unavailable / write failed. If we have legacy data, keep showing it
            // in-memory as an unsaved new document (legacy key left intact for a future retry).
            if (!cancelled && legacy && !pointer) applyLoadedDocument({ ...legacy }, null)
         } finally {
            if (!cancelled) hasHydratedRef.current = true
         }
      }
      hydrate()
      return () => { cancelled = true }
   }, [applyLoadedDocument])

   // Mirror currentDocumentId into a ref + persist the pointer (only after hydration, so
   // the initial blank state can't wipe the stored pointer before it has been read).
   useEffect(() => {
      currentDocumentIdRef.current = currentDocumentId
      if (!hasHydratedRef.current) return
      if (currentDocumentId) localStorage.setItem(CURRENT_DOCUMENT_ID_KEY, currentDocumentId)
      else localStorage.removeItem(CURRENT_DOCUMENT_ID_KEY)
   }, [currentDocumentId])

   // Autosave on any document change, debounced 1.5s, persisted to IndexedDB.
   useEffect(() => {
      if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
      setSaveStatus('dirty')
      autosaveTimerRef.current = setTimeout(() => {
         setSaveStatus('saving')
         saveDocument(
            { meta, sections },
            { docTheme, docAccent },
            currentDocumentIdRef.current ?? undefined,
            pendingNewDocFolderRef.current ?? undefined,
         ).then(savedId => {
            if (currentDocumentIdRef.current === null) {
               currentDocumentIdRef.current = savedId
               setCurrentDocumentId(savedId)
            }
            pendingNewDocFolderRef.current = null   // consumed, future new docs default to root
            setSaveStatus('saved')
         }).catch(error => {
            console.error('[autosave] saveDocument failed:', error)
            setSaveStatus('dirty')
            notifySaveFailedRef.current()
         })
      }, 1500)
      return () => {
         if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current)
      }
   }, [meta, sections, docTheme, docAccent])

   // Fade the "Saved" indicator out after 2.5 s
   useEffect(() => {
      if (saveStatus !== 'saved') return
      const clearTimer = setTimeout(() => setSaveStatus('clean'), 2500)
      return () => clearTimeout(clearTimer)
   }, [saveStatus])

   // Browser tab title, asterisk while dirty
   useEffect(() => {
      const baseTitle = meta.title ? `${meta.title}, Documinter` : 'Documinter'
      document.title  = saveStatus !== 'clean' ? `* ${baseTitle}` : baseTitle
   }, [saveStatus, meta.title])

   // Cancel any pending autosave and write the current document immediately. Awaitable
   // so callers (manual save, opening the binder) can flush before continuing.
   const persistNow = useCallback(async (): Promise<void> => {
      if (autosaveTimerRef.current !== null) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
      setSaveStatus('saving')
      try {
         const savedId = await saveDocument(
            { meta, sections },
            { docTheme, docAccent },
            currentDocumentIdRef.current ?? undefined,
            pendingNewDocFolderRef.current ?? undefined,
         )
         if (currentDocumentIdRef.current === null) {
            currentDocumentIdRef.current = savedId
            setCurrentDocumentId(savedId)
         }
         pendingNewDocFolderRef.current = null   // consumed, future new docs default to root
         setSaveStatus('saved')
      } catch (error) {
         console.error('[persistNow] saveDocument failed:', error)
         setSaveStatus('dirty')
         showToast(t.saveFailed, { type: 'error' })
      }
   }, [meta, sections, docTheme, docAccent, showToast, t])

   // Manual save
   const handleManualSave = useCallback(() => { void persistNow() }, [persistNow])

   // #############################
   // # BINDER (DOCUMENT LIBRARY) #
   // #############################

   const [binderOpen, setBinderOpen] = useState(false)
   // The folder the binder should open into, the current document's folder, resolved before the
   // binder mounts so it lands there directly (no root-then-folder flash). null = root.
   const [binderInitialFolder, setBinderInitialFolder] = useState<BinderFolderRecord | null>(null)

   // Open the binder, flush any pending changes first so the current document appears up-to-date
   // in the list, resolve which folder it lives in, then mount the binder in place of the editor.
   const handleOpenBinder = useCallback(async () => {
      if (saveStatus !== 'clean') await persistNow()
      let folder: BinderFolderRecord | null = null
      const openId = currentDocumentIdRef.current
      if (openId) {
         try {
            const folderId = await getDocumentFolderId(openId)
            if (folderId && folderId !== '0') folder = (await getFolder(folderId)) ?? null
         } catch { /* fall back to root */ }
      }
      setBinderInitialFolder(folder)
      setBinderOpen(true)
   }, [saveStatus, persistNow])

   // Pending binder navigation awaiting unsaved-changes confirmation.
   const [pendingNavigation, setPendingNavigation] = useState<{ kind: 'open'; id: string } | { kind: 'new'; folderId?: string } | null>(null)

   // True when the current document isn't durably saved (flush in-flight or failed).
   const isNotDurablySaved = saveStatus === 'saving' || saveStatus === 'dirty'

   // Load a stored document into the editor and close the binder.
   const openDocumentNow = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id)
         if (!loaded) { showToast(t.binderOpenFailed, { type: 'error' }); return }
         applyLoadedDocument(loaded, id)
         setBinderOpen(false)
         showToast(t.binderDocumentOpened, { type: 'success' })
      } catch {
         // Leave the binder open; nothing was replaced.
         showToast(t.binderOpenFailed, { type: 'error' })
      }
   }, [applyLoadedDocument, showToast, t])

   // Create a blank document and close the binder (currentDocumentId reset to null, so the first
   // edit creates a fresh IndexedDB record, filed into folderId if given, else root).
   const newDocumentNow = useCallback((folderId?: string) => {
      replaceDocument(EMPTY_META, [mkSection(t.defaultSectionTitle)])
      pendingNewDocFolderRef.current = folderId ?? null   // set after replaceDocument (which clears it)
      setBinderOpen(false)
      showToast(t.binderDocumentCreated, { type: 'success' })
   }, [t, replaceDocument, showToast])

   // Open a document from the binder, guard against discarding unsaved changes
   // (only fires when the open-binder flush is still in-flight or failed).
   const handleOpenDocument = useCallback((id: string) => {
      if (isNotDurablySaved) setPendingNavigation({ kind: 'open', id })
      else void openDocumentNow(id)
   }, [isNotDurablySaved, openDocumentNow])

   // Create a new document from the binder (optionally filed into a folder), same unsaved guard.
   const handleNewDocumentFromBinder = useCallback((folderId?: string) => {
      if (isNotDurablySaved) setPendingNavigation({ kind: 'new', folderId })
      else newDocumentNow(folderId)
   }, [isNotDurablySaved, newDocumentNow])

   // Confirm the pending navigation (discard-and-open / discard-and-new per approved design).
   const handleConfirmNavigation = useCallback(() => {
      const pending = pendingNavigation
      setPendingNavigation(null)
      if (pending?.kind === 'open') void openDocumentNow(pending.id)
      else if (pending?.kind === 'new') newDocumentNow(pending.folderId)
   }, [pendingNavigation, openDocumentNow, newDocumentNow])

   const handleCancelNavigation = useCallback(() => setPendingNavigation(null), [])

   // When the currently-open document is deleted from the binder, clear its id so the
   // next edit creates a fresh record instead of resurrecting the deleted one (upsert).
   const handleDocumentDeleted = useCallback((id: string) => {
      if (currentDocumentIdRef.current === id) {
         currentDocumentIdRef.current = null
         setCurrentDocumentId(null)
      }
   }, [])

   // Mode system
   const [mode, setMode] = useState<Mode>('wysiwyg')

   function handleSetMode(newMode: Mode) {
      if (newMode === mode) { setMode('wysiwyg'); return }
      setMode(newMode)
   }

   // ######################
   // # PANE LAYOUT SYSTEM #
   // ######################

   const { paneLayout, togglePanel, setPaneLayout } = useWorkspaceState()

   // Per-panel keyboard shortcuts: Ctrl+Shift+D/M/K
   useEffect(() => {
      function handleKeyDown(event: KeyboardEvent): void {
         if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
         const key = event.key.toLowerCase()
         if (key === 'd') { event.preventDefault(); togglePanel('wysiwyg') }
         else if (key === 'm') { event.preventDefault(); togglePanel('mintdown') }
         else if (key === 'k') { event.preventDefault(); togglePanel('markdown') }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [togglePanel])

   // ############################
   // # DOCUMENT-LEVEL CALLBACKS #
   // ############################

   // Commit from the MarkdownPanel back into document state (live edit, autosaves normally).
   const handleMarkdownCommit = useCallback((newSections: Section[], newMeta: DocMeta) => {
      setSections(newSections)
      setMeta(newMeta)
   }, [])

   // Wipe document and start fresh.
   const handleNewDocument = useCallback(() => {
      replaceDocument(EMPTY_META, [mkSection(t.defaultSectionTitle)])
   }, [t, replaceDocument])

   // Import a Markdown file, parse it, replace the document. Opening a file lands in the editor,
   // so leave binder mode if it was open.
   const handleImportMarkdown = useCallback((file: File): Promise<void> => {
      return importMarkdownFile(file).then(({ sections: newSections, meta: newMeta }) => {
         replaceDocument(newMeta, newSections)
         setBinderOpen(false)
      })
   }, [replaceDocument])

   // Import a Mintdown file, parse it, replace the document.
   const handleImportMintdown = useCallback((file: File): Promise<void> => {
      return importMintdownFile(file).then(({ sections: newSections, meta: newMeta }) => {
         replaceDocument(newMeta, newSections)
         setBinderOpen(false)
      })
   }, [replaceDocument])

   // Meta
   const handleMetaChange = useCallback((patch: Partial<DocMeta>) => {
      setMeta(currentMeta => ({ ...currentMeta, ...patch }))
   }, [])

   // Load state from JSON (restoring its saved theme + accent). Opening lands in the editor.
   const handleLoad = useCallback((state: DocState, presentation: DocPresentation) => {
      replaceDocument(state.meta, state.sections, presentation)
      setBinderOpen(false)
   }, [replaceDocument])

   // ===================================
   //  Header: New + standalone binder toggle
   // ===================================

   // New from the header: in binder mode create a doc and exit the binder; in document mode
   // replace the in-editor document (the confirm lives in the header).
   const handleHeaderNew = useCallback(() => {
      if (binderOpen) handleNewDocumentFromBinder()
      else handleNewDocument()
   }, [binderOpen, handleNewDocumentFromBinder, handleNewDocument])

   // Close the binder back to the editor. Document mode must always have a document, so if none is
   // open (currentDocumentId null = only the pristine blank default was showing), spawn a fresh one.
   const handleCloseBinder = useCallback(() => {
      if (currentDocumentIdRef.current === null) handleNewDocument()
      setBinderOpen(false)
   }, [handleNewDocument])

   // Standalone Open/Close Binder affordance in the header.
   const handleToggleBinder = useCallback(() => {
      if (binderOpen) handleCloseBinder()
      else void handleOpenBinder()
   }, [binderOpen, handleCloseBinder, handleOpenBinder])

   // Mutations, extracted into focused hooks
   const sectionMutations   = useSectionMutations(setSections, t)
   const blockMutations     = useBlockMutations(setSections, t)
   const containerMutations = useContainerMutations(setSections, t)

   return (
      <LangProvider lang={lang} setLang={setLang}>
         {/* Shared app menu bar, mounted in both modes; context-aware via mode. */}
         <HeaderMenuBar
            mode={binderOpen ? 'binder' : 'document'}
            meta={meta}
            sections={sections}
            theme={theme}
            docTheme={docTheme}
            docAccent={docAccent}
            previewMode={mode}
            paneLayout={paneLayout}
            saveStatus={saveStatus}
            onLoad={handleLoad}
            onToggleTheme={toggleTheme}
            onSetMode={handleSetMode}
            onTogglePanel={togglePanel}
            onManualSave={handleManualSave}
            onNew={handleHeaderNew}
            onToggleBinder={handleToggleBinder}
            onImportMarkdownFile={handleImportMarkdown}
            onImportMintdownFile={handleImportMintdown}
            onDocThemeChange={setDocTheme}
            onDocAccentChange={setDocAccent}
         />

         {binderOpen ? (
            <Binder
               currentDocumentId={currentDocumentId}
               initialFolder={binderInitialFolder}
               onOpenDocument={handleOpenDocument}
               onNewDocument={handleNewDocumentFromBinder}
               onDocumentDeleted={handleDocumentDeleted}
            />
         ) : (
          <>
            <DocumentTitleBar meta={meta} onMetaChange={handleMetaChange} />

            <DocumentMutationsContext.Provider value={{
               updateBlock:       blockMutations.updateBlock,
               addBlock:          blockMutations.addBlock,
               insertBlockAt:     blockMutations.insertBlockAt,
               removeBlock:       blockMutations.removeBlk,
               duplicateBlock:    blockMutations.duplicateBlock,
               reorderBlocks:     blockMutations.reorderBlocks,
               addListItem:       blockMutations.addListItem,
               removeLastItem:    blockMutations.removeLastItem,
               addTableRow:       blockMutations.addTableRow,
               removeLastRow:     blockMutations.removeLastRow,
               addTableCol:       blockMutations.addTableCol,
               insertTableRowAt:  blockMutations.insertTableRowAt,
               deleteTableRowAt:  blockMutations.deleteTableRowAt,
               insertTableColAt:  blockMutations.insertTableColAt,
               deleteTableColAt:  blockMutations.deleteTableColAt,
               moveListItemUp:              blockMutations.moveListItemUp,
               moveListItemDown:            blockMutations.moveListItemDown,
               indentListItem:              blockMutations.indentListItem,
               unindentListItem:            blockMutations.unindentListItem,
               removeListItem:              blockMutations.removeListItem,
               insertListItemAfter:         blockMutations.insertListItemAfter,
               updateListItemRichText:      blockMutations.updateListItemRichText,
               reorderListItemsUnderParent: blockMutations.reorderListItemsUnderParent,
               toggleChecklistItem:         blockMutations.toggleChecklistItem,
               containerMutations,
               updateTitle:       sectionMutations.updateSecTitle,
               removeSection:     sectionMutations.removeSec,
               reorderSections:   sectionMutations.reorderSections,
            }}>
               <div className="flex flex-1 min-h-0 overflow-hidden">
                  <Panel
                     open={panelOpen}
                     onToggle={() => setPanelOpen(current => !current)}
                     dockSide={panelDockSide}
                     onToggleDockSide={handleTogglePanelDockSide}
                     sections={sections}
                     onAddSection={sectionMutations.addSection}
                     onToggleSec={sectionMutations.toggleSec}
                     onDuplicateSec={sectionMutations.duplicateSec}
                     onRemoveSec={sectionMutations.removeSec}
                     onReorderSections={sectionMutations.reorderSections}
                     onReorderBlocks={blockMutations.reorderBlocks}
                  />

                  <WorkspaceLayout
                     paneLayout={paneLayout}
                     onPaneLayoutChange={setPaneLayout}
                     panels={{
                        wysiwyg: (
                           <WysiwygArea
                              meta={meta}
                              sections={sections}
                              docTheme={docTheme}
                              docAccent={docAccent}
                              onUpdateMeta={handleMetaChange}
                              onAddSection={sectionMutations.addSection}
                              readOnly={mode === 'preview'}
                           />
                        ),
                        mintdown: (
                           <MintdownEditor
                              sections={sections}
                              meta={meta}
                              onCommit={handleMarkdownCommit}
                           />
                        ),
                        markdown: (
                           <MarkdownPanel
                              sections={sections}
                              meta={meta}
                              onCommit={handleMarkdownCommit}
                           />
                        ),
                     }}
                  />
               </div>
            </DocumentMutationsContext.Provider>
          </>
         )}

            {pendingNavigation && (
               <ConfirmDialog
                  title={t.binderUnsavedTitle}
                  message={t.binderUnsavedMessage}
                  confirmLabel={t.binderUnsavedProceed}
                  cancelLabel={t.binderUnsavedCancel}
                  danger
                  onConfirm={handleConfirmNavigation}
                  onCancel={handleCancelNavigation}
               />
            )}

            <ToastContainer />
            <UpdatePrompt />
         </LangProvider>
   )
}

// -- React Imports --
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { mkSection } from './lib/document'
import { translations, type Lang } from './lib/i18n'
import { readAutosave, clearLegacyAutosave } from './lib/autosaveStorage'
import { saveDocument, loadDocument, getDocumentFolderId, duplicateDocument, moveDocument, type LoadedDocument, type DocPresentation } from './lib/binderDocuments'
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
import { SaveAsDialog } from './molecules/SaveAsDialog'
import { ToastContainer } from './atoms/ToastContainer'
import { UpdatePrompt } from './atoms/UpdatePrompt'

// -- Markdown Imports --
import { importMarkdownFile } from './lib/markdown'
import { importMintdownFile } from './lib/mintdown'

// -- Type Imports --
import type { BinderFolderRecord, DocMeta, DocState, Mode, OpenDocument, SaveStatus, Section } from './types'
import { useWorkspaceState } from './hooks/useWorkspaceState'

const EMPTY_META: DocMeta = { title: '', fields: [] }
const CURRENT_DOCUMENT_ID_KEY = 'documinter-current-document-id'   // legacy single-pointer (migrated away)
const OPEN_DOCUMENTS_KEY      = 'documinter-open-documents'        // the open-tab set + active, for reload restore
const DEFAULT_DOC_ACCENT = '#2dcea8'

// Which documents had open tabs last session, in tab order, plus which was active. Only tabs with a
// binder id are listed; pristine never-saved tabs aren't persisted (consistent with autosave).
interface PersistedOpenDocuments {
   documentIds:      string[]
   activeDocumentId: string | null
}

// Read the restore intent from localStorage, migrating the legacy single pointer when the new key is
// absent. Never throws on a malformed value (falls back to nothing-to-restore).
function readPersistedOpenDocuments(): PersistedOpenDocuments {
   try {
      const raw = localStorage.getItem(OPEN_DOCUMENTS_KEY)
      if (raw) {
         const parsed = JSON.parse(raw)
         if (parsed && Array.isArray(parsed.documentIds)) {
            return {
               documentIds:      parsed.documentIds.filter((id: unknown): id is string => typeof id === 'string'),
               activeDocumentId: typeof parsed.activeDocumentId === 'string' ? parsed.activeDocumentId : null,
            }
         }
      }
   } catch { /* malformed → fall through to migration / empty */ }
   const legacyPointer = localStorage.getItem(CURRENT_DOCUMENT_ID_KEY)
   if (legacyPointer) return { documentIds: [legacyPointer], activeDocumentId: legacyPointer }
   return { documentIds: [], activeDocumentId: null }
}

// A fresh blank tab: new identity, no binder record yet, clean. Shared by the initial mount state,
// New (add-a-tab), the binder's New (which seeds the folder it lands in), and the last-tab-close
// respawn (the always-have-a-document invariant).
function createBlankDocument(sectionTitle: string, pendingFolderId: string | null = null): OpenDocument {
   return {
      tabKey:    crypto.randomUUID(),
      meta:      EMPTY_META,
      sections:  [mkSection(sectionTitle)],
      docTheme:  'light',
      docAccent: DEFAULT_DOC_ACCENT,
      documentId:            null,
      saveStatus:            'clean',
      pendingNewDocFolderId: pendingFolderId,
   }
}

// Build an open tab from a stored document (fresh tabKey, clean — it's in sync with storage).
// Shared by reload restore and open-from-binder.
function buildTabFromLoaded(loaded: LoadedDocument, documentId: string | null): OpenDocument {
   return {
      tabKey:    crypto.randomUUID(),
      meta:      loaded.meta,
      sections:  loaded.sections,
      docTheme:  loaded.docTheme,
      docAccent: loaded.docAccent,
      documentId,
      saveStatus:            'clean',
      pendingNewDocFolderId: null,
   }
}

export default function App() {
   // Document state starts blank; the real document is hydrated asynchronously from
   // IndexedDB on mount (see the hydration effect below). Documents live as a list with one active
   // tab. This phase keeps exactly one entry, so the app behaves identically to the single-document
   // era; the tab strip + multi-tab opening arrive in later phases.
   const [openDocuments, setOpenDocuments] = useState<OpenDocument[]>(() => {
      const initialLang = (localStorage.getItem('documinter-lang') as Lang) ?? 'en'
      return [createBlankDocument(translations[initialLang].defaultSectionTitle)]
   })
   const [activeTabKey, setActiveTabKey] = useState<string>(() => openDocuments[0].tabKey)
   // Mirror of activeTabKey for the stable setter levers + async paths that must target the current
   // tab without re-subscribing.
   const activeTabKeyRef = useRef(activeTabKey)
   useEffect(() => { activeTabKeyRef.current = activeTabKey }, [activeTabKey])
   // Mirror of the whole list for async paths (the debounced save's promotion, persistNow) that must
   // read a tab's latest identity/status by tabKey without re-subscribing.
   const openDocumentsRef = useRef(openDocuments)
   useEffect(() => { openDocumentsRef.current = openDocuments }, [openDocuments])

   // The active document and the content + identity the render + effects below read, derived from the
   // list. documentId / saveStatus are per-tab (phase 2); the active tab's values drive the UI.
   const activeDocument = openDocuments.find(document => document.tabKey === activeTabKey)!
   const { meta, sections, docTheme, docAccent, documentId, saveStatus } = activeDocument

   // Binder records that currently have an open tab (for the open-vs-active card highlight).
   const openDocumentIds = openDocuments
      .map(document => document.documentId)
      .filter((id): id is string => id !== null)

   // The setter lever (TABS_STUDY §3.2): hand the mutation hooks a Section[] setter that updates only
   // the active tab. The hooks are unchanged — they still receive a Dispatch<SetStateAction<Section[]>>.
   const setActiveSections = useCallback((updater: SetStateAction<Section[]>) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current
            ? { ...document, sections: typeof updater === 'function' ? updater(document.sections) : updater }
            : document))
   }, [])
   const setActiveDocTheme = useCallback((nextTheme: 'light' | 'dark') => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current ? { ...document, docTheme: nextTheme } : document))
   }, [])
   const setActiveDocAccent = useCallback((nextAccent: string) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current ? { ...document, docAccent: nextAccent } : document))
   }, [])
   // Per-tab save-status setter. Status lives on each OpenDocument (phase 2), so the autosave cycle,
   // persistNow, and the fade timer target a specific tab by key — the active tab for live edits, or
   // the captured originating tab for an async save's resolution (TABS_STUDY §4.2).
   const setTabSaveStatus = useCallback((tabKey: string, status: SaveStatus) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === tabKey && document.saveStatus !== status
            ? { ...document, saveStatus: status }
            : document))
   }, [])
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

   // ######################################
   // # SAVE STATUS + AUTOSAVE (INDEXEDDB) #
   // ######################################

   const { showToast } = useToast()

   // saveStatus, the document id, and the pending-new-doc folder are per-tab now (on OpenDocument).
   // skipNextAutosaveRef + autosaveTimerRef stay single refs this phase: only the active tab is
   // editable and only it debounces a save, so one skip flag + one timer suffice until phase 3 adds
   // tab switching (which will need flush-on-switch).
   const skipNextAutosaveRef  = useRef(true)   // skip the initial mount cycle (no spurious save)
   const hasHydratedRef       = useRef(false)
   const autosaveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
   // Captured during the first render so the persistence effect can't overwrite the stored set
   // before the hydration effect reads it.
   const initialRestoreRef    = useRef<PersistedOpenDocuments>(readPersistedOpenDocuments())

   // Keep a stable, always-current notifier so the autosave effect doesn't depend on t/showToast.
   const notifySaveFailedRef  = useRef<() => void>(() => {})
   useEffect(() => {
      notifySaveFailedRef.current = () => showToast(t.saveFailed, { type: 'error' })
   })

   // Replace the open-tab set with a restored set (reload boot / legacy migration), activating the
   // tab whose documentId matches activeDocumentId, else the first. A programmatic replacement, so
   // it skips the autosave cycle it triggers (no spurious save, active tab reads clean). Callers
   // pass a non-empty restoredTabs.
   const applyRestoredTabs = useCallback((restoredTabs: OpenDocument[], activeDocumentId: string | null) => {
      skipNextAutosaveRef.current = true
      const activeTab = restoredTabs.find(tab => tab.documentId === activeDocumentId) ?? restoredTabs[0]
      setOpenDocuments(restoredTabs)
      setActiveTabKey(activeTab.tabKey)
   }, [])

   // Replace the in-editor document with fresh content that is NOT yet a binder record
   // (new / JSON load / file import). Resets currentDocumentId to null so the next edit
   // creates a new IndexedDB record rather than overwriting the previously-open document,
   // and skips the autosave cycle this replacement triggers. An optional presentation restores
   // the document's saved theme + accent (e.g. from a JSON backup); omit to keep the current ones.
   const replaceDocument = useCallback((nextMeta: DocMeta, nextSections: Section[], presentation?: DocPresentation, pendingFolderId?: string | null) => {
      skipNextAutosaveRef.current = true
      const newTabKey = crypto.randomUUID()
      setOpenDocuments(documents => {
         // Without a presentation, carry the active tab's current theme/accent forward (matches the
         // old behavior of leaving setDocTheme/setDocAccent untouched on a plain new/import/load).
         const current = documents.find(document => document.tabKey === activeTabKeyRef.current)
         return [{
            tabKey:    newTabKey,
            meta:      nextMeta,
            sections:  nextSections,
            docTheme:  presentation ? presentation.docTheme  : current?.docTheme  ?? 'light',
            docAccent: presentation ? presentation.docAccent : current?.docAccent ?? DEFAULT_DOC_ACCENT,
            documentId:            null,   // not yet a binder record; the first edit forks a fresh one
            saveStatus:            'clean',
            pendingNewDocFolderId: pendingFolderId ?? null,
         }]
      })
      setActiveTabKey(newTabKey)
   }, [])

   // One-time async hydration: restore every open tab from last session (eager — each document is
   // loaded in full), or migrate a legacy localStorage autosave. The blank default shows until this
   // resolves; if nothing survives it stays (the always-have-a-document invariant).
   useEffect(() => {
      let cancelled = false
      async function hydrate() {
         const restore = initialRestoreRef.current
         const legacy  = readAutosave()
         try {
            if (restore.documentIds.length === 0 && legacy) {
               // Migrate legacy autosave → IndexedDB. Keep the old key until the write confirms.
               const migratedId = await saveDocument(
                  { meta: legacy.meta, sections: legacy.sections },
                  { docTheme: legacy.docTheme, docAccent: legacy.docAccent },
               )
               clearLegacyAutosave()
               if (cancelled) return
               applyRestoredTabs([buildTabFromLoaded({ ...legacy }, migratedId)], migratedId)
               return
            }
            // Load each persisted id in tab order, skipping any deleted since last session.
            const restoredTabs: OpenDocument[] = []
            for (const persistedId of restore.documentIds) {
               const loaded = await loadDocument(persistedId)
               if (cancelled) return
               if (loaded) restoredTabs.push(buildTabFromLoaded(loaded, persistedId))
            }
            if (restoredTabs.length > 0) applyRestoredTabs(restoredTabs, restore.activeDocumentId)
            // else: no surviving tabs → keep the initial blank.
         } catch {
            // IndexedDB unavailable / read failed. If we have legacy data, keep showing it in-memory
            // as an unsaved document (legacy key left intact for a future retry).
            if (!cancelled && legacy && restore.documentIds.length === 0) {
               applyRestoredTabs([buildTabFromLoaded({ ...legacy }, null)], null)
            }
         } finally {
            if (!cancelled) hasHydratedRef.current = true
         }
      }
      hydrate()
      return () => { cancelled = true }
   }, [applyRestoredTabs])

   // Persist the open-tab set + active tab (only after hydration, so the initial blank can't
   // overwrite the stored set before it has been read). Tabs without a binder id aren't listed;
   // once autosave assigns one this re-runs and includes them. Also retires the legacy pointer key.
   useEffect(() => {
      if (!hasHydratedRef.current) return
      const documentIds = openDocuments
         .map(openDocument => openDocument.documentId)
         .filter((id): id is string => id !== null)
      localStorage.setItem(OPEN_DOCUMENTS_KEY, JSON.stringify({ documentIds, activeDocumentId: documentId }))
      localStorage.removeItem(CURRENT_DOCUMENT_ID_KEY)
   }, [openDocuments, documentId])

   // Autosave on any document change, debounced 1.5s, persisted to IndexedDB.
   useEffect(() => {
      if (skipNextAutosaveRef.current) {
         skipNextAutosaveRef.current = false
         // A skipped cycle is a programmatic load/replace/hydration — the active tab is already in
         // sync with storage, so force it clean. Without this, a transient 'dirty' set for the
         // pre-hydration blank (e.g. by StrictMode's double-invoked mount cycle) is never cleared,
         // sticking the pill at "Unsaved changes" after a reload with no save actually pending.
         setTabSaveStatus(activeTabKeyRef.current, 'clean')
         return
      }
      // Capture the tab that originated this edit. The resolved save promotes/marks THIS tab by key,
      // never whatever happens to be active when the promise settles (TABS_STUDY §4.2).
      const originatingTabKey = activeTabKeyRef.current
      setTabSaveStatus(originatingTabKey, 'dirty')
      autosaveTimerRef.current = setTimeout(() => {
         // Read the originating tab's latest identity at fire time (a prior cycle may have promoted it).
         const originatingTab = openDocumentsRef.current.find(document => document.tabKey === originatingTabKey)
         setTabSaveStatus(originatingTabKey, 'saving')
         saveDocument(
            { meta, sections },
            { docTheme, docAccent },
            originatingTab?.documentId ?? undefined,
            originatingTab?.pendingNewDocFolderId ?? undefined,
         ).then(savedId => {
            setOpenDocuments(documents => documents.map(document =>
               document.tabKey === originatingTabKey
                  ? { ...document, documentId: document.documentId ?? savedId, saveStatus: 'saved', pendingNewDocFolderId: null }
                  : document))
         }).catch(error => {
            console.error('[autosave] saveDocument failed:', error)
            setTabSaveStatus(originatingTabKey, 'dirty')
            notifySaveFailedRef.current()
         })
      }, 1500)
      return () => {
         if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current)
      }
   }, [meta, sections, docTheme, docAccent, setTabSaveStatus])

   // Fade the "Saved" indicator out after 2.5 s
   useEffect(() => {
      if (saveStatus !== 'saved') return
      const clearTimer = setTimeout(() => setTabSaveStatus(activeTabKeyRef.current, 'clean'), 2500)
      return () => clearTimeout(clearTimer)
   }, [saveStatus, setTabSaveStatus])

   // Browser tab title, asterisk while dirty
   useEffect(() => {
      const baseTitle = meta.title ? `${meta.title}, Documinter` : 'Documinter'
      document.title  = saveStatus !== 'clean' ? `* ${baseTitle}` : baseTitle
   }, [saveStatus, meta.title])

   // Cancel any pending autosave and write the active document immediately. Awaitable so callers
   // (manual save, opening the binder, Save As) can flush before continuing. Returns the binder id
   // the active tab was saved under (newly assigned if it had none), or null on failure — callers
   // that need the id can use it directly rather than re-reading openDocumentsRef, whose promotion
   // hasn't synced back to the ref yet at the await boundary.
   const persistNow = useCallback(async (): Promise<string | null> => {
      if (autosaveTimerRef.current !== null) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
      const flushTabKey = activeTabKeyRef.current
      const flushTab = openDocumentsRef.current.find(document => document.tabKey === flushTabKey)
      if (!flushTab) return null
      setTabSaveStatus(flushTabKey, 'saving')
      try {
         const savedId = await saveDocument(
            { meta: flushTab.meta, sections: flushTab.sections },
            { docTheme: flushTab.docTheme, docAccent: flushTab.docAccent },
            flushTab.documentId ?? undefined,
            flushTab.pendingNewDocFolderId ?? undefined,
         )
         setOpenDocuments(documents => documents.map(document =>
            document.tabKey === flushTabKey
               ? { ...document, documentId: document.documentId ?? savedId, saveStatus: 'saved', pendingNewDocFolderId: null }
               : document))
         return savedId
      } catch (error) {
         console.error('[persistNow] saveDocument failed:', error)
         setTabSaveStatus(flushTabKey, 'dirty')
         showToast(t.saveFailed, { type: 'error' })
         return null
      }
   }, [showToast, t, setTabSaveStatus])

   // Manual save
   const handleManualSave = useCallback(() => { void persistNow() }, [persistNow])

   // ###############
   // # TAB SYSTEM  #
   // ###############

   // The single switch primitive every activation routes through.
   const activateTab = useCallback(async (tabKey: string) => {
      if (tabKey === activeTabKeyRef.current) return   // already active, nothing to do
      // Flush-on-switch: drain the outgoing tab's pending save before leaving it, so a debounced
      // write can't be dropped or land against the wrong tab. persistNow flushes the active tab,
      // which is still the outgoing one at this point.
      const outgoing = openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)
      if (outgoing && (outgoing.saveStatus === 'dirty' || outgoing.saveStatus === 'saving')) {
         await persistNow()
      }
      // Skip-on-activation: the incoming tab's content becoming active must not be read as an edit
      // (same mechanism as a programmatic replace), so the autosave cycle skips + clears it clean.
      skipNextAutosaveRef.current = true
      setActiveTabKey(tabKey)
   }, [persistNow])

   // New = add a tab. Appends a fresh blank document and activates it (no longer replaces the active
   // tab, so nothing is discarded and no confirm is needed).
   const addNewTab = useCallback(() => {
      const newDocument = createBlankDocument(t.defaultSectionTitle)
      setOpenDocuments(documents => [...documents, newDocument])
      void activateTab(newDocument.tabKey)
   }, [t, activateTab])

   // Remove a tab from the list (after any unsaved-changes guard). If it was active, activate a
   // neighbor (right, else left). If it was the last tab, respawn a blank — openDocuments is never
   // empty (the always-have-a-document invariant now lives on the tab list).
   const performCloseTab = useCallback((tabKey: string) => {
      const documentsBefore = openDocumentsRef.current
      const index = documentsBefore.findIndex(document => document.tabKey === tabKey)
      if (index === -1) return
      const wasActive = activeTabKeyRef.current === tabKey
      const remaining = documentsBefore.filter(document => document.tabKey !== tabKey)

      // Update the refs synchronously, not just via the post-render effects, so a batch of closes
      // (a recursive folder delete removing several open docs) chains off fresh state instead of
      // each call clobbering the previous one with a stale snapshot.
      if (remaining.length === 0) {
         const blankDocument = createBlankDocument(t.defaultSectionTitle)
         skipNextAutosaveRef.current = true
         openDocumentsRef.current = [blankDocument]
         activeTabKeyRef.current  = blankDocument.tabKey
         setOpenDocuments([blankDocument])
         setActiveTabKey(blankDocument.tabKey)
         return
      }

      openDocumentsRef.current = remaining
      setOpenDocuments(remaining)
      if (wasActive) {
         const neighbor = remaining[index] ?? remaining[index - 1]   // right neighbor, else left
         skipNextAutosaveRef.current = true
         activeTabKeyRef.current = neighbor.tabKey
         setActiveTabKey(neighbor.tabKey)
      }
   }, [t])

   // Reorder the tab strip. Only the array order changes — the active tab's content + identity are
   // untouched (activeTabKey is unchanged), so this triggers no autosave and no activation.
   const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
      setOpenDocuments(documents => arrayMove(documents, fromIndex, toIndex))
   }, [])

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
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)
      const openId = activeTab?.documentId ?? null
      if (openId) {
         try {
            const folderId = await getDocumentFolderId(openId)
            if (folderId && folderId !== '0') folder = (await getFolder(folderId)) ?? null
         } catch { /* fall back to root */ }
      }
      setBinderInitialFolder(folder)
      setBinderOpen(true)
   }, [saveStatus, persistNow])

   // Pending action awaiting unsaved-changes confirmation: a dirty tab close (discard-and-close).
   // Opening a doc / creating one now add-or-focus a tab, discarding nothing, so they need no guard.
   const [pendingNavigation, setPendingNavigation] = useState<{ kind: 'close-tab'; tabKey: string } | null>(null)

   // Close a tab. A dirty/saving tab routes through the unsaved-changes guard (discard-and-close);
   // a clean tab closes immediately.
   const closeTab = useCallback((tabKey: string) => {
      const target = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (!target) return
      if (target.saveStatus === 'dirty' || target.saveStatus === 'saving') {
         setPendingNavigation({ kind: 'close-tab', tabKey })
         return
      }
      performCloseTab(tabKey)
   }, [performCloseTab])

   // Open a document from the binder: focus its tab if already open, otherwise load it into a new
   // tab. Opening discards nothing (it never replaces another tab), so there is no unsaved-changes
   // guard on this path. Closes the binder either way.
   const handleOpenDocument = useCallback(async (id: string) => {
      const existing = openDocumentsRef.current.find(document => document.documentId === id)
      if (existing) {
         void activateTab(existing.tabKey)
         setBinderOpen(false)
         showToast(t.binderDocumentOpened, { type: 'success' })
         return
      }
      try {
         const loaded = await loadDocument(id)
         if (!loaded) { showToast(t.binderOpenFailed, { type: 'error' }); return }
         const newTab = buildTabFromLoaded(loaded, id)
         setOpenDocuments(documents => [...documents, newTab])
         void activateTab(newTab.tabKey)
         setBinderOpen(false)
         showToast(t.binderDocumentOpened, { type: 'success' })
      } catch {
         // Leave the binder open; nothing was added.
         showToast(t.binderOpenFailed, { type: 'error' })
      }
   }, [activateTab, showToast, t])

   // New from the binder: add a fresh blank tab (carrying the folder it should land in on first
   // save), activate it, and close the binder. No replace, no discard.
   const handleNewDocumentFromBinder = useCallback((folderId?: string) => {
      const newDocument = createBlankDocument(t.defaultSectionTitle, folderId ?? null)
      setOpenDocuments(documents => [...documents, newDocument])
      void activateTab(newDocument.tabKey)
      setBinderOpen(false)
      showToast(t.binderDocumentCreated, { type: 'success' })
   }, [t, activateTab, showToast])

   // Duplicate a tab's document via the binder and open the copy as a new tab. The copy is made from
   // the binder record, so the source must be persisted first: the active tab may hold unsaved edits
   // or (if pristine) have no record yet — persist it and use persistNow's returned id (its promotion
   // hasn't synced to openDocumentsRef at this await boundary). A non-active pristine tab has nothing
   // stored to copy, so it no-ops.
   const handleDuplicateTab = useCallback(async (sourceTabKey: string) => {
      const sourceTab = openDocumentsRef.current.find(document => document.tabKey === sourceTabKey)
      if (!sourceTab) return
      const sourceDocumentId = sourceTab.tabKey === activeTabKeyRef.current
         ? ((sourceTab.saveStatus !== 'clean' || sourceTab.documentId === null) ? await persistNow() : sourceTab.documentId)
         : sourceTab.documentId
      if (!sourceDocumentId) return
      const duplicateId = await duplicateDocument(sourceDocumentId)
      await handleOpenDocument(duplicateId)
   }, [persistNow, handleOpenDocument])

   // Save As opens a dialog to name the copy + pick a destination folder. The fork happens on
   // confirm (handleConfirmSaveAs); cancel does nothing. The picker opens at the document's current
   // folder (root for an unsaved doc), and the name pre-fills with the current title (verbatim).
   const [saveAsDialog, setSaveAsDialog] = useState<{ sourceTabKey: string; initialFolder: BinderFolderRecord | null } | null>(null)

   const handleSaveAs = useCallback(async () => {
      const sourceTabKey = activeTabKeyRef.current
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === sourceTabKey)
      if (!activeTab) return
      let initialFolder: BinderFolderRecord | null = null
      if (activeTab.documentId) {
         try {
            const folderId = await getDocumentFolderId(activeTab.documentId)
            if (folderId && folderId !== '0') initialFolder = (await getFolder(folderId)) ?? null
         } catch { /* fall back to root */ }
      }
      setSaveAsDialog({ sourceTabKey, initialFolder })
   }, [])

   // Fork & switch: persist the active document so the ORIGINAL is a frozen binder record, duplicate
   // it (the copy keeps the document's own title verbatim), file the copy into the chosen folder,
   // then re-point the active tab to the copy. Further edits save to the copy; the original is left
   // untouched. The title is never changed here — it's part of the document, renamed in the tab.
   const handleConfirmSaveAs = useCallback(async (destinationFolderId: string) => {
      const dialog = saveAsDialog
      setSaveAsDialog(null)
      if (!dialog) return
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === dialog.sourceTabKey)
      if (!activeTab) return
      // Use persistNow's returned id for the freshly-persisted/promoted case: its setOpenDocuments
      // hasn't synced to openDocumentsRef yet at this await boundary, so re-reading the ref would
      // see a stale null and skip the fork.
      const sourceDocumentId = (activeTab.saveStatus !== 'clean' || activeTab.documentId === null)
         ? await persistNow()
         : activeTab.documentId
      if (!sourceDocumentId) return
      const copyId = await duplicateDocument(sourceDocumentId)
      await moveDocument(copyId, destinationFolderId)
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === dialog.sourceTabKey
            ? { ...document, documentId: copyId }
            : document))
      showToast(t.savedAsCopy, { type: 'success' })
   }, [saveAsDialog, persistNow, showToast, t])

   const handleCancelSaveAs = useCallback(() => setSaveAsDialog(null), [])

   // Confirm the pending action (discard-and-close the dirty tab).
   const handleConfirmNavigation = useCallback(() => {
      const pending = pendingNavigation
      setPendingNavigation(null)
      if (pending?.kind === 'close-tab') performCloseTab(pending.tabKey)
   }, [pendingNavigation, performCloseTab])

   const handleCancelNavigation = useCallback(() => setPendingNavigation(null), [])

   // A document was deleted from the binder: close its tab if one is open (the close path's
   // neighbor-activate / spawn-blank-if-last invariant applies). No-op if no tab has it.
   const handleDocumentDeleted = useCallback((id: string) => {
      const openTab = openDocumentsRef.current.find(document => document.documentId === id)
      if (openTab) closeTab(openTab.tabKey)
   }, [closeTab])

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
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current
            ? { ...document, sections: newSections, meta: newMeta }
            : document))
   }, [])

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
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current
            ? { ...document, meta: { ...document.meta, ...patch } }
            : document))
   }, [])

   // Load state from JSON (restoring its saved theme + accent). Opening lands in the editor.
   const handleLoad = useCallback((state: DocState, presentation: DocPresentation) => {
      replaceDocument(state.meta, state.sections, presentation)
      setBinderOpen(false)
   }, [replaceDocument])

   // ===================================
   //  Header: New + standalone binder toggle
   // ===================================

   // New from the header: in binder mode create a doc and exit the binder; in document mode add a
   // new tab (nothing is discarded, so no confirm).
   const handleHeaderNew = useCallback(() => {
      if (binderOpen) handleNewDocumentFromBinder()
      else addNewTab()
   }, [binderOpen, handleNewDocumentFromBinder, addNewTab])

   // Close the binder back to the editor. The always-have-a-document invariant now lives on the tab
   // list (openDocuments is never empty), so there is always a tab to return to — just close.
   const handleCloseBinder = useCallback(() => {
      setBinderOpen(false)
   }, [])

   // Standalone Open/Close Binder affordance in the header.
   const handleToggleBinder = useCallback(() => {
      if (binderOpen) handleCloseBinder()
      else void handleOpenBinder()
   }, [binderOpen, handleCloseBinder, handleOpenBinder])

   // Mutations, extracted into focused hooks
   const sectionMutations   = useSectionMutations(setActiveSections, t)
   const blockMutations     = useBlockMutations(setActiveSections, t)
   const containerMutations = useContainerMutations(setActiveSections, t)

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
            onSaveAs={handleSaveAs}
            onNew={handleHeaderNew}
            onToggleBinder={handleToggleBinder}
            onImportMarkdownFile={handleImportMarkdown}
            onImportMintdownFile={handleImportMintdown}
            onDocThemeChange={setActiveDocTheme}
            onDocAccentChange={setActiveDocAccent}
         />

         {binderOpen ? (
            <Binder
               openDocumentIds={openDocumentIds}
               activeDocumentId={documentId}
               initialFolder={binderInitialFolder}
               onOpenDocument={handleOpenDocument}
               onNewDocument={handleNewDocumentFromBinder}
               onDocumentDeleted={handleDocumentDeleted}
            />
         ) : (
          <>
            <DocumentTitleBar
               openDocuments={openDocuments}
               activeTabKey={activeTabKey}
               onActivateTab={activateTab}
               onCloseTab={closeTab}
               onReorderTabs={reorderTabs}
               onDuplicateTab={handleDuplicateTab}
               onMetaChange={handleMetaChange}
            />

            <DocumentMutationsContext.Provider value={{
               updateBlock:       blockMutations.updateBlock,
               addBlock:          blockMutations.addBlock,
               insertBlockAt:     blockMutations.insertBlockAt,
               insertBlockAfter:  blockMutations.insertBlockAfter,
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
                              activeTabKey={activeTabKey}
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

            {saveAsDialog && (
               <SaveAsDialog
                  initialFolder={saveAsDialog.initialFolder}
                  onConfirm={handleConfirmSaveAs}
                  onCancel={handleCancelSaveAs}
               />
            )}

            <ToastContainer />
            <UpdatePrompt />
         </LangProvider>
   )
}

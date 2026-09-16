// -- React Imports --
import { useCallback, useEffect, useRef, useState, type SetStateAction, type ReactNode } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { mkSection, isEmptyDocument } from './lib/document'
import { translations, type Lang } from './lib/i18n'
import { readAutosave, clearLegacyAutosave } from './lib/autosaveStorage'
import { NameTakenError } from './lib/filesystem/filesystemBackend'
import { parseMint } from './lib/filesystem/mintFile'
import { classifyDiskChange } from './lib/native/diskConflict'
import { binderRelativePath, readLaunchFileText } from './lib/native/launchFile'
import type { LoadedDocument, DocPresentation } from './lib/documentRecord'
import type { TinImportSummary } from './lib/tinMapping'
import { parseTin, gunzipToString, downloadTin, tinDownloadName, type TinFile } from './lib/tinFile'
import { instantiateTemplate, captureTemplate, applyTemplateChrome, type DocumentTemplate } from './lib/documentTemplate'
import {
   emptyHistory, recordEdit, applyUndo, applyRedo, canUndo, canRedo,
   COALESCE_MS, HISTORY_DEPTH_CAP,
   type DocSnapshot, type UndoHistory,
} from './lib/undoHistory'

// -- Hook Imports --
import { useSectionMutations } from './hooks/useSectionMutations'
import { useBlockMutations } from './hooks/useBlockMutations'
import { useContainerMutations } from './hooks/useContainerMutations'

// -- Context Imports --
import { DocumentMutationsContext } from './contexts/DocumentMutationsContext'
import { LangProvider } from './contexts/LangContext'
import { useToast } from './contexts/ToastContext'
import { useBinderBackend } from './contexts/BinderBackendContext'
import { useNativeBinderControls, type PendingLaunchOpen } from './contexts/NativeBinderContext'

// -- Component Imports --
import { HeaderMenuBar } from './organisms/HeaderMenuBar'
import { DocumentTitleBar } from './organisms/DocumentTitleBar'
import { DockedWorkspace } from './organisms/DockedWorkspace'
import { StructurePanelBody } from './organisms/StructurePanelBody'
import { PagesPanelBody } from './organisms/PagesPanelBody'
import { AnchorsPanelBody } from './organisms/AnchorsPanelBody'
import { FormatPanelBody } from './organisms/FormatPanelBody'
import { PresentationPanelBody } from './organisms/PresentationPanelBody'
import { NavPanelBody } from './organisms/NavPanelBody'
import { TemplatesPanelBody } from './organisms/TemplatesPanelBody'
import { useDockState } from './hooks/useDockState'
import { usePagesPanelData } from './hooks/usePagesPanelData'
import { printDocument, computeDocumentPages } from './lib/exportLayout'
import { paginateDocument, EMPTY_HEIGHTS, type DocumentPages, type MeasuredHeights } from './lib/pageLayout'
import { applicablePanels, PANEL_REGISTRY, type PanelContext } from './lib/panelRegistry'
import { isPanelVisible } from './lib/dockPolicy'
import type { DockPanelToggle } from './molecules/ViewMenu'
import type { PanelId } from './lib/dockLayout'
import { WysiwygArea } from './organisms/WysiwygArea'
import { MarkdownPanel } from './organisms/MarkdownPanel'
import { WorkspaceLayout } from './organisms/WorkspaceLayout'
import { Binder } from './organisms/Binder'
import { ConfirmDialog } from './molecules/ConfirmDialog'
import { DiskConflictDialog } from './molecules/DiskConflictDialog'
import { TinImportDialog } from './molecules/TinImportDialog'
import { SaveAsDialog } from './molecules/SaveAsDialog'
import { PromptDialog } from './molecules/PromptDialog'
import { NewDocumentDialog, type NewDocumentChoice } from './molecules/NewDocumentDialog'
import { ToastContainer } from './atoms/ToastContainer'

// -- Markdown Imports --
import { importMarkdownFile } from './lib/markdown'

// -- Platform Imports --
import { openBinaryFile } from './lib/platform/fileTransfer'

// -- Type Imports --
import type { BinderDocumentRecord, BinderFolderRecord, DocMeta, DocState, Mode, OpenDocument, SaveStatus, Section } from './types'
import type { DocPresentationExtras } from './lib/presentation'
import type { DocFormat } from './lib/format'
import { useWorkspaceState } from './hooks/useWorkspaceState'

const EMPTY_META: DocMeta = { title: '', fields: [] }
// Debounce before re-running the offscreen height measure, so a burst of keystrokes measures once on the
// pause. The canvas paginates synchronously from cached heights every render; only the heights settle later.
const PAGINATION_DEBOUNCE_MS = 180
const CURRENT_DOCUMENT_ID_KEY = 'documinter-current-document-id'   // legacy single-pointer (migrated away)
const OPEN_DOCUMENTS_KEY      = 'documinter-open-documents'        // the open-tab set + active, for reload restore
const DEFAULT_DOC_ACCENT = '#2dcea8'

// Empty layout for before the first measure and non-paged documents. paginateDocument with EMPTY_HEIGHTS
// yields the forced-break-only placeholder (zero heights never auto-break), so nothing overflows until the
// heights land.
const EMPTY_DOCUMENT_PAGES: DocumentPages = { pages: [], tooTallPageIds: new Set(), heights: EMPTY_HEIGHTS }

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
   } catch { /* malformed, fall through to migration / empty */ }
   const legacyPointer = localStorage.getItem(CURRENT_DOCUMENT_ID_KEY)
   if (legacyPointer) return { documentIds: [legacyPointer], activeDocumentId: legacyPointer }
   return { documentIds: [], activeDocumentId: null }
}

// A fresh blank tab: new identity, no binder record yet, clean. Shared by initial mount, New, the binder's
// New (seeds its folder), and the last-tab-close respawn (the always-have-a-document invariant).
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
      syncedUpdatedAt:       null,
   }
}

// A fresh tab pre-styled from a template: a blank body wearing the template's chrome (meta scaffold with
// fresh field ids, theme, accent, presentation, format). No binder record yet, clean, like createBlankDocument.
function createDocumentFromTemplate(template: DocumentTemplate, sectionTitle: string, pendingFolderId: string | null = null): OpenDocument {
   // Wrap randomUUID so it keeps its `crypto` receiver (an unbound reference throws Illegal invocation).
   const chrome = instantiateTemplate(template, () => crypto.randomUUID())
   return {
      tabKey:    crypto.randomUUID(),
      meta:      chrome.meta,
      sections:  [mkSection(sectionTitle)],
      docTheme:  chrome.docTheme,
      docAccent: chrome.docAccent,
      presentation: chrome.presentation,
      format:       chrome.format,
      documentId:            null,
      saveStatus:            'clean',
      pendingNewDocFolderId: pendingFolderId,
      syncedUpdatedAt:       null,
   }
}

// Build an open tab from a stored document (fresh tabKey, clean, it's in sync with storage).
// Shared by reload restore and open-from-binder.
function buildTabFromLoaded(loaded: LoadedDocument, documentId: string | null): OpenDocument {
   return {
      tabKey:    crypto.randomUUID(),
      meta:      loaded.meta,
      sections:  loaded.sections,
      docTheme:  loaded.docTheme,
      docAccent: loaded.docAccent,
      presentation: loaded.presentation,
      format:       loaded.format,
      documentId,
      saveStatus:            'clean',
      pendingNewDocFolderId: null,
      // A real load carries a non-empty ISO stamp; an empty one (a legacy autosave with no timestamp) means
      // never-synced, so it maps to null.
      syncedUpdatedAt:       loaded.updatedAt || null,
   }
}

export default function App() {
   // The active persistence backend: every save / load / list goes through it, so the storage engine can
   // be swapped without touching the handlers below.
   const backend = useBinderBackend()

   // Native only: the Binder-switcher controls + a pending `.mint` launch to open. Null on the web.
   const nativeBinder = useNativeBinderControls()

   // Starts blank; the real set hydrates asynchronously on mount (see the hydration effect). Documents are
   // a list of open tabs, exactly one active; its content and identity drive the app.
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

   // ############################
   // # UNDO / REDO (PER-TAB)    #
   // ############################

   // Each tab keeps its own session-only history, keyed by tabKey and held OUTSIDE OpenDocument so it
   // can never reach autosave or serialization. Dropped when the tab closes; a new or opened tab
   // starts empty on first edit. History is never restored across a reload.
   const historyRef = useRef<Map<string, UndoHistory>>(new Map())

   // History lives in a ref (never in serializable state), so the toolbar's Undo / Redo enabled state
   // is mirrored into React state and refreshed after every history change and on tab switch.
   const [canUndoActive, setCanUndoActive] = useState(false)
   const [canRedoActive, setCanRedoActive] = useState(false)
   const refreshHistoryFlags = useCallback(() => {
      const history = historyRef.current.get(activeTabKeyRef.current)
      setCanUndoActive(!!history && canUndo(history))
      setCanRedoActive(!!history && canRedo(history))
   }, [])

   // The undoable slice of a tab: the fields the binder persists. References the immutable model, so it is
   // cheap and shares untouched subtrees with the live state.
   const takeSnapshot = useCallback((document: OpenDocument): DocSnapshot => ({
      meta:         document.meta,
      sections:     document.sections,
      docTheme:     document.docTheme,
      docAccent:    document.docAccent,
      presentation: document.presentation,
      format:       document.format,
   }), [])

   // The single choke point every content lever routes through: snapshot the active tab's pre-edit slice
   // into history, then apply the edit. `kind` coalesces a burst of like edits into one entry. produceNext
   // runs inside the functional update so it composes on the freshest state (two levers can commit in one
   // tick: a page op writes sections then format). Bookkeeping writes (save status, tab open/close) never come here.
   const commitActiveEdit = useCallback((kind: string, produceNext: (document: OpenDocument) => OpenDocument) => {
      const tabKey = activeTabKeyRef.current
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (!activeTab) return
      const previous = historyRef.current.get(tabKey) ?? emptyHistory()
      historyRef.current.set(tabKey, recordEdit(previous, takeSnapshot(activeTab), kind, Date.now(), COALESCE_MS, HISTORY_DEPTH_CAP))
      refreshHistoryFlags()
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === tabKey ? produceNext(document) : document))
   }, [takeSnapshot, refreshHistoryFlags])

   // Write a restored slice back onto a tab, leaving its identity + save bookkeeping untouched. Goes
   // through the same setOpenDocuments path as a live edit, so autosave and the pure paged reflow
   // re-derive on their own; it deliberately does NOT record history (undo/redo drive the stacks).
   const applySnapshotToTab = useCallback((tabKey: string, snapshot: DocSnapshot) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === tabKey
            ? { ...document, meta: snapshot.meta, sections: snapshot.sections, docTheme: snapshot.docTheme, docAccent: snapshot.docAccent, presentation: snapshot.presentation, format: snapshot.format }
            : document))
   }, [])

   const undo = useCallback(() => {
      const tabKey = activeTabKeyRef.current
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (!activeTab) return
      const history = historyRef.current.get(tabKey)
      if (!history) return
      const result = applyUndo(history, takeSnapshot(activeTab))
      if (!result) return
      historyRef.current.set(tabKey, result.history)
      refreshHistoryFlags()
      applySnapshotToTab(tabKey, result.snapshot)
   }, [takeSnapshot, applySnapshotToTab, refreshHistoryFlags])

   const redo = useCallback(() => {
      const tabKey = activeTabKeyRef.current
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (!activeTab) return
      const history = historyRef.current.get(tabKey)
      if (!history) return
      const result = applyRedo(history, takeSnapshot(activeTab), HISTORY_DEPTH_CAP)
      if (!result) return
      historyRef.current.set(tabKey, result.history)
      refreshHistoryFlags()
      applySnapshotToTab(tabKey, result.snapshot)
   }, [takeSnapshot, applySnapshotToTab, refreshHistoryFlags])

   // Switching tabs shows a different history, so refresh the toolbar's enabled state for the new tab.
   useEffect(() => { refreshHistoryFlags() }, [activeTabKey, refreshHistoryFlags])

   // The active document, derived from the list; its content + identity drive the render + effects below.
   // documentId / saveStatus are per-tab.
   const activeDocument = openDocuments.find(document => document.tabKey === activeTabKey)!
   const { meta, sections, docTheme, docAccent, presentation, format, documentId, saveStatus } = activeDocument

   // A scratch tab (no binder record) holding real content: no autosave runs, so closing it loses it.
   // Drives the red "Never saved" indicator. Gated on isEmptyDocument so a pristine blank stays quiet.
   const activeNeverSaved = documentId === null && !isEmptyDocument(activeDocument)

   // Binder records that currently have an open tab (for the open-vs-active card highlight).
   const openDocumentIds = openDocuments
      .map(document => document.documentId)
      .filter((id): id is string => id !== null)

   // Hands the mutation hooks a Section[] setter that updates only the active tab, so the hooks stay
   // oblivious to tabs (they receive a plain Dispatch<SetStateAction<Section[]>>).
   const setActiveSections = useCallback((updater: SetStateAction<Section[]>) => {
      commitActiveEdit('sections', document =>
         ({ ...document, sections: typeof updater === 'function' ? updater(document.sections) : updater }))
   }, [commitActiveEdit])
   const setActiveDocTheme = useCallback((nextTheme: 'light' | 'dark') => {
      // Clicking the already-active theme is a no-op, so it must not spawn a dead undo entry.
      if (openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)?.docTheme === nextTheme) return
      commitActiveEdit('docTheme', document => ({ ...document, docTheme: nextTheme }))
   }, [commitActiveEdit])
   const setActiveDocAccent = useCallback((nextAccent: string) => {
      // Re-selecting the current accent changes nothing, so skip the history entry.
      if (openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)?.docAccent === nextAccent) return
      commitActiveEdit('docAccent', document => ({ ...document, docAccent: nextAccent }))
   }, [commitActiveEdit])
   // Patch the active tab's presentation extras (watermark, ...). A real document change: flows through
   // autosave + persist like any edit. `undefined` clears them entirely.
   const setActivePresentation = useCallback((next: DocPresentationExtras | undefined) => {
      commitActiveEdit('presentation', document => ({ ...document, presentation: next }))
   }, [commitActiveEdit])
   // Patch the active tab's page format. A real document change: flows through autosave + persist like any
   // edit. `undefined` reverts to the infinite default.
   const setActiveFormat = useCallback((next: DocFormat | undefined) => {
      commitActiveEdit('format', document => ({ ...document, format: next }))
   }, [commitActiveEdit])
   // Commit new sections AND a new format in one edit, so a page operation (which changes both the
   // block flow and the break markers) records a single undo entry rather than two.
   const commitSectionsAndFormat = useCallback((nextSections: Section[], nextFormat: DocFormat | undefined) => {
      commitActiveEdit('page-op', document => ({ ...document, sections: nextSections, format: nextFormat }))
   }, [commitActiveEdit])
   // A page break commits under its OWN undo kind so toggling one never coalesces into an adjacent margin /
   // width / band edit (those route through setActiveFormat = 'format'). Each explicit break is its own undo step.
   const setActivePageBreak = useCallback((next: DocFormat | undefined) => {
      commitActiveEdit('page-break', document => ({ ...document, format: next }))
   }, [commitActiveEdit])
   // Non-recording format write for the page reconcile pass (re-anchoring a break whose anchor block was
   // deleted). A follow-on to the delete, which already recorded its entry, so it must NOT record a second.
   // Snapshots carry `format`, so undo/redo stay consistent. Mirrors applySnapshotToTab's non-recording path.
   const setActiveFormatSilently = useCallback((next: DocFormat | undefined) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current ? { ...document, format: next } : document))
   }, [])
   // Per-tab save-status setter. Status lives on each OpenDocument, so autosave, persistNow, and the fade
   // timer target a specific tab by key (the active tab, or the captured originating tab for an async save).
   const setTabSaveStatus = useCallback((tabKey: string, status: SaveStatus) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === tabKey && document.saveStatus !== status
            ? { ...document, saveStatus: status }
            : document))
   }, [])

   const [theme, setTheme] = useState<'dark' | 'light'>(
      () => (localStorage.getItem('documinter-theme') as 'dark' | 'light') ?? 'dark'
   )
   useEffect(() => {
      document.documentElement.dataset.theme = theme
      localStorage.setItem('documinter-theme', theme)
   }, [theme])
   const toggleTheme = useCallback(() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark'), [])

   const [lang, setLang] = useState<Lang>(
      () => (localStorage.getItem('documinter-lang') as Lang) ?? 'en'
   )
   useEffect(() => { localStorage.setItem('documinter-lang', lang) }, [lang])
   const t = translations[lang]

   // ######################################
   // # SAVE STATUS + AUTOSAVE (INDEXEDDB) #
   // ######################################

   const { showToast } = useToast()

   // skipNextAutosaveRef + autosaveTimerRef stay single refs: only the active tab is editable and debounces
   // a save, so one skip flag + one timer suffice; switching tabs flushes the outgoing save first (activateTab).
   const skipNextAutosaveRef  = useRef(true)   // skip the initial mount cycle (no spurious save)
   const hasHydratedRef       = useRef(false)
   const autosaveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
   // Captured during the first render so the persistence effect can't overwrite the stored set
   // before the hydration effect reads it.
   const initialRestoreRef    = useRef<PersistedOpenDocuments>(readPersistedOpenDocuments())

   // Keep a stable, always-current notifier so the autosave effect doesn't depend on t/showToast.
   const notifySaveFailedRef  = useRef<() => void>(() => {})
   // A rename rejected by the native backend (title stem collides with a sibling): toast + revert the tab's
   // title to the last saved value (the rename never happened, so the file still holds it). Read it back and
   // restore. A ref, same rationale as notifySaveFailedRef.
   const notifyNameTakenRef   = useRef<(tabKey: string, documentId: string | null) => void>(() => {})
   useEffect(() => {
      notifySaveFailedRef.current = () => showToast(t.saveFailed, { type: 'error' })
      notifyNameTakenRef.current = (tabKey, documentId) => {
         showToast(t.titleNameTaken, { type: 'error' })
         if (documentId === null) return
         void backend.loadDocument(documentId, { touch: false }).then(saved => {
            if (!saved) return
            setOpenDocuments(documents => documents.map(document =>
               document.tabKey === tabKey ? { ...document, meta: { ...document.meta, title: saved.meta.title } } : document))
         })
      }
   })

   // Replace the open-tab set with a restored set (reload boot / legacy migration), activating the tab
   // matching activeDocumentId, else the first. Programmatic, so it skips the autosave cycle it triggers.
   // Callers pass a non-empty restoredTabs.
   const applyRestoredTabs = useCallback((restoredTabs: OpenDocument[], activeDocumentId: string | null) => {
      skipNextAutosaveRef.current = true
      const activeTab = restoredTabs.find(tab => tab.documentId === activeDocumentId) ?? restoredTabs[0]
      setOpenDocuments(restoredTabs)
      setActiveTabKey(activeTab.tabKey)
   }, [])

   // One-time async hydration: restore every open tab from last session (each loaded in full), or migrate a
   // legacy localStorage autosave. The blank default shows until this resolves and stays if nothing survives.
   useEffect(() => {
      let cancelled = false
      async function hydrate() {
         const restore = initialRestoreRef.current
         const legacy  = readAutosave()
         try {
            if (restore.documentIds.length === 0 && legacy) {
               // Migrate a legacy localStorage autosave into the binder. Keep the old key until the write confirms.
               const migratedId = await backend.saveDocument(
                  { meta: legacy.meta, sections: legacy.sections },
                  { docTheme: legacy.docTheme, docAccent: legacy.docAccent },
               )
               clearLegacyAutosave()
               if (cancelled) return
               applyRestoredTabs([buildTabFromLoaded({ ...legacy, updatedAt: '' }, migratedId)], migratedId)
               return
            }
            // Load each persisted id in tab order, skipping any deleted since last session.
            const restoredTabs: OpenDocument[] = []
            for (const persistedId of restore.documentIds) {
               const loaded = await backend.loadDocument(persistedId)
               if (cancelled) return
               if (loaded) restoredTabs.push(buildTabFromLoaded(loaded, persistedId))
            }
            if (restoredTabs.length > 0) applyRestoredTabs(restoredTabs, restore.activeDocumentId)
            // else: no surviving tabs, keep the initial blank.
         } catch {
            // Backend read failed. If legacy data exists, keep showing it in memory as an unsaved
            // document (the legacy key stays intact for a future retry).
            if (!cancelled && legacy && restore.documentIds.length === 0) {
               applyRestoredTabs([buildTabFromLoaded({ ...legacy, updatedAt: '' }, null)], null)
            }
         } finally {
            if (!cancelled) hasHydratedRef.current = true
         }
      }
      hydrate()
      return () => { cancelled = true }
   }, [applyRestoredTabs, backend])

   // Persist the open-tab set + active tab, only after hydration so the initial blank can't overwrite the
   // stored set before it is read. Tabs without a binder id aren't listed; a scratch tab earns a slot once
   // an explicit Save binds it. Also retires the legacy pointer key.
   useEffect(() => {
      if (!hasHydratedRef.current) return
      const documentIds = openDocuments
         .map(openDocument => openDocument.documentId)
         .filter((id): id is string => id !== null)
      localStorage.setItem(OPEN_DOCUMENTS_KEY, JSON.stringify({ documentIds, activeDocumentId: documentId }))
      localStorage.removeItem(CURRENT_DOCUMENT_ID_KEY)
   }, [openDocuments, documentId])

   // Autosave on any document change, debounced 1.5s. Runs ONLY for a tab already bound to a record
   // (documentId set). A scratch tab persists nothing here until an explicit Save binds it via persistNow.
   useEffect(() => {
      if (skipNextAutosaveRef.current) {
         skipNextAutosaveRef.current = false
         // A skipped cycle is a programmatic load/replace/hydration; the active tab is in sync with storage,
         // so force it clean. Without this a transient 'dirty' (e.g. StrictMode's double mount) sticks the
         // pill at "Unsaved changes" after a reload with no save pending.
         setTabSaveStatus(activeTabKeyRef.current, 'clean')
         return
      }
      // A scratch tab has no record: persist nothing, schedule nothing (no timer to clean up either). Read
      // the id off the ref so binding it later via persistNow doesn't re-trigger this with a spurious save.
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)
      if (!activeTab || activeTab.documentId === null) return
      // Capture the tab that originated this edit. The resolved save promotes/marks THIS tab by key,
      // never whatever happens to be active when the promise settles.
      const originatingTabKey = activeTabKeyRef.current
      setTabSaveStatus(originatingTabKey, 'dirty')
      autosaveTimerRef.current = setTimeout(() => {
         // Read the originating tab's latest identity at fire time (a prior cycle may have promoted it).
         const originatingTab = openDocumentsRef.current.find(document => document.tabKey === originatingTabKey)
         setTabSaveStatus(originatingTabKey, 'saving')
         backend.saveDocument(
            { meta, sections },
            { docTheme, docAccent, presentation, format },
            originatingTab?.documentId ?? undefined,
            originatingTab?.pendingNewDocFolderId ?? undefined,
         ).then(async savedId => {
            // Sync the tab to the version just written, so the watcher does not read this save as external.
            const savedRecord = await backend.getDocumentRecord(savedId)
            setOpenDocuments(documents => documents.map(document =>
               document.tabKey === originatingTabKey
                  ? { ...document, documentId: document.documentId ?? savedId, saveStatus: 'saved', pendingNewDocFolderId: null, syncedUpdatedAt: savedRecord?.updatedAt ?? document.syncedUpdatedAt }
                  : document))
         }).catch(error => {
            console.error('[autosave] saveDocument failed:', error)
            setTabSaveStatus(originatingTabKey, 'dirty')
            if (error instanceof NameTakenError) notifyNameTakenRef.current(originatingTabKey, originatingTab?.documentId ?? null)
            else notifySaveFailedRef.current()
         })
      }, 1500)
      return () => {
         if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current)
      }
   }, [meta, sections, docTheme, docAccent, presentation, format, setTabSaveStatus, backend])

   // Fade the "Saved" indicator out after 2.5 s
   useEffect(() => {
      if (saveStatus !== 'saved') return
      const clearTimer = setTimeout(() => setTabSaveStatus(activeTabKeyRef.current, 'clean'), 2500)
      return () => clearTimeout(clearTimer)
   }, [saveStatus, setTabSaveStatus])

   // Browser tab title, asterisk while there are changes on disk: a bound tab mid-save cycle, or a
   // scratch tab that has never been saved at all.
   useEffect(() => {
      const baseTitle = meta.title ? `${meta.title} - Documinter` : 'Documinter'
      document.title  = (saveStatus !== 'clean' || activeNeverSaved) ? `* ${baseTitle}` : baseTitle
   }, [saveStatus, activeNeverSaved, meta.title])

   // Cancel any pending autosave and write the active document now. The SINGLE explicit binding point: for
   // a scratch tab it creates the record and assigns the id, turning autosave on. Awaitable so callers can
   // flush first. Returns the saved id (newly assigned if none), or null on failure: openDocumentsRef's
   // promotion hasn't synced at the await boundary, so callers needing the id use it directly. Implicit-flush
   // callers (opening the binder, tab-switch drain) must gate on documentId !== null so they never mint a
   // record for a scratch tab.
   const persistNow = useCallback(async (): Promise<string | null> => {
      if (autosaveTimerRef.current !== null) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
      const flushTabKey = activeTabKeyRef.current
      const flushTab = openDocumentsRef.current.find(document => document.tabKey === flushTabKey)
      if (!flushTab) return null
      setTabSaveStatus(flushTabKey, 'saving')
      const wasCreate = flushTab.documentId === null
      try {
         const savedId = await backend.saveDocument(
            { meta: flushTab.meta, sections: flushTab.sections },
            { docTheme: flushTab.docTheme, docAccent: flushTab.docAccent, presentation: flushTab.presentation, format: flushTab.format },
            flushTab.documentId ?? undefined,
            flushTab.pendingNewDocFolderId ?? undefined,
         )
         // Re-read the saved light record: it carries the disk updatedAt the tab must sync to (so the watcher
         // never mistakes this save for an external change), and, on a CREATE, the possibly-bumped title (the
         // native filename policy takes the next free title on a stem collision). An update never bumps.
         const savedRecord = await backend.getDocumentRecord(savedId)
         const savedTitle = wasCreate ? (savedRecord?.meta.title ?? null) : null
         setOpenDocuments(documents => documents.map(document => {
            if (document.tabKey !== flushTabKey) return document
            // Sync the possibly-bumped title only when the user has not edited it during the save round-trip.
            const meta = (savedTitle !== null && savedTitle !== document.meta.title && document.meta.title === flushTab.meta.title)
               ? { ...document.meta, title: savedTitle }
               : document.meta
            return { ...document, documentId: document.documentId ?? savedId, meta, saveStatus: 'saved', pendingNewDocFolderId: null, syncedUpdatedAt: savedRecord?.updatedAt ?? document.syncedUpdatedAt }
         }))
         return savedId
      } catch (error) {
         console.error('[persistNow] saveDocument failed:', error)
         setTabSaveStatus(flushTabKey, 'dirty')
         if (error instanceof NameTakenError) notifyNameTakenRef.current(flushTabKey, flushTab.documentId)
         else showToast(t.saveFailed, { type: 'error' })
         return null
      }
   }, [showToast, t, setTabSaveStatus, backend])

   const handleManualSave = useCallback(() => { void persistNow() }, [persistNow])

   // ############################################
   // # EXTERNAL DISK CHANGES (NATIVE BACKEND)   #
   // ############################################
   // The filesystem backend fires subscribe() when an Explorer edit / deletion reconciles. A document open in
   // a tab is then reconciled against its on-disk record: a clean tab silently reloads, a deleted file turns
   // the tab into an unsaved scratch (content kept), and a dirty tab raises a conflict the user resolves.

   // Tabs (by key) whose open document changed on disk while dirty, awaiting a keep-mine / load-disk choice.
   // Resolved one at a time (the head); the multi-tab case is rare.
   const [conflictQueue, setConflictQueue] = useState<string[]>([])

   // Replace a bound tab's content with the disk version, programmatically: mark it clean and re-sync its disk
   // stamp WITHOUT an undo entry (setOpenDocuments directly, never commitActiveEdit). When it is the active
   // tab, the incoming content must not read as a user edit, so the next autosave cycle is skipped.
   const reloadTabFromDisk = useCallback(async (tabKey: string, id: string) => {
      const loaded = await backend.loadDocument(id, { touch: false })
      if (!loaded) return
      const target = openDocumentsRef.current.find(document => document.tabKey === tabKey && document.documentId === id)
      if (!target) return   // closed or rebound during the load
      if (activeTabKeyRef.current === tabKey) skipNextAutosaveRef.current = true
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === tabKey && document.documentId === id
            ? { ...document, meta: loaded.meta, sections: loaded.sections, docTheme: loaded.docTheme, docAccent: loaded.docAccent, presentation: loaded.presentation, format: loaded.format, saveStatus: 'clean', syncedUpdatedAt: loaded.updatedAt }
            : document))
   }, [backend])

   // Reconcile every bound tab against its on-disk record on an external change. Reads the light record per
   // tab (no content unless a reload is needed), re-checks the tab is unchanged across the await, then applies
   // the classified outcome.
   const onExternalChange = useCallback(() => {
      void (async () => {
         const boundTabs = openDocumentsRef.current
            .filter(document => document.documentId !== null)
            .map(document => ({ tabKey: document.tabKey, id: document.documentId! }))
         for (const { tabKey, id } of boundTabs) {
            let diskRecord: BinderDocumentRecord | null
            try { diskRecord = await backend.getDocumentRecord(id) }
            catch { continue }
            const tab = openDocumentsRef.current.find(document => document.tabKey === tabKey)
            if (!tab || tab.documentId !== id) continue   // closed or rebound mid-pass
            const outcome = classifyDiskChange(
               { documentId: tab.documentId, syncedUpdatedAt: tab.syncedUpdatedAt, saveStatus: tab.saveStatus },
               diskRecord,
            )
            if (outcome === 'deleted') {
               // Keep the content, drop the binding: the tab becomes a never-saved scratch (red indicator via
               // activeNeverSaved), and a later Save recreates the file. Content is untouched, so no autosave wakes.
               setOpenDocuments(documents => documents.map(document =>
                  document.tabKey === tabKey && document.documentId === id
                     ? { ...document, documentId: null, syncedUpdatedAt: null, saveStatus: 'clean' }
                     : document))
               showToast(t.diskDeletedToast, { type: 'warning' })
            } else if (outcome === 'reload') {
               await reloadTabFromDisk(tabKey, id)
               showToast(t.diskReloadedToast, { type: 'neutral' })
            } else if (outcome === 'conflict') {
               setConflictQueue(queue => queue.includes(tabKey) ? queue : [...queue, tabKey])
            }
         }
      })()
   }, [backend, showToast, t, reloadTabFromDisk])

   // A second subscriber alongside the binder view's: the backend hands external changes to both.
   useEffect(() => backend.subscribe(onExternalChange), [backend, onExternalChange])

   // Drop closed tabs from the conflict queue (a folder delete can close several open tabs at once), so the
   // dialog never stalls on a head tab that no longer exists.
   useEffect(() => {
      setConflictQueue(queue => {
         const live = queue.filter(key => openDocuments.some(document => document.tabKey === key))
         return live.length === queue.length ? queue : live
      })
   }, [openDocuments])

   // Resolve the head conflict. Keep-mine syncs the tab's stamp to the current disk version so the same change
   // does not re-prompt (the unsaved edits overwrite disk on the next save). Load-disk reloads and discards
   // them. Either way the tab leaves the queue.
   const resolveConflictKeepMine = useCallback(async (tabKey: string) => {
      const tab = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (tab && tab.documentId !== null) {
         const id = tab.documentId
         try {
            const record = await backend.getDocumentRecord(id)
            if (record) {
               setOpenDocuments(documents => documents.map(document =>
                  document.tabKey === tabKey && document.documentId === id
                     ? { ...document, syncedUpdatedAt: record.updatedAt }
                     : document))
            }
         } catch { /* leave the stamp; a later change simply re-prompts */ }
      }
      setConflictQueue(queue => queue.filter(key => key !== tabKey))
   }, [backend])

   const resolveConflictLoadDisk = useCallback(async (tabKey: string) => {
      const tab = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (tab && tab.documentId !== null) await reloadTabFromDisk(tabKey, tab.documentId)
      setConflictQueue(queue => queue.filter(key => key !== tabKey))
   }, [reloadTabFromDisk])

   // ###############
   // # TAB SYSTEM  #
   // ###############

   // The single switch primitive every activation routes through.
   const activateTab = useCallback(async (tabKey: string) => {
      if (tabKey === activeTabKeyRef.current) return   // already active, nothing to do
      // Flush-on-switch: drain the outgoing tab's pending save before leaving, so a debounced write can't be
      // dropped or land against the wrong tab. persistNow flushes the active tab, still the outgoing one here.
      const outgoing = openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)
      if (outgoing && (outgoing.saveStatus === 'dirty' || outgoing.saveStatus === 'saving')) {
         await persistNow()
      }
      // Skip-on-activation: the incoming tab's content becoming active must not be read as an edit
      // (same mechanism as a programmatic replace), so the autosave cycle skips + clears it clean.
      skipNextAutosaveRef.current = true
      setActiveTabKey(tabKey)
   }, [persistNow])

   // Reset the tab list to one fresh blank, syncing the refs synchronously so a follow-up read sees the new
   // state at once. Used when the last tab closes and after a Tin replace wipes the binder out.
   const spawnSingleBlankTab = useCallback(() => {
      const blankDocument = createBlankDocument(t.defaultSectionTitle)
      skipNextAutosaveRef.current = true
      openDocumentsRef.current = [blankDocument]
      activeTabKeyRef.current  = blankDocument.tabKey
      setOpenDocuments([blankDocument])
      setActiveTabKey(blankDocument.tabKey)
   }, [t])

   // Remove a tab (after any unsaved-changes guard). If active, activate a neighbor (right, else left). If
   // it was the last, respawn a blank: openDocuments is never empty (the always-have-a-document invariant).
   const performCloseTab = useCallback((tabKey: string) => {
      const documentsBefore = openDocumentsRef.current
      const index = documentsBefore.findIndex(document => document.tabKey === tabKey)
      if (index === -1) return
      const wasActive = activeTabKeyRef.current === tabKey
      const remaining = documentsBefore.filter(document => document.tabKey !== tabKey)

      // Drop the closed tab's history: it is session-only and must not outlive the tab.
      historyRef.current.delete(tabKey)

      // Update the refs synchronously so a batch of closes (a recursive folder delete removing several open
      // docs) chains off fresh state instead of each call clobbering the last with a stale snapshot.
      if (remaining.length === 0) {
         spawnSingleBlankTab()
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
   }, [spawnSingleBlankTab])

   // Reorder the tab strip. Only the array order changes, the active tab's content + identity are
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
   // Bumped after File -> Import... adds a record behind the mounted Binder's back (the write happens in
   // HeaderMenuBar). Binder watches this and re-reads its list.
   const [binderRefreshToken, setBinderRefreshToken] = useState(0)
   const handleDocumentImported = useCallback(() => {
      setBinderRefreshToken(token => token + 1)
   }, [])

   // ##################
   // # TINS (.tin I/O) #
   // ##################

   // The folder the binder is currently showing, reported up so a File-menu Tin import (its picker lives in
   // the header) grafts into it. A ref, not state: nothing renders from it and the async onchange reads the
   // latest value. Root is the sentinel '0'.
   const binderCurrentFolderIdRef = useRef('0')
   const handleBinderFolderChange = useCallback((folderId: string) => {
      binderCurrentFolderIdRef.current = folderId
   }, [])

   // A parsed Tin awaiting the user's merge / replace choice, and the merge target (the folder it
   // was picked or dropped into). Replace ignores the target.
   const [tinModeRequest, setTinModeRequest]     = useState<{ tin: TinFile; targetFolderId: string } | null>(null)
   // A Tin awaiting the second, destructive Replace confirmation (kept apart so Merge never touches it).
   const [tinReplaceConfirm, setTinReplaceConfirm] = useState<TinFile | null>(null)
   // Bumped only on a Replace to remount the Binder fresh at root: the folder it was showing may be
   // one of the records the wipe just removed, so re-seeding to root avoids a stale breadcrumb.
   const [binderRemountKey, setBinderRemountKey] = useState(0)

   // Compose the "N templates, N folders, N documents" fragment shared by the mode dialog's summary
   // and the post-import toast, filling the translated pattern's placeholders.
   const formatTinCounts = useCallback((counts: TinImportSummary) => t.tinImportModeCounts
      .replace('{templates}', String(counts.templates))
      .replace('{folders}',   String(counts.folders))
      .replace('{documents}', String(counts.documents)), [t])

   // File -> Save binder as Tin...: collect the whole binder and download it, stamped with today.
   const handleSaveBinderTin = useCallback(async () => {
      try {
         const tin = await backend.collectBinderForTin()
         await downloadTin(tin, tinDownloadName('documinter-binder', tin.exportedAt))
         showToast(t.tinExported, { type: 'success' })
      } catch {
         showToast(t.tinExportFailed, { type: 'error' })
      }
   }, [showToast, t, backend])

   // File -> Open Tin...: pick a `.tin`, gunzip, parse. A corrupt gzip or non-Tin errors out with no writes;
   // a valid one opens the merge / replace dialog, targeting the folder the binder is currently showing.
   const handleOpenTin = useCallback(async () => {
      const picked = await openBinaryFile({ filters: [{ name: 'Documinter Tin', extensions: ['tin'] }] })
      if (!picked) return
      try {
         const tin = parseTin(await gunzipToString(picked.bytes))
         if (!tin) { showToast(t.tinInvalid, { type: 'error' }); return }
         setTinModeRequest({ tin, targetFolderId: binderCurrentFolderIdRef.current })
      } catch {
         showToast(t.tinInvalid, { type: 'error' })
      }
   }, [showToast, t])

   // A `.tin` dropped onto the binder body (routed by useBinderFileImport): same mode dialog, with the
   // drop's folder as the merge target.
   const handleTinDropped = useCallback((tin: TinFile, targetFolderId: string) => {
      setTinModeRequest({ tin, targetFolderId })
   }, [])

   // Write an imported Tin, then refresh the binder list and toast the counts. A Replace also wipes the open
   // tabs (their ids may be gone) to one blank, drops all session history, and remounts the Binder at root;
   // a Merge just refreshes the list.
   const runTinImport = useCallback(async (tin: TinFile, mode: 'merge' | 'replace', targetFolderId: string) => {
      try {
         const summary = await backend.importTin(tin, mode, targetFolderId)
         if (mode === 'replace') {
            historyRef.current.clear()
            spawnSingleBlankTab()
            setBinderInitialFolder(null)
            setBinderRemountKey(key => key + 1)
         }
         setBinderRefreshToken(token => token + 1)
         showToast(`${t.tinImportedPrefix} ${formatTinCounts(summary)}`, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t, formatTinCounts, spawnSingleBlankTab, backend])

   // Merge chosen: graft into the target folder straight away (non-destructive).
   const handleTinMerge = useCallback(() => {
      const request = tinModeRequest
      setTinModeRequest(null)
      if (request) void runTinImport(request.tin, 'merge', request.targetFolderId)
   }, [tinModeRequest, runTinImport])

   // Replace chosen: hand off to the destructive second confirmation (no write yet).
   const handleTinReplaceStep = useCallback(() => {
      const request = tinModeRequest
      setTinModeRequest(null)
      if (request) setTinReplaceConfirm(request.tin)
   }, [tinModeRequest])

   const handleConfirmTinReplace = useCallback(() => {
      const tin = tinReplaceConfirm
      setTinReplaceConfirm(null)
      if (tin) void runTinImport(tin, 'replace', '0')
   }, [tinReplaceConfirm, runTinImport])

   // Open the binder: flush any pending changes first so the document appears up-to-date in the list,
   // resolve its folder, then mount. Only a BOUND tab flushes: opening the binder must never mint a record
   // for a scratch tab behind the user's back.
   const handleOpenBinder = useCallback(async () => {
      if (documentId !== null && saveStatus !== 'clean') await persistNow()
      let folder: BinderFolderRecord | null = null
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)
      const openId = activeTab?.documentId ?? null
      if (openId) {
         try {
            const folderId = await backend.getDocumentFolderId(openId)
            if (folderId && folderId !== '0') folder = await backend.getFolder(folderId)
         } catch { /* fall back to root */ }
      }
      setBinderInitialFolder(folder)
      setBinderOpen(true)
   }, [documentId, saveStatus, persistNow, backend])

   // Pending action awaiting unsaved-changes confirmation: a dirty tab close (discard-and-close).
   // Opening a doc / creating one adds or focuses a tab, discarding nothing, so neither needs a guard.
   const [pendingNavigation, setPendingNavigation] = useState<{ kind: 'close-tab'; tabKey: string; reason: 'dirty' | 'unsaved-open' } | null>(null)

   // Close a tab, guarding two ways data could be lost:
   //  - dirty/saving: unsaved edits on a bound tab (discard-and-close).
   //  - a scratch tab with real content (documentId null), whatever its origin: no stored record, so closing
   //    loses it. The blank scaffold has nothing to lose.
   // Anything safely stored (a binder record, or the empty blank) closes immediately.
   const closeTab = useCallback((tabKey: string) => {
      const target = openDocumentsRef.current.find(document => document.tabKey === tabKey)
      if (!target) return
      if (target.saveStatus === 'dirty' || target.saveStatus === 'saving') {
         setPendingNavigation({ kind: 'close-tab', tabKey, reason: 'dirty' })
         return
      }
      if (target.documentId === null && !isEmptyDocument(target)) {
         setPendingNavigation({ kind: 'close-tab', tabKey, reason: 'unsaved-open' })
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
         const loaded = await backend.loadDocument(id)
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
   }, [activateTab, showToast, t, backend])

   // Open a `.mint` by absolute path as a scratch tab (documentId null, "never saved"): a launched file
   // that sits outside any Binder, or one inside a Binder the index has not caught up to. Its bytes are
   // parsed like any Open; a Save-As later files it into the Binder.
   const openLooseFile = useCallback(async (filePath: string) => {
      try {
         const parsed = parseMint(await readLaunchFileText(filePath))
         if (!parsed) { showToast(t.binderOpenFailed, { type: 'error' }); return }
         const looseTab = buildTabFromLoaded(parsed.loaded, null)
         setOpenDocuments(documents => [...documents, looseTab])
         void activateTab(looseTab.tabKey)
         setBinderOpen(false)
         showToast(t.binderDocumentOpened, { type: 'success' })
      } catch {
         showToast(t.binderOpenFailed, { type: 'error' })
      }
   }, [activateTab, showToast, t])

   // Consume a launched `.mint` (set by the native host once the right Binder is mounted): open its tab
   // if the Binder indexes it, otherwise fall back to a loose scratch tab. The ref makes it fire once per
   // launch, since the host's controls object (and this effect's deps) change on every render.
   const handledLaunchRef = useRef<PendingLaunchOpen | null>(null)
   useEffect(() => {
      const pending = nativeBinder?.pendingLaunchOpen ?? null
      if (pending === null || handledLaunchRef.current === pending) return
      handledLaunchRef.current = pending
      let cancelled = false
      void (async () => {
         try {
            if (pending.kind === 'binder-doc') {
               const relativePath = binderRelativePath(pending.binderRoot, pending.filePath)
               const id = relativePath !== null && backend.resolveDocumentByRelativePath
                  ? await backend.resolveDocumentByRelativePath(relativePath)
                  : null
               if (cancelled) return
               if (id !== null) { await handleOpenDocument(id); return }
            }
            await openLooseFile(pending.filePath)
         } finally {
            if (!cancelled) nativeBinder?.consumeLaunchOpen()
         }
      })()
      return () => { cancelled = true }
   }, [nativeBinder, backend, handleOpenDocument, openLooseFile])

   // The one New-document entry point: a dialog offering Blank or a template with accent / theme / format
   // overrides. Opened from the header, File menu, and the binder's empty-state CTA (which seeds its folder).
   // The stored folder becomes the new tab's pending-save folder. null = root.
   const [newDocumentDialog, setNewDocumentDialog] = useState<{ folderId: string | null } | null>(null)
   const handleOpenNewDocument   = useCallback((folderId: string | null = null) => setNewDocumentDialog({ folderId }), [])
   const handleCancelNewDocument = useCallback(() => setNewDocumentDialog(null), [])

   // Create the document the dialog composed: a blank body wearing the blank defaults or the template's
   // chrome, with the dialog's overridden accent / theme / format on top. Adds a tab, activates, closes the binder.
   const handleCreateNewDocument = useCallback((template: DocumentTemplate | null, choice: NewDocumentChoice) => {
      const folderId = newDocumentDialog?.folderId ?? null
      setNewDocumentDialog(null)
      const base = template
         ? createDocumentFromTemplate(template, t.defaultSectionTitle, folderId)
         : createBlankDocument(t.defaultSectionTitle, folderId)
      const newDocument: OpenDocument = { ...base, docAccent: choice.accent, docTheme: choice.theme, format: choice.format }
      setOpenDocuments(documents => [...documents, newDocument])
      void activateTab(newDocument.tabKey)
      setBinderOpen(false)
      showToast(t.binderDocumentCreated, { type: 'success' })
   }, [newDocumentDialog, t, activateTab, showToast])

   // New from template, direct: the Templates view's per-card "Use" button. Skips the dialog (the choice is
   // made) and creates straight from the template, filed into the current folder.
   const handleNewFromTemplate = useCallback((template: DocumentTemplate, folderId?: string) => {
      const newDocument = createDocumentFromTemplate(template, t.defaultSectionTitle, folderId ?? null)
      setOpenDocuments(documents => [...documents, newDocument])
      void activateTab(newDocument.tabKey)
      setBinderOpen(false)
      showToast(t.binderDocumentCreated, { type: 'success' })
   }, [t, activateTab, showToast])

   // Apply a template's chrome to the ACTIVE document, keeping its content. One undo step
   // (applyTemplateChrome runs inside commitActiveEdit), then the binder closes.
   const handleApplyTemplate = useCallback((template: DocumentTemplate) => {
      commitActiveEdit('apply-template', document => ({ ...document, ...applyTemplateChrome(document, template) }))
      setBinderOpen(false)
      showToast(t.templateApplied, { type: 'success' })
   }, [commitActiveEdit, t, showToast])

   // Duplicate a tab's document into a new tab. A BOUND tab is copied from its record: the active bound tab
   // flushes its edits first (persistNow's returned id, since its promotion hasn't synced to the ref here). A
   // non-active tab with no record no-ops.
   //
   // The active SCRATCH tab must not mint a record just to be duplicated: it is deep-cloned in memory into a
   // fresh scratch tab, the copy staying unsaved like its source until an explicit save.
   const handleDuplicateTab = useCallback(async (sourceTabKey: string) => {
      const sourceTab = openDocumentsRef.current.find(document => document.tabKey === sourceTabKey)
      if (!sourceTab) return
      if (sourceTab.tabKey === activeTabKeyRef.current && sourceTab.documentId === null) {
         const clonedTab: OpenDocument = {
            tabKey:                crypto.randomUUID(),
            meta:                  structuredClone(sourceTab.meta),
            sections:              structuredClone(sourceTab.sections),
            docTheme:              sourceTab.docTheme,
            docAccent:             sourceTab.docAccent,
            presentation:          sourceTab.presentation ? structuredClone(sourceTab.presentation) : undefined,
            format:                sourceTab.format ? structuredClone(sourceTab.format) : undefined,
            documentId:            null,
            saveStatus:            'clean',
            pendingNewDocFolderId: sourceTab.pendingNewDocFolderId,
            syncedUpdatedAt:       null,
         }
         setOpenDocuments(documents => [...documents, clonedTab])
         void activateTab(clonedTab.tabKey)
         return
      }
      const sourceDocumentId = sourceTab.tabKey === activeTabKeyRef.current
         ? (sourceTab.saveStatus !== 'clean' ? await persistNow() : sourceTab.documentId)
         : sourceTab.documentId
      if (!sourceDocumentId) return
      const duplicateId = await backend.duplicateDocument(sourceDocumentId)
      await handleOpenDocument(duplicateId)
   }, [persistNow, handleOpenDocument, activateTab, backend])

   // Save As opens a dialog to pick a destination folder; the fork happens on confirm (handleConfirmSaveAs).
   // The picker opens at the document's current folder (root for an unsaved doc).
   const [saveAsDialog, setSaveAsDialog] = useState<{ sourceTabKey: string; initialFolder: BinderFolderRecord | null } | null>(null)

   const handleSaveAs = useCallback(async () => {
      const sourceTabKey = activeTabKeyRef.current
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === sourceTabKey)
      if (!activeTab) return
      let initialFolder: BinderFolderRecord | null = null
      if (activeTab.documentId) {
         try {
            const folderId = await backend.getDocumentFolderId(activeTab.documentId)
            if (folderId && folderId !== '0') initialFolder = await backend.getFolder(folderId)
         } catch { /* fall back to root */ }
      }
      setSaveAsDialog({ sourceTabKey, initialFolder })
   }, [backend])

   // Fork & switch: persist the active document so the ORIGINAL is a frozen record, duplicate it, file the
   // copy into the chosen folder, then re-point the active tab to the copy. Further edits save to the copy;
   // the original is untouched. The title is unchanged here (it is part of the document).
   const handleConfirmSaveAs = useCallback(async (destinationFolderId: string) => {
      const dialog = saveAsDialog
      setSaveAsDialog(null)
      if (!dialog) return
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === dialog.sourceTabKey)
      if (!activeTab) return
      // Use persistNow's returned id: its setOpenDocuments hasn't synced to openDocumentsRef at this await
      // boundary, so re-reading the ref would see a stale null and skip the fork.
      const sourceDocumentId = (activeTab.saveStatus !== 'clean' || activeTab.documentId === null)
         ? await persistNow()
         : activeTab.documentId
      if (!sourceDocumentId) return
      const copyId = await backend.duplicateDocument(sourceDocumentId)
      await backend.moveDocument(copyId, destinationFolderId)
      // The tab now tracks the copy, so sync it to the copy's disk version (else the watcher would read the
      // still-old synced stamp as an external change against the fresh record).
      const copyRecord = await backend.getDocumentRecord(copyId)
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === dialog.sourceTabKey
            ? { ...document, documentId: copyId, syncedUpdatedAt: copyRecord?.updatedAt ?? document.syncedUpdatedAt }
            : document))
      showToast(t.savedAsCopy, { type: 'success' })
   }, [saveAsDialog, persistNow, showToast, t, backend])

   const handleCancelSaveAs = useCallback(() => setSaveAsDialog(null), [])

   // Save the active document's chrome as a reusable template (File -> Save as template). On confirm the
   // capture reads the active tab's live chrome (meta scaffold, theme, accent, presentation, format); no
   // content is captured. No binder list to refresh, so the toast is the only feedback.
   const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false)
   const handleOpenSaveAsTemplate = useCallback(() => setSaveAsTemplateOpen(true), [])
   const handleCancelSaveAsTemplate = useCallback(() => setSaveAsTemplateOpen(false), [])
   const handleConfirmSaveAsTemplate = useCallback(async (name: string) => {
      setSaveAsTemplateOpen(false)
      const activeTab = openDocumentsRef.current.find(document => document.tabKey === activeTabKeyRef.current)
      if (!activeTab) return
      try {
         const template = captureTemplate(name, {
            meta:         activeTab.meta,
            docTheme:     activeTab.docTheme,
            docAccent:    activeTab.docAccent,
            presentation: activeTab.presentation,
            format:       activeTab.format,
         }, crypto.randomUUID(), Date.now())
         await backend.saveTemplate(template)
         showToast(t.templateSaved, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t, backend])

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

   const [mode, setMode] = useState<Mode>('wysiwyg')

   function handleSetMode(newMode: Mode) {
      if (newMode === mode) { setMode('wysiwyg'); return }
      setMode(newMode)
   }

   const pagedDocument = !!format && format.kind !== 'infinite'

   // Which paragraph the editor is editing through its out-of-flow overlay (see WysiwygArea). A render-only
   // signal set on a fragment press, cleared on blur. It never feeds pagination (that would move the layout
   // on focus); it selects which split paragraph gets the overlay AND holds the page recompute steady while
   // typing, so the visible pages stay put mid-edit. Reset on tab switch (the id belongs to the outgoing flow).
   const [focusedParagraphId, setFocusedParagraphId] = useState<string | null>(null)
   useEffect(() => { setFocusedParagraphId(null) }, [activeTabKey])

   // The block whose editor window (diagram / graph / image / ...) is open, lifted from WysiwygArea's
   // single-mode PopAWindow. Like focusedParagraphId it FREEZES pagination while set: an edit that changes
   // the block's height (a diagram that stops overflowing its page) would otherwise reflow the pages and
   // remount the block, unmounting the inline editor window mid-edit. The layout settles when it closes.
   const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
   useEffect(() => { setEditingBlockId(null) }, [activeTabKey])

   // The offscreen measure pass's HEIGHTS, refreshed on a typing pause below. Heights are the only thing that
   // needs the DOM; pagination is pure arithmetic, so the canvas paginates from these cached heights
   // SYNCHRONOUSLY every render. Per-block, id-keyed, width-stable: after a structural edit surviving blocks
   // keep their heights and re-paginate instantly; a new block measures 0 until the next pass.
   const [measuredHeights, setMeasuredHeights] = useState<MeasuredHeights>(EMPTY_HEIGHTS)

   // Reset the heights when the active tab OR the page kind changes, DURING render (adjust-state-on-prop-
   // change), so the new tab paginates from scratch until measured and never flashes the outgoing heights.
   // The kind is in the key because turning a document paged leaves the tab key alone yet suddenly needs
   // pages. Also clears the frozen-layout cache so the freeze branch can't hold a stale cross-tab snapshot.
   const paginationResetKey = `${activeTabKey}::${format?.kind ?? 'infinite'}`
   const lastPaginationResetKeyRef = useRef(paginationResetKey)

   // The document's ONE page layout, fed identically to the editor canvas, Pages panel, and Preview.
   // Computed SYNCHRONOUSLY during render from (sections, format, measuredHeights) through the pure
   // paginateDocument, the same pagination Save-as-PDF / HTML export runs, so all five surfaces match by
   // construction. A render-phase computation with a ref cache (NOT useMemo): paginateDocument is pure
   // arithmetic, so recomputing per render is free. FROZEN while a paragraph is focused: the in-progress edit
   // lives only in the contentEditable until blur, so re-paginating now would move the break under the caret.
   const lastDocumentPagesRef = useRef<DocumentPages>(EMPTY_DOCUMENT_PAGES)
   if (lastPaginationResetKeyRef.current !== paginationResetKey) {
      lastPaginationResetKeyRef.current = paginationResetKey
      setMeasuredHeights(EMPTY_HEIGHTS)
      lastDocumentPagesRef.current = EMPTY_DOCUMENT_PAGES
   }

   let documentPages: DocumentPages
   if (!pagedDocument) {
      documentPages = EMPTY_DOCUMENT_PAGES
   } else if (focusedParagraphId || editingBlockId) {
      // Hold the layout steady while a paragraph is typed (its length is not in the model until blur), or
      // while a block editor window is open (a reflow would remount the block and close the window).
      documentPages = lastDocumentPagesRef.current
   } else {
      documentPages = paginateDocument(sections, format, measuredHeights)
      lastDocumentPagesRef.current = documentPages
   }

   // Refresh the measured HEIGHTS on a typing pause. The offscreen pass is debounced and off the critical
   // path: the canvas keeps paginating from the last heights while typing, and fresh heights land on the
   // pause. HELD while a paragraph is focused: its length is not in the model until blur, so measuring now
   // would read a half-typed paragraph; the blur re-runs this. A superseded run is cancelled so a stale
   // promise never overwrites fresher heights.
   useEffect(() => {
      if (!pagedDocument) return                    // infinite: nothing to measure, keep the empty heights
      if (focusedParagraphId || editingBlockId) return   // hold heights steady while editing a paragraph or a block
      let cancelled = false
      const timer = window.setTimeout(() => {
         void computeDocumentPages(meta, sections, { theme: docTheme, accent: docAccent, lang, presentation, format })
            .then(result => { if (!cancelled) setMeasuredHeights(result.heights) })
      }, PAGINATION_DEBOUNCE_MS)
      return () => { cancelled = true; clearTimeout(timer) }
   }, [pagedDocument, focusedParagraphId, editingBlockId, meta, sections, docTheme, docAccent, lang, presentation, format])

   // Export dialog: lifted here (not local to HeaderMenuBar) so the header's File -> Export... / Ctrl+E path
   // and the document background context menu's "Export..." item open the same modal instance.
   const [exportOpen, setExportOpen] = useState(false)
   const handleOpenExport  = useCallback(() => setExportOpen(true), [])
   const handleCloseExport = useCallback(() => setExportOpen(false), [])

   // Save as PDF: the browser print dialog over the paged export HTML. printDocument self-measures the layout
   // offscreen, so the PDF is the same in Preview or Edit regardless of what the editor measured. Commit any
   // active edit first (blur) so the print sees the committed model.
   const handleSaveAsPdf = useCallback(() => {
      const active = document.activeElement as HTMLElement | null
      if (active && active.isContentEditable) active.blur()
      void printDocument(meta, sections, { theme: docTheme, accent: docAccent, lang, presentation, format })
   }, [meta, sections, docTheme, docAccent, lang, presentation, format])

   // The document editors (Presentation, Navigation, Page setup) are dockable panels. Their menu launchers
   // reveal the panel through the dock, so they live just below the dock state.

   // ######################
   // # PANE LAYOUT SYSTEM #
   // ######################

   const { paneLayout, togglePanel, setPaneLayout } = useWorkspaceState()

   // Per-panel keyboard shortcuts: Ctrl+Shift+D/K
   useEffect(() => {
      function handleKeyDown(event: KeyboardEvent): void {
         if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
         const key = event.key.toLowerCase()
         if (key === 'd') { event.preventDefault(); togglePanel('wysiwyg') }
         else if (key === 'k') { event.preventDefault(); togglePanel('markdown') }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [togglePanel])

   // Document-history shortcuts: Ctrl+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo. Focus decides ownership:
   // while a text field is focused the browser's native in-field undo runs untouched, so the global
   // handler bails when the active element is editable. Only active in document mode.
   useEffect(() => {
      if (binderOpen) return
      function isEditableTarget(element: Element | null): boolean {
         if (!element) return false
         if ((element as HTMLElement).isContentEditable) return true
         const tag = element.tagName
         return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      }
      function handleKeyDown(event: KeyboardEvent): void {
         if (!(event.ctrlKey || event.metaKey) || event.altKey) return
         const key = event.key.toLowerCase()
         if (key !== 'z' && key !== 'y') return
         if (isEditableTarget(document.activeElement)) return
         event.preventDefault()
         const isRedo = key === 'y' || (key === 'z' && event.shiftKey)
         if (isRedo) redo()
         else undo()
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [binderOpen, undo, redo])

   // Ctrl+S / Cmd+S saves the active document (binding a scratch tab on first save). Fires even while a
   // field is focused, unlike undo. A block or the title commits only on blur, so blur the focused field
   // first, then persist on the next tick once that write lands in openDocumentsRef; otherwise persistNow
   // saves the last-committed content and drops the latest keystrokes. Document mode only.
   useEffect(() => {
      if (binderOpen) return
      function handleKeyDown(event: KeyboardEvent): void {
         if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
         if (event.key.toLowerCase() !== 's') return
         event.preventDefault()
         const active = document.activeElement as HTMLElement | null
         const isField = !!active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
         if (isField) {
            active.blur()
            setTimeout(() => { void handleManualSave() }, 0)
         } else {
            void handleManualSave()
         }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [binderOpen, handleManualSave])

   // ############################
   // # DOCUMENT-LEVEL CALLBACKS #
   // ############################

   // Commit from the MarkdownPanel back into document state (live edit, autosaves normally).
   const handleMarkdownCommit = useCallback((newSections: Section[], newMeta: DocMeta) => {
      commitActiveEdit('markdown', document => ({ ...document, sections: newSections, meta: newMeta }))
   }, [commitActiveEdit])

   // Open freshly-loaded content (File -> Open: JSON backup / Markdown) in a NEW tab, activating it. The tab
   // is NOT a binder record and stays scratch: only an explicit Save binds it (Open is not Import), so it
   // reads as "Never saved" and closeTab warns before it is lost. A JSON backup restores its saved theme /
   // accent / extras; a plain Markdown import lands with the document defaults.
   const openLoadedInNewTab = useCallback((nextMeta: DocMeta, nextSections: Section[], presentation?: DocPresentation) => {
      const newTab: OpenDocument = {
         tabKey:    crypto.randomUUID(),
         meta:      nextMeta,
         sections:  nextSections,
         docTheme:  presentation ? presentation.docTheme  : 'light',
         docAccent: presentation ? presentation.docAccent : DEFAULT_DOC_ACCENT,
         presentation: presentation ? presentation.presentation : undefined,
         format:       presentation ? presentation.format       : undefined,
         documentId:            null,   // not a binder record; stays scratch until an explicit Save binds it
         saveStatus:            'clean',
         pendingNewDocFolderId: null,
         syncedUpdatedAt:       null,
      }
      setOpenDocuments(documents => [...documents, newTab])
      void activateTab(newTab.tabKey)
   }, [activateTab])

   // Import a Markdown file, parse it, open it in a new tab. Opening a file lands in the editor,
   // so leave binder mode if it was open.
   const handleImportMarkdown = useCallback((source: string): Promise<void> => {
      const { sections: newSections, meta: newMeta } = importMarkdownFile(source)
      openLoadedInNewTab(newMeta, newSections)
      setBinderOpen(false)
      return Promise.resolve()
   }, [openLoadedInNewTab])

   const handleMetaChange = useCallback((patch: Partial<DocMeta>) => {
      commitActiveEdit('meta', document => ({ ...document, meta: { ...document.meta, ...patch } }))
   }, [commitActiveEdit])

   // Load state from JSON (restoring its saved theme + accent) into a new tab. Opening lands in the
   // editor. Not added to the binder (Open is not Import); closeTab warns before it is lost unsaved.
   const handleLoad = useCallback((state: DocState, presentation: DocPresentation) => {
      openLoadedInNewTab(state.meta, state.sections, presentation)
      setBinderOpen(false)
   }, [openLoadedInNewTab])

   // ===================================
   //  Header: New + standalone binder toggle
   // ===================================

   // New from the header (and the File menu): open the New Document dialog. Same in both modes; on
   // Create the dialog's handler closes the binder if it was open.
   const handleHeaderNew = useCallback(() => handleOpenNewDocument(null), [handleOpenNewDocument])

   // Close the binder back to the editor. openDocuments is never empty (the always-have-a-document
   // invariant), so there is always a tab to return to.
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

   // ######################
   // # SIDE-PANEL DOCK    #
   // ######################

   // The dock owns the side panels' layout; applicability is driven by the active document's format (Pages
   // needs a paged doc) and mode (Pages needs edit mode). Pages data + handlers are derived here so the
   // App-level dock hosts the body directly.
   const panelContext: PanelContext = { formatKind: format?.kind ?? 'infinite', readOnly: mode === 'preview' }
   const dock      = useDockState(panelContext)
   const pagesData = usePagesPanelData(sections, format, commitSectionsAndFormat, t, documentPages.pages)

   // Menu launchers for the document-editor panels: reveal the panel (docking it if hidden). Presentation
   // also closes the Export dialog first, since one of its launch points is the dialog's HTML branch.
   const handleOpenPresentation = () => { setExportOpen(false); dock.revealPanel('presentation') }
   const handleOpenNav          = () => dock.revealPanel('documentnav')
   const handleOpenFormat       = () => dock.revealPanel('pagesetup')

   // The panel bodies fed to the docks, keyed by id (mirrors WorkspaceLayout's `panels` record). App
   // wires each body's data + handlers here; the dock hosts only the chrome.
   const panelBodies: Record<PanelId, ReactNode> = {
      structure: (
         <StructurePanelBody
            sections={sections}
            onAddSection={sectionMutations.addSection}
            onToggleSec={sectionMutations.toggleSec}
            onDuplicateSec={sectionMutations.duplicateSec}
            onRemoveSec={sectionMutations.removeSec}
            onReorderSections={sectionMutations.reorderSections}
            onReorderBlocks={blockMutations.reorderBlocks}
         />
      ),
      pages: (
         <PagesPanelBody
            pages={pagesData.pages}
            meta={meta}
            sections={sections}
            docTheme={docTheme}
            docAccent={docAccent}
            margins={pagesData.margins}
            sheetWidthPx={pagesData.sheetWidthPx}
            sheetHeightPx={pagesData.sheetHeightPx}
            onReorder={pagesData.onReorder}
            onDuplicate={pagesData.onDuplicate}
            onDelete={pagesData.onDelete}
            onInsertAfter={pagesData.onInsertAfter}
            onRemoveBreak={pagesData.onRemoveBreak}
            onAddPage={pagesData.onAddPage}
            onSaveAsPdf={handleSaveAsPdf}
            onJump={pagesData.onJump}
         />
      ),
      anchors: (
         <AnchorsPanelBody sections={sections} />
      ),
      pagesetup: (
         <FormatPanelBody format={format} onChange={setActiveFormat} />
      ),
      presentation: (
         <PresentationPanelBody presentation={presentation} onChange={setActivePresentation} />
      ),
      documentnav: (
         <NavPanelBody presentation={presentation} sections={sections} onChange={setActivePresentation} />
      ),
      templates: (
         <TemplatesPanelBody
            currentChrome={{ meta, docTheme, docAccent, presentation, format }}
            onUse={template => handleNewFromTemplate(template)}
            onApply={handleApplyTemplate}
         />
      ),
   }

   // The applicable dockable panels as View-menu toggles: on = visible (docked or floating), off =
   // hidden. Toggling routes through the dock's show/hide, which remembers the prior config.
   const dockPanels: DockPanelToggle[] = applicablePanels(panelContext).map(panelId => ({
      id:       panelId,
      label:    PANEL_REGISTRY[panelId].title(t),
      icon:     PANEL_REGISTRY[panelId].icon,
      visible:  isPanelVisible(dock.layout, dock.floatingPanels, panelId),
      onToggle: () => dock.togglePanelVisibility(panelId),
   }))

   return (
      <LangProvider lang={lang} setLang={setLang}>
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
            neverSaved={activeNeverSaved}
            onLoad={handleLoad}
            onToggleTheme={toggleTheme}
            onSetMode={handleSetMode}
            onTogglePanel={togglePanel}
            dockPanels={dockPanels}
            onManualSave={handleManualSave}
            onSaveAs={handleSaveAs}
            onSaveAsTemplate={handleOpenSaveAsTemplate}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndoActive}
            canRedo={canRedoActive}
            onNew={handleHeaderNew}
            onAddSection={sectionMutations.addSection}
            onToggleBinder={handleToggleBinder}
            onImportMarkdownFile={handleImportMarkdown}
            onDocumentImported={handleDocumentImported}
            onSaveTin={handleSaveBinderTin}
            onOpenTin={handleOpenTin}
            onDocThemeChange={setActiveDocTheme}
            onDocAccentChange={setActiveDocAccent}
            exportOpen={exportOpen}
            onOpenExport={handleOpenExport}
            onCloseExport={handleCloseExport}
            presentation={presentation}
            onOpenPresentation={handleOpenPresentation}
            onOpenNav={handleOpenNav}
            format={format}
            onOpenFormat={handleOpenFormat}
         />

         {binderOpen ? (
            <Binder
               key={binderRemountKey}
               openDocumentIds={openDocumentIds}
               activeDocumentId={documentId}
               initialFolder={binderInitialFolder}
               refreshToken={binderRefreshToken}
               onOpenDocument={handleOpenDocument}
               onNewDocument={folderId => handleOpenNewDocument(folderId ?? null)}
               onNewFromTemplate={handleNewFromTemplate}
               onApplyTemplate={handleApplyTemplate}
               onDocumentDeleted={handleDocumentDeleted}
               onCurrentFolderChange={handleBinderFolderChange}
               onTinDropped={handleTinDropped}
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
               moveBlockAcross:   blockMutations.moveBlockAcross,
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
               addSection:        sectionMutations.addSection,
               insertSectionAt:   sectionMutations.insertSectionAt,
               duplicateSec:      sectionMutations.duplicateSec,
               moveSecUp:         sectionMutations.moveSecUp,
               moveSecDown:       sectionMutations.moveSecDown,
               toggleSec:         sectionMutations.toggleSec,
            }}>
               <DockedWorkspace dock={dock} panelBodies={panelBodies}>
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
                              presentation={presentation}
                              format={format}
                              activeTabKey={activeTabKey}
                              onUpdateMeta={handleMetaChange}
                              onAddSection={sectionMutations.addSection}
                              readOnly={mode === 'preview'}
                              onDocThemeChange={setActiveDocTheme}
                              onDocAccentChange={setActiveDocAccent}
                              onFormatChange={setActiveFormat}
                              onPageBreakChange={setActivePageBreak}
                              onReconcileFormat={setActiveFormatSilently}
                              onCommitSectionsAndFormat={commitSectionsAndFormat}
                              onOpenExport={handleOpenExport}
                              onManualSave={handleManualSave}
                              onSaveAs={handleSaveAs}
                              onOpenPresentation={handleOpenPresentation}
                              onOpenNav={handleOpenNav}
                              onApplyTemplate={handleApplyTemplate}
                              onOpenFormat={handleOpenFormat}
                              previewMode={mode}
                              onSetMode={handleSetMode}
                              pages={documentPages.pages}
                              tooTallPageIds={documentPages.tooTallPageIds}
                              focusedParagraphId={focusedParagraphId}
                              onParagraphFocusChange={setFocusedParagraphId}
                              onBlockEditorOpenChange={setEditingBlockId}
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
               </DockedWorkspace>
            </DocumentMutationsContext.Provider>
          </>
         )}

            {pendingNavigation && (
               <ConfirmDialog
                  title={pendingNavigation.reason === 'unsaved-open' ? t.closeUnsavedOpenTitle : t.binderUnsavedTitle}
                  message={pendingNavigation.reason === 'unsaved-open' ? t.closeUnsavedOpenMessage : t.binderUnsavedMessage}
                  confirmLabel={pendingNavigation.reason === 'unsaved-open' ? t.closeUnsavedOpenConfirm : t.binderUnsavedProceed}
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

            {conflictQueue.length > 0 && (() => {
               const conflictTab = openDocuments.find(document => document.tabKey === conflictQueue[0])
               if (!conflictTab) return null
               const tabKey = conflictTab.tabKey
               return (
                  <DiskConflictDialog
                     title={conflictTab.meta.title || t.untitledDoc}
                     onKeepMine={() => void resolveConflictKeepMine(tabKey)}
                     onLoadDisk={() => void resolveConflictLoadDisk(tabKey)}
                  />
               )
            })()}

            {saveAsTemplateOpen && (
               <PromptDialog
                  title={t.saveAsTemplateTitle}
                  label={t.saveAsTemplateLabel}
                  initialValue={meta.title}
                  confirmLabel={t.saveAsTemplateConfirm}
                  cancelLabel={t.binderUnsavedCancel}
                  onConfirm={name => void handleConfirmSaveAsTemplate(name)}
                  onCancel={handleCancelSaveAsTemplate}
               />
            )}

            {newDocumentDialog && (
               <NewDocumentDialog
                  onCreate={handleCreateNewDocument}
                  onCancel={handleCancelNewDocument}
               />
            )}

            {tinModeRequest && (
               <TinImportDialog
                  templates={tinModeRequest.tin.templates.length}
                  folders={tinModeRequest.tin.folders.length}
                  documents={tinModeRequest.tin.documents.length}
                  onMerge={handleTinMerge}
                  onReplace={handleTinReplaceStep}
                  onCancel={() => setTinModeRequest(null)}
               />
            )}

            {tinReplaceConfirm && (
               <ConfirmDialog
                  title={t.tinReplaceTitle}
                  message={t.tinReplaceWarning}
                  confirmLabel={t.tinReplaceConfirm}
                  cancelLabel={t.tinImportCancel}
                  danger
                  onConfirm={handleConfirmTinReplace}
                  onCancel={() => setTinReplaceConfirm(null)}
               />
            )}

            <ToastContainer />
         </LangProvider>
   )
}

// -- React Imports --
import { useCallback, useEffect, useRef, useState, type SetStateAction, type ReactNode } from 'react'

// -- Library Imports --
import { arrayMove } from '@dnd-kit/sortable'

// -- Lib / Util Imports --
import { mkSection, isEmptyDocument } from './lib/document'
import { translations, type Lang } from './lib/i18n'
import { readAutosave, clearLegacyAutosave } from './lib/autosaveStorage'
import { saveDocument, loadDocument, getDocumentFolderId, duplicateDocument, moveDocument, type LoadedDocument, type DocPresentation } from './lib/binderDocuments'
import { getFolder } from './lib/binderFolders'
import { instantiateTemplate, captureTemplate, applyTemplateChrome, type DocumentTemplate } from './lib/documentTemplate'
import { saveTemplate } from './lib/templateStore'
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
import { MintdownEditor } from './organisms/MintdownEditor'
import { WorkspaceLayout } from './organisms/WorkspaceLayout'
import { Binder } from './organisms/Binder'
import { ConfirmDialog } from './molecules/ConfirmDialog'
import { SaveAsDialog } from './molecules/SaveAsDialog'
import { PromptDialog } from './molecules/PromptDialog'
import { NewDocumentDialog, type NewDocumentChoice } from './molecules/NewDocumentDialog'
import { ToastContainer } from './atoms/ToastContainer'
import { UpdatePrompt } from './atoms/UpdatePrompt'

// -- Markdown Imports --
import { importMarkdownFile } from './lib/markdown'
import { importMintdownFile } from './lib/mintdown'

// -- Type Imports --
import type { BinderFolderRecord, DocMeta, DocState, Mode, OpenDocument, SaveStatus, Section } from './types'
import type { DocPresentationExtras } from './lib/presentation'
import type { DocFormat } from './lib/format'
import { useWorkspaceState } from './hooks/useWorkspaceState'

const EMPTY_META: DocMeta = { title: '', fields: [] }
// How long to wait after the last height-affecting edit before re-running the offscreen height measure.
// Long enough that a burst of keystrokes measures once, on the pause, not per character; short enough that
// the heights re-settle promptly. The canvas paginates SYNCHRONOUSLY from the cached heights every render,
// so structural edits reflow instantly; only the measured heights settle a beat later (see the effect below).
const PAGINATION_DEBOUNCE_MS = 180
const CURRENT_DOCUMENT_ID_KEY = 'documinter-current-document-id'   // legacy single-pointer (migrated away)
const OPEN_DOCUMENTS_KEY      = 'documinter-open-documents'        // the open-tab set + active, for reload restore
const DEFAULT_DOC_ACCENT = '#2dcea8'

// An empty layout, used before the first measure and for non-paged documents. paginateDocument with
// EMPTY_HEIGHTS yields exactly the forced-break-only placeholder (zero heights never trigger an auto-break),
// so an unmeasured paged canvas shows its explicit breaks and nothing overflows until the heights land.
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

// A fresh tab pre-styled from a template: a blank body (one empty section) wearing the template's
// chrome (meta scaffold with fresh field ids, theme, accent, presentation, page format). Like
// createBlankDocument, it has no binder record yet and is clean; it saves on first edit into the
// folder it was created in.
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
   }
}

export default function App() {
   // Document state starts blank; the real document set is hydrated asynchronously from
   // IndexedDB on mount (see the hydration effect below). Documents live as a list of open tabs,
   // with exactly one tab active at a time; its content and identity drive the rest of the app.
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

   // The undoable slice of a tab: the fields the binder persists. Holds references to the immutable
   // model, so it is cheap and shares untouched subtrees with the live state.
   const takeSnapshot = useCallback((document: OpenDocument): DocSnapshot => ({
      meta:         document.meta,
      sections:     document.sections,
      docTheme:     document.docTheme,
      docAccent:    document.docAccent,
      presentation: document.presentation,
      format:       document.format,
   }), [])

   // The single choke point every content lever routes through: snapshot the active tab's pre-edit
   // slice into its history, then apply the edit. `kind` groups a burst of like edits into one entry
   // (see recordEdit's coalescing). produceNext runs inside the functional update so it composes on the
   // freshest state, which matters when two levers commit in the same tick (a page op writes sections
   // then format). Bookkeeping writes (save status, tab promotion, tab open/close) never come here.
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

   // The active document and the content + identity the render + effects below read, derived from the
   // list. documentId / saveStatus are per-tab; the active tab's values drive the UI.
   const activeDocument = openDocuments.find(document => document.tabKey === activeTabKey)!
   const { meta, sections, docTheme, docAccent, presentation, format, documentId, saveStatus } = activeDocument

   // A scratch tab (no binder record yet) that holds real content: closing it would lose it, and no
   // autosave is running. Drives the persistent red "Never saved" indicator. Gated on isEmptyDocument
   // so a pristine blank scratch tab stays quiet (nothing to warn about), matching closeTab's guard.
   const activeNeverSaved = documentId === null && !isEmptyDocument(activeDocument)

   // Binder records that currently have an open tab (for the open-vs-active card highlight).
   const openDocumentIds = openDocuments
      .map(document => document.documentId)
      .filter((id): id is string => id !== null)

   // The setter lever: hands the mutation hooks a Section[] setter that updates only
   // the active tab. The hooks stay oblivious to tabs, they still receive a plain Dispatch<SetStateAction<Section[]>>.
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
   // Patch the active tab's presentation extras (watermark, ...). A real document change, so it flows
   // through autosave + persist like any other edit. `undefined` clears the extras entirely.
   const setActivePresentation = useCallback((next: DocPresentationExtras | undefined) => {
      commitActiveEdit('presentation', document => ({ ...document, presentation: next }))
   }, [commitActiveEdit])
   // Patch the active tab's page format (infinite width, later paged A4). A real document change, so it
   // flows through autosave + persist like any other edit. `undefined` clears it entirely, reverting to
   // the infinite/normal default.
   const setActiveFormat = useCallback((next: DocFormat | undefined) => {
      commitActiveEdit('format', document => ({ ...document, format: next }))
   }, [commitActiveEdit])
   // Commit new sections AND a new format in one edit, so a page operation (which changes both the
   // block flow and the break markers) records a single undo entry rather than two.
   const commitSectionsAndFormat = useCallback((nextSections: Section[], nextFormat: DocFormat | undefined) => {
      commitActiveEdit('page-op', document => ({ ...document, sections: nextSections, format: nextFormat }))
   }, [commitActiveEdit])
   // A block-menu page break commits under its OWN undo kind so toggling a break never coalesces into an
   // adjacent margin / width / band edit (those all route through setActiveFormat = 'format'). Same format
   // write, distinct kind, so each explicit break is its own discrete undo step.
   const setActivePageBreak = useCallback((next: DocFormat | undefined) => {
      commitActiveEdit('page-break', document => ({ ...document, format: next }))
   }, [commitActiveEdit])
   // Non-recording format write for the page reconcile pass: when a break's anchor block is deleted the
   // editor re-anchors the boundary to the surviving predecessor. That persists + autosaves like any format
   // change, but it is a follow-on to the delete (which already recorded its own entry), not a fresh user
   // action, so it must NOT record a second history entry. Snapshots carry `format`, so undo/redo stay
   // consistent without it. Mirrors applySnapshotToTab's non-recording setOpenDocuments path.
   const setActiveFormatSilently = useCallback((next: DocFormat | undefined) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === activeTabKeyRef.current ? { ...document, format: next } : document))
   }, [])
   // Per-tab save-status setter. Status lives on each OpenDocument, so the autosave cycle,
   // persistNow, and the fade timer target a specific tab by key, the active tab for live edits, or
   // the captured originating tab for an async save's resolution.
   const setTabSaveStatus = useCallback((tabKey: string, status: SaveStatus) => {
      setOpenDocuments(documents => documents.map(document =>
         document.tabKey === tabKey && document.saveStatus !== status
            ? { ...document, saveStatus: status }
            : document))
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

   // saveStatus, the document id, and the pending-new-doc folder live per tab, on OpenDocument.
   // skipNextAutosaveRef + autosaveTimerRef stay single refs: only the active tab is editable and
   // only it debounces a save, so one skip flag + one timer suffice; switching tabs flushes the
   // outgoing tab's pending save first (see activateTab's flush-on-switch).
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

   // One-time async hydration: restore every open tab from last session (eager, each document is
   // loaded in full), or migrate a legacy localStorage autosave. The blank default shows until this
   // resolves; if nothing survives it stays (the always-have-a-document invariant).
   useEffect(() => {
      let cancelled = false
      async function hydrate() {
         const restore = initialRestoreRef.current
         const legacy  = readAutosave()
         try {
            if (restore.documentIds.length === 0 && legacy) {
               // Migrate legacy autosave to IndexedDB. Keep the old key until the write confirms.
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
            // else: no surviving tabs, keep the initial blank.
         } catch {
            // IndexedDB unavailable / read failed. If legacy data exists, keep showing it in memory
            // as an unsaved document (the legacy key stays intact for a future retry).
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
   // a scratch tab only earns an id (and a slot here) once an explicit Save binds it to a record,
   // which re-runs this and includes it. Also retires the legacy pointer key.
   useEffect(() => {
      if (!hasHydratedRef.current) return
      const documentIds = openDocuments
         .map(openDocument => openDocument.documentId)
         .filter((id): id is string => id !== null)
      localStorage.setItem(OPEN_DOCUMENTS_KEY, JSON.stringify({ documentIds, activeDocumentId: documentId }))
      localStorage.removeItem(CURRENT_DOCUMENT_ID_KEY)
   }, [openDocuments, documentId])

   // Autosave on any document change, debounced 1.5s, persisted to IndexedDB. Runs ONLY for a tab
   // already bound to a binder record (documentId set). A scratch tab (documentId null) persists
   // nothing here, it stays in memory until an explicit Save (File -> Save / Save As) binds it via
   // persistNow, which flips its documentId and hands autosave over from there.
   useEffect(() => {
      if (skipNextAutosaveRef.current) {
         skipNextAutosaveRef.current = false
         // A skipped cycle is a programmatic load/replace/hydration, the active tab is already in
         // sync with storage, so force it clean. Without this, a transient 'dirty' set for the
         // pre-hydration blank (e.g. by StrictMode's double-invoked mount cycle) is never cleared,
         // sticking the pill at "Unsaved changes" after a reload with no save actually pending.
         setTabSaveStatus(activeTabKeyRef.current, 'clean')
         return
      }
      // A scratch tab has no record yet. Persist nothing, schedule nothing, mark nothing: it stays
      // a purely in-memory document (surfaced by the red "Never saved" indicator) until the user
      // explicitly saves it. The dependency list re-runs this on the next edit, still a no-op while
      // scratch, so there is no timer to clean up either. Read the id off the ref (kept current for
      // this render) so binding it later via persistNow doesn't re-trigger this effect with a
      // spurious save.
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
         saveDocument(
            { meta, sections },
            { docTheme, docAccent, presentation, format },
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
   }, [meta, sections, docTheme, docAccent, presentation, format, setTabSaveStatus])

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

   // Cancel any pending autosave and write the active document immediately. This is the SINGLE
   // explicit binding point: for a scratch tab (documentId null) it creates the binder record and
   // assigns the id, turning autosave on from there. Awaitable so callers (manual save, Save As) can
   // flush before continuing. Returns the binder id the active tab was saved under (newly assigned if
   // it had none), or null on failure, callers that need the id can use it directly rather than
   // re-reading openDocumentsRef, whose promotion hasn't synced back to the ref yet at the await
   // boundary. Implicit-flush callers (opening the binder, tab-switch drain) must gate on
   // documentId !== null so they never mint a record for a scratch tab.
   const persistNow = useCallback(async (): Promise<string | null> => {
      if (autosaveTimerRef.current !== null) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
      const flushTabKey = activeTabKeyRef.current
      const flushTab = openDocumentsRef.current.find(document => document.tabKey === flushTabKey)
      if (!flushTab) return null
      setTabSaveStatus(flushTabKey, 'saving')
      try {
         const savedId = await saveDocument(
            { meta: flushTab.meta, sections: flushTab.sections },
            { docTheme: flushTab.docTheme, docAccent: flushTab.docAccent, presentation: flushTab.presentation, format: flushTab.format },
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

   // Remove a tab from the list (after any unsaved-changes guard). If it was active, activate a
   // neighbor (right, else left). If it was the last tab, respawn a blank, openDocuments is never
   // empty (the always-have-a-document invariant lives on the tab list).
   const performCloseTab = useCallback((tabKey: string) => {
      const documentsBefore = openDocumentsRef.current
      const index = documentsBefore.findIndex(document => document.tabKey === tabKey)
      if (index === -1) return
      const wasActive = activeTabKeyRef.current === tabKey
      const remaining = documentsBefore.filter(document => document.tabKey !== tabKey)

      // Drop the closed tab's history: it is session-only and must not outlive the tab.
      historyRef.current.delete(tabKey)

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
   // Bumped after File -> Import... adds a record straight to IndexedDB, behind the mounted
   // Binder's back (the write happens in HeaderMenuBar, which owns no list state of its own).
   // Binder watches this and re-reads its list, the same shared-refresh shape as its own dataVersion.
   const [binderRefreshToken, setBinderRefreshToken] = useState(0)
   const handleDocumentImported = useCallback(() => {
      setBinderRefreshToken(token => token + 1)
   }, [])

   // Open the binder, flush any pending changes first so the current document appears up-to-date
   // in the list, resolve which folder it lives in, then mount the binder in place of the editor.
   // Only a BOUND tab flushes: a scratch tab (documentId null) has no record to refresh, and opening
   // the binder must never mint one behind the user's back.
   const handleOpenBinder = useCallback(async () => {
      if (documentId !== null && saveStatus !== 'clean') await persistNow()
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
   }, [documentId, saveStatus, persistNow])

   // Pending action awaiting unsaved-changes confirmation: a dirty tab close (discard-and-close).
   // Opening a doc / creating one adds or focuses a tab, discarding nothing, so neither needs a guard.
   const [pendingNavigation, setPendingNavigation] = useState<{ kind: 'close-tab'; tabKey: string; reason: 'dirty' | 'unsaved-open' } | null>(null)

   // Close a tab, guarding two ways data could be lost:
   //  - dirty/saving: unsaved edits on a bound tab (discard-and-close).
   //  - a scratch tab never saved to the binder (documentId null + real content), whatever its origin
   //    (a brand-new doc, a template instance, or a file opened from disk): it has no stored record,
   //    so closing it loses it. The blank scaffold has nothing to lose.
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

   // The one New-document entry point: a dialog (New Document dialog) offering Blank or a
   // template with accent / theme / format overrides, then Create. Opened from the header New button,
   // the File menu, and the binder's empty-state CTA (which seeds the folder it was opened from). The
   // stored folder is applied as the new tab's pending-save folder. null = root.
   const [newDocumentDialog, setNewDocumentDialog] = useState<{ folderId: string | null } | null>(null)
   const handleOpenNewDocument   = useCallback((folderId: string | null = null) => setNewDocumentDialog({ folderId }), [])
   const handleCancelNewDocument = useCallback(() => setNewDocumentDialog(null), [])

   // Create the document the dialog composed: a blank body wearing either the blank defaults or the
   // chosen template's chrome, with the dialog's (possibly overridden) accent / theme / format on
   // top. Adds it as a tab, activates it, and closes the binder. No replace, no discard.
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

   // New from template, direct: the binder Templates view's per-card "Use" button. Skips the dialog
   // since the template choice is already made, creates straight from the template, filed into the
   // current folder.
   const handleNewFromTemplate = useCallback((template: DocumentTemplate, folderId?: string) => {
      const newDocument = createDocumentFromTemplate(template, t.defaultSectionTitle, folderId ?? null)
      setOpenDocuments(documents => [...documents, newDocument])
      void activateTab(newDocument.tabKey)
      setBinderOpen(false)
      showToast(t.binderDocumentCreated, { type: 'success' })
   }, [t, activateTab, showToast])

   // Apply a template's chrome to the ACTIVE document, keeping its content: the binder Templates
   // view's per-card "Apply to current document" entry. One undo step (applyTemplateChrome runs
   // inside commitActiveEdit), then the binder closes so the restyled document shows right away.
   const handleApplyTemplate = useCallback((template: DocumentTemplate) => {
      commitActiveEdit('apply-template', document => ({ ...document, ...applyTemplateChrome(document, template) }))
      setBinderOpen(false)
      showToast(t.templateApplied, { type: 'success' })
   }, [commitActiveEdit, t, showToast])

   // Duplicate a tab's document and open the copy as a new tab. A BOUND tab is copied from its binder
   // record: the active bound tab flushes its unsaved edits first (persistNow's returned id, since its
   // promotion hasn't synced to openDocumentsRef at this await boundary). A non-active tab with no
   // record has nothing stored to copy, so it no-ops.
   //
   // The active SCRATCH tab has no record and must not mint one just to be duplicated. It is cloned in
   // memory into a fresh scratch tab instead, deep-copied so the two documents never share references,
   // and the copy stays unsaved (documentId null) exactly like its source until an explicit save.
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
         }
         setOpenDocuments(documents => [...documents, clonedTab])
         void activateTab(clonedTab.tabKey)
         return
      }
      const sourceDocumentId = sourceTab.tabKey === activeTabKeyRef.current
         ? (sourceTab.saveStatus !== 'clean' ? await persistNow() : sourceTab.documentId)
         : sourceTab.documentId
      if (!sourceDocumentId) return
      const duplicateId = await duplicateDocument(sourceDocumentId)
      await handleOpenDocument(duplicateId)
   }, [persistNow, handleOpenDocument, activateTab])

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
   // untouched. The title is never changed here, it's part of the document, renamed in the tab.
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

   // Save the active document's chrome as a reusable template (File -> Save as template). A name
   // dialog opens here; on confirm the capture reads the active tab's live chrome (meta scaffold,
   // theme, accent, presentation, page format) directly, no content is captured. This path doesn't
   // open the binder, so there is no list to refresh, the toast is the only feedback.
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
         await saveTemplate(template)
         showToast(t.templateSaved, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t])

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

   const pagedDocument = !!format && format.kind !== 'infinite'

   // Which paragraph the editor is currently editing through its out-of-flow overlay (see WysiwygArea).
   // A render-only signal: a fragment press sets it, its blur clears it. It never feeds pagination (that
   // would move the layout on focus); it selects which split paragraph gets the edit overlay AND holds the
   // page recompute steady while typing (see the documentPages effect below), so the visible pages stay put
   // mid-edit and re-settle deterministically on blur. Reset on tab switch, since the id belongs to the
   // outgoing document's flow.
   const [focusedParagraphId, setFocusedParagraphId] = useState<string | null>(null)
   useEffect(() => { setFocusedParagraphId(null) }, [activeTabKey])

   // The offscreen measurement pass's HEIGHTS, refreshed on a typing pause by the debounced effect below.
   // Heights are the only thing that inherently needs the DOM; pagination itself is pure arithmetic, so the
   // canvas paginates from these cached heights SYNCHRONOUSLY every render (see documentPages just below).
   // Heights are per-block, id-keyed, and width-stable, so after a structural edit the surviving blocks keep
   // their correct heights and re-paginate instantly; a brand-new block measures 0 until the next pass lands.
   const [measuredHeights, setMeasuredHeights] = useState<MeasuredHeights>(EMPTY_HEIGHTS)

   // Reset the heights the instant the active tab OR the page kind changes, DURING render (React's "adjust
   // state when a prop changes" pattern), so the new tab paginates from scratch (forced breaks only) until
   // it is measured, and the canvas never flashes the outgoing document's heights for a frame. The kind is
   // in the key because turning an infinite document paged (Page setup) leaves the tab key alone yet suddenly
   // needs pages. Also clear the frozen-layout cache so the freeze branch below can never hold a stale
   // cross-tab snapshot. A render-phase reset (not an effect) means no blank frame.
   const paginationResetKey = `${activeTabKey}::${format?.kind ?? 'infinite'}`
   const lastPaginationResetKeyRef = useRef(paginationResetKey)

   // The document's ONE page layout, fed identically to the editor canvas, the Pages panel, and Preview.
   // Computed SYNCHRONOUSLY during render from (sections, format, measuredHeights) through the pure
   // paginateDocument (lib/pageLayout): the single budgeted, empty-atomic-set pagination the Save-as-PDF /
   // HTML export also runs, so all five surfaces render identical pages by construction. This is a plain
   // render-phase computation with a ref cache (NOT useMemo): paginateDocument is pure arithmetic
   // (microseconds even for large docs), so recomputing per render is free and matches the pre-unification
   // editor. It is FROZEN while a paragraph is focused: an in-progress edit lives only in the contentEditable
   // until blur, so re-paginating now would move the break under the caret. The freeze holds the last
   // non-focused layout through the ref below.
   const lastDocumentPagesRef = useRef<DocumentPages>(EMPTY_DOCUMENT_PAGES)
   if (lastPaginationResetKeyRef.current !== paginationResetKey) {
      lastPaginationResetKeyRef.current = paginationResetKey
      setMeasuredHeights(EMPTY_HEIGHTS)
      lastDocumentPagesRef.current = EMPTY_DOCUMENT_PAGES
   }

   let documentPages: DocumentPages
   if (!pagedDocument) {
      documentPages = EMPTY_DOCUMENT_PAGES
   } else if (focusedParagraphId) {
      // Hold the layout steady while a paragraph is being typed: its in-progress length lives only in the
      // contentEditable until blur, so re-paginating now would move the break under the caret.
      documentPages = lastDocumentPagesRef.current
   } else {
      documentPages = paginateDocument(sections, format, measuredHeights)
      lastDocumentPagesRef.current = documentPages
   }

   // Refresh the measured HEIGHTS on a typing pause. The offscreen pass is debounced and off the critical
   // path: the canvas keeps paginating synchronously from the last heights while the author types, and the
   // fresh heights land ~180ms after the last height-affecting change (the layout re-settles on the next
   // render). HELD while a paragraph is focused: an in-progress edit lives only in the contentEditable until
   // blur, and its length is not yet in the model, so measuring now would read a half-typed paragraph.
   // Clearing focusedParagraphId on blur re-runs this and settles the heights exactly where the export also
   // reads them. A superseded run (deps changed, or a newer pass scheduled) is cancelled so a stale promise
   // never overwrites fresher heights.
   useEffect(() => {
      if (!pagedDocument) return          // infinite: nothing to measure, keep the empty heights
      if (focusedParagraphId) return      // hold the heights steady while a paragraph is being edited
      let cancelled = false
      const timer = window.setTimeout(() => {
         void computeDocumentPages(meta, sections, { theme: docTheme, accent: docAccent, lang, presentation, format })
            .then(result => { if (!cancelled) setMeasuredHeights(result.heights) })
      }, PAGINATION_DEBOUNCE_MS)
      return () => { cancelled = true; clearTimeout(timer) }
   }, [pagedDocument, focusedParagraphId, meta, sections, docTheme, docAccent, lang, presentation, format])

   // Export dialog: lifted here (rather than local state inside HeaderMenuBar) so both the header's
   // File -> Export... / Ctrl+E path AND the document background context menu's "Export..." item
   // open the exact same modal instance.
   const [exportOpen, setExportOpen] = useState(false)
   const handleOpenExport  = useCallback(() => setExportOpen(true), [])
   const handleCloseExport = useCallback(() => setExportOpen(false), [])

   // Save as PDF: the browser print dialog over the paged export HTML, using the document's own theme /
   // accent / presentation / format. printDocument self-measures the paged layout offscreen, so the PDF
   // is the same whether the app is in Preview or Edit and regardless of what the editor has measured.
   // Commit any active edit first (blur) so the print sees the committed model.
   const handleSaveAsPdf = useCallback(() => {
      const active = document.activeElement as HTMLElement | null
      if (active && active.isContentEditable) active.blur()
      void printDocument(meta, sections, { theme: docTheme, accent: docAccent, lang, presentation, format })
   }, [meta, sections, docTheme, docAccent, lang, presentation, format])

   // The document editors (Presentation, Navigation, Page setup) are dockable panels now, not bespoke
   // windows. Their menu launchers reveal the panel (docking it if hidden) through the dock, so they
   // live just below the dock state (handleOpenPresentation / handleOpenNav / handleOpenFormat).

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

   // Ctrl+S / Cmd+S saves the active document (and binds a scratch tab to a binder record on its
   // first save). Unlike undo, it fires even while a field is focused, since that is exactly when
   // people reach for it. A block or the title commits only on blur (RichEditable / the title input),
   // so the in-progress edit lives in the DOM, not the model yet. Blur the focused field first to
   // flush its commit, then persist on the next tick once that write has landed in openDocumentsRef,
   // otherwise persistNow would save the last-committed content and drop the latest keystrokes. Only
   // active in document mode (the binder has no editable document of its own).
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

   // Open freshly-loaded content (File -> Open: JSON backup / Markdown / Mintdown) in a NEW tab,
   // activating it. Discards nothing (it never replaces another tab). The new tab is NOT a binder
   // record (documentId null) and stays that way: editing it no longer forks a record, only an
   // explicit Save (File -> Save / Save As) binds it. A JSON backup's presentation restores its saved
   // theme / accent / extras, a plain Markdown/Mintdown import lands with the document defaults.
   // Opening from a file never auto-creates a binder entry (Open is not Import); it reads as
   // "Never saved" and closeTab warns before the unsaved tab is lost.
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
      }
      setOpenDocuments(documents => [...documents, newTab])
      void activateTab(newTab.tabKey)
   }, [activateTab])

   // Import a Markdown file, parse it, open it in a new tab. Opening a file lands in the editor,
   // so leave binder mode if it was open.
   const handleImportMarkdown = useCallback((file: File): Promise<void> => {
      return importMarkdownFile(file).then(({ sections: newSections, meta: newMeta }) => {
         openLoadedInNewTab(newMeta, newSections)
         setBinderOpen(false)
      })
   }, [openLoadedInNewTab])

   // Import a Mintdown file, parse it, open it in a new tab.
   const handleImportMintdown = useCallback((file: File): Promise<void> => {
      return importMintdownFile(file).then(({ sections: newSections, meta: newMeta }) => {
         openLoadedInNewTab(newMeta, newSections)
         setBinderOpen(false)
      })
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

   // Close the binder back to the editor. The always-have-a-document invariant lives on the tab
   // list (openDocuments is never empty), so there is always a tab to return to, just close.
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

   // The dock owns the side panels' layout; applicability is driven by the active document's format
   // (Pages needs a paged doc) and mode (Pages needs edit mode). The Pages data + handlers are derived
   // here so the App-level dock can host the body directly, without WysiwygArea owning it.
   const panelContext: PanelContext = { formatKind: format?.kind ?? 'infinite', readOnly: mode === 'preview' }
   const dock      = useDockState(panelContext)
   const pagesData = usePagesPanelData(sections, format, commitSectionsAndFormat, t, documentPages.pages)

   // Menu launchers for the document-editor panels: reveal the panel (docking it if hidden) rather
   // than opening a window. Presentation also closes the Export dialog first, since one of its launch
   // points is the dialog's HTML branch.
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
            onImportMintdownFile={handleImportMintdown}
            onDocumentImported={handleDocumentImported}
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
               openDocumentIds={openDocumentIds}
               activeDocumentId={documentId}
               initialFolder={binderInitialFolder}
               refreshToken={binderRefreshToken}
               onOpenDocument={handleOpenDocument}
               onNewDocument={folderId => handleOpenNewDocument(folderId ?? null)}
               onNewFromTemplate={handleNewFromTemplate}
               onApplyTemplate={handleApplyTemplate}
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

            <ToastContainer />
            <UpdatePrompt />
         </LangProvider>
   )
}

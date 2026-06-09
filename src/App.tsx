// -- React Imports --
import { useCallback, useEffect, useRef, useState } from 'react'

// -- Lib / Util Imports --
import { mkSection } from './lib/document'
import { translations, type Lang } from './lib/i18n'
import { readAutosave, writeAutosave } from './lib/storage'

// -- Hook Imports --
import { useSectionMutations } from './hooks/useSectionMutations'
import { useBlockMutations } from './hooks/useBlockMutations'
import { useContainerMutations } from './hooks/useContainerMutations'

// -- Context Imports --
import { DocumentMutationsContext } from './contexts/DocumentMutationsContext'
import { LangProvider } from './contexts/LangContext'

// -- Component Imports --
import { Topbar } from './organisms/Topbar'
import { Panel } from './organisms/Panel'
import { WysiwygArea } from './organisms/WysiwygArea'
import { MarkdownPanel } from './organisms/MarkdownPanel'
import { WorkspaceLayout } from './organisms/WorkspaceLayout'
import { ToastContainer } from './atoms/ToastContainer'

// -- Markdown Imports --
import { importMarkdownFile } from './lib/markdown'

// -- Type Imports --
import type { BlockType, DocMeta, DocState, Mode, PaneId, PaneNode, PaneSplit, SaveStatus, Section, ViewLayout } from './types'

const EMPTY_META: DocMeta = { module: '', title: '', author: '', date: '', env: '' }

const DEFAULT_SPLIT: PaneSplit = {
   kind:        'split',
   orientation: 'h',
   ratio:       0.5,
   children: [
      { kind: 'leaf', paneId: 'wysiwyg' },
      { kind: 'leaf', paneId: 'markdown' },
   ],
}

export default function App() {
   const [sections, setSections] = useState<Section[]>(() => readAutosave()?.sections ?? [mkSection()])
   const [meta, setMeta]         = useState<DocMeta>(() => readAutosave()?.meta ?? EMPTY_META)
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

   // Document appearance (independent of app theme)
   const [docTheme,  setDocTheme]  = useState<'light' | 'dark'>(() => readAutosave()?.docTheme  ?? 'light')
   const [docAccent, setDocAccent] = useState(                 () => readAutosave()?.docAccent ?? '#2dcea8')

   // ============================================================
   // Save status
   // ============================================================

   const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')

   const hasMountedRef    = useRef(false)
   const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
   const writeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

   // Autosave on any document change — debounced 1.5 seconds
   useEffect(() => {
      if (!hasMountedRef.current) { hasMountedRef.current = true; return }
      setSaveStatus('dirty')
      autosaveTimerRef.current = setTimeout(() => {
         setSaveStatus('saving')
         writeTimerRef.current = setTimeout(() => {
            writeAutosave({ meta, sections, docTheme, docAccent })
            setSaveStatus('saved')
         }, 400)
      }, 1500)
      return () => {
         if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current)
         if (writeTimerRef.current    !== null) clearTimeout(writeTimerRef.current)
      }
   }, [meta, sections, docTheme, docAccent])

   // Fade the "Saved" indicator out after 2.5 s
   useEffect(() => {
      if (saveStatus !== 'saved') return
      const clearTimer = setTimeout(() => setSaveStatus('clean'), 2500)
      return () => clearTimeout(clearTimer)
   }, [saveStatus])

   // Browser tab title — asterisk while dirty
   useEffect(() => {
      const baseTitle = meta.title ? `${meta.title} — Documinter` : 'Documinter'
      document.title  = saveStatus !== 'clean' ? `* ${baseTitle}` : baseTitle
   }, [saveStatus, meta.title])

   // Manual save: cancel any pending autosave, write immediately, mark saved
   const handleManualSave = useCallback(() => {
      if (autosaveTimerRef.current !== null) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
      if (writeTimerRef.current    !== null) { clearTimeout(writeTimerRef.current);    writeTimerRef.current    = null }
      writeAutosave({ meta, sections, docTheme, docAccent })
      setSaveStatus('saved')
   }, [meta, sections, docTheme, docAccent])

   // Mode system
   const [mode, setMode] = useState<Mode>('wysiwyg')

   function handleSetMode(newMode: Mode) {
      if (newMode === mode) { setMode('wysiwyg'); return }
      setMode(newMode)
   }

   // ============================================================
   // Pane layout system
   // ============================================================

   const [paneLayout, setPaneLayout] = useState<PaneNode>(() => {
      try {
         const stored = localStorage.getItem('documinter-pane-layout')
         if (stored) {
            const parsed = JSON.parse(stored)
            if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
               return parsed as PaneNode
            }
         }
      } catch {}
      return { kind: 'leaf', paneId: 'wysiwyg' }
   })

   // Tracks the last known split config so Ctrl+\ can restore it when cycling back.
   const lastSplitRef = useRef<PaneSplit>(
      paneLayout.kind === 'split' ? (paneLayout as PaneSplit) : DEFAULT_SPLIT
   )

   // Keep lastSplitRef current whenever the layout is a split.
   useEffect(() => {
      if (paneLayout.kind === 'split') lastSplitRef.current = paneLayout as PaneSplit
   }, [paneLayout])

   // Persist pane layout to localStorage.
   useEffect(() => {
      localStorage.setItem('documinter-pane-layout', JSON.stringify(paneLayout))
   }, [paneLayout])

   // Ctrl+\ / Cmd+\ cycles through the three layout modes.
   useEffect(() => {
      const VIEW_CYCLE: ViewLayout[] = ['wysiwyg', 'split', 'markdown']

      function handleKeyDown(event: KeyboardEvent): void {
         if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
            event.preventDefault()
            setPaneLayout(currentLayout => {
               const currentViewLayout: ViewLayout =
                  currentLayout.kind === 'split' ? 'split' :
                  currentLayout.paneId === 'wysiwyg' ? 'wysiwyg' : 'markdown'
               const nextViewLayout = VIEW_CYCLE[(VIEW_CYCLE.indexOf(currentViewLayout) + 1) % VIEW_CYCLE.length]
               if (nextViewLayout === 'split') return lastSplitRef.current
               const paneId: PaneId = nextViewLayout === 'wysiwyg' ? 'wysiwyg' : 'markdown'
               return { kind: 'leaf', paneId }
            })
         }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [])

   // Converts a ViewLayout enum (from the ViewMenu) into a PaneNode.
   const handleViewLayoutChange = useCallback((layout: ViewLayout) => {
      if (layout === 'split') {
         setPaneLayout(lastSplitRef.current)
      } else {
         const paneId: PaneId = layout === 'wysiwyg' ? 'wysiwyg' : 'markdown'
         setPaneLayout({ kind: 'leaf', paneId })
      }
   }, [])

   // ============================================================
   // Document-level callbacks
   // ============================================================

   // Commit from the MarkdownPanel back into document state.
   const handleMarkdownCommit = useCallback((newSections: Section[], newMeta: DocMeta) => {
      setSections(newSections)
      setMeta(newMeta)
   }, [])

   // Wipe document and start fresh.
   const handleNewDocument = useCallback(() => {
      setSections([mkSection()])
      setMeta(EMPTY_META)
   }, [])

   // Import a Markdown file, parse it, replace the document.
   const handleImportMarkdown = useCallback((file: File): Promise<void> => {
      return importMarkdownFile(file).then(({ sections: newSections, meta: newMeta }) => {
         setSections(newSections)
         setMeta(newMeta)
      })
   }, [])

   // Meta
   const handleMetaChange = useCallback((patch: Partial<DocMeta>) => {
      setMeta(currentMeta => ({ ...currentMeta, ...patch }))
   }, [])

   // Load state from JSON
   const handleLoad = useCallback((state: DocState) => {
      setMeta(state.meta)
      setSections(state.sections)
   }, [])

   // Mutations — extracted into focused hooks
   const sectionMutations   = useSectionMutations(setSections, t)
   const blockMutations     = useBlockMutations(setSections, t)
   const containerMutations = useContainerMutations(setSections, t)

   return (
      <LangProvider lang={lang} setLang={setLang}>
            <Topbar
               meta={meta}
               sections={sections}
               theme={theme}
               docTheme={docTheme}
               docAccent={docAccent}
               mode={mode}
               paneLayout={paneLayout}
               saveStatus={saveStatus}
               onLoad={handleLoad}
               onToggleTheme={toggleTheme}
               onSetMode={handleSetMode}
               onViewLayoutChange={handleViewLayoutChange}
               onManualSave={handleManualSave}
               onNewDocument={handleNewDocument}
               onImportMarkdown={handleImportMarkdown}
               onDocThemeChange={setDocTheme}
               onDocAccentChange={setDocAccent}
               onAddSection={sectionMutations.addSection}
               onAddBlock={(sectionId: string, type: BlockType) => blockMutations.addBlock(sectionId, type)}
               onMetaChange={handleMetaChange}
            />

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
                     wysiwygPane={
                        <WysiwygArea
                           meta={meta}
                           sections={sections}
                           docTheme={docTheme}
                           docAccent={docAccent}
                           onUpdateMeta={handleMetaChange}
                           readOnly={mode === 'preview'}
                        />
                     }
                     markdownPane={
                        <MarkdownPanel
                           sections={sections}
                           meta={meta}
                           onCommit={handleMarkdownCommit}
                        />
                     }
                  />
               </div>
            </DocumentMutationsContext.Provider>

            <ToastContainer />
         </LangProvider>
   )
}

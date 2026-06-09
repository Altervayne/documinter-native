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

// -- Type Imports --
import type { DocMeta, DocState, Mode, SaveStatus, Section, ViewLayout } from './types'

const EMPTY_META: DocMeta = { module: '', title: '', author: '', date: '', env: '' }

export default function App() {
   const [sections, setSections] = useState<Section[]>(() => readAutosave()?.sections ?? [mkSection()])
   const [meta, setMeta]         = useState<DocMeta>(() => readAutosave()?.meta ?? EMPTY_META)
   const [panelOpen, setPanelOpen] = useState(true)

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

   // View layout system (wysiwyg / split / markdown)
   const [viewLayout,  setViewLayout]  = useState<ViewLayout>('wysiwyg')
   const [splitRatio,  setSplitRatio]  = useState(0.5)

   // Ctrl+\ / Cmd+\ cycles through view layout states.
   useEffect(() => {
      const VIEW_CYCLE: ViewLayout[] = ['wysiwyg', 'split', 'markdown']
      function handleKeyDown(event: KeyboardEvent) {
         if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
            event.preventDefault()
            setViewLayout(current => {
               const currentIndex = VIEW_CYCLE.indexOf(current)
               return VIEW_CYCLE[(currentIndex + 1) % VIEW_CYCLE.length]
            })
         }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [])

   // Commit from the MarkdownPanel back into document state.
   const handleMarkdownCommit = useCallback((newSections: Section[], newMeta: DocMeta) => {
      setSections(newSections)
      setMeta(newMeta)
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
               viewLayout={viewLayout}
               saveStatus={saveStatus}
               onLoad={handleLoad}
               onToggleTheme={toggleTheme}
               onSetMode={handleSetMode}
               onViewLayoutChange={setViewLayout}
               onManualSave={handleManualSave}
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
                     docTheme={docTheme}
                     docAccent={docAccent}
                     onDocThemeChange={setDocTheme}
                     onDocAccentChange={setDocAccent}
                     onToggle={() => setPanelOpen(currentlyOpen => !currentlyOpen)}
                     sections={sections}
                     onAddSection={sectionMutations.addSection}
                     onToggleSec={sectionMutations.toggleSec}
                     onMoveSecUp={sectionMutations.moveSecUp}
                     onMoveSecDown={sectionMutations.moveSecDown}
                     onDuplicateSec={sectionMutations.duplicateSec}
                     onRemoveSec={sectionMutations.removeSec}
                     onAddBlock={blockMutations.addBlock}
                     onMoveBlkUp={blockMutations.moveBlkUp}
                     onMoveBlkDown={blockMutations.moveBlkDown}
                     onRemoveBlk={blockMutations.removeBlk}
                     onReorderSections={sectionMutations.reorderSections}
                     onReorderBlocks={blockMutations.reorderBlocks}
                  />

                  <WorkspaceLayout
                     viewLayout={viewLayout}
                     splitRatio={splitRatio}
                     onSplitRatio={setSplitRatio}
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

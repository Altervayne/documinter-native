// -- React Imports --
import { useCallback, useEffect, useState } from 'react'

// -- Lib / Util Imports --
import { mkSection } from './lib/state'
import { translations, type Lang } from './lib/i18n'

// -- Hook Imports --
import { useSectionMutations } from './hooks/useSectionMutations'
import { useBlockMutations } from './hooks/useBlockMutations'
import { useContainerMutations } from './hooks/useContainerMutations'

// -- Context Imports --
import { DocumentMutationsContext } from './lib/DocumentMutationsContext'

// -- Component Imports --
import { Topbar } from './organisms/Topbar'
import { Panel } from './organisms/Panel'
import { WysiwygArea } from './organisms/WysiwygArea'
import { Toast } from './atoms/Toast'
import { LangProvider } from './lib/LangContext'

// -- Type Imports --
import type { DocMeta, DocState, Section } from './types'

const EMPTY_META: DocMeta = { module: '', title: '', author: '', date: '', env: '' }

export default function App() {
   const [sections, setSections] = useState<Section[]>(() => [mkSection()])
   const [meta, setMeta]         = useState<DocMeta>(EMPTY_META)
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

   // Dynamic page title
   useEffect(() => {
      document.title = meta.title ? `${meta.title} — Documinter` : 'Documinter'
   }, [meta.title])

   // Document appearance (independent of app theme)
   const [docTheme,  setDocTheme]  = useState<'light' | 'dark'>('light')
   const [docAccent, setDocAccent] = useState('#2dcea8')

   // Toast
   const [toast, setToast]         = useState('')
   const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | undefined>()

   function showToast(msg: string, action?: { label: string; onClick: () => void }) {
      setToast(msg)
      setToastAction(action)
   }
   function clearToast() {
      setToast('')
      setToastAction(undefined)
   }

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
   const sectionMutations   = useSectionMutations(setSections, showToast, clearToast, t)
   const blockMutations     = useBlockMutations(setSections, showToast, clearToast, t)
   const containerMutations = useContainerMutations(setSections, t)

   return (
      <LangProvider lang={lang} setLang={setLang}>
         <Topbar
            meta={meta}
            sections={sections}
            theme={theme}
            docTheme={docTheme}
            docAccent={docAccent}
            onLoad={handleLoad}
            onToast={msg => showToast(msg)}
            onToggleTheme={toggleTheme}
         />

         <DocumentMutationsContext.Provider value={{
            updateBlock:       blockMutations.updateBlock,
            addBlock:          blockMutations.addBlock,
            removeBlock:       blockMutations.removeBlk,
            duplicateBlock:    blockMutations.duplicateBlock,
            reorderBlocks:     blockMutations.reorderBlocks,
            addListItem:       blockMutations.addListItem,
            removeLastItem:    blockMutations.removeLastItem,
            addTableRow:       blockMutations.addTableRow,
            removeLastRow:     blockMutations.removeLastRow,
            addTableCol:       blockMutations.addTableCol,
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
                  onRemoveSec={sectionMutations.removeSec}
                  onAddBlock={blockMutations.addBlock}
                  onMoveBlkUp={blockMutations.moveBlkUp}
                  onMoveBlkDown={blockMutations.moveBlkDown}
                  onRemoveBlk={blockMutations.removeBlk}
                  onReorderSections={sectionMutations.reorderSections}
                  onReorderBlocks={blockMutations.reorderBlocks}
               />

               <WysiwygArea
                  meta={meta}
                  sections={sections}
                  docTheme={docTheme}
                  docAccent={docAccent}
                  onUpdateMeta={handleMetaChange}
               />
            </div>
         </DocumentMutationsContext.Provider>

         <Toast message={toast} action={toastAction} onDone={clearToast} />
      </LangProvider>
   )
}

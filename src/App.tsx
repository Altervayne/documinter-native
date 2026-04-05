// -- React Imports --
import { useCallback, useEffect, useState } from 'react'
import type React from 'react'

// -- Lib / Util Imports --
import { mkSection } from './lib/state'
import { translations, type Lang } from './lib/i18n'
import { documentToMintdown, downloadMintdown, mintdownToDocument } from './lib/mintdown'
import { loadMintdownFile } from './lib/saveload'

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
import { MintdownEditor } from './organisms/MintdownEditor'
import { Toast } from './atoms/Toast'
import { LangProvider } from './lib/LangContext'

// -- Type Imports --
import type { DocMeta, DocState, Mode, Section } from './types'

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

   // Mode system
   const [mode, setMode]           = useState<Mode>('wysiwyg')
   const [rawText, setRawText]     = useState('')
   const [rawTextDirty, setRawTextDirty]       = useState(true)
   const [previewSections, setPreviewSections] = useState<Section[]>([])
   const [previewMeta, setPreviewMeta]         = useState<Partial<DocMeta>>({})

   // Wrapper that marks rawText stale whenever wysiwyg mutations change sections
   const setSectionsAndMarkDirty = useCallback((updater: React.SetStateAction<Section[]>) => {
      setSections(updater)
      setRawTextDirty(true)
   }, [])

   function handleSetMode(newMode: Mode) {
      if (newMode === mode) { setMode('wysiwyg'); return }

      if (newMode === 'raw' || newMode === 'split') {
         if (rawTextDirty) {
            const text = documentToMintdown(meta, sections)
            setRawText(text)
            setRawTextDirty(false)
            if (newMode === 'split') {
               const result = mintdownToDocument(text)
               setPreviewSections(result.sections)
               setPreviewMeta(result.meta)
            }
         } else if (newMode === 'split') {
            // rawText already valid — just init preview from it
            const result = mintdownToDocument(rawText)
            setPreviewSections(result.sections)
            setPreviewMeta(result.meta)
         }
      } else if (mode === 'raw' || mode === 'split') {
         const result = mintdownToDocument(rawText)
         if (result.sections.length > 0) {
            setSections(result.sections)        // direct setter — rawText is still valid
            handleMetaChange(result.meta as Partial<DocMeta>)
            setRawTextDirty(false)
         }
      }
      setMode(newMode)
   }

   // Live split preview — debounced 300ms
   useEffect(() => {
      if (mode !== 'split') return
      const timer = setTimeout(() => {
         const result = mintdownToDocument(rawText)
         setPreviewSections(result.sections)
         setPreviewMeta(result.meta)
      }, 300)
      return () => clearTimeout(timer)
   }, [rawText, mode])

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
      setRawTextDirty(true)
   }, [])

   // Mutations — extracted into focused hooks
   const sectionMutations   = useSectionMutations(setSectionsAndMarkDirty, showToast, clearToast, t)
   const blockMutations     = useBlockMutations(setSectionsAndMarkDirty, showToast, clearToast, t)
   const containerMutations = useContainerMutations(setSectionsAndMarkDirty, t)

   function handleDownloadMintdown() {
      const text = (mode === 'raw' || mode === 'split') ? rawText : documentToMintdown(meta, sections)
      downloadMintdown(text, meta.title)
   }

   function handleLoadMintdown() {
      loadMintdownFile(
         text => {
            const result = mintdownToDocument(text)
            if (result.sections.length > 0) {
               setSections(result.sections)
               handleMetaChange(result.meta as Partial<DocMeta>)
               setRawText(text)
               setRawTextDirty(false)
               setMode('wysiwyg')
               showToast(t.mintLoaded)
            } else {
               showToast('No sections found in file.')
            }
         },
         msg => showToast(msg),
      )
   }

   return (
      <LangProvider lang={lang} setLang={setLang}>
         <Topbar
            meta={meta}
            sections={sections}
            theme={theme}
            docTheme={docTheme}
            docAccent={docAccent}
            mode={mode}
            onLoad={handleLoad}
            onToast={msg => showToast(msg)}
            onToggleTheme={toggleTheme}
            onSetMode={handleSetMode}
            onDownloadMintdown={handleDownloadMintdown}
            onLoadMintdown={handleLoadMintdown}
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

               {mode === 'wysiwyg' && (
                  <WysiwygArea
                     meta={meta}
                     sections={sections}
                     docTheme={docTheme}
                     docAccent={docAccent}
                     onUpdateMeta={handleMetaChange}
                  />
               )}
               {mode === 'preview' && (
                  <WysiwygArea
                     meta={meta}
                     sections={sections}
                     docTheme={docTheme}
                     docAccent={docAccent}
                     onUpdateMeta={handleMetaChange}
                     readOnly
                  />
               )}
               {mode === 'raw' && (
                  <MintdownEditor value={rawText} onChange={setRawText} />
               )}
               {mode === 'split' && (
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                     <MintdownEditor value={rawText} onChange={setRawText} />
                     <div className="w-px shrink-0 bg-border" />
                     <WysiwygArea
                        meta={{ ...meta, ...previewMeta } as DocMeta}
                        sections={previewSections}
                        docTheme={docTheme}
                        docAccent={docAccent}
                        onUpdateMeta={handleMetaChange}
                        readOnly
                     />
                  </div>
               )}
            </div>
         </DocumentMutationsContext.Provider>

         <Toast message={toast} action={toastAction} onDone={clearToast} />
      </LangProvider>
   )
}

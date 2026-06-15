// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Type Imports --
import type { BlockType, DocMeta, DocState, Mode, PaneId, PaneNode, SaveStatus, Section } from '../types'
import { isPanelVisible } from '../lib/paneTree'

// -- Atom Imports --
import { Button } from '../atoms/Button'
import { LogoColor, LogoMono } from '../atoms/Logo'

// -- Organism Imports --
import { ExportModal } from './ExportModal'

// -- Molecule Imports --
import { ViewMenu } from '../molecules/ViewMenu'
import { FileMenu } from '../molecules/FileMenu'
import { InsertMenu } from '../molecules/InsertMenu'
import { AppearanceMenu } from '../molecules/AppearanceMenu'
import { AboutMenu } from '../molecules/AboutMenu'

// -- Lib Imports --
import { downloadJSON, loadJSONFile } from '../lib/storage'
import { documentToMarkdown } from '../lib/markdown'
import { exportMintdownFile } from '../lib/mintdown'

// -- Icon Imports --
import { Eye, Download, CircleDot, Loader2, CircleCheck } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'

// #########################
// # SAVE STATUS INDICATOR #
// #########################

interface SaveStatusIndicatorProps {
   status:      SaveStatus
   labelDirty:  string
   labelSaving: string
   labelSaved:  string
}

function SaveStatusIndicator({ status, labelDirty, labelSaving, labelSaved }: SaveStatusIndicatorProps) {
   // Remember the last non-clean status so the pill keeps showing that label
   // while it fades out after the status returns to 'clean'. This uses React's
   // "adjust state during render" pattern so we never read/write a ref in render.
   const [displayed, setDisplayed] = useState<'dirty' | 'saving' | 'saved'>('dirty')

   if (status !== 'clean' && status !== displayed) setDisplayed(status)

   const isVisible = status !== 'clean'

   return (
      <div className={`flex items-center gap-1.5 font-mono text-xs select-none pointer-events-none transition-opacity duration-500 ${
         isVisible ? 'opacity-100' : 'opacity-0'
      } ${
         displayed === 'dirty'  ? 'text-yellow' :
         displayed === 'saving' ? 'text-muted'  :
         'text-green'
      }`}>
         {displayed === 'dirty'  && <CircleDot   size={12} />}
         {displayed === 'saving' && <Loader2     size={12} className="animate-spin" />}
         {displayed === 'saved'  && <CircleCheck size={12} />}
         <span>
            {displayed === 'dirty'  ? labelDirty  :
             displayed === 'saving' ? labelSaving :
             labelSaved}
         </span>
      </div>
   )
}

// #########
// # PROPS #
// #########

interface TopbarProps {
   meta:             DocMeta
   sections:         Section[]
   theme:            'dark' | 'light'
   docTheme:         'light' | 'dark'
   docAccent:        string
   mode:             Mode
   paneLayout:       PaneNode
   saveStatus:       SaveStatus
   onLoad:           (state: DocState) => void
   onToggleTheme:    () => void
   onSetMode:        (mode: Mode) => void
   onTogglePanel:    (id: PaneId) => void
   onManualSave:     () => void
   onOpenBinder:     () => void
   onNewDocument:    () => void
   onImportMarkdown: (file: File) => Promise<void>
   onImportMintdown: (file: File) => Promise<void>
   onDocThemeChange: (theme: 'light' | 'dark') => void
   onDocAccentChange:(hex: string) => void
   onAddSection:     () => void
   onAddBlock:       (sectionId: string, type: BlockType) => void
   onMetaChange:     (patch: Partial<DocMeta>) => void
}

// #############
// # COMPONENT #
// #############

export function Topbar({
   meta, sections, theme, docTheme, docAccent, mode, paneLayout, saveStatus,
   onLoad, onToggleTheme, onSetMode, onTogglePanel, onManualSave, onOpenBinder,
   onNewDocument, onImportMarkdown, onImportMintdown, onDocThemeChange, onDocAccentChange,
   onAddSection, onAddBlock, onMetaChange,
}: TopbarProps) {
   const [exportOpen,    setExportOpen]    = useState(false)
   const [titleEditing,  setTitleEditing]  = useState(false)
   const [titleDraft,    setTitleDraft]    = useState('')
   const titleInputRef                     = useRef<HTMLInputElement>(null)
   const suppressNextBlurRef               = useRef(false)
   const { t, lang, setLang }              = useLang()
   const { showToast }                     = useToast()

   const lastSectionId  = sections.at(-1)?.id ?? null
   const isMarkdownOnly = !isPanelVisible(paneLayout, 'wysiwyg')

   // ==============
   //  Title editing
   // ==============

   function handleTitleClick() {
      setTitleDraft(meta.title)
      setTitleEditing(true)
   }

   // Select all text once the input mounts
   useEffect(() => {
      if (titleEditing) titleInputRef.current?.select()
   }, [titleEditing])

   function commitTitle(value: string) {
      const trimmed = value.trim()
      // Empty value → keep current title (no change)
      onMetaChange({ title: trimmed || meta.title })
      setTitleEditing(false)
   }

   function handleTitleBlur() {
      if (suppressNextBlurRef.current) {
         suppressNextBlurRef.current = false
         return
      }
      commitTitle(titleDraft)
   }

   function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Enter') {
         event.preventDefault()
         suppressNextBlurRef.current = true   // prevent double-commit on the resulting blur
         commitTitle(titleDraft)
         titleInputRef.current?.blur()
      } else if (event.key === 'Escape') {
         suppressNextBlurRef.current = true
         setTitleEditing(false)
         titleInputRef.current?.blur()
      }
   }

   // =============
   //  File actions
   // =============

   function handleLoadJSON() {
      loadJSONFile(
         (state: DocState) => { onLoad(state); showToast(t.jsonBackupImported, { type: 'success' }) },
         (message: string) => showToast(message, { type: 'error' }),
      )
   }

   function handleSaveJSON() {
      downloadJSON(meta, sections)
      onManualSave()
      showToast(t.jsonBackupExported, { type: 'success' })
   }

   function handleNewDocument() {
      if (!window.confirm(t.newDocumentConfirm)) return
      onNewDocument()
   }

   function handleImportMarkdownClick() {
      const input    = document.createElement('input')
      input.type     = 'file'
      input.accept   = '.md,.markdown,.txt'
      input.onchange = async () => {
         const file = input.files?.[0]
         if (!file) return
         try {
            await onImportMarkdown(file)
            showToast(t.markdownImported, { type: 'success' })
         } catch {
            showToast('Import failed', { type: 'error' })
         }
      }
      input.click()
   }

   function handleExportMarkdownClick() {
      const markdownContent = documentToMarkdown(sections, meta)
      const blob            = new Blob([markdownContent], { type: 'text/markdown' })
      const url             = URL.createObjectURL(blob)
      const anchor          = document.createElement('a')
      const filename        = (meta.title || 'document').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()
      anchor.href           = url
      anchor.download       = `${filename}.md`
      anchor.click()
      URL.revokeObjectURL(url)
      showToast(t.markdownExported, { type: 'success' })
   }

   function handleImportMintdownClick() {
      const input    = document.createElement('input')
      input.type     = 'file'
      input.accept   = '.mintd,.txt'
      input.onchange = async () => {
         const file = input.files?.[0]
         if (!file) return
         try {
            await onImportMintdown(file)
            showToast(t.mintdownImported, { type: 'success' })
         } catch {
            showToast('Import failed', { type: 'error' })
         }
      }
      input.click()
   }

   function handleExportMintdownClick() {
      exportMintdownFile(sections, meta)
      showToast(t.mintdownExported, { type: 'success' })
   }

   // ===============
   //  Preview toggle
   // ===============

   function handlePreviewClick() {
      onSetMode(mode === 'preview' ? 'wysiwyg' : 'preview')
   }

   // =======
   //  Render
   // =======

   return (
      <>
         <div className="shrink-0 flex flex-col z-200">

            {/* ================================================= */}
            {/*  Top strip, brand · document title · save status */}
            {/* ================================================= */}
            <div className="h-11 relative flex items-center px-4 bg-raised border-b border-border">

               {/* Brand, left anchor */}
               <div className="flex items-center gap-2 shrink-0 select-none">
                  {theme === 'dark'
                     ? <LogoColor className="h-7 w-auto" />
                     : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
                  }
                  <span className="font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
               </div>

               {/* Document title, absolutely centered
                   max-w-[40%] is the collision guard: the title can never
                   overlap the brand area or save indicator at any viewport width. */}
               <div className="absolute left-1/2 -translate-x-1/2 inset-y-0 flex items-center min-w-0 max-w-[40%]">
                  {titleEditing ? (
                     <input
                        ref={titleInputRef}
                        type="text"
                        aria-label={t.docTitle}
                        value={titleDraft}
                        onChange={event => setTitleDraft(event.target.value)}
                        onBlur={handleTitleBlur}
                        onKeyDown={handleTitleKeyDown}
                        className="font-mono text-sm bg-transparent border-0 border-b border-accent/60 outline-none w-full text-center text-text"
                     />
                  ) : (
                     <span
                        onClick={handleTitleClick}
                        title={meta.title || t.untitledDoc}
                        className="font-mono text-sm text-text/60 truncate cursor-text hover:text-text/90 select-none transition-colors"
                     >
                        {meta.title || t.untitledDoc}
                     </span>
                  )}
               </div>

               {/* Save status indicator, right anchor */}
               <div className="ml-auto shrink-0 flex items-center">
                  <SaveStatusIndicator
                     status={saveStatus}
                     labelDirty={t.unsavedChanges}
                     labelSaving={t.autosaving}
                     labelSaved={t.saved}
                  />
               </div>
            </div>

            {/* =============================== */}
            {/*  Bottom strip, menus · actions */}
            {/* =============================== */}
            <div className="flex items-center gap-1 p-1 bg-raised border-b border-border">

               {/* Menu bar */}
               <FileMenu
                  onOpenBinder={onOpenBinder}
                  onSaveNow={onManualSave}
                  onNewDocument={handleNewDocument}
                  onLoadJSON={handleLoadJSON}
                  onSaveJSON={handleSaveJSON}
                  onImportMarkdown={handleImportMarkdownClick}
                  onExportMarkdown={handleExportMarkdownClick}
                  onImportMintdown={handleImportMintdownClick}
                  onExportMintdown={handleExportMintdownClick}
                  onOpenExportModal={() => setExportOpen(true)}
                  t={t}
               />
               <ViewMenu
                  paneLayout={paneLayout}
                  onTogglePanel={onTogglePanel}
                  t={t}
               />
               <InsertMenu
                  lastSectionId={lastSectionId}
                  onAddSection={onAddSection}
                  onAddBlock={onAddBlock}
                  t={t}
               />
               <AppearanceMenu
                  theme={theme}
                  onToggleTheme={onToggleTheme}
                  lang={lang}
                  onLangChange={setLang}
                  docTheme={docTheme}
                  onDocThemeChange={onDocThemeChange}
                  docAccent={docAccent}
                  onDocAccentChange={onDocAccentChange}
                  t={t}
               />
               <AboutMenu theme={theme} t={t} />

               {/* Spacer, pushes actions to the far right */}
               <div className="flex-1" />

               {/* Quick actions */}
               <Button
                  variant="ghost"
                  onClick={handlePreviewClick}
                  disabled={isMarkdownOnly}
                  style={mode === 'preview' && !isMarkdownOnly ? { color: 'var(--color-accent)' } : undefined}
               >
                  <Eye size={14} />{t.previewMode}
               </Button>
               <Button variant="primary" onClick={() => setExportOpen(true)}>
                  <Download size={14} />{t.export}
               </Button>
            </div>
         </div>

         {exportOpen && (
            <ExportModal
               meta={meta}
               sections={sections}
               defaultTheme={docTheme}
               defaultAccent={docAccent}
               lang={lang}
               onClose={() => setExportOpen(false)}
            />
         )}
      </>
   )
}

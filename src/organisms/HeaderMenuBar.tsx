// -- React Imports --
import { useState } from 'react'

// -- Type Imports --
import type { DocMeta, DocState, Mode, PaneId, PaneNode, SaveStatus, Section } from '../types'
import { isPanelVisible } from '../lib/paneTree'

// -- Atom Imports --
import { Button } from '../atoms/Button'
import { LogoColor, LogoMono } from '../atoms/Logo'

// -- Organism Imports --
import { ExportModal } from './ExportModal'

// -- Molecule Imports --
import { FileMenu } from '../molecules/FileMenu'
import { ViewMenu } from '../molecules/ViewMenu'
import { AppearanceMenu } from '../molecules/AppearanceMenu'
import { AboutMenu } from '../molecules/AboutMenu'
import { ConfirmDialog } from '../molecules/ConfirmDialog'

// -- Lib Imports --
import { downloadJSON, loadJSONFile } from '../lib/documentBackupFile'
import type { DocPresentation } from '../lib/binderDocuments'
import { exportMarkdownFile } from '../lib/markdown'
import { exportMintdownFile } from '../lib/mintdown'

// -- Icon Imports --
import { Eye, Download, Library, PanelLeftClose, CircleDot, Loader2, CircleCheck } from 'lucide-react'

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

interface HeaderMenuBarProps {
   /** Binder vs document context, read from App's binderOpen state. Drives menu greying + actions. */
   mode:             'binder' | 'document'
   meta:             DocMeta
   sections:         Section[]
   theme:            'dark' | 'light'
   docTheme:         'light' | 'dark'
   docAccent:        string
   /** The editor preview toggle (wysiwyg/preview), distinct from the binder/document mode above. */
   previewMode:      Mode
   paneLayout:       PaneNode
   saveStatus:       SaveStatus
   onLoad:           (state: DocState, presentation: DocPresentation) => void
   onToggleTheme:    () => void
   onSetMode:        (mode: Mode) => void
   onTogglePanel:    (id: PaneId) => void
   onManualSave:     () => void
   onNew:            () => void
   onToggleBinder:   () => void
   onImportMarkdownFile: (file: File) => Promise<void>
   onImportMintdownFile: (file: File) => Promise<void>
   onDocThemeChange: (theme: 'light' | 'dark') => void
   onDocAccentChange:(hex: string) => void
}

// #############
// # COMPONENT #
// #############

export function HeaderMenuBar({
   mode, meta, sections, theme, docTheme, docAccent, previewMode, paneLayout, saveStatus,
   onLoad, onToggleTheme, onSetMode, onTogglePanel, onManualSave, onNew, onToggleBinder,
   onImportMarkdownFile, onImportMintdownFile, onDocThemeChange, onDocAccentChange,
}: HeaderMenuBarProps) {
   const [exportOpen, setExportOpen]       = useState(false)
   const [confirmNewOpen, setConfirmNewOpen] = useState(false)
   const { t, lang, setLang }              = useLang()
   const { showToast }                     = useToast()

   const isDocumentMode = mode === 'document'
   const isMarkdownOnly = !isPanelVisible(paneLayout, 'wysiwyg')

   // Placeholder for features not built this session (Tin, Save as, binder-mode imports).
   function comingSoon() {
      showToast(t.comingSoon, { type: 'neutral' })
   }

   // =============
   //  File actions
   // =============

   function handleNew() {
      // Replacing the in-editor document warrants a confirm; in binder mode New simply spawns a
      // new document (the binder isn't an editable doc to clear), so no confirm there.
      if (isDocumentMode) setConfirmNewOpen(true)
      else onNew()
   }

   function handleOpenDocumint() {
      loadJSONFile(
         (state: DocState, presentation: DocPresentation) => { onLoad(state, presentation); showToast(t.jsonBackupImported, { type: 'success' }) },
         (message: string) => showToast(message, { type: 'error' }),
      )
   }

   function pickFile(accept: string, onPicked: (file: File) => Promise<void>) {
      const input  = document.createElement('input')
      input.type   = 'file'
      input.accept = accept
      input.onchange = async () => {
         const file = input.files?.[0]
         if (!file) return
         try {
            await onPicked(file)
         } catch {
            showToast(t.importFailed, { type: 'error' })
         }
      }
      input.click()
   }

   function handleOpenMarkdown() {
      pickFile('.md,.markdown,.txt', async (file) => { await onImportMarkdownFile(file); showToast(t.markdownImported, { type: 'success' }) })
   }

   function handleOpenMintdown() {
      pickFile('.mint,.mintdown,.txt', async (file) => { await onImportMintdownFile(file); showToast(t.mintdownImported, { type: 'success' }) })
   }

   function handleExportDocumint() {
      downloadJSON(meta, sections, { docTheme, docAccent })
      onManualSave()
      showToast(t.jsonBackupExported, { type: 'success' })
   }

   function handleExportMarkdown() {
      exportMarkdownFile(sections, meta)
      showToast(t.markdownExported, { type: 'success' })
   }

   function handleExportMintdown() {
      exportMintdownFile(sections, meta)
      showToast(t.mintdownExported, { type: 'success' })
   }

   function handlePreviewClick() {
      onSetMode(previewMode === 'preview' ? 'wysiwyg' : 'preview')
   }

   // =======
   //  Render
   // =======

   return (
      <>
         <div className="shrink-0 flex items-center gap-1 p-1 px-3 bg-raised border-b border-border z-200">

            {/* Brand, left anchor */}
            <div className="flex items-center gap-2 mr-2 shrink-0 select-none">
               {theme === 'dark'
                  ? <LogoColor className="h-7 w-auto" />
                  : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
               }
               <span className="font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
            </div>

            {/* Menu bar */}
            <FileMenu
               mode={mode}
               onNewDocument={handleNew}
               onOpenTin={comingSoon}
               onOpenDocumint={handleOpenDocumint}
               onOpenMarkdown={handleOpenMarkdown}
               onOpenMintdown={handleOpenMintdown}
               onSave={onManualSave}
               onSaveAs={comingSoon}
               onExportDocumint={handleExportDocumint}
               onExportMarkdown={handleExportMarkdown}
               onExportMintdown={handleExportMintdown}
               onImportDocumint={comingSoon}
               onImportMarkdown={comingSoon}
               onImportMintdown={comingSoon}
               t={t}
            />
            {isDocumentMode && <ViewMenu paneLayout={paneLayout} onTogglePanel={onTogglePanel} t={t} />}
            <AppearanceMenu
               theme={theme}
               onToggleTheme={onToggleTheme}
               lang={lang}
               onLangChange={setLang}
               showDocumentSettings={isDocumentMode}
               docTheme={docTheme}
               onDocThemeChange={onDocThemeChange}
               docAccent={docAccent}
               onDocAccentChange={onDocAccentChange}
               t={t}
            />
            <AboutMenu theme={theme} t={t} />

            {/* Spacer, pushes actions to the far right */}
            <div className="flex-1" />

            {/* Save status */}
            <div className="shrink-0 flex items-center mr-1">
               <SaveStatusIndicator
                  status={saveStatus}
                  labelDirty={t.unsavedChanges}
                  labelSaving={t.autosaving}
                  labelSaved={t.saved}
               />
            </div>

            {/* Standalone binder toggle, always visible; label reflects mode */}
            <Button
               variant={isDocumentMode ? 'ghost' : 'primary'}
               onClick={onToggleBinder}
            >
               {isDocumentMode ? <Library size={14} /> : <PanelLeftClose size={14} />}
               {isDocumentMode ? t.openBinder : t.closeBinder}
            </Button>

            {/* Document-only quick actions */}
            {isDocumentMode && (
               <>
                  <Button
                     variant="ghost"
                     onClick={handlePreviewClick}
                     disabled={isMarkdownOnly}
                     style={previewMode === 'preview' && !isMarkdownOnly ? { color: 'var(--color-accent)' } : undefined}
                  >
                     <Eye size={14} />{t.previewMode}
                  </Button>
                  <Button variant="primary" onClick={() => setExportOpen(true)}>
                     <Download size={14} />{t.export}
                  </Button>
               </>
            )}
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

         {confirmNewOpen && (
            <ConfirmDialog
               title={t.newDocument}
               message={t.newDocumentConfirm}
               confirmLabel={t.newDocumentProceed}
               cancelLabel={t.binderUnsavedCancel}
               onConfirm={() => { setConfirmNewOpen(false); onNew() }}
               onCancel={() => setConfirmNewOpen(false)}
            />
         )}
      </>
   )
}

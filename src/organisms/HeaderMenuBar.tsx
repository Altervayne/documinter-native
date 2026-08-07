// -- React Imports --
import { useEffect, useState } from 'react'

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
import { ViewMenu, type DockPanelToggle } from '../molecules/ViewMenu'
import { PreferencesMenu } from '../molecules/PreferencesMenu'
import { DocumentMenu } from '../molecules/DocumentMenu'
import { AboutMenu } from '../molecules/AboutMenu'

// -- Lib Imports --
import { parseDocumentBackup } from '../lib/documentBackupFile'
import type { DocPresentation } from '../lib/binderDocuments'
import type { DocPresentationExtras } from '../lib/presentation'
import type { DocFormat } from '../lib/format'
import type { Page } from '../lib/pageModel'

// -- Icon Imports --
import { Eye, Library, PanelLeftClose, CircleDot, Loader2, CircleCheck } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'

// ====================
//  Open format sniffing
// ====================

// Route one picked file to the right existing loader. Extension decides when it is one we know;
// otherwise the trimmed content is sniffed: `{` -> JSON backup, `---` front matter -> Mintdown,
// anything else -> Markdown. HTML is export-only and never routed here.
type OpenFormat = 'backup' | 'mintdown' | 'markdown'

function detectOpenFormat(fileName: string, text: string): OpenFormat {
   const lowerName = fileName.toLowerCase()
   if (lowerName.endsWith('.json') || lowerName.endsWith('.documint')) return 'backup'
   if (lowerName.endsWith('.mint') || lowerName.endsWith('.mintd') || lowerName.endsWith('.mintdown')) return 'mintdown'
   if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'markdown'
   // Ambiguous / unknown extension (.txt, none, or anything else): sniff the content.
   const trimmed = text.trimStart()
   if (trimmed.startsWith('{'))   return 'backup'
   if (trimmed.startsWith('---')) return 'mintdown'
   return 'markdown'
}

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
   // while it fades out after the status returns to 'clean'. Uses React's
   // "adjust state during render" pattern, so no ref read/write happens during render.
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
   /** The dockable side panels applicable to the active document, shown as toggles in the View menu. */
   dockPanels:       DockPanelToggle[]
   onManualSave:     () => void
   onSaveAs:         () => void
   /** Save the active document's chrome as a reusable template (File -> Save as template). */
   onSaveAsTemplate: () => void
   onNew:            () => void
   /** Add a section to the active document, the Document menu's "Add section" entry. */
   onAddSection:     () => void
   onToggleBinder:   () => void
   onImportMarkdownFile: (file: File) => Promise<void>
   onImportMintdownFile: (file: File) => Promise<void>
   onDocThemeChange: (theme: 'light' | 'dark') => void
   onDocAccentChange:(hex: string) => void
   /** Export dialog open state, lifted to App.tsx so the document background context menu's
    *  "Export..." item and this header's File -> Export... / Ctrl+E both drive the same modal. */
   exportOpen:       boolean
   onOpenExport:     () => void
   onCloseExport:    () => void
   /** Presentation extras of the active document, threaded into the Export dialog's ExportOptions so
    *  a watermark bakes into the exported HTML. */
   presentation?:    DocPresentationExtras
   /** Opens the document-level Presentation window (from the Export dialog's HTML branch and the
    *  Document menu's "Presentation..." entry). */
   onOpenPresentation?: () => void
   /** Opens the document-level Navigation window (the Document menu's "Navigation..." entry). */
   onOpenNav?:          () => void
   /** Document page format (infinite width or paged A4) of the active document, threaded into
    *  the Export dialog's ExportOptions so a non-default width bakes into the exported HTML. */
   format?:    DocFormat
   /** The editor's measured reflow, threaded into the Export dialog so HTML / PDF match the editor. */
   pagedLayout?: Page[]
   /** Opens the document-level Page setup window (the Document menu's "Page setup..." entry). */
   onOpenFormat?: () => void
}

// #############
// # COMPONENT #
// #############

export function HeaderMenuBar({
   mode, meta, sections, theme, docTheme, docAccent, previewMode, paneLayout, saveStatus,
   onLoad, onToggleTheme, onSetMode, onTogglePanel, dockPanels, onManualSave, onSaveAs, onSaveAsTemplate, onNew, onAddSection, onToggleBinder,
   onImportMarkdownFile, onImportMintdownFile, onDocThemeChange, onDocAccentChange,
   exportOpen, onOpenExport, onCloseExport, presentation, onOpenPresentation, onOpenNav,
   format, pagedLayout, onOpenFormat,
}: HeaderMenuBarProps) {
   const { t, lang, setLang }              = useLang()
   const { showToast }                     = useToast()

   const isDocumentMode = mode === 'document'
   const isMarkdownOnly = !isPanelVisible(paneLayout, 'wysiwyg')

   // Ctrl+E (Cmd+E) opens the Export dialog. Document mode only, export acts on the open
   // document, which the binder view doesn't present.
   useEffect(() => {
      if (!isDocumentMode) return
      function handleKeyDown(event: KeyboardEvent) {
         if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') {
            event.preventDefault()
            onOpenExport()
         }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [isDocumentMode, onOpenExport])

   // Placeholder for features not yet implemented (Tin, binder-mode imports).
   function comingSoon() {
      showToast(t.comingSoon, { type: 'neutral' })
   }

   // =============
   //  File actions
   // =============

   // One unified Open: a single picker whose selection is format-detected and handed to the
   // matching EXISTING loader (JSON backup / Mintdown / Markdown). All three paths land in the
   // editor (the import handlers leave binder mode); the toast reflects the detected format.
   function handleOpen() {
      const input  = document.createElement('input')
      input.type   = 'file'
      input.accept = '.json,.documint,.mint,.mintd,.mintdown,.md,.markdown,.txt'
      input.onchange = async () => {
         const file = input.files?.[0]
         if (!file) return
         try {
            const text   = await file.text()
            const format = detectOpenFormat(file.name, text)
            if (format === 'backup') {
               const parsed = parseDocumentBackup(text)
               if (!parsed) { showToast(t.importFailed, { type: 'error' }); return }
               onLoad(parsed.state, parsed.presentation)
               showToast(t.jsonBackupImported, { type: 'success' })
            } else if (format === 'mintdown') {
               await onImportMintdownFile(file)
               showToast(t.mintdownImported, { type: 'success' })
            } else {
               await onImportMarkdownFile(file)
               showToast(t.markdownImported, { type: 'success' })
            }
         } catch {
            showToast(t.importFailed, { type: 'error' })
         }
      }
      input.click()
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

            <div className="flex items-center gap-2 mr-2 shrink-0 select-none">
               {theme === 'dark'
                  ? <LogoColor className="h-7 w-auto" />
                  : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
               }
               <span className="font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
            </div>

            <FileMenu
               mode={mode}
               onNewDocument={onNew}
               onOpenTin={comingSoon}
               onOpen={handleOpen}
               onSave={onManualSave}
               onSaveAs={onSaveAs}
               onSaveAsTemplate={onSaveAsTemplate}
               onExport={onOpenExport}
               onImportDocumint={comingSoon}
               onImportMarkdown={comingSoon}
               onImportMintdown={comingSoon}
               t={t}
            />
            {isDocumentMode && <ViewMenu paneLayout={paneLayout} onTogglePanel={onTogglePanel} dockPanels={dockPanels} t={t} />}
            {/* Preferences = app-wide settings (chrome theme + language). */}
            <PreferencesMenu
               theme={theme}
               onToggleTheme={onToggleTheme}
               lang={lang}
               onLangChange={setLang}
               t={t}
            />
            {/* Document = the per-document customization set, sharing its entry list with the
                document-background context menu via buildDocumentMenuEntries (parity). Document mode
                only; reachable in preview too (readOnly just disables "Add section"). */}
            {isDocumentMode && (
               <DocumentMenu
                  t={t}
                  docTheme={docTheme}
                  docAccent={docAccent}
                  previewMode={previewMode}
                  readOnly={previewMode === 'preview'}
                  onAddSection={onAddSection}
                  onDocThemeChange={onDocThemeChange}
                  onDocAccentChange={onDocAccentChange}
                  onOpenPresentation={onOpenPresentation}
                  onOpenNavigation={onOpenNav}
                  onOpenFormat={onOpenFormat}
                  onOpenExport={onOpenExport}
                  onManualSave={onManualSave}
                  onSaveAs={onSaveAs}
                  onTogglePreview={() => onSetMode(previewMode === 'preview' ? 'wysiwyg' : 'preview')}
               />
            )}
            <AboutMenu theme={theme} t={t} />

            {/* Spacer, pushes actions to the far right */}
            <div className="flex-1" />

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

            {/* Document-only quick actions; Export lives in File -> Export... (Ctrl+E). */}
            {isDocumentMode && (
               <Button
                  variant="ghost"
                  onClick={handlePreviewClick}
                  disabled={isMarkdownOnly}
                  style={previewMode === 'preview' && !isMarkdownOnly ? { color: 'var(--color-accent)' } : undefined}
               >
                  <Eye size={14} />{t.previewMode}
               </Button>
            )}
         </div>

         {exportOpen && (
            <ExportModal
               meta={meta}
               sections={sections}
               defaultTheme={docTheme}
               defaultAccent={docAccent}
               presentation={presentation}
               format={format}
               pagedLayout={pagedLayout}
               lang={lang}
               onClose={onCloseExport}
               onOpenPresentation={onOpenPresentation}
            />
         )}
      </>
   )
}

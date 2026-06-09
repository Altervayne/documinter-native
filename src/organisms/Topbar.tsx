import { useRef, useState } from 'react'
import type { BlockType, DocMeta, DocState, Mode, PaneNode, SaveStatus, Section, ViewLayout } from '../types'
import { Button } from '../atoms/Button'
import { ExportModal } from './ExportModal'
import { ViewMenu } from '../molecules/ViewMenu'
import { FileMenu } from '../molecules/FileMenu'
import { InsertMenu } from '../molecules/InsertMenu'
import { AppearanceMenu } from '../molecules/AppearanceMenu'
import { AboutMenu } from '../molecules/AboutMenu'
import { downloadJSON, loadJSONFile } from '../lib/storage'
import { documentToMarkdown } from '../lib/markdown'
import { Eye, Download, CircleDot, Loader2, CircleCheck } from 'lucide-react'
import { LogoColor, LogoMono } from '../atoms/Logo'
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'

// ============================================================
// Save status indicator
// ============================================================

interface SaveStatusIndicatorProps {
   status:      SaveStatus
   labelDirty:  string
   labelSaving: string
   labelSaved:  string
}

function SaveStatusIndicator({ status, labelDirty, labelSaving, labelSaved }: SaveStatusIndicatorProps) {
   const lastNonCleanRef = useRef<'dirty' | 'saving' | 'saved'>('dirty')
   if (status !== 'clean') lastNonCleanRef.current = status

   const displayed = lastNonCleanRef.current
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

// ============================================================
// Helper — derive ViewLayout from PaneNode
// ============================================================

function deriveViewLayout(paneLayout: PaneNode): ViewLayout {
   if (paneLayout.kind === 'split') return 'split'
   return paneLayout.paneId === 'wysiwyg' ? 'wysiwyg' : 'markdown'
}

// ============================================================
// Props
// ============================================================

interface TopbarProps {
   meta:               DocMeta
   sections:           Section[]
   theme:              'dark' | 'light'
   docTheme:           'light' | 'dark'
   docAccent:          string
   mode:               Mode
   paneLayout:         PaneNode
   saveStatus:         SaveStatus
   onLoad:             (state: DocState) => void
   onToggleTheme:      () => void
   onSetMode:          (mode: Mode) => void
   onViewLayoutChange: (layout: ViewLayout) => void
   onManualSave:       () => void
   onNewDocument:      () => void
   onImportMarkdown:   (file: File) => Promise<void>
   onDocThemeChange:   (theme: 'light' | 'dark') => void
   onDocAccentChange:  (hex: string) => void
   onAddSection:       () => void
   onAddBlock:         (sectionId: string, type: BlockType) => void
}

// ============================================================
// Component
// ============================================================

export function Topbar({
   meta, sections, theme, docTheme, docAccent, mode, paneLayout, saveStatus,
   onLoad, onToggleTheme, onSetMode, onViewLayoutChange, onManualSave,
   onNewDocument, onImportMarkdown, onDocThemeChange, onDocAccentChange,
   onAddSection, onAddBlock,
}: TopbarProps) {
   const [exportOpen, setExportOpen] = useState(false)
   const { t, lang, setLang }        = useLang()
   const { showToast }               = useToast()

   const viewLayout      = deriveViewLayout(paneLayout)
   const lastSectionId   = sections.at(-1)?.id ?? null
   const isMarkdownOnly  = paneLayout.kind === 'leaf' && paneLayout.paneId === 'markdown'

   // ── File actions ────────────────────────────────────────────

   function handleLoadJSON() {
      loadJSONFile(
         (state: DocState) => { onLoad(state); showToast(t.docLoaded, { type: 'success' }) },
         (message: string) => showToast(message, { type: 'error' }),
      )
   }

   function handleSaveJSON() {
      downloadJSON(meta, sections)
      onManualSave()
      showToast(t.jsonSaved, { type: 'success' })
   }

   function handleNewDocument() {
      if (!window.confirm(t.newDocumentConfirm)) return
      onNewDocument()
   }

   function handleImportMarkdownClick() {
      const input = document.createElement('input')
      input.type   = 'file'
      input.accept = '.md,.markdown,.txt'
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
      // Reuse the markdown serialiser — produce a data-URI download
      const markdownContent  = documentToMarkdown(sections, meta)
      const blob             = new Blob([markdownContent], { type: 'text/markdown' })
      const url              = URL.createObjectURL(blob)
      const anchor           = document.createElement('a')
      const filename         = (meta.title || 'document').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()
      anchor.href            = url
      anchor.download        = `${filename}.md`
      anchor.click()
      URL.revokeObjectURL(url)
      showToast(t.markdownExported, { type: 'success' })
   }

   // ── Preview toggle ───────────────────────────────────────────

   function handlePreviewClick() {
      onSetMode(mode === 'preview' ? 'wysiwyg' : 'preview')
   }

   // ── Render ──────────────────────────────────────────────────

   return (
      <>
         <header className="h-12 shrink-0 flex items-center gap-2 px-4 bg-raised border-b border-border z-200">

            {/* Brand */}
            <div className="flex items-center gap-2 shrink-0 select-none mr-1">
               {theme === 'dark'
                  ? <LogoColor className="h-7 w-auto" />
                  : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
               }
               <span className="font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
            </div>

            {/* Menu bar */}
            <FileMenu
               onNewDocument={handleNewDocument}
               onLoadJSON={handleLoadJSON}
               onSaveJSON={handleSaveJSON}
               onImportMarkdown={handleImportMarkdownClick}
               onExportMarkdown={handleExportMarkdownClick}
               onOpenExportModal={() => setExportOpen(true)}
               t={t}
            />
            <ViewMenu
               viewLayout={viewLayout}
               onChange={onViewLayoutChange}
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

            {/* Centre — title + save status */}
            <div className="flex-1 relative flex items-center justify-center min-w-0 px-4">
               <span className="font-mono text-xs text-muted/70 truncate select-none">
                  {meta.title || t.untitledDoc}
               </span>
               <div className="absolute right-4 inset-y-0 flex items-center">
                  <SaveStatusIndicator
                     status={saveStatus}
                     labelDirty={t.unsavedChanges}
                     labelSaving={t.autosaving}
                     labelSaved={t.saved}
                  />
               </div>
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2 shrink-0">
               <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePreviewClick}
                  title={t.previewMode}
                  disabled={isMarkdownOnly}
                  style={mode === 'preview' && !isMarkdownOnly ? { color: 'var(--color-accent)' } : undefined}
               >
                  <Eye size={14} />
               </Button>
               <Button variant="primary" onClick={() => setExportOpen(true)}>
                  <Download size={14} />{t.export}
               </Button>
            </div>
         </header>

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

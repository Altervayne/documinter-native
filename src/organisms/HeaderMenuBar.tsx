// -- React Imports --
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
import { BinderSwitcher } from '../molecules/BinderSwitcher'
import { WindowControls } from '../molecules/WindowControls'

// -- Lib Imports --
import { isTauri } from '../lib/platform'
import { parseDocumentBackup } from '../lib/documentBackupFile'
import type { DocPresentation } from '../lib/binderDocuments'
import { DEFAULT_DOC_ACCENT } from '../lib/documentTemplate'
import { importMarkdownFile } from '../lib/markdown'
import { openTextFile } from '../lib/platform/fileTransfer'
import type { DocPresentationExtras } from '../lib/presentation'
import type { DocFormat } from '../lib/format'

// -- Icon Imports --
import { Eye, Library, PanelLeftClose, CircleDot, Loader2, CircleCheck, TriangleAlert, Undo2, Redo2 } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'
import { useBinderBackend } from '../contexts/BinderBackendContext'

// ====================
//  Open format sniffing
// ====================

// Route a picked file to the right loader. Extension decides when known; otherwise the content is
// sniffed (`{` -> JSON backup, else Markdown). HTML is export-only and never routed here.
type OpenFormat = 'backup' | 'markdown'

function detectOpenFormat(fileName: string, text: string): OpenFormat {
   const lowerName = fileName.toLowerCase()
   if (lowerName.endsWith('.json') || lowerName.endsWith('.documint')) return 'backup'
   if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'markdown'
   // Ambiguous / unknown extension (.txt, none, or anything else): sniff the content.
   const trimmed = text.trimStart()
   if (trimmed.startsWith('{'))   return 'backup'
   return 'markdown'
}

// Everything detectOpenFormat can route; shared by Open (new tab) and Import (new binder record).
const OPEN_FILE_FILTERS = [{ name: 'Documinter document', extensions: ['json', 'documint', 'md', 'markdown', 'txt'] }]

// #########################
// # SAVE STATUS INDICATOR #
// #########################

interface SaveStatusIndicatorProps {
   status:      SaveStatus
   /** The active tab is a scratch document with real content that has never been saved to the binder.
    *  Takes precedence over `status` and shows a persistent red warning that never fades. */
   neverSaved:  boolean
   labelDirty:  string
   labelSaving: string
   labelSaved:  string
   labelNever:  string
}

function SaveStatusIndicator({ status, neverSaved, labelDirty, labelSaving, labelSaved, labelNever }: SaveStatusIndicatorProps) {
   // Remember the last non-clean status so the pill keeps showing that label while it fades out after
   // the status returns to 'clean' (React's adjust-state-during-render pattern).
   const [displayed, setDisplayed] = useState<'dirty' | 'saving' | 'saved'>('dirty')

   if (status !== 'clean' && status !== displayed) setDisplayed(status)

   // A never-saved scratch tab is a standing risk, so its warning bypasses the fade state machine:
   // always rendered, full opacity, red, until the doc is saved.
   if (neverSaved) {
      return (
         <div className="flex items-center gap-1.5 font-mono text-xs select-none pointer-events-none text-red">
            <TriangleAlert size={12} />
            <span className="hdr-collapse">{labelNever}</span>
         </div>
      )
   }

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
         <span className="hdr-collapse">
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
   /** Active tab is a scratch document with real content, never saved to the binder. Shows the
    *  persistent red "Never saved" indicator instead of the ordinary save-status pill. */
   neverSaved:       boolean
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
   /** Document history: step back / forward through the active tab's committed edits. Enabled state
    *  follows the tab's undo / redo stacks; the same actions bind to Ctrl+Z / Ctrl+Y in App. */
   onUndo:           () => void
   onRedo:           () => void
   canUndo:          boolean
   canRedo:          boolean
   onNew:            () => void
   /** Add a section to the active document, the Document menu's "Add section" entry. */
   onAddSection:     () => void
   onToggleBinder:   () => void
   onImportMarkdownFile: (source: string) => Promise<void>
   /** Notifies the binder (File -> Import... just added a record behind its back) so its list
    *  picks up the new card without waiting on an unrelated action to refresh it. Binder mode only. */
   onDocumentImported: () => void
   /** Download the whole binder as a `.tin` bundle (File -> Save binder as Tin...). Binder mode only. */
   onSaveTin:          () => void
   /** Open a `.tin` bundle, choosing merge vs replace (File -> Open Tin...). Binder mode only. */
   onOpenTin:          () => void
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
   /** Opens the document-level Page setup window (the Document menu's "Page setup..." entry). */
   onOpenFormat?: () => void
}

// ####################
// # RESPONSIVE COLLAPSE
// ####################

// Draggable slack kept between the left menus and right controls; when the bar can't hold the full
// labels plus this gap, it collapses to icons (see index.css .hdr-compact).
const MIN_DRAG_GAP = 32

/**
 * Measures the title bar and returns whether it must run compact (icon-only). The left and right groups
 * are shrink-0, so their measured widths are the real content widths; when they plus MIN_DRAG_GAP exceed
 * the bar, compact. The natural width is cached so it expands again only once the FULL content fits (no
 * oscillation). Measured before paint so the bar never flashes an overflow. resetKey (mode + language)
 * re-expands to re-measure the fresh label widths.
 */
function useHeaderCompaction(resetKey: string) {
   const [compact, setCompact] = useState(false)
   // Only the setter is used: a window resize bumps it purely to trigger the measuring layout effect.
   const [, setSizeTick] = useState(0)
   const barRef         = useRef<HTMLDivElement>(null)
   const collapsibleRef = useRef<HTMLDivElement>(null)
   const leftRef        = useRef<HTMLDivElement>(null)
   const rightRef       = useRef<HTMLDivElement>(null)
   const naturalWidthRef = useRef(0)
   const prevKeyRef      = useRef(resetKey)

   // A window resize bumps sizeTick so the measuring layout effect re-renders and re-measures.
   useEffect(() => {
      const bar = barRef.current
      if (!bar) return
      const observer = new ResizeObserver(() => setSizeTick(tick => tick + 1))
      observer.observe(bar)
      return () => observer.disconnect()
   }, [])

   // Measured every commit (no deps), so it converges: each setCompact re-measures until the flag settles,
   // a same-value setCompact bails without a re-render. Available width is the COLLAPSIBLE region (the
   // flex-1 box excluding the window controls), so the controls are never part of the budget. A content
   // change (mode / language) while compact drops to expanded first, since compact widths can't tell us
   // the true full-label width.
   useLayoutEffect(() => {
      const collapsible = collapsibleRef.current, left = leftRef.current, right = rightRef.current
      if (!collapsible || !left || !right) return
      const available = collapsible.clientWidth
      const contentChanged = resetKey !== prevKeyRef.current
      prevKeyRef.current = resetKey
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompact(wasCompact => {
         if (contentChanged && wasCompact) return false
         if (!wasCompact) {
            naturalWidthRef.current = left.offsetWidth + right.offsetWidth + MIN_DRAG_GAP
            return naturalWidthRef.current > available
         }
         return available < naturalWidthRef.current
      })
   })

   return { compact, barRef, collapsibleRef, leftRef, rightRef }
}

// #############
// # COMPONENT #
// #############

export function HeaderMenuBar({
   mode, meta, sections, theme, docTheme, docAccent, previewMode, paneLayout, saveStatus, neverSaved,
   onLoad, onToggleTheme, onSetMode, onTogglePanel, dockPanels, onManualSave, onSaveAs, onSaveAsTemplate,
   onUndo, onRedo, canUndo, canRedo, onNew, onAddSection, onToggleBinder,
   onImportMarkdownFile, onDocumentImported, onSaveTin, onOpenTin, onDocThemeChange, onDocAccentChange,
   exportOpen, onOpenExport, onCloseExport, presentation, onOpenPresentation, onOpenNav,
   format, onOpenFormat,
}: HeaderMenuBarProps) {
   const { t, lang, setLang }              = useLang()
   const { showToast }                     = useToast()
   const backend                           = useBinderBackend()

   const isDocumentMode = mode === 'document'
   const isMarkdownOnly = !isPanelVisible(paneLayout, 'wysiwyg')

   // Title-bar responsive collapse, keyed on mode + lang (both resize the labels) so it re-measures.
   const { compact, barRef, collapsibleRef, leftRef, rightRef } = useHeaderCompaction(`${mode}-${lang}`)

   // Ctrl+E (Cmd+E) opens the Export dialog. Document mode only (export acts on the open document).
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

   // =============
   //  File actions
   // =============

   // Unified Open: one picker, format-detected and handed to the matching loader (JSON backup / Markdown).
   // Both paths land in the editor (leaving binder mode); the toast reflects the detected format.
   async function handleOpen() {
      const picked = await openTextFile({ filters: OPEN_FILE_FILTERS })
      if (!picked) return
      try {
         const format = detectOpenFormat(picked.name, picked.text)
         if (format === 'backup') {
            const parsed = parseDocumentBackup(picked.text)
            if (!parsed) { showToast(t.importFailed, { type: 'error' }); return }
            onLoad(parsed.state, parsed.presentation)
            showToast(t.jsonBackupImported, { type: 'success' })
         } else {
            await onImportMarkdownFile(picked.text)
            showToast(t.markdownImported, { type: 'success' })
         }
      } catch {
         showToast(t.importFailed, { type: 'error' })
      }
   }

   // Binder Import: the same picker + detection as handleOpen, but the loaded document becomes a new
   // binder record (saveDocument, no existingId) in the root instead of a tab. Never touches the open
   // tabs or leaves binder mode; the caller bumps the binder list so the card shows up right away.
   async function handleImport() {
      const picked = await openTextFile({ filters: OPEN_FILE_FILTERS })
      if (!picked) return
      try {
         const format = detectOpenFormat(picked.name, picked.text)
         if (format === 'backup') {
            const parsed = parseDocumentBackup(picked.text)
            if (!parsed) { showToast(t.importFailed, { type: 'error' }); return }
            await backend.saveDocument(parsed.state, parsed.presentation)
         } else {
            const loaded = importMarkdownFile(picked.text)
            const state: DocState = { meta: loaded.meta, sections: loaded.sections }
            await backend.saveDocument(state, { docTheme: 'light', docAccent: DEFAULT_DOC_ACCENT })
         }
         onDocumentImported()
         showToast(t.binderImportSuccess, { type: 'success' })
      } catch {
         showToast(t.importFailed, { type: 'error' })
      }
   }

   function handlePreviewClick() {
      onSetMode(previewMode === 'preview' ? 'wysiwyg' : 'preview')
   }

   // =======
   //  Render
   // =======

   return (
      <>
         {/* data-tauri-drag-region turns the bar's empty areas into the native window drag handle
             (inert in the browser; in Tauri only the region itself drags, so menus stay clickable).
             The OS title bar is off in the shell, so this bar plus WindowControls IS the title bar. */}
         <div ref={barRef} data-tauri-drag-region className={`shrink-0 flex items-center gap-1 p-1 px-3 bg-raised border-b border-border z-200 ${compact ? 'hdr-compact' : ''}`}>

            {/* Collapsible region: everything EXCEPT the window controls. flex-1 min-w-0 so it yields
                width to the controls first; when low the labels fold, and overflow stays WITHIN this box. */}
            <div ref={collapsibleRef} className="flex-1 min-w-0 flex items-center gap-1">

            {/* Left group: identity + menus. shrink-0 so useHeaderCompaction reads its true content width;
                a drag region so the decorative logo (pointer-events-none) still drags the window. */}
            <div ref={leftRef} data-tauri-drag-region className="flex items-center gap-1 shrink-0 min-w-0">

            {/* Logo + wordmark are decorative: pointer-events-none lets a click fall through to the drag
                region, so grabbing the logo drags the window. The wordmark folds away first (hdr-collapse). */}
            <div className="flex items-center gap-2 mr-1 shrink-0 select-none pointer-events-none">
               {theme === 'dark'
                  ? <LogoColor className="h-7 w-auto" />
                  : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
               }
               <span className="hdr-collapse font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
            </div>

            {/* Native only: the open Binder's name + switch / open / create. Renders nothing on the web
                or before a Binder is open. */}
            <BinderSwitcher />

            <FileMenu
               mode={mode}
               onNewDocument={onNew}
               onOpen={handleOpen}
               onSave={onManualSave}
               onSaveAs={onSaveAs}
               onSaveAsTemplate={onSaveAsTemplate}
               onExport={onOpenExport}
               onImport={handleImport}
               onSaveTin={onSaveTin}
               onOpenTin={onOpenTin}
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
            {/* Document = the per-document customization set, sharing its entries with the document-background
                context menu via buildDocumentMenuEntries. Document mode only; in preview readOnly just
                disables "Add section". */}
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
            </div>

            {/* Spacer: the widest empty band and main drag handle. Flex-grows, so it gives up width first;
                the left / right groups never shrink. */}
            <div data-tauri-drag-region className="flex-1 self-stretch" />

            {/* Right group: status + document actions (window controls are a separate sibling below).
                shrink-0 so its width measures true; a drag region so the save pill drags through. Folds
                to icons under pressure, only after the spacer. */}
            <div ref={rightRef} data-tauri-drag-region className="flex items-center gap-1 shrink-0">

            {/* The save-status pill is display-only. pointer-events-none here so its band drags the window;
                its label folds away (hdr-collapse) when compact so it stops reserving width. */}
            <div className="shrink-0 flex items-center pointer-events-none">
               <SaveStatusIndicator
                  status={saveStatus}
                  neverSaved={neverSaved}
                  labelDirty={t.unsavedChanges}
                  labelSaving={t.autosaving}
                  labelSaved={t.saved}
                  labelNever={t.neverSaved}
               />
            </div>

            {/* Document history: Undo / Redo, disabled at the ends of the stack. Ctrl+Z / Ctrl+Y live in
                App and keep working regardless of these buttons. */}
            {isDocumentMode && (
               <>
                  <Button
                     variant="ghost"
                     size="icon"
                     onClick={onUndo}
                     disabled={!canUndo}
                     title={`${t.undoAction} (Ctrl+Z)`}
                     aria-label={t.undoAction}
                  >
                     <Undo2 size={14} />
                  </Button>
                  <Button
                     variant="ghost"
                     size="icon"
                     onClick={onRedo}
                     disabled={!canRedo}
                     title={`${t.redoAction} (Ctrl+Y)`}
                     aria-label={t.redoAction}
                  >
                     <Redo2 size={14} />
                  </Button>
               </>
            )}

            {/* Binder toggle, always visible; label reflects mode. */}
            <Button
               variant={isDocumentMode ? 'ghost' : 'primary'}
               onClick={onToggleBinder}
            >
               {isDocumentMode ? <Library size={14} /> : <PanelLeftClose size={14} />}
               <span className="hdr-collapse">{isDocumentMode ? t.openBinder : t.closeBinder}</span>
            </Button>

            {/* Document-only quick actions; Export lives in File -> Export... (Ctrl+E). */}
            {isDocumentMode && (
               <Button
                  variant="ghost"
                  onClick={handlePreviewClick}
                  disabled={isMarkdownOnly}
                  style={previewMode === 'preview' && !isMarkdownOnly ? { color: 'var(--color-accent)' } : undefined}
               >
                  <Eye size={14} /><span className="hdr-collapse">{t.previewMode}</span>
               </Button>
            )}
            </div>

            </div>

            {/* Native caption buttons, OUTSIDE the collapsible region and never shrunk, so they own the
                right edge and can never be pushed off screen; only the menus to their left fold. Tauri
                shell only (isTauri() is false in the browser, so nothing renders). */}
            {isTauri() && <WindowControls />}
         </div>

         {exportOpen && (
            <ExportModal
               meta={meta}
               sections={sections}
               defaultTheme={docTheme}
               defaultAccent={docAccent}
               presentation={presentation}
               format={format}
               lang={lang}
               onClose={onCloseExport}
               onOpenPresentation={onOpenPresentation}
            />
         )}
      </>
   )
}

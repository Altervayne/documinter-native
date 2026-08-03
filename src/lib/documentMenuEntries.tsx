// -- Icon Imports --
import { Plus, Sun, Moon, Image, PanelLeft, Ruler, Download, Save, FileDown, Eye, EyeOff } from 'lucide-react'

// -- Type Imports --
import type { ContextMenuEntry } from '../molecules/ContextMenu'
import type { AccentSwatchOption, AccentCustomSwatchOption } from '../molecules/AccentSwatchGrid'
import type { Mode } from '../types'
import type { T } from './i18n'

// -- Lib Imports --
import { ACCENT_PRESETS, accentPresetName } from './constants'

// #############
// # TYPES #
// #############

/**
 * The full set of handlers + state the document menu needs. Every entry-producing branch is guarded
 * on the presence of its handler, exactly like the background context menu was, so the SAME builder
 * can serve a surface that only wires a subset (though in practice both surfaces wire all of them).
 */
export interface DocumentMenuOptions {
   t:            T
   docTheme:     'light' | 'dark'
   /** The current document accent hex, drives which swatch (if any) renders as active. */
   docAccent:    string
   /** The editor/preview sub-mode, for the preview-toggle entry's icon + (unchanged) label. */
   previewMode?: Mode
   /** Read-only (preview) render: the "Add section" entry stays in the list but disabled. */
   readOnly?:    boolean
   onAddSection?:      () => void
   /** Flip the DOCUMENT theme (dark ⇄ light), distinct from the app/chrome theme. */
   onDocThemeChange?:  (theme: 'light' | 'dark') => void
   /** Pick one of the accent presets, or apply a live change from the custom ColorPicker. */
   onDocAccentChange?: (hex: string) => void
   /** Whether the user has explicitly chosen the Custom tile (or adjusted its picker) since the
    *  menu last opened, the "custom is the selected choice" intent. Kept separate from whether
    *  `docAccent` happens to coincide with a preset hex; each surface owns its own bool. Combined
    *  below with the "docAccent matches no preset" fallback so a freshly reopened menu with a
    *  truly off-palette color still reads Custom as active even though this flag resets to false
    *  on each open. */
   customAccentSelected?: boolean
   /** Select the Custom tile: mark it the active choice and (re)apply the current `docAccent`
    *  through `onDocAccentChange`, a no-op on the value itself (the picker is already seeded from
    *  `docAccent`), but it hands off cleanly: flipping from a preset into Custom keeps that color
    *  rather than resetting it. */
   onSelectCustomAccent?: () => void
   /** Clear the "Custom is selected" intent, called when a preset swatch is clicked, so the ring
    *  moves cleanly off Custom even if the picker's last color happened to equal that preset's hex. */
   onDeselectCustomAccent?: () => void
   /** Open the document-level Presentation window. */
   onOpenPresentation?: () => void
   /** Open the document-level Navigation window. */
   onOpenNavigation?:   () => void
   /** Open the document-level Page setup window (Phase 1: infinite-canvas width only). */
   onOpenFormat?:       () => void
   /** Open the format-aware Export dialog. */
   onOpenExport?: () => void
   onManualSave?: () => void
   onSaveAs?:     () => void
   /** Toggle the editor/preview mode. */
   onTogglePreview?: () => void
}

// ##########################################################
// # SHARED DOCUMENT-MENU ENTRY BUILDER (SINGLE SOURCE OF TRUTH) #
// ##########################################################

/**
 * The one ordered list of per-document actions, consumed by BOTH the top-bar "Document" dropdown
 * (HeaderMenuBar) AND the document-background context menu (WysiwygArea). Keeping it here, a single
 * pure function, is what enforces the two surfaces can never drift in label or order: they render
 * the identical `ContextMenuEntry[]`, each through its own thin renderer.
 *
 * Order: Add section · Doc theme · Accent (header + swatch grid) · Presentation… · Navigation…
 * · Page setup… · Export… · Save · Save As… · Preview toggle. Icon size 13 matches both surfaces'
 * existing rows.
 */
export function buildDocumentMenuEntries(options: DocumentMenuOptions): ContextMenuEntry[] {
   const {
      t, docTheme, docAccent, previewMode, readOnly,
      onAddSection, onDocThemeChange, onDocAccentChange,
      customAccentSelected, onSelectCustomAccent, onDeselectCustomAccent,
      onOpenPresentation, onOpenNavigation, onOpenFormat, onOpenExport, onManualSave, onSaveAs, onTogglePreview,
   } = options

   const entries: ContextMenuEntry[] = []

   if (onAddSection) {
      // Nonsensical in preview (nothing to insert into an inert, read-only render), kept in the
      // menu but disabled, rather than removed.
      entries.push({ label: t.bgMenuAddSection, icon: <Plus size={13} />, onSelect: onAddSection, disabled: !!readOnly })
   }

   if (onDocThemeChange) {
      if (entries.length > 0) entries.push({ type: 'separator' })
      entries.push({
         label:    docTheme === 'dark' ? t.toLightMode : t.toDarkMode,
         icon:     docTheme === 'dark' ? <Sun size={13} /> : <Moon size={13} />,
         onSelect: () => onDocThemeChange(docTheme === 'dark' ? 'light' : 'dark'),
      })
   }

   if (onDocAccentChange) {
      entries.push({ type: 'header', label: t.accent })

      // Nameless swatch grid, each preset's localized name rides along as a tooltip/aria-label
      // only (AccentSwatchGrid never renders it as text); "active" drives the tile's ring.
      const isPresetHex   = (hex: string) => hex.toLowerCase() === docAccent.toLowerCase()
      const customSelected = !!customAccentSelected

      const presets: AccentSwatchOption[] = ACCENT_PRESETS.map(hex => ({
         hex,
         name:   accentPresetName(hex, t),
         // Never active while Custom is the selected choice, even if this preset's hex happens to
         // coincide with the current (custom) docAccent, Custom alone owns the ring in that case.
         active: isPresetHex(hex) && !customSelected,
         onSelect: () => {
            onDocAccentChange(hex)
            onDeselectCustomAccent?.()
         },
      }))

      // Custom is the active choice either because it was explicitly selected (or its picker
      // adjusted), customSelected, or, as a fallback for a freshly (re)opened menu, because the
      // document accent doesn't match any preset at all.
      const custom: AccentCustomSwatchOption | undefined = onSelectCustomAccent
         ? {
              name:     t.bgMenuCustomAccentTitle,
              active:   customSelected || !ACCENT_PRESETS.some(isPresetHex),
              value:    docAccent,
              onSelect: onSelectCustomAccent,
              onChange: onDocAccentChange,
           }
         : undefined

      entries.push({ type: 'accent-grid', presets, custom })
   }

   const hasActions = !!onOpenPresentation || !!onOpenNavigation || !!onOpenFormat || !!onOpenExport || !!onManualSave || !!onSaveAs || !!onTogglePreview
   if (hasActions && entries.length > 0) entries.push({ type: 'separator' })
   if (onOpenPresentation) entries.push({ label: t.presentationMenu,  icon: <Image size={13} />,    onSelect: onOpenPresentation })
   if (onOpenNavigation)   entries.push({ label: t.menuNavigation,    icon: <PanelLeft size={13} />, onSelect: onOpenNavigation })
   if (onOpenFormat)       entries.push({ label: t.formatMenuPageSetup, icon: <Ruler size={13} />,   onSelect: onOpenFormat })
   if (onOpenExport)       entries.push({ label: t.menuExport,        icon: <Download size={13} />,  onSelect: onOpenExport })
   if (onManualSave)       entries.push({ label: t.fileSave,          icon: <Save size={13} />,      onSelect: onManualSave })
   if (onSaveAs)           entries.push({ label: t.fileSaveAs,        icon: <FileDown size={13} />,  onSelect: onSaveAs })
   if (onTogglePreview) {
      entries.push({
         label:    t.previewMode,
         icon:     previewMode === 'preview' ? <EyeOff size={13} /> : <Eye size={13} />,
         onSelect: onTogglePreview,
      })
   }

   return entries
}

import { describe, it, expect } from 'vitest'

import { buildDocumentMenuEntries, type DocumentMenuOptions } from './documentMenuEntries'
import type { ContextMenuEntry } from '../molecules/ContextMenu'
import { translations } from './i18n'
import { ACCENT_PRESETS } from './constants'

const t = translations.en

// ==========================================================
//  A label + order projection: the exact contract both surfaces (top-bar Document dropdown and
//  document-background context menu) must render identically. Items collapse to their label,
//  separators / headers to a stable tag, the accent section to its preset hexes + whether a custom
//  tile is wired. Icons, onSelect identity, and swatch "active" state are ignored, so two surfaces
//  wiring different opener closures still project equal iff the shared builder kept order in lockstep.
// ==========================================================
function project(entries: ContextMenuEntry[]): string[] {
   return entries.map(entry => {
      if ('type' in entry) {
         if (entry.type === 'separator') return '---'
         if (entry.type === 'accent-grid') {
            return `accent-grid:${entry.presets.map(preset => preset.hex).join(',')}:custom=${entry.custom ? 'yes' : 'no'}`
         }
         return `header:${entry.label}`
      }
      return entry.label
   })
}

// Narrows an entry down to the accent-grid variant, for tests that need to inspect the swatch data
// (active flags) the label+order projection above deliberately discards.
function findAccentGridEntry(entries: ContextMenuEntry[]) {
   const entry = entries.find(candidate => 'type' in candidate && candidate.type === 'accent-grid')
   if (!entry || !('type' in entry) || entry.type !== 'accent-grid') {
      throw new Error('accent-grid entry not found')
   }
   return entry
}

// A fully-wired option set (every handler present), matching what both live surfaces pass.
const fullOptions: DocumentMenuOptions = {
   t,
   docTheme:  'light',
   docAccent: ACCENT_PRESETS[0],
   previewMode: 'wysiwyg',
   readOnly:  false,
   onAddSection:       () => {},
   onDocThemeChange:   () => {},
   onDocAccentChange:  () => {},
   customAccentSelected: false,
   onSelectCustomAccent: () => {},
   onDeselectCustomAccent: () => {},
   onOpenPresentation: () => {},
   onOpenNavigation:   () => {},
   onOpenFormat:       () => {},
   onOpenExport:       () => {},
   onManualSave:       () => {},
   onSaveAs:           () => {},
   onTogglePreview:    () => {},
}

describe('buildDocumentMenuEntries', () => {
   it('produces the full document action list in the expected order', () => {
      const expected = [
         t.bgMenuAddSection,
         '---',
         t.toDarkMode,                       // docTheme is light -> offers switching to dark
         `header:${t.accent}`,
         `accent-grid:${ACCENT_PRESETS.join(',')}:custom=yes`,
         '---',
         t.presentationMenu,                 // windows group
         t.menuNavigation,                   // Navigation sits right after Presentation
         t.formatMenuPageSetup,              // Page setup sits right after Navigation
         '---',
         t.fileSave,                         // file group
         t.fileSaveAs,
         t.menuExport,                       // Export moved down next to the save actions
         '---',
         t.previewMode,                      // preview group
      ]
      expect(project(buildDocumentMenuEntries(fullOptions))).toEqual(expected)
   })

   it('places Navigation immediately after Presentation', () => {
      const labels = project(buildDocumentMenuEntries(fullOptions))
      const presentationIndex = labels.indexOf(t.presentationMenu)
      const navigationIndex   = labels.indexOf(t.menuNavigation)
      expect(presentationIndex).toBeGreaterThanOrEqual(0)
      expect(navigationIndex).toBe(presentationIndex + 1)
   })

   it('is the single source of truth: two surfaces wiring different openers project identically', () => {
      // The top-bar Document dropdown and the background context menu differ ONLY in their
      // surface-specific opener closures (custom-accent expand toggle, preview toggle), never in
      // label or order. Simulating each with distinct closures must still yield an identical
      // projection.
      const contextMenuSurface = buildDocumentMenuEntries({
         ...fullOptions,
         onSelectCustomAccent: () => { /* selects Custom, setting this surface's own customAccentSelected flag */ },
         onTogglePreview:      () => { /* onSetMode('preview') */ },
      })
      const topBarSurface = buildDocumentMenuEntries({
         ...fullOptions,
         onSelectCustomAccent: () => { /* selects Custom, setting this surface's own customAccentSelected flag */ },
         onTogglePreview:      () => { /* onSetMode(previewMode === 'preview' ? 'wysiwyg' : 'preview') */ },
      })
      expect(project(topBarSurface)).toEqual(project(contextMenuSurface))
   })

   it('reflects the current document theme in the theme-toggle label', () => {
      const darkLabels = project(buildDocumentMenuEntries({ ...fullOptions, docTheme: 'dark' }))
      expect(darkLabels).toContain(t.toLightMode)
      expect(darkLabels).not.toContain(t.toDarkMode)
   })

   it('omits the custom-accent tile when no custom-accent selector is wired', () => {
      const entries = buildDocumentMenuEntries({ ...fullOptions, onSelectCustomAccent: undefined })
      const labels = project(entries)
      // The header + preset grid still render (they only need onDocAccentChange); only the
      // custom tile drops out.
      expect(labels).toContain(`header:${t.accent}`)
      expect(findAccentGridEntry(entries).custom).toBeUndefined()
   })

   it('keeps the disabled "Add section" entry under readOnly rather than dropping it', () => {
      const entries = buildDocumentMenuEntries({ ...fullOptions, readOnly: true })
      const addSection = entries.find(entry => !('type' in entry) && entry.label === t.bgMenuAddSection)
      expect(addSection).toBeDefined()
      expect(addSection && !('type' in addSection) && addSection.disabled).toBe(true)
   })

   it('marks only the accent preset matching docAccent as active, and the custom tile inactive', () => {
      const targetHex = ACCENT_PRESETS[2]
      const entries = buildDocumentMenuEntries({ ...fullOptions, docAccent: targetHex })
      const accentGrid = findAccentGridEntry(entries)
      for (const preset of accentGrid.presets) {
         expect(preset.active).toBe(preset.hex === targetHex)
      }
      expect(accentGrid.custom?.active).toBe(false)
   })

   it('marks the custom tile active (and no preset active) when docAccent matches no preset', () => {
      const entries = buildDocumentMenuEntries({ ...fullOptions, docAccent: '#123456' })
      const accentGrid = findAccentGridEntry(entries)
      expect(accentGrid.presets.every(preset => !preset.active)).toBe(true)
      expect(accentGrid.custom?.active).toBe(true)
   })

   it('marks Custom active (and no preset active) when customAccentSelected is set, even though docAccent matches a preset', () => {
      const targetHex = ACCENT_PRESETS[2]
      const entries = buildDocumentMenuEntries({ ...fullOptions, docAccent: targetHex, customAccentSelected: true })
      const accentGrid = findAccentGridEntry(entries)
      expect(accentGrid.presets.every(preset => !preset.active)).toBe(true)
      expect(accentGrid.custom?.active).toBe(true)
   })

   it('leaves the matching preset active when customAccentSelected is unset, even though docAccent matches it', () => {
      const targetHex = ACCENT_PRESETS[2]
      const entries = buildDocumentMenuEntries({ ...fullOptions, docAccent: targetHex, customAccentSelected: false })
      const accentGrid = findAccentGridEntry(entries)
      expect(accentGrid.presets.find(preset => preset.hex === targetHex)?.active).toBe(true)
      expect(accentGrid.custom?.active).toBe(false)
   })

   it('selecting a preset applies its hex and clears the custom-selected flag', () => {
      const appliedHexes: string[] = []
      let deselectCalls = 0
      const entries = buildDocumentMenuEntries({
         ...fullOptions,
         customAccentSelected: true,
         onDocAccentChange: (hex) => appliedHexes.push(hex),
         onDeselectCustomAccent: () => { deselectCalls++ },
      })
      const accentGrid = findAccentGridEntry(entries)
      accentGrid.presets[0].onSelect()
      expect(appliedHexes).toEqual([ACCENT_PRESETS[0]])
      expect(deselectCalls).toBe(1)
   })

   it('wires the custom tile\'s onSelect directly to onSelectCustomAccent (the surface applies the hand-off)', () => {
      let selectCalls = 0
      const onSelectCustomAccent = () => { selectCalls++ }
      const entries = buildDocumentMenuEntries({ ...fullOptions, onSelectCustomAccent })
      const accentGrid = findAccentGridEntry(entries)
      accentGrid.custom?.onSelect()
      expect(selectCalls).toBe(1)
   })
})

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import { AccentSwatchGrid } from './AccentSwatchGrid'
import type { ContextMenuItem } from './ContextMenu'
import { buildDocumentMenuEntries } from '../lib/documentMenuEntries'
import type { Mode } from '../types'
import type { T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

// Feed the right-edge guard below, sized to the dropdown's own `w-64` Tailwind width.
const DROPDOWN_WIDTH = 256
const EDGE_MARGIN     = 8

// #########
// # TYPES #
// #########

interface DocumentMenuProps {
   t:            T
   docTheme:     'light' | 'dark'
   docAccent:    string
   previewMode?: Mode
   readOnly?:    boolean
   onAddSection?:      () => void
   onDocThemeChange?:  (theme: 'light' | 'dark') => void
   onDocAccentChange?: (hex: string) => void
   onOpenPresentation?: () => void
   onOpenNavigation?:   () => void
   onOpenFormat?:       () => void
   onOpenExport?: () => void
   onManualSave?: () => void
   onSaveAs?:     () => void
   onTogglePreview?: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The top-bar "Document" dropdown: the per-document customization set. Renders the SAME entry list
 * as the document-background context menu (both from buildDocumentMenuEntries) so the two can never
 * drift. This surface owns only its own `customAccentSelected` flag. The theme + accent edited here
 * are PER-DOCUMENT; the app/chrome theme + language live in the Preferences menu.
 */
export function DocumentMenu({
   t, docTheme, docAccent, previewMode, readOnly,
   onAddSection, onDocThemeChange, onDocAccentChange,
   onOpenPresentation, onOpenNavigation, onOpenFormat, onOpenExport, onManualSave, onSaveAs, onTogglePreview,
}: DocumentMenuProps) {
   const [open, setOpen]                                 = useState(false)
   const [customAccentSelected, setCustomAccentSelected] = useState(false)
   const [alignRight, setAlignRight]                     = useState(false)
   const containerRef                                    = useRef<HTMLDivElement>(null)

   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) {
            setOpen(false)
            setCustomAccentSelected(false)
         }
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   // Flip to right-aligned when a left-aligned dropdown would overflow the viewport's right edge.
   useLayoutEffect(() => {
      if (!open) return
      const containerRect = containerRef.current?.getBoundingClientRect()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (containerRect) setAlignRight(containerRect.left + DROPDOWN_WIDTH > window.innerWidth - EDGE_MARGIN)
   }, [open])

   // Selecting the Custom tile applies the current docAccent and reveals the inline ColorPicker;
   // selecting a preset clears the flag again.
   const entries = buildDocumentMenuEntries({
      t,
      docTheme,
      docAccent,
      previewMode,
      readOnly,
      onAddSection,
      onDocThemeChange,
      onDocAccentChange,
      customAccentSelected,
      onSelectCustomAccent: onDocAccentChange
         ? () => { setCustomAccentSelected(true); onDocAccentChange(docAccent) }
         : undefined,
      onDeselectCustomAccent: () => setCustomAccentSelected(false),
      onOpenPresentation,
      onOpenNavigation,
      onOpenFormat,
      onOpenExport,
      onManualSave,
      onSaveAs,
      onTogglePreview,
   })

   // Custom's selected state is NOT reset here: it is a persistent choice, cleared only by picking a
   // preset or by the outside-click close, so an unrelated item like Save or Export leaves it alone.
   function handleItemSelect(item: ContextMenuItem) {
      if (item.disabled) return
      item.onSelect()
      setOpen(false)
   }

   return (
      <div ref={containerRef} className="relative">
         <button
            onClick={() => setOpen(wasOpen => !wasOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-medium
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border'
               }`}
         >
            <FileText size={14} />
            <span className="hdr-collapse">{t.menuDocument}</span>
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {open && (
            <div className={`absolute top-full mt-1.5 w-64 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden ${alignRight ? 'right-0 left-auto' : 'left-0'}`} style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}>
               {entries.map((entry, entryIndex) => {
                  if ('type' in entry) {
                     if (entry.type === 'separator') {
                        return <div key={`separator-${entryIndex}`} className="h-px bg-border my-1 mx-2" />
                     }
                     if (entry.type === 'accent-grid') {
                        return <AccentSwatchGrid key={`accent-grid-${entryIndex}`} presets={entry.presets} custom={entry.custom} />
                     }
                     return (
                        <div
                           key={`header-${entryIndex}`}
                           className="px-3 pt-2 pb-1 text-[0.6rem] uppercase tracking-wider text-muted/60 font-semibold select-none"
                        >
                           {entry.label}
                        </div>
                     )
                  }
                  return (
                     <button
                        key={`item-${entryIndex}`}
                        disabled={entry.disabled}
                        onClick={() => handleItemSelect(entry)}
                        className={[
                           'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer',
                           entry.disabled
                              ? 'opacity-40 cursor-not-allowed'
                              : entry.danger
                                 ? 'text-red/80 hover:text-red hover:bg-red/10'
                                 : 'text-text hover:bg-border/50',
                        ].join(' ')}
                     >
                        {entry.icon && <span className="shrink-0 text-muted">{entry.icon}</span>}
                        <span className="flex-1">{entry.label}</span>
                     </button>
                  )
               })}
            </div>
         )}
      </div>
   )
}

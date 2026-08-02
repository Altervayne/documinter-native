// -- Library Imports --
import { Palette } from 'lucide-react'
import { ColorPicker } from 'react-piqua-color'

// -- Lib Imports --
import { clsx } from '../lib/clsx'

// #########
// # TYPES #
// #########

/** One accent-preset tile: a plain filled swatch, no visible name — the name only surfaces as a
 *  tooltip / `aria-label` for accessibility. Built by documentMenuEntries.tsx's
 *  buildDocumentMenuEntries, which is the single place that knows the preset list and which one
 *  is currently active. */
export interface AccentSwatchOption {
   hex:      string
   /** Localized friendly name (e.g. "Orange") — tooltip + aria-label only, never rendered as text. */
   name:     string
   active:   boolean
   onSelect: () => void
}

/** The "Custom accent…" tile: a multicolor affordance that toggles an inline react-piqua-color
 *  ColorPicker directly beneath the grid when expanded. */
export interface AccentCustomSwatchOption {
   /** Localized "Custom accent" name — tooltip + aria-label only, never rendered as text. */
   name:     string
   /** True when the document accent doesn't match any preset (so this tile is the "current" one). */
   active:   boolean
   expanded: boolean
   value:    string
   onToggle: () => void
   onChange: (hex: string) => void
}

interface AccentSwatchGridProps {
   presets: AccentSwatchOption[]
   /** Omitted entirely when the surface didn't wire a custom-accent opener. */
   custom?: AccentCustomSwatchOption
}

// #############
// # CONSTANTS #
// #############

const SWATCH_BASE     = 'w-[18px] h-[18px] rounded-md border transition-all cursor-pointer shrink-0'
const SWATCH_ACTIVE   = 'ring-2 ring-offset-2 ring-offset-raised ring-text border-transparent'
const SWATCH_INACTIVE = 'border-border/60 hover:scale-110 hover:border-border'

/** A sweep across the accent palette itself — reads at a glance as "pick any color", distinct
 *  from the flat preset tiles beside it. */
const CUSTOM_GRADIENT = 'conic-gradient(from 180deg, #f97316, #2563eb, #16a34a, #7c3aed, #e11d48, #0891b2, #2dcea8, #f97316)'

// #############
// # COMPONENT #
// #############

/**
 * The accent picker's shared visual: a compact, nameless grid of filled color-swatch tiles (the
 * name lives only in `title` / `aria-label`) plus a multicolor "Custom accent…" tile that expands
 * an inline ColorPicker directly beneath the grid. Consumed identically by both the top-bar
 * Document dropdown (molecules/DocumentMenu) and the document-background context menu
 * (molecules/ContextMenu) via the shared `{ type: 'accent-grid' }` ContextMenuEntry — rendering
 * it in exactly one place is what keeps the two surfaces' accent presentation in lockstep.
 */
export function AccentSwatchGrid({ presets, custom }: AccentSwatchGridProps) {
   return (
      <div className="px-3 py-2">
         <div className="flex flex-wrap gap-1.5">
            {presets.map(preset => (
               <button
                  key={preset.hex}
                  type="button"
                  title={preset.name}
                  aria-label={preset.name}
                  onClick={preset.onSelect}
                  style={{ background: preset.hex }}
                  className={clsx(SWATCH_BASE, preset.active ? SWATCH_ACTIVE : SWATCH_INACTIVE)}
               />
            ))}
            {custom && (
               <button
                  type="button"
                  title={custom.name}
                  aria-label={custom.name}
                  onClick={custom.onToggle}
                  style={{ backgroundImage: CUSTOM_GRADIENT }}
                  className={clsx(
                     SWATCH_BASE,
                     'flex items-center justify-center',
                     custom.active || custom.expanded ? SWATCH_ACTIVE : SWATCH_INACTIVE,
                  )}
               >
                  <Palette size={10} className="text-white drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]" />
               </button>
            )}
         </div>

         {/* Inline custom-color picker, expanded directly under the grid rather than at the foot
             of the menu or in a detached floating popover — see fix #2 in the 2026-08-02 report. */}
         {custom?.expanded && (
            <div className="pt-2">
               <ColorPicker value={custom.value} onChange={custom.onChange} />
            </div>
         )}
      </div>
   )
}

// -- Library Imports --
import { Palette } from 'lucide-react'
import { ColorPicker } from 'react-piqua-color'

// -- Lib Imports --
import { clsx } from '../lib/clsx'

// #########
// # TYPES #
// #########

export interface AccentSwatchOption {
   hex:      string
   /** Tooltip + aria-label only, never rendered as text. */
   name:     string
   active:   boolean
   onSelect: () => void
}

/** The "Custom accent" tile: a selectable choice like the preset swatches, NOT a disclosure toggle.
 *  Selecting it reveals the inline picker beneath the grid; selecting it again is a no-op. */
export interface AccentCustomSwatchOption {
   name:     string
   /** Active when explicitly selected or when the document accent matches no preset. Drives the ring
    *  and whether the ColorPicker renders. */
   active:   boolean
   value:    string
   onSelect: () => void
   onChange: (hex: string) => void
}

interface AccentSwatchGridProps {
   presets: AccentSwatchOption[]
   /** Omitted when the surface wired no custom-accent opener. */
   custom?: AccentCustomSwatchOption
}

// #############
// # CONSTANTS #
// #############

const SWATCH_BASE     = 'w-[18px] h-[18px] rounded-md border transition-all cursor-pointer shrink-0'
const SWATCH_ACTIVE   = 'ring-2 ring-offset-2 ring-offset-raised ring-text border-transparent'
const SWATCH_INACTIVE = 'border-border/60 hover:scale-110 hover:border-border'

/** A palette sweep, so the Custom tile reads as "pick any color" beside the flat preset tiles. */
const CUSTOM_GRADIENT = 'conic-gradient(from 180deg, #f97316, #2563eb, #16a34a, #7c3aed, #e11d48, #0891b2, #2dcea8, #f97316)'

// #############
// # COMPONENT #
// #############

/**
 * The accent picker's shared visual: a nameless grid of swatch tiles plus a multicolor Custom tile
 * that reveals an inline ColorPicker beneath the grid. Rendered in one place so the Document
 * dropdown and the document-background context menu keep their accent presentation in lockstep.
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
                  onClick={custom.onSelect}
                  style={{ backgroundImage: CUSTOM_GRADIENT }}
                  className={clsx(
                     SWATCH_BASE,
                     'flex items-center justify-center',
                     custom.active ? SWATCH_ACTIVE : SWATCH_INACTIVE,
                  )}
               >
                  <Palette size={10} className="text-white drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]" />
               </button>
            )}
         </div>

         {custom?.active && (
            <div className="pt-2">
               <ColorPicker value={custom.value} onChange={custom.onChange} />
            </div>
         )}
      </div>
   )
}

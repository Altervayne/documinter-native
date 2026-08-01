// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { Palette } from 'lucide-react'
import { ColorPicker } from 'react-piqua-color'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import { clsx } from '../lib/clsx'

// -- Type Imports --
import type { CalloutStyle } from '../types'

// Callout accent colors live as CSS custom properties in doc.css so they
// automatically switch between light-doc and dark-doc palettes.
const STYLES: { value: CalloutStyle; cssVar: string }[] = [
   { value: 'info',    cssVar: '--callout-info-accent'    },
   { value: 'valid',   cssVar: '--callout-valid-accent'   },
   { value: 'warning', cssVar: '--callout-warning-accent' },
   { value: 'danger',  cssVar: '--callout-danger-accent'  },
]

/** Neutral hex handed to the package picker when there is no custom color yet. */
const PICKER_FALLBACK = '#6b7280'

interface CalloutStylePickerProps {
   current: CalloutStyle
   /** Optional custom hex override; when set, it takes precedence over `current` visually
    *  (the presets render unselected — the callout is following its own color, not a preset). */
   customColor?: string
   onChange: (style: CalloutStyle) => void
   /** Applies live while adjusting the custom color (mirrors GraphSeriesColorPopover's onPick). */
   onCustomColorChange: (hex: string) => void
   /** Clears the custom color back to following `current`'s preset. */
   onClearCustomColor: () => void
}

export function CalloutStylePicker({ current, customColor, onChange, onCustomColorChange, onClearCustomColor }: CalloutStylePickerProps) {
   const { t } = useLang()
   const [popoverOpen, setPopoverOpen] = useState(false)
   const customButtonRef = useRef<HTMLButtonElement>(null)

   return (
      <div className="flex items-center gap-1 p-2 -mb-4">
         {STYLES.map(({ value, cssVar }) => (
            <button
               key={value}
               onClick={() => onChange(value)}
               className={clsx(
                  'px-2.5 py-1 text-xs rounded-md border capitalize cursor-pointer transition-all',
                  !customColor && current === value
                     ? 'font-semibold'
                     : 'border-current/20 opacity-50 hover:opacity-80',
               )}
               style={!customColor && current === value
                  ? {
                       color:       `var(${cssVar})`,
                       borderColor: `var(${cssVar})`,
                       background:  `color-mix(in srgb, var(${cssVar}) 10%, transparent)`,
                    }
                  : undefined
               }
            >
               {value}
            </button>
         ))}

         {/* Custom color swatch — opens a popover; picking here overrides the preset entirely. */}
         <button
            ref={customButtonRef}
            type="button"
            onClick={() => setPopoverOpen(true)}
            className={clsx(
               'w-6 h-6 rounded-full border cursor-pointer transition-all flex items-center justify-center shrink-0',
               customColor ? 'ring-2 ring-offset-1 ring-current/30' : 'border-current/20 opacity-50 hover:opacity-80',
            )}
            style={customColor ? { background: customColor, borderColor: customColor } : undefined}
            aria-label={t.calloutCustomColor}
            title={t.calloutCustomColor}
         >
            {!customColor && <Palette size={12} />}
         </button>

         {popoverOpen && (
            <CalloutColorPopover
               anchorRect={customButtonRef.current?.getBoundingClientRect() ?? new DOMRect()}
               value={customColor ?? PICKER_FALLBACK}
               title={t.calloutCustomColor}
               resetLabel={t.calloutClearCustomColor}
               onPick={onCustomColorChange}
               onReset={() => { onClearCustomColor(); setPopoverOpen(false) }}
               onClose={() => setPopoverOpen(false)}
            />
         )}
      </div>
   )
}

// #####################
// # COLOR POPOVER     #
// #####################

interface CalloutColorPopoverProps {
   anchorRect: DOMRect
   value:      string
   title:      string
   resetLabel: string
   onPick:     (hex: string) => void
   onReset:    () => void
   onClose:    () => void
}

/**
 * Floating color popover for the callout's custom-color swatch — the react-piqua-color
 * ColorPicker plus a "clear to preset" action. Mirrors GraphSeriesColorPopover's shell
 * (molecules/GraphDataGrid.tsx) and MetaFieldColorPopover's dismissal pattern, kept local here
 * rather than imported so the callout block doesn't reach into the graph editor module.
 */
function CalloutColorPopover({ anchorRect, value, title, resetLabel, onPick, onReset, onClose }: CalloutColorPopoverProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({ type: 'rect', rect: anchorRect })

   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         const target = event.target as HTMLElement
         if (ref.current?.contains(target)) return
         if (target.closest('[data-callout-color-trigger]')) return
         onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      return () => document.removeEventListener('pointerdown', handlePointerDown)
   }, [onClose, ref])

   return createPortal(
      <div
         ref={ref}
         className="fixed z-[9999] w-62 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         <div className="px-2 pt-2 pb-1.5">
            <span className="text-[0.7rem] uppercase tracking-wider text-muted/70 font-semibold select-none">{title}</span>
         </div>
         <div className="p-2 border-t border-border">
            <ColorPicker value={value} onChange={onPick} />
         </div>
         <div className="border-t border-border px-2 py-1.5">
            <button
               onClick={onReset}
               className="w-full text-left text-xs text-muted hover:text-text transition-colors cursor-pointer px-1 py-0.5 rounded"
            >
               {resetLabel}
            </button>
         </div>
      </div>,
      document.body,
   )
}

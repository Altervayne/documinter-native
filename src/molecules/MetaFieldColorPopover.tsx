// -- React Imports --
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { ColorPicker } from 'react-piqua-color'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// #########
// # TYPES #
// #########

interface MetaFieldColorPopoverProps {
   /** The field's current color: 'accent', a literal hex, or undefined (default gray). */
   activeColor: string | undefined
   /** Viewport rect of the swatch trigger; drives the clamped placement below/above it. */
   anchorRect:  DOMRect
   /** Localised heading for the popover. */
   title:        string
   /** Localised label for the accent-tracking choice. */
   accentLabel:  string
   /** Localised label for the clear-to-default action. */
   defaultLabel: string
   /** Set the field to track the document accent live. */
   onPickAccent: () => void
   /** Set the field to a literal hex. Applies continuously while adjusting. */
   onPickColor:  (hex: string) => void
   /** Clear the field's color back to the default muted gray. */
   onClear:      () => void
   /** Dismiss the popover. */
   onClose:      () => void
}

// #############
// # CONSTANTS #
// #############

/** Neutral hex handed to the package picker when the field has no literal color yet. */
const PICKER_FALLBACK = '#6b7280'

// #############
// # COMPONENT #
// #############

/**
 * Floating per-field color popover for document metadata. Offers three choices: track the
 * document accent live, pick a literal color via the react-piqua-color ColorPicker, or clear
 * back to the default muted gray. Portaled to document.body and viewport-clamped so it stays
 * on-screen even when the trigger sits near an edge.
 */
export function MetaFieldColorPopover({
   activeColor,
   anchorRect,
   title,
   accentLabel,
   defaultLabel,
   onPickAccent,
   onPickColor,
   onClear,
   onClose,
}: MetaFieldColorPopoverProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({ type: 'rect', rect: anchorRect })

   // Dismiss on a pointerdown outside the popover, ignoring the swatch trigger (marked with
   // data-meta-color-trigger) so re-clicking it toggles via the parent rather than fighting this.
   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         const target = event.target as HTMLElement
         if (ref.current?.contains(target)) return
         if (target.closest('[data-meta-color-trigger]')) return
         onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      return () => document.removeEventListener('pointerdown', handlePointerDown)
   }, [onClose, ref])

   const isAccent    = activeColor === 'accent'
   const pickerValue = activeColor && activeColor !== 'accent' ? activeColor : PICKER_FALLBACK

   return createPortal(
      <div
         ref={ref}
         className="fixed z-[9999] w-62 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         {/* Heading + Accent choice */}
         <div className="px-2 pt-2 pb-1.5 flex items-center justify-between gap-2">
            <span className="text-[0.7rem] uppercase tracking-wider text-muted/70 font-semibold select-none">{title}</span>
            <button
               onClick={() => { onPickAccent(); onClose() }}
               className={`flex items-center gap-1.5 text-xs cursor-pointer px-1.5 py-0.5 rounded transition-colors
                  ${isAccent ? 'text-accent bg-accent/10' : 'text-muted hover:text-text hover:bg-accent/10'}`}
            >
               <span className="w-3 h-3 rounded-full bg-accent border border-border" />
               {accentLabel}
            </button>
         </div>

         {/* Custom color picker (applies live while adjusting) */}
         <div className="p-2 border-t border-border">
            <ColorPicker value={pickerValue} onChange={color => onPickColor(color)} />
         </div>

         {/* Clear to default */}
         <div className="border-t border-border px-2 py-1.5">
            <button
               onClick={() => { onClear(); onClose() }}
               className="w-full text-left text-xs text-muted hover:text-text transition-colors cursor-pointer px-1 py-0.5 rounded"
            >
               {defaultLabel}
            </button>
         </div>
      </div>,
      document.body,
   )
}

import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ColorSwatchButton } from '../atoms/ColorSwatchButton'
import { ColorPicker } from './ColorPicker'

// #########
// # TYPES #
// #########

interface InlineColorPopoverProps {
   /** Currently active color hex, or undefined when the field is unset. */
   activeColor: string | undefined
   /**
    * Ref to the trigger button's "relative"-positioned wrapper. Its viewport-space
    * rect is read inside the layout effect below (never during render) to compute a
    * centered-below position that is then clamped to stay on-screen.
    */
   anchorRef:   RefObject<HTMLDivElement | null>
   /** Curated quick-pick palette (existing font/highlight values, no new colors). */
   palette:     readonly string[]
   /** Recently-used custom colors (most-recent-first), shown as a quick-pick row. */
   recent:      readonly string[]
   /** Localised label for the recent-colors row. */
   recentLabel: string
   /** Localised label for the "remove color" action. */
   removeLabel: string
   /** Apply a color to the selection (undefined clears the field). Does not close. */
   onApply:     (color: string | undefined) => void
   /** Close the popover, used by the discrete actions (quick-pick swatch / remove). */
   onClose:     () => void
}

interface Pos { top: number; left: number }

// #############
// # CONSTANTS #
// #############

/** Minimum gap kept between the clamped popover and the viewport edge. */
const CLAMP_MARGIN = 8

/** Vertical gap between the trigger button and the popover beneath it. */
const TRIGGER_GAP = 6

// #############
// # COMPONENT #
// #############

/**
 * Floating color popover shared by the font-color and highlight-color buttons.
 * Mirrors the accent-color picker in AppearanceMenu: a row of curated quick-pick
 * swatches plus the full ColorPicker for custom colors. The ColorPicker emits
 * onChange continuously while dragging, so it applies without closing; quick-pick
 * swatches and the remove action are discrete and close on selection.
 *
 * A "recent" row surfaces previously-used custom colors (those not in the curated
 * palette) so they can be re-applied in one click.
 */
export function InlineColorPopover({ activeColor, anchorRef, palette, recent, recentLabel, removeLabel, onApply, onClose }: InlineColorPopoverProps) {
   const pickAndClose = (color: string) => { onApply(color); onClose() }

   const popoverRef = useRef<HTMLDivElement>(null)

   // Position relative to the trigger's own box (this popover's containing block —
   // it's `position: absolute` inside the trigger's `position: relative` wrapper).
   const [position, setPosition] = useState<Pos>({ top: 0, left: 0 })

   // Measures the popover's real rendered size on mount (this component mounts fresh
   // each time it opens, so "once on mount" naturally recomputes for new content), then
   // clamps the desired centered-below-trigger position two-sided so it can never
   // render partly off-screen — compounds correctly even when the trigger itself
   // (FormatToolbar) is already clamped near an edge. Both refs are read here, inside
   // the effect, never during render.
   useLayoutEffect(() => {
      const popoverElement = popoverRef.current
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!popoverElement || !anchor) return
      const popoverBoundingRect = popoverElement.getBoundingClientRect()

      const desiredLeft = anchor.left + anchor.width / 2 - popoverBoundingRect.width / 2
      const desiredTop  = anchor.bottom + TRIGGER_GAP

      const clampedLeft = Math.max(CLAMP_MARGIN, Math.min(desiredLeft, window.innerWidth  - popoverBoundingRect.width  - CLAMP_MARGIN))
      const clampedTop  = Math.max(CLAMP_MARGIN, Math.min(desiredTop,  window.innerHeight - popoverBoundingRect.height - CLAMP_MARGIN))

      setPosition({
         top:  clampedTop  - anchor.top,
         left: clampedLeft - anchor.left,
      })
   }, [anchorRef])

   return (
      <div
         ref={popoverRef}
         className="absolute w-62 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{
            top:       position.top,
            left:      position.left,
            animation: 'link-panel-in 120ms ease-out both',
            zIndex:    10,
         }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         {/* Curated quick-pick swatches */}
         <div className="flex flex-wrap gap-1 p-2">
            {palette.map(color => (
               <ColorSwatchButton key={color} color={color} isActive={activeColor === color} onPick={pickAndClose} />
            ))}
         </div>

         {/* Recently-used custom colors */}
         {recent.length > 0 && (
            <div className="border-t border-border px-2 pt-1.5 pb-2">
               <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider px-1 pb-1.5">
                  {recentLabel}
               </div>
               <div className="flex flex-wrap gap-1">
                  {recent.map(color => (
                     <ColorSwatchButton key={color} color={color} isActive={activeColor === color} onPick={pickAndClose} />
                  ))}
               </div>
            </div>
         )}

         {/* Full custom color picker, replaces the old native <input type="color"> */}
         <div className="border-t border-border p-2">
            <ColorPicker value={activeColor ?? palette[0]} onChange={color => onApply(color)} />
         </div>

         {/* Remove color */}
         <div className="border-t border-border px-2 py-1.5">
            <button
               onClick={() => { onApply(undefined); onClose() }}
               className="w-full text-left text-xs text-muted hover:text-text transition-colors cursor-pointer px-1 py-0.5 rounded"
            >
               {removeLabel}
            </button>
         </div>
      </div>
   )
}

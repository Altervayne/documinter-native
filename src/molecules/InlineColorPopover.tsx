import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ColorPicker } from 'react-piqua-color'

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
   /** Localised label for the curated-palette row. */
   paletteLabel: string
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
 * The package ColorPicker renders the curated-palette row, the recents row, and the
 * custom-color body itself (swatchesPosition="top"), and auto-highlights the swatch
 * matching `value`. onChange applies continuously while dragging, so an active
 * adjustment (input / slider / eyedropper) stays open; a discrete swatch or recent
 * pick closes the popover via onColorCommitted, as does the remove action below.
 */
export function InlineColorPopover({ activeColor, anchorRef, palette, recent, paletteLabel, recentLabel, removeLabel, onApply, onClose }: InlineColorPopoverProps) {
   const popoverRef = useRef<HTMLDivElement>(null)

   // Position relative to the trigger's own box (this popover's containing block,
   // it's `position: absolute` inside the trigger's `position: relative` wrapper).
   const [position, setPosition] = useState<Pos>({ top: 0, left: 0 })

   // Measures the popover's real rendered size on mount (this component mounts fresh
   // each time it opens, so "once on mount" naturally recomputes for new content), then
   // clamps the desired centered-below-trigger position two-sided so it can never
   // render partly off-screen, compounds correctly even when the trigger itself
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

      // Rounded to whole pixels: a fractional absolute offset renders the popover off the pixel grid,
      // which the browser anti-aliases into a blur that reads like an unwanted scale.
      setPosition({
         top:  Math.round(clampedTop  - anchor.top),
         left: Math.round(clampedLeft - anchor.left),
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
         {/* Palette row, recents row, and custom picker, all rendered by the package.
             The palette/recents sit on top (swatchesPosition="top"); the swatch matching
             `value` is auto-highlighted. A swatch/recent pick is discrete and closes; an
             input/slider/eyedropper adjustment applies live and stays open. */}
         <div className="p-2">
            <ColorPicker
               value={activeColor ?? palette[0]}
               onChange={color => onApply(color)}
               swatches={[...palette]}
               recentColors={[...recent]}
               swatchesLabel={paletteLabel}
               recentLabel={recentLabel}
               swatchesPosition="top"
               onColorCommitted={(_hex, source) => { if (source === 'swatch' || source === 'recent') onClose() }}
            />
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

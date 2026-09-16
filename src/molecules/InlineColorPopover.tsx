import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ColorPicker } from 'react-piqua-color'

// #########
// # TYPES #
// #########

interface InlineColorPopoverProps {
   /** Active color hex, or undefined when unset. */
   activeColor: string | undefined
   /** The trigger's positioned wrapper; its rect anchors the clamped placement below. */
   anchorRef:   RefObject<HTMLDivElement | null>
   /** Curated quick-pick palette (existing font/highlight values, no new colors). */
   palette:     readonly string[]
   /** Recently-used custom colors, most-recent-first. */
   recent:      readonly string[]
   paletteLabel: string
   recentLabel: string
   removeLabel: string
   /** Apply a color to the selection (undefined clears it). Does not close. */
   onApply:     (color: string | undefined) => void
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
 * Floating color popover shared by the font-color and highlight-color buttons. The package
 * ColorPicker renders the palette row, recents row, and custom body. A live adjustment (drag /
 * slider / eyedropper) stays open; a discrete swatch or recent pick closes it, as does remove.
 */
export function InlineColorPopover({ activeColor, anchorRef, palette, recent, paletteLabel, recentLabel, removeLabel, onApply, onClose }: InlineColorPopoverProps) {
   const popoverRef = useRef<HTMLDivElement>(null)

   // Position relative to the trigger's box (this popover is absolute inside its relative wrapper).
   const [position, setPosition] = useState<Pos>({ top: 0, left: 0 })

   // Measure the popover on mount (it remounts each open, so this recomputes for new content), then
   // clamp the centered-below-trigger position so it never renders off-screen even when the trigger
   // is already clamped near an edge.
   useLayoutEffect(() => {
      const popoverElement = popoverRef.current
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!popoverElement || !anchor) return
      const popoverBoundingRect = popoverElement.getBoundingClientRect()

      const desiredLeft = anchor.left + anchor.width / 2 - popoverBoundingRect.width / 2
      const desiredTop  = anchor.bottom + TRIGGER_GAP

      const clampedLeft = Math.max(CLAMP_MARGIN, Math.min(desiredLeft, window.innerWidth  - popoverBoundingRect.width  - CLAMP_MARGIN))
      const clampedTop  = Math.max(CLAMP_MARGIN, Math.min(desiredTop,  window.innerHeight - popoverBoundingRect.height - CLAMP_MARGIN))

      // Whole pixels, else a fractional offset lands off the pixel grid and blurs into an unwanted scale.
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

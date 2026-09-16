// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { ColorPicker } from 'react-piqua-color'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// #########
// # TYPES #
// #########

interface ColorSwatchFieldProps {
   /** Shown in the swatch, and the value the picker opens on. */
   value: string
   /** Heading shown atop the popover. */
   title: string
   ariaLabel: string
   /** Apply a picked hex; fires live while dragging/typing in the picker. */
   onChange: (hex: string) => void
   /** Clear an override back to its fallback default. Omit to hide the reset row, for a field with no
    *  fallback to revert to (the image-markup stroke/fill/text colors). */
   onReset?: () => void
   /** Required whenever `onReset` is supplied. */
   resetLabel?: string
   /** Appended after the shared `color-swatch-btn` base class. */
   className?: string
}

// #############
// # COMPONENT #
// #############

/**
 * A swatch button that opens the app ColorPicker in a floating, portaled, viewport-clamped popover.
 * Backs the diagram inspector's `ColorRow` and the image-markup editor's stroke/fill/text controls.
 * Unlike the graph/meta-field popovers the reset row here is optional (pass `onReset` only when the
 * field can fall back to something).
 */
export function ColorSwatchField({ value, title, ariaLabel, onChange, onReset, resetLabel, className }: ColorSwatchFieldProps) {
   const [isOpen, setIsOpen]         = useState(false)
   const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
   const triggerRef = useRef<HTMLButtonElement>(null)

   function toggle(): void {
      if (isOpen) {
         setIsOpen(false)
         return
      }
      setAnchorRect(triggerRef.current?.getBoundingClientRect() ?? null)
      setIsOpen(true)
   }

   return (
      <>
         <button
            type="button"
            ref={triggerRef}
            className={className ? `color-swatch-btn ${className}` : 'color-swatch-btn'}
            data-color-swatch-trigger
            style={{ background: value }}
            aria-label={ariaLabel}
            title={ariaLabel}
            onClick={toggle}
         />
         {isOpen && anchorRect && (
            <ColorSwatchPopover
               anchorRect={anchorRect}
               value={value}
               title={title}
               resetLabel={resetLabel}
               onPick={onChange}
               onReset={onReset}
               onClose={() => setIsOpen(false)}
            />
         )}
      </>
   )
}

// #############
// # POPOVER   #
// #############

interface ColorSwatchPopoverProps {
   /** Viewport rect of the swatch trigger; drives the clamped placement below/above it. */
   anchorRect:  DOMRect
   value:       string
   title:       string
   resetLabel?: string
   onPick:      (hex: string) => void
   onReset?:    () => void
   onClose:     () => void
}

function ColorSwatchPopover({ anchorRect, value, title, resetLabel, onPick, onReset, onClose }: ColorSwatchPopoverProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({ type: 'rect', rect: anchorRect })

   // Dismiss on outside pointerdown, ignoring the swatch trigger (its own click toggles the popover;
   // closing here too would just re-open it).
   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         const target = event.target as HTMLElement
         if (ref.current?.contains(target)) return
         if (target.closest('[data-color-swatch-trigger]')) return
         onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      return () => document.removeEventListener('pointerdown', handlePointerDown)
   }, [onClose, ref])

   return createPortal(
      // z above the modal layer (dialogs are z-[10000]): the swatch is used inside modals, and an
      // open picker is always the topmost transient interaction.
      <div
         ref={ref}
         className="fixed z-[10001] w-62 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         <div className="px-2 pt-2 pb-1.5">
            <span className="text-[0.7rem] uppercase tracking-wider text-muted/70 font-semibold select-none">{title}</span>
         </div>
         <div className="p-2 border-t border-border">
            <ColorPicker value={value} onChange={onPick} />
         </div>
         {onReset && (
            <div className="border-t border-border px-2 py-1.5">
               <button
                  onClick={() => { onReset(); onClose() }}
                  className="w-full text-left text-xs text-muted hover:text-text transition-colors cursor-pointer px-1 py-0.5 rounded"
               >
                  {resetLabel}
               </button>
            </div>
         )}
      </div>,
      document.body,
   )
}

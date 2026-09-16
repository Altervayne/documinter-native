// -- React Imports --
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// #########
// # TYPES #
// #########

/** A viewport-coordinate click point (menus at the cursor), or an anchor rect for pickers that flip above/below their trigger. */
export type ClampAnchor =
   | { type: 'point'; x: number; y: number }
   | { type: 'rect';  rect: DOMRect; preferAbove?: boolean }

interface ClampedResult<ElementType extends HTMLElement> {
   /** Attach to the popover element, its rendered size drives the clamp. */
   ref:  RefObject<ElementType | null>
   top:  number
   left: number
}

// #############
// # CONSTANTS #
// #############

// Gap kept between a clamped popover and every viewport edge. Exported so a popover taller than the
// viewport can cap its own height to the same margin instead of hardcoding a second value.
export const DEFAULT_MARGIN = 12

// ############
// # INTERNAL #
// ############

// Two-sided clamp. The near-edge floor (Math.max) matters because a Math.min-only clamp lets
// `viewport - size - margin` go negative and push the popover off-screen. Exported so the
// draggable-window primitive reuses the exact same rule.
export function clampAxis(desired: number, size: number, viewportSize: number, margin: number): number {
   return Math.max(margin, Math.min(desired, viewportSize - size - margin))
}

function computePosition(
   anchor:   ClampAnchor,
   size:     { width: number; height: number },
   viewport: { width: number; height: number },
   margin:   number,
): { top: number; left: number } {
   let desiredLeft: number
   let desiredTop:  number

   if (anchor.type === 'point') {
      desiredLeft = anchor.x
      desiredTop  = anchor.y
   } else {
      const spaceAbove = anchor.rect.top - margin
      const spaceBelow = viewport.height - anchor.rect.bottom - margin
      // Prefer the hinted side when it fits, otherwise open on whichever side has more room.
      const openAbove = anchor.preferAbove
         ? spaceAbove >= size.height || spaceAbove >= spaceBelow
         : spaceBelow < size.height && spaceAbove > spaceBelow
      desiredLeft = anchor.rect.left
      desiredTop  = openAbove ? anchor.rect.top - size.height : anchor.rect.bottom
   }

   return {
      left: clampAxis(desiredLeft, size.width,  viewport.width,  margin),
      top:  clampAxis(desiredTop,  size.height, viewport.height, margin),
   }
}

// #############
// # HOOK      #
// #############

/**
 * Positions a portaled popover to stay fully on-screen on both axes. Size is measured from the rendered
 * node (layout effect + ref), not estimated from a row count, since an undershoot would push it
 * off-screen; recomputes on window resize so an open popover follows the viewport.
 */
export function useViewportClampedPosition<ElementType extends HTMLElement = HTMLDivElement>(
   anchor: ClampAnchor,
   margin: number = DEFAULT_MARGIN,
): ClampedResult<ElementType> {
   const ref = useRef<ElementType>(null)
   const [size, setSize] = useState({ width: 0, height: 0 })
   const [viewport, setViewport] = useState(() => ({
      width:  window.innerWidth,
      height: window.innerHeight,
   }))

   // Measure before paint (synchronous) so the 0x0 first pass is corrected without a visible flicker.
   useLayoutEffect(() => {
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
   }, [])

   // A menu can grow while open (the accent section expands an inline ColorPicker in place), so
   // re-measure on size changes to keep the taller box on-screen rather than freezing the mount-time size.
   useEffect(() => {
      const element = ref.current
      if (!element || typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(() => {
         const rect = element.getBoundingClientRect()
         setSize(current => (current.width === rect.width && current.height === rect.height)
            ? current
            : { width: rect.width, height: rect.height })
      })
      observer.observe(element)
      return () => observer.disconnect()
   }, [])

   useEffect(() => {
      function handleResize() {
         setViewport({ width: window.innerWidth, height: window.innerHeight })
      }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
   }, [])

   const { top, left } = computePosition(anchor, size, viewport, margin)
   return { ref, top, left }
}

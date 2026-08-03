// -- React Imports --
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// #########
// # TYPES #
// #########

/**
 * A viewport-coordinate click point (context menus open at the cursor), or an anchor
 * rectangle for dropdowns/pickers that flip above/below their trigger button.
 */
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

// A small but visible gap kept between a clamped popover's box and every viewport edge, enough
// that the menu (and its softened drop-shadow) never reads as flush-with / spilling-off the edge.
const DEFAULT_MARGIN = 12

// ############
// # INTERNAL #
// ############

// Two-sided clamp: never past the far edge (Math.min) and never before the near
// edge (Math.max). The near-edge floor is the fix for the audited bug, a Math.min-only
// clamp lets `viewport − size − margin` go negative and pushes the popover off-screen.
// Exported so the draggable-window primitive reuses the exact same clamp rule rather than
// re-deriving it (single source of truth for "can never leave the viewport").
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
 * Positions a portaled popover so it stays fully on-screen on both axes.
 *
 * The popover's size is measured from the actual rendered node (layout effect + ref),
 * not estimated from an item count, heights here are dynamic (a context menu grows with
 * its rows, BlockContextMenu can reach ~650px), and estimating is exactly what let the
 * off-screen-clamp bug slip in. Recomputes on window resize so an open popover follows
 * the viewport.
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

   // Measure the rendered popover before paint (synchronous, so no visible flicker as the
   // 0×0 first pass is corrected). This captures the real box on mount, the fix for the
   // estimate-driven off-screen bug.
   useLayoutEffect(() => {
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
   }, [])

   // A menu's content isn't always stable while open, e.g. the document-background context
   // menu's accent section expands an inline ColorPicker in place, growing the menu's own box.
   // Re-measure whenever the rendered size actually changes so the clamp keeps the (now taller)
   // popover fully on-screen instead of freezing the stale mount-time box.
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

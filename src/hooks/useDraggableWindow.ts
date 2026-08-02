// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// -- Hook Imports --
import { clampAxis } from './useViewportClampedPosition'

// #########
// # TYPES #
// #########

export interface WindowPosition {
   top:  number
   left: number
}

export interface WindowSize {
   width:  number
   height: number
}

interface Viewport {
   width:  number
   height: number
}

interface UseDraggableWindowOptions {
   /** Initial top/left; the caller derives it from the anchor block's rect, then clamps. */
   initialPosition: WindowPosition
   /** Initial width/height of the window body. */
   initialSize: WindowSize
   /** Smallest the window may be resized to. */
   minSize: WindowSize
   /** Largest the window may be resized to (also capped by the remaining viewport). */
   maxSize: WindowSize
   /**
    * When true, drag + resize are inert (the narrow-viewport sheet fallback disables both). The
    * hook still tracks position/size so re-enabling keeps the last values.
    */
   disabled: boolean
   /** Viewport-edge margin the window is kept inside of; shared with the clamp math. */
   margin: number
}

interface UseDraggableWindowResult {
   position: WindowPosition
   size:     WindowSize
   /** Programmatic placement (e.g. re-centering when the anchor changes). */
   setPosition: (position: WindowPosition) => void
   /** Spread onto the title bar; starts a move-drag on pointer-down. */
   titleBarProps: {
      onPointerDown:   (event: ReactPointerEvent) => void
      onPointerMove:   (event: ReactPointerEvent) => void
      onPointerUp:     (event: ReactPointerEvent) => void
      onPointerCancel: (event: ReactPointerEvent) => void
   }
   /** Spread onto the bottom-right resize grip; starts a resize-drag on pointer-down. */
   resizeHandleProps: {
      onPointerDown:   (event: ReactPointerEvent) => void
      onPointerMove:   (event: ReactPointerEvent) => void
      onPointerUp:     (event: ReactPointerEvent) => void
      onPointerCancel: (event: ReactPointerEvent) => void
   }
   /** True while a move or resize drag is in progress (drives the user-select guard). */
   isInteracting: boolean
}

// ############
// # PURE MATH #
// ############
// These are extracted as pure functions (no DOM, no React) so the clamp logic is unit-testable
// in isolation. The window drag/resize interaction is just these two applied to pointer state.

/**
 * Clamp a desired top/left so the window of `size` stays fully inside `viewport` (both axes),
 * reusing the exact two-sided `clampAxis` rule from the popover positioner.
 */
export function clampWindowPosition(
   position: WindowPosition,
   size:     WindowSize,
   viewport: Viewport,
   margin:   number,
): WindowPosition {
   return {
      left: clampAxis(position.left, size.width,  viewport.width,  margin),
      top:  clampAxis(position.top,  size.height, viewport.height, margin),
   }
}

/**
 * Clamp a desired width/height to [minSize, maxSize], further capped so the window's far edge
 * (at `position`) never crosses the viewport margin. The lower bound wins if the two collide, so
 * the window never inverts.
 */
export function clampWindowSize(
   desired:  WindowSize,
   position: WindowPosition,
   minSize:  WindowSize,
   maxSize:  WindowSize,
   viewport: Viewport,
   margin:   number,
): WindowSize {
   const availableWidth  = viewport.width  - position.left - margin
   const availableHeight = viewport.height - position.top  - margin
   const width  = Math.max(minSize.width,  Math.min(desired.width,  maxSize.width,  availableWidth))
   const height = Math.max(minSize.height, Math.min(desired.height, maxSize.height, availableHeight))
   return { width, height }
}

// ########
// # HOOK #
// ########

function readViewport(): Viewport {
   return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * Pointer-Events drag + resize for a floating window, no dependency. A move-drag records the
 * pointer's offset within the window on pointer-down, captures the pointer, and on every move
 * re-derives top/left through the shared viewport clamp. A resize-drag records the start pointer
 * and size, then grows width/height clamped to min/max and the remaining viewport. Pointer
 * capture (not global document listeners) keeps tracking when the pointer leaves the handle and
 * auto-cleans on pointer-up/cancel. A window-resize listener re-clamps the stored position so a
 * shrinking viewport can never strand the window off-screen.
 */
export function useDraggableWindow(options: UseDraggableWindowOptions): UseDraggableWindowResult {
   const { initialPosition, initialSize, minSize, maxSize, disabled, margin } = options

   const [position, setPosition] = useState<WindowPosition>(initialPosition)
   const [size,     setSize]     = useState<WindowSize>(initialSize)
   const [isInteracting, setIsInteracting] = useState(false)

   // Live drag state kept in refs (mutating it must not trigger a re-render).
   const moveOffset   = useRef<{ x: number; y: number } | null>(null)
   const resizeStart  = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

   // Re-clamp on viewport resize so the window can't be left stranded off-screen. `size` is a dep
   // so the listener always clamps against the current box; the functional updater reads the latest
   // position, and a fresh viewport is measured each time.
   useEffect(() => {
      function handleResize() {
         setPosition(current => clampWindowPosition(current, size, readViewport(), margin))
      }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
   }, [margin, size])

   // ============
   //  Move drag
   // ============
   function onMovePointerDown(event: ReactPointerEvent) {
      if (disabled) return
      // Don't start a drag when the press lands on an interactive control inside the title bar
      // (e.g. the close button). Otherwise setPointerCapture below redirects the pointer to the
      // title bar and the control's click never fires, the window becomes impossible to close.
      if ((event.target as Element).closest('button, input, select, textarea, a, [role="button"]')) return
      moveOffset.current = { x: event.clientX - position.left, y: event.clientY - position.top }
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsInteracting(true)
   }
   function onMovePointerMove(event: ReactPointerEvent) {
      const offset = moveOffset.current
      if (!offset) return
      const desired: WindowPosition = { left: event.clientX - offset.x, top: event.clientY - offset.y }
      setPosition(clampWindowPosition(desired, size, readViewport(), margin))
   }
   function endMove(event: ReactPointerEvent) {
      if (!moveOffset.current) return
      moveOffset.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
         event.currentTarget.releasePointerCapture(event.pointerId)
      setIsInteracting(false)
   }

   // ============
   //  Resize drag
   // ============
   function onResizePointerDown(event: ReactPointerEvent) {
      if (disabled) return
      // The grip lives on the title-bar's sibling; stop the event so it does not also start a move.
      event.stopPropagation()
      resizeStart.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height }
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsInteracting(true)
   }
   function onResizePointerMove(event: ReactPointerEvent) {
      const start = resizeStart.current
      if (!start) return
      const desired: WindowSize = {
         width:  start.width  + (event.clientX - start.x),
         height: start.height + (event.clientY - start.y),
      }
      setSize(clampWindowSize(desired, position, minSize, maxSize, readViewport(), margin))
   }
   function endResize(event: ReactPointerEvent) {
      if (!resizeStart.current) return
      resizeStart.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
         event.currentTarget.releasePointerCapture(event.pointerId)
      setIsInteracting(false)
   }

   return {
      position,
      size,
      setPosition,
      titleBarProps: {
         onPointerDown:   onMovePointerDown,
         onPointerMove:   onMovePointerMove,
         onPointerUp:     endMove,
         onPointerCancel: endMove,
      },
      resizeHandleProps: {
         onPointerDown:   onResizePointerDown,
         onPointerMove:   onResizePointerMove,
         onPointerUp:     endResize,
         onPointerCancel: endResize,
      },
      isInteracting,
   }
}

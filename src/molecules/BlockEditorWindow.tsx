// -- React Imports --
import { useState } from 'react'
import type { ReactNode } from 'react'

// -- Component Imports --
import { FloatingWindow } from './FloatingWindow'
import { clampWindowPosition, type WindowPosition, type WindowSize } from '../hooks/useDraggableWindow'

// #############
// # CONSTANTS #
// #############

const DEFAULT_SIZE: WindowSize = { width: 460, height: 540 }
const MIN_SIZE:     WindowSize = { width: 320, height: 240 }
const MAX_SIZE:     WindowSize = { width: 920, height: 860 }
const VIEWPORT_MARGIN = 12
// Gap between the anchored block and the window's initial placement.
const ANCHOR_GAP = 16

// #########
// # TYPES #
// #########

interface BlockEditorWindowProps {
   /** Title-bar label (block-type aware, e.g. "Edit chart"). */
   title: string
   /** The anchored block's viewport rect; the window opens offset from it, then clamps. */
   anchorRect: DOMRect
   /** Optional leading icon in the title bar. */
   icon?: ReactNode
   /**
    * Move focus into the window on open (and restore the previously-focused element on close).
    * Defaults to true for a block editor. Set false for a TOOL window that acts on a surface
    * underneath it (the math symbol palette), so the underlying textarea keeps focus and the
    * user can keep typing while the window stays open.
    */
   focusOnOpen?: boolean
   /** Close the window (close button / Escape). */
   onClose: () => void
   /** The block's expanded editor UI. */
   children: ReactNode
}

// ###########
// # HELPERS #
// ###########

/**
 * Initial placement: sit the window to the right of the block (or to its left when the right side
 * has no room), aligned to the block's top, then clamp fully on-screen. A degenerate anchor rect
 * (a block whose ref had not measured) falls back to viewport-centered.
 */
function computeInitialPosition(
   anchorRect: DOMRect,
   size:       WindowSize,
   viewport:   { width: number; height: number },
): WindowPosition {
   const isDegenerate = anchorRect.width === 0 && anchorRect.height === 0
   if (isDegenerate) {
      const centered: WindowPosition = {
         left: (viewport.width  - size.width)  / 2,
         top:  (viewport.height - size.height) / 2,
      }
      return clampWindowPosition(centered, size, viewport, VIEWPORT_MARGIN)
   }

   const fitsRight = anchorRect.right + ANCHOR_GAP + size.width <= viewport.width - VIEWPORT_MARGIN
   const desiredLeft = fitsRight
      ? anchorRect.right + ANCHOR_GAP
      : anchorRect.left - ANCHOR_GAP - size.width
   const desired: WindowPosition = { left: desiredLeft, top: anchorRect.top }
   return clampWindowPosition(desired, size, viewport, VIEWPORT_MARGIN)
}

// #############
// # COMPONENT #
// #############

/**
 * A floating, draggable, NON-MODAL window hosting a block's full editing UI. It is the shared
 * `FloatingWindow` shell configured for a block editor: placed offset from the block's anchor rect
 * (once, on open), focus-grabbing by default, Escape-closing, and degrading to a near-full-screen
 * sheet on a narrow viewport. Unlike every other overlay in the app it has NO backdrop and does NOT
 * close on outside-click or scroll; only the close button and Escape dismiss it.
 *
 * Lifecycle is owned by the caller: the window is rendered inline by the block component only while
 * that block is the open one, so a deleted block unmounts and takes the window with it for free.
 */
export function BlockEditorWindow({ title, anchorRect, icon, focusOnOpen = true, onClose, children }: BlockEditorWindowProps) {
   // Initial placement computed once from the anchor rect (lazy initializer, no recompute on every
   // render; a re-open remounts this component and recomputes fresh).
   const [initialPosition] = useState<WindowPosition>(() =>
      computeInitialPosition(anchorRect, DEFAULT_SIZE, { width: window.innerWidth, height: window.innerHeight }),
   )

   return (
      <FloatingWindow
         title={title}
         icon={icon}
         initialPosition={initialPosition}
         initialSize={DEFAULT_SIZE}
         minSize={MIN_SIZE}
         maxSize={MAX_SIZE}
         margin={VIEWPORT_MARGIN}
         focusOnOpen={focusOnOpen}
         escapeCloses
         sheetFallback
         onClose={onClose}
      >
         {children}
      </FloatingWindow>
   )
}

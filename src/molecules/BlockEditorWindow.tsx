// -- React Imports --
import { useState } from 'react'
import type { ReactNode } from 'react'

// -- Library Imports --
import { PopAWindow, computeAnchoredPosition, usePopAWindowBounds, type WindowSize } from 'react-pop-a-window'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

// #############
// # CONSTANTS #
// #############

// The anchor-placement size, matching the window's default initial size. The window itself opens at
// the package defaults (460x540 / 320x240 / 920x860 / margin 12), so only the placement math needs it.
const SIZE: WindowSize = { width: 460, height: 540 }
// Gap between the anchored block and the window's initial placement, and the viewport-edge margin the
// placement is kept inside of. Both match the package's own defaults, passed here for intent.
const ANCHOR_GAP = 16
const VIEWPORT_MARGIN = 12

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

// #############
// # COMPONENT #
// #############

/**
 * A floating, draggable, NON-MODAL window hosting a block's full editing UI. It is the shared
 * `PopAWindow` shell configured for a block editor: placed offset from the block's anchor rect
 * (once, on open), focus-grabbing by default, Escape-closing, and degrading to a near-full-screen
 * sheet on a narrow viewport. Unlike every other overlay in the app it has NO backdrop and does NOT
 * close on outside-click or scroll; only the close button and Escape dismiss it.
 *
 * Lifecycle is owned by the caller: the window is rendered inline by the block component only while
 * that block is the open one, so a deleted block unmounts and takes the window with it for free.
 */
export function BlockEditorWindow({ title, anchorRect, icon, focusOnOpen = true, onClose, children }: BlockEditorWindowProps) {
   const { t } = useLang()
   const bounds = usePopAWindowBounds()

   // Initial placement computed once from the anchor rect (lazy initializer, no recompute on every
   // render; a re-open remounts this component and recomputes fresh). The window sits to the right of
   // the block when it fits there, else to its left, and clamps fully on-screen.
   const [initialPosition] = useState(() =>
      computeAnchoredPosition(anchorRect, SIZE, bounds, { gap: ANCHOR_GAP, margin: VIEWPORT_MARGIN }),
   )

   return (
      <PopAWindow
         title={title}
         icon={icon}
         initialPosition={initialPosition}
         focusOnOpen={focusOnOpen}
         closeLabel={t.blockWindowClose}
         resizeLabel={t.blockWindowResize}
         // The window portals over the document surface, and React bubbles synthetic events up the
         // React tree (not the DOM tree), so a right-click inside the window would otherwise reach the
         // document's onContextMenu and open a document menu on top of any editor menu. Stop it here.
         stopContextMenuPropagation={true}
         onClose={onClose}
      >
         {children}
      </PopAWindow>
   )
}

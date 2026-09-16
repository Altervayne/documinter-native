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

// Placement inputs, matching the package's own defaults; only the placement math below needs them.
const SIZE: WindowSize = { width: 460, height: 540 }
const ANCHOR_GAP = 16
const VIEWPORT_MARGIN = 12

// #########
// # TYPES #
// #########

interface BlockEditorWindowProps {
   title: string
   /** The anchored block's viewport rect; the window opens offset from it, then clamps. */
   anchorRect: DOMRect
   icon?: ReactNode
   /** Move focus into the window on open (default). Set false for a TOOL window acting on the surface
    *  beneath it (the math symbol palette), so that surface keeps focus and typing continues. */
   focusOnOpen?: boolean
   onClose: () => void
   children: ReactNode
}

// #############
// # COMPONENT #
// #############

/**
 * A floating, NON-MODAL window hosting a block's editing UI: the shared `PopAWindow` shell. Unlike
 * every other overlay it has NO backdrop and does NOT close on outside-click or scroll (only the
 * close button and Escape do). The caller renders it inline only while its block is open.
 */
export function BlockEditorWindow({ title, anchorRect, icon, focusOnOpen = true, onClose, children }: BlockEditorWindowProps) {
   const { t } = useLang()
   const bounds = usePopAWindowBounds()

   // Placement computed once from the anchor rect (a re-open remounts and recomputes fresh).
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
         // React bubbles synthetic events up the React tree, not the DOM: without this a right-click
         // inside the portaled window reaches the document's onContextMenu and opens a menu over it.
         stopContextMenuPropagation={true}
         onClose={onClose}
      >
         {children}
      </PopAWindow>
   )
}

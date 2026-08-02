// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { X } from 'lucide-react'

// -- Context / Hook Imports --
import { useLang } from '../contexts/LangContext'
import {
   useDraggableWindow,
   clampWindowPosition,
   type WindowPosition,
   type WindowSize,
} from '../hooks/useDraggableWindow'

// #############
// # CONSTANTS #
// #############

const DEFAULT_SIZE: WindowSize = { width: 460, height: 540 }
const MIN_SIZE:     WindowSize = { width: 320, height: 240 }
const MAX_SIZE:     WindowSize = { width: 920, height: 860 }
const VIEWPORT_MARGIN = 12
// Gap between the anchored block and the window's initial placement.
const ANCHOR_GAP = 16
// Below this viewport width the window degrades to a near-full-screen sheet (drag/resize off).
const SHEET_BREAKPOINT = 640

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
 * A floating, draggable, NON-MODAL window hosting a block's full editing UI. Portaled to the body
 * (escaping the block's DnD transform / overflow context), position: fixed, with a drag title bar
 * and a bottom-right resize grip (both via useDraggableWindow). Unlike every other overlay in the
 * app it has NO backdrop and does NOT close on outside-click or scroll, the document stays live
 * behind it; only the close button and Escape dismiss it. Below a narrow breakpoint it degrades to
 * a near-full-screen sheet with drag/resize disabled.
 *
 * Lifecycle is owned by the caller: the window is rendered inline by the block component only while
 * that block is the open one, so a deleted block unmounts and takes the window with it for free.
 */
export function BlockEditorWindow({ title, anchorRect, icon, focusOnOpen = true, onClose, children }: BlockEditorWindowProps) {
   const { t } = useLang()

   // Narrow-viewport sheet fallback, tracked live so a resize across the breakpoint re-renders.
   const [isSheet, setIsSheet] = useState(() => window.innerWidth < SHEET_BREAKPOINT)
   useEffect(() => {
      function handleResize() { setIsSheet(window.innerWidth < SHEET_BREAKPOINT) }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
   }, [])

   // Initial placement computed once from the anchor rect (lazy initializer, no recompute on
   // every render; a re-open remounts this component and recomputes fresh).
   const [initialPosition] = useState<WindowPosition>(() =>
      computeInitialPosition(anchorRect, DEFAULT_SIZE, { width: window.innerWidth, height: window.innerHeight }),
   )

   const drag = useDraggableWindow({
      initialPosition,
      initialSize: DEFAULT_SIZE,
      minSize:     MIN_SIZE,
      maxSize:     MAX_SIZE,
      disabled:    isSheet,
      margin:      VIEWPORT_MARGIN,
   })

   const windowRef = useRef<HTMLDivElement>(null)

   // Focus moves into the window on open; the previously-focused element is restored on close.
   // Non-modal, so no focus trap, the user may Tab back out to the document. Skipped entirely
   // when focusOnOpen is false (a tool window that must leave the underlying textarea focused).
   useEffect(() => {
      if (!focusOnOpen) return
      const previouslyFocused = document.activeElement as HTMLElement | null
      windowRef.current?.focus()
      return () => {
         if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
      }
   }, [focusOnOpen])

   // Escape closes; stop-propagation so it does not also reach the editor / block underneath.
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
         }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onClose])

   const windowStyle: React.CSSProperties = isSheet
      ? { userSelect: drag.isInteracting ? 'none' : undefined }
      : {
         top:        drag.position.top,
         left:       drag.position.left,
         width:      drag.size.width,
         height:     drag.size.height,
         userSelect: drag.isInteracting ? 'none' : undefined,
      }

   return createPortal(
      <div
         ref={windowRef}
         tabIndex={-1}
         role="dialog"
         aria-modal="false"
         aria-label={title}
         className={isSheet ? 'block-editor-window block-editor-window-sheet' : 'block-editor-window'}
         style={windowStyle}
         // The window portals to <body>, but React bubbles SYNTHETIC events up the React tree, so a
         // right-click inside the window would otherwise reach the host block's onContextMenu and open
         // the document's block/section menu ON TOP of any editor menu. Stop it at the window root: the
         // editor's own row context menus have already fired (they're inner targets); this only blocks
         // the drill-through to the document. Not preventDefault'd, so native input menus still work.
         onContextMenu={event => event.stopPropagation()}
      >
         {/* Title bar, the drag handle (inert in sheet mode). */}
         <div className="block-editor-window-titlebar" {...(isSheet ? {} : drag.titleBarProps)}>
            {icon && <span className="block-editor-window-icon">{icon}</span>}
            <span className="block-editor-window-title">{title}</span>
            <button
               type="button"
               className="block-editor-window-close"
               aria-label={t.blockWindowClose}
               title={t.blockWindowClose}
               onClick={onClose}
            >
               <X size={15} />
            </button>
         </div>

         {/* Body, the block's expanded editor; scrolls within the window. */}
         <div className="block-editor-window-body">
            {children}
         </div>

         {/* Bottom-right resize grip (hidden in sheet mode). */}
         {!isSheet && (
            <div
               className="block-editor-window-resize"
               role="separator"
               aria-label={t.blockWindowResize}
               {...drag.resizeHandleProps}
            />
         )}
      </div>,
      document.body,
   )
}

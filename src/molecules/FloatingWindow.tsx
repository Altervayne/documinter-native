// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { X } from 'lucide-react'

// -- Context / Hook Imports --
import { useLang } from '../contexts/LangContext'
import { useDraggableWindow, type WindowPosition, type WindowSize } from '../hooks/useDraggableWindow'

// #############
// # CONSTANTS #
// #############

// Below this viewport width the window degrades to a near-full-screen sheet (drag / resize off).
const SHEET_BREAKPOINT = 640

// #########
// # TYPES #
// #########

export interface FloatingWindowGeometry {
   top:    number
   left:   number
   width:  number
   height: number
}

interface FloatingWindowProps {
   /** Title-bar label + the accessible name of the dialog. */
   title: string
   /** Optional leading icon in the title bar. */
   icon?: ReactNode
   /** Initial top/left, already clamped by the caller (it owns anchor / stored-placement logic). */
   initialPosition: WindowPosition
   /** Initial width/height. */
   initialSize: WindowSize
   /** Resize floor / ceiling. */
   minSize: WindowSize
   maxSize: WindowSize
   /** Viewport-edge margin the window is kept inside of. */
   margin: number
   /** Extra title-bar controls, rendered between the title and the close button (e.g. the dock Pin).
    *  An action element owns its own pointer handlers (and should stopPropagation so it never starts a
    *  title-bar drag). */
   headerActions?: ReactNode
   /** Class for the body wrapper. Defaults to the padded / scrolling block-editor body; a host whose
    *  content owns its own scroll passes a bare variant. */
   bodyClassName?: string
   /** Move focus into the window on open, restoring the previously-focused element on close. Off for a
    *  tool window that must leave an underlying field focused. */
   focusOnOpen?: boolean
   /** Whether the Escape key closes the window. */
   escapeCloses?: boolean
   /** Whether to degrade to a near-full-screen sheet (drag / resize off) below SHEET_BREAKPOINT. */
   sheetFallback?: boolean
   /** Called when a move / resize gesture ends, with the committed geometry, for callers that persist
    *  it (a floating panel restoring its window across a reload). */
   onGeometryCommit?: (geometry: FloatingWindowGeometry) => void
   /** Overrides the close button's title / aria-label (defaults to the generic block-window label). */
   closeLabel?: string
   /** Overrides the resize grip's aria-label. */
   resizeLabel?: string
   /** Play the pop-in animation on mount. Off for a window whose opacity is externally controlled
    *  (see `dimmed`): the mount animation forwards-fills opacity:1 and would outrank the dim. */
   animateIn?: boolean
   /** Dim the window as "in transit" (e.g. while its dock Pin is being dragged to a new home). */
   dimmed?: boolean
   /** Close the window (close button / Escape). */
   onClose: () => void
   /** The window body. */
   children: ReactNode
}

// #############
// # COMPONENT #
// #############

/**
 * The shared floating-window shell: a portaled, position:fixed, draggable + resizable window with a
 * drag title bar (icon + title + optional extra actions + close) and a bottom-right resize grip, all
 * built on the `useDraggableWindow` primitive. It carries no content policy of its own, the host passes
 * the body + the few behavior flags that differ between a block editor (anchor-placed, focus-grabbing,
 * Escape-closes, sheet fallback) and a popped-out dock panel (stored-placement, geometry persisted).
 * Non-modal by design: no backdrop, no outside-click close.
 */
export function FloatingWindow({
   title, icon, initialPosition, initialSize, minSize, maxSize, margin,
   headerActions, bodyClassName = 'block-editor-window-body',
   focusOnOpen = true, escapeCloses = true, sheetFallback = true,
   animateIn = true, dimmed = false,
   onGeometryCommit, closeLabel, resizeLabel, onClose, children,
}: FloatingWindowProps) {
   const { t } = useLang()

   // Narrow-viewport sheet fallback, tracked live so a resize across the breakpoint re-renders.
   const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < SHEET_BREAKPOINT)
   useEffect(() => {
      if (!sheetFallback) return
      function handleResize() { setIsNarrow(window.innerWidth < SHEET_BREAKPOINT) }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
   }, [sheetFallback])
   const isSheet = sheetFallback && isNarrow

   const drag = useDraggableWindow({
      initialPosition,
      initialSize,
      minSize,
      maxSize,
      disabled: isSheet,
      margin,
   })

   const windowRef = useRef<HTMLDivElement>(null)

   // Focus moves into the window on open; the previously-focused element is restored on close.
   // Non-modal, so no focus trap. Skipped entirely when focusOnOpen is false.
   useEffect(() => {
      if (!focusOnOpen) return
      const previouslyFocused = document.activeElement as HTMLElement | null
      windowRef.current?.focus()
      return () => {
         if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
      }
   }, [focusOnOpen])

   // Escape closes; stop-propagation so it does not also reach the editor / surface underneath.
   useEffect(() => {
      if (!escapeCloses) return
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
         }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [escapeCloses, onClose])

   // Persist geometry when a move / resize gesture ends (and once on mount). Depending only on
   // `isInteracting` keeps this to gesture-end transitions; the fresh position / size are read then.
   useEffect(() => {
      if (!onGeometryCommit || drag.isInteracting) return
      onGeometryCommit({ top: drag.position.top, left: drag.position.left, width: drag.size.width, height: drag.size.height })
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [drag.isInteracting])

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
         className={[
            'block-editor-window',
            isSheet ? 'block-editor-window-sheet' : '',
            animateIn ? '' : 'block-editor-window-no-anim',
            dimmed ? 'block-editor-window-dimmed' : '',
         ].filter(Boolean).join(' ')}
         style={windowStyle}
         // The window portals to <body>, but React bubbles SYNTHETIC events up the React tree, so a
         // right-click inside the window would otherwise reach the host's onContextMenu and open a
         // document menu on top of any editor menu. Stop it at the window root: inner row context menus
         // have already fired (they are inner targets). Not preventDefault'd, so native input menus work.
         onContextMenu={event => event.stopPropagation()}
      >
         {/* Title bar = the drag handle (inert in sheet mode). */}
         <div className="block-editor-window-titlebar" {...(isSheet ? {} : drag.titleBarProps)}>
            {icon && <span className="block-editor-window-icon">{icon}</span>}
            <span className="block-editor-window-title">{title}</span>
            {headerActions}
            <button
               type="button"
               className="block-editor-window-close"
               aria-label={closeLabel ?? t.blockWindowClose}
               title={closeLabel ?? t.blockWindowClose}
               onClick={onClose}
            >
               <X size={15} />
            </button>
         </div>

         {/* Body: the host's content; scrolls or not per bodyClassName. */}
         <div className={bodyClassName}>
            {children}
         </div>

         {/* Bottom-right resize grip (hidden in sheet mode). */}
         {!isSheet && (
            <div
               className="block-editor-window-resize"
               role="separator"
               aria-label={resizeLabel ?? t.blockWindowResize}
               {...drag.resizeHandleProps}
            />
         )}
      </div>,
      document.body,
   )
}

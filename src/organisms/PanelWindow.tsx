// -- React Imports --
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'

// -- Icon Imports --
import { X, Pin } from 'lucide-react'

// -- Hook / Lib / Context Imports --
import { useDraggableWindow } from '../hooks/useDraggableWindow'
import { PANEL_REGISTRY } from '../lib/panelRegistry'
import type { PanelId, WindowPlacement } from '../lib/dockLayout'
import { useLang } from '../contexts/LangContext'

// #############
// # CONSTANTS #
// #############

const MIN_SIZE = { width: 220, height: 200 }
const MAX_SIZE = { width: 640, height: 900 }
const WINDOW_MARGIN = 12

// #########
// # TYPES #
// #########

interface PanelWindowProps {
   panelId:           PanelId
   placement:         WindowPlacement
   body:              ReactNode
   /** The Pin is both a button (click to dock to the remembered side) and a drag handle (drag to
    *  choose where to dock, using the dock's drop zones). The workspace owns that click-vs-drag flow. */
   onPinPointerDown:  (event: ReactPointerEvent<HTMLButtonElement>) => void
   /** True while this panel's Pin is being dragged, to dim the window as "in transit". */
   dragging:          boolean
   onClose:           () => void
   onCommitPlacement: (placement: WindowPlacement) => void
}

// #############
// # COMPONENT #
// #############

/**
 * A floating window hosting a popped-out panel. The panel body is the same host-agnostic component the
 * dock renders, so a panel is identical docked or floating. Drag / resize come from the shared
 * `useDraggableWindow` primitive (the same one the Block Editor Window uses); the title bar carries the
 * panel identity plus dock (return to the dock) and close controls. Geometry is committed back to the
 * dock state when a move or resize gesture ends, so it survives a reload.
 */
export function PanelWindow({ panelId, placement, body, onPinPointerDown, dragging, onClose, onCommitPlacement }: PanelWindowProps) {
   const { t } = useLang()
   const descriptor = PANEL_REGISTRY[panelId]

   const win = useDraggableWindow({
      initialPosition: { top: placement.top, left: placement.left },
      initialSize:     { width: placement.width, height: placement.height },
      minSize:         MIN_SIZE,
      maxSize:         MAX_SIZE,
      disabled:        false,
      margin:          WINDOW_MARGIN,
   })

   // Persist geometry when a move / resize gesture ends. Depending only on `isInteracting` keeps this to
   // gesture-end transitions; the fresh position / size are read at that point.
   useEffect(() => {
      if (win.isInteracting) return
      onCommitPlacement({ top: win.position.top, left: win.position.left, width: win.size.width, height: win.size.height })
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [win.isInteracting])

   return createPortal(
      <div
         className={`fixed z-[9990] flex flex-col bg-raised border border-border rounded-lg shadow-2xl overflow-hidden transition-opacity ${dragging ? 'opacity-60' : ''}`}
         style={{ top: win.position.top, left: win.position.left, width: win.size.width, height: win.size.height }}
      >
         <div
            {...win.titleBarProps}
            className="flex items-center gap-1.5 h-9 pl-2 pr-1 border-b border-border shrink-0 cursor-grab select-none touch-none"
         >
            <span className="shrink-0 text-accent">{descriptor.icon}</span>
            <span className="flex-1 truncate text-xs font-semibold text-text">{descriptor.title(t)}</span>
            <button
               onPointerDown={(event) => { event.stopPropagation(); onPinPointerDown(event) }}
               title={t.dockDockPanel}
               aria-label={t.dockDockPanel}
               className="shrink-0 text-muted hover:text-accent p-1 rounded-md hover:bg-accent/8 cursor-grab border-0 bg-transparent transition-colors touch-none select-none"
            >
               <Pin size={15} />
            </button>
            <button
               onClick={onClose}
               title={t.dockClosePanel}
               aria-label={t.dockClosePanel}
               className="shrink-0 text-muted hover:text-red p-1 rounded-md hover:bg-red/10 cursor-pointer border-0 bg-transparent transition-colors"
            >
               <X size={15} />
            </button>
         </div>

         <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {body}
         </div>

         <div
            {...win.resizeHandleProps}
            className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize touch-none"
         />
      </div>,
      document.body,
   )
}

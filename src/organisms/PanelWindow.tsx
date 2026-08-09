// -- React Imports --
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

// -- Icon Imports --
import { Pin } from 'lucide-react'

// -- Component / Lib / Context Imports --
import { FloatingWindow } from '../molecules/FloatingWindow'
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
 * A floating window hosting a popped-out panel. It is the shared `FloatingWindow` shell configured for
 * the dock: opened at the panel's stored placement (persisted back on every move / resize so it
 * survives a reload), the panel body host-agnostic (identical docked or floating, so it owns its own
 * scroll), and the title bar carrying the panel identity plus a Pin (return to / re-dock) and close. It
 * skips the block editor's focus-grab, Escape-close, sheet fallback, and pop-in animation, and dims
 * while the Pin is being dragged to a new dock target.
 */
export function PanelWindow({ panelId, placement, body, onPinPointerDown, dragging, onClose, onCommitPlacement }: PanelWindowProps) {
   const { t } = useLang()
   const descriptor = PANEL_REGISTRY[panelId]

   return (
      <FloatingWindow
         title={descriptor.title(t)}
         icon={descriptor.icon}
         initialPosition={{ top: placement.top, left: placement.left }}
         initialSize={{ width: placement.width, height: placement.height }}
         minSize={MIN_SIZE}
         maxSize={MAX_SIZE}
         margin={WINDOW_MARGIN}
         // The panel body brings its own scroll (it is the same body the dock hosts), so the window body
         // stays bare: fill the space, hide overflow, and let the inner body scroll.
         bodyClassName="flex-1 min-h-0 flex flex-col overflow-hidden"
         focusOnOpen={false}
         escapeCloses={false}
         sheetFallback={false}
         animateIn={false}
         dimmed={dragging}
         onGeometryCommit={onCommitPlacement}
         closeLabel={t.dockClosePanel}
         onClose={onClose}
         headerActions={
            <button
               type="button"
               onPointerDown={event => { event.stopPropagation(); onPinPointerDown(event) }}
               title={t.dockDockPanel}
               aria-label={t.dockDockPanel}
               className="shrink-0 inline-flex items-center justify-center w-[1.6rem] h-[1.6rem] rounded-md border-0 bg-transparent text-muted hover:text-accent hover:bg-accent/10 cursor-grab transition-colors touch-none select-none"
            >
               <Pin size={15} />
            </button>
         }
      >
         {body}
      </FloatingWindow>
   )
}

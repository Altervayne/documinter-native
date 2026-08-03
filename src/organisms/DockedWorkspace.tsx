// -- React Imports --
import { useRef, useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'

// -- Organism / Lib / Hook / Context Imports --
import { DockHost, type DockDragApi, type DockDropTarget } from './DockHost'
import { PANEL_REGISTRY } from '../lib/panelRegistry'
import type { DockLayout, DockSide, PanelId } from '../lib/dockLayout'
import type { DockStateResult } from '../hooks/useDockState'
import { useLang } from '../contexts/LangContext'

// #############
// # CONSTANTS #
// #############

// Pointer travel before a tab press becomes a drag (below this, it stays a click that activates the
// tab). Matches the dnd-kit activation distance the panel bodies use, so the feel is consistent.
const ACTIVATION_DISTANCE_PX = 5
// The tab-strip band at the top of a group: a drop here merges (tabs); below it splits into a new
// group. Matches the h-9 (36px) group header.
const TAB_STRIP_HEIGHT_PX = 36
// Width of the edge rail shown on an empty side during a drag.
const EDGE_RAIL_PX = 48

// #########
// # TYPES #
// #########

interface DockedWorkspaceProps {
   dock:        DockStateResult
   panelBodies: Record<PanelId, ReactNode>
   /** The center workspace (WorkspaceLayout), rendered between the two docks. */
   children:    ReactNode
}

// ################
// # PURE HELPERS #
// ################

/** How many tabs a group has, for appending a merged panel at the end. */
function groupPanelCount(layout: DockLayout, groupId: string): number {
   for (const side of ['left', 'right'] as const) {
      const group = layout[side]?.groups.find((candidate) => candidate.id === groupId)
      if (group) return group.panels.length
   }
   return 0
}

// #############
// # COMPONENT #
// #############

/**
 * Hosts the two side docks around the center workspace and owns the shared tab drag-and-drop, so a tab
 * dragged out of one dock can land in the other. A press on a tab is a click (activate) until the
 * pointer travels past the activation distance, at which point it becomes a drag with a floating ghost
 * and live drop-zone highlights. Drops resolve by group id (merge into a group, or a new group before /
 * after a target), plus edge rails for starting a dock on a currently empty side. The config menu
 * (DockHost) stays as the permanent, non-drag way to do the same moves.
 */
export function DockedWorkspace({ dock, panelBodies, children }: DockedWorkspaceProps) {
   const [draggingPanelId, setDraggingPanelId] = useState<PanelId | null>(null)
   const [pointer, setPointer]                 = useState<{ x: number; y: number } | null>(null)
   const [dropTarget, setDropTarget]           = useState<DockDropTarget | null>(null)

   const groupElements = useRef<Map<string, HTMLElement>>(new Map())
   const regionRef     = useRef<HTMLDivElement>(null)

   function registerGroup(groupId: string, element: HTMLElement | null): void {
      if (element) groupElements.current.set(groupId, element)
      else groupElements.current.delete(groupId)
   }

   // Resolve where a drop at (x, y) would land: over a group's tab strip merges, its upper / lower half
   // makes a new group before / after it, and an empty side's edge rail starts a dock there.
   function computeDropTarget(pointerX: number, pointerY: number): DockDropTarget | null {
      for (const [groupId, element] of groupElements.current) {
         const rect = element.getBoundingClientRect()
         if (pointerX < rect.left || pointerX > rect.right || pointerY < rect.top || pointerY > rect.bottom) continue
         if (pointerY <= rect.top + TAB_STRIP_HEIGHT_PX) return { kind: 'merge', groupId }
         if (pointerY <= rect.top + rect.height / 2)      return { kind: 'adjacent', groupId, position: 'before' }
         return { kind: 'adjacent', groupId, position: 'after' }
      }

      const region = regionRef.current?.getBoundingClientRect()
      if (region) {
         if (!dock.layout.left  && pointerX <= region.left  + EDGE_RAIL_PX) return { kind: 'emptySide', side: 'left' }
         if (!dock.layout.right && pointerX >= region.right - EDGE_RAIL_PX) return { kind: 'emptySide', side: 'right' }
      }
      return null
   }

   function applyDrop(panelId: PanelId, target: DockDropTarget | null): void {
      if (!target) return
      if (target.kind === 'merge') {
         dock.mergePanelIntoGroup(panelId, target.groupId, groupPanelCount(dock.layout, target.groupId))
      } else if (target.kind === 'adjacent') {
         dock.movePanelAdjacentToGroup(panelId, target.groupId, target.position)
      } else {
         dock.movePanelToSide(panelId, target.side)
      }
   }

   function handleTabPointerDown(panelId: PanelId, groupId: string, event: ReactPointerEvent<HTMLButtonElement>): void {
      if (event.button !== 0) return
      const startX = event.clientX
      const startY = event.clientY
      let started = false

      function handleMove(moveEvent: PointerEvent): void {
         const { clientX, clientY } = moveEvent
         if (!started) {
            if (Math.abs(clientX - startX) < ACTIVATION_DISTANCE_PX && Math.abs(clientY - startY) < ACTIVATION_DISTANCE_PX) return
            started = true
            setDraggingPanelId(panelId)
            document.body.style.userSelect = 'none'
         }
         setPointer({ x: clientX, y: clientY })
         setDropTarget(computeDropTarget(clientX, clientY))
      }

      function handleUp(upEvent: PointerEvent): void {
         window.removeEventListener('pointermove', handleMove)
         window.removeEventListener('pointerup', handleUp)
         document.body.style.userSelect = ''
         if (!started) {
            dock.setActiveTab(groupId, panelId)   // never crossed the threshold, so it was a click
         } else {
            applyDrop(panelId, computeDropTarget(upEvent.clientX, upEvent.clientY))
         }
         setDraggingPanelId(null)
         setPointer(null)
         setDropTarget(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
   }

   const drag: DockDragApi = { draggingPanelId, dropTarget, onTabPointerDown: handleTabPointerDown, registerGroup }
   const isDragging = draggingPanelId !== null

   return (
      <div ref={regionRef} className="relative flex flex-1 min-h-0 overflow-hidden">
         <DockHost side="left"  layout={dock.layout} panelBodies={panelBodies} actions={dock} drag={drag} />
         {children}
         <DockHost side="right" layout={dock.layout} panelBodies={panelBodies} actions={dock} drag={drag} />

         {/* Edge rails: only shown on a currently empty side while dragging, as a target to start a dock. */}
         {isDragging && !dock.layout.left && (
            <EdgeRail side="left"  active={dropTarget?.kind === 'emptySide' && dropTarget.side === 'left'} />
         )}
         {isDragging && !dock.layout.right && (
            <EdgeRail side="right" active={dropTarget?.kind === 'emptySide' && dropTarget.side === 'right'} />
         )}

         {isDragging && pointer && <DragGhost panelId={draggingPanelId} pointer={pointer} />}
      </div>
   )
}

// ##########################
// # EDGE RAIL + DRAG GHOST #
// ##########################

function EdgeRail({ side, active }: { side: DockSide; active: boolean }) {
   const edgeClass = side === 'left' ? 'left-0' : 'right-0'
   return (
      <div
         className={[
            `absolute top-0 bottom-0 ${edgeClass} z-40 pointer-events-none border-2 border-dashed rounded-sm transition-colors`,
            active ? 'border-accent bg-accent/15' : 'border-accent/30 bg-accent/[0.04]',
         ].join(' ')}
         style={{ width: EDGE_RAIL_PX }}
      />
   )
}

function DragGhost({ panelId, pointer }: { panelId: PanelId; pointer: { x: number; y: number } }) {
   const { t } = useLang()
   const descriptor = PANEL_REGISTRY[panelId]
   return (
      <div className="fixed z-[9999] pointer-events-none" style={{ left: pointer.x + 12, top: pointer.y + 12 }}>
         <div className="flex items-center gap-1.5 px-2.5 h-8 bg-raised border border-border shadow-xl rounded-md opacity-90">
            <span className="shrink-0 text-accent">{descriptor.icon}</span>
            <span className="text-xs font-medium text-text whitespace-nowrap">{descriptor.title(t)}</span>
         </div>
      </div>
   )
}

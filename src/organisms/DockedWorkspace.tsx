// -- React Imports --
import { useRef, useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'

// -- Organism / Lib / Hook / Context Imports --
import { DockHost, DROP_BEFORE_MAX, DROP_AFTER_MIN, type DockDragApi, type DockDropTarget } from './DockHost'
import { PanelWindow } from './PanelWindow'
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
// Width of the edge rail shown on an empty side during a drag: wide so docking to a fresh side is an
// obvious target rather than a thin sliver.
const EDGE_RAIL_PX = 112

// #########
// # TYPES #
// #########

interface DockedWorkspaceProps {
   dock:        DockStateResult
   panelBodies: Record<PanelId, ReactNode>
   /** The center workspace (WorkspaceLayout), rendered between the two docks. */
   children:    ReactNode
}

/** What a drag started from: a docked tab (click activates it) or a floating panel's Pin (click docks
 *  it). The shared pipeline uses this to pick the click action and the neutral zones. */
type DragSource = { kind: 'tab'; groupId: string } | { kind: 'floating' }

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
   const dockElements  = useRef<Map<DockSide, HTMLElement>>(new Map())
   const regionRef     = useRef<HTMLDivElement>(null)
   // The group the drag started from, captured at press so the hit-test can mark self-drops as cancel.
   // `sourceMultiTab` decides whether the source's above / below bands stay live (pull the tab out into
   // its own group) or also cancel (a lone tab splitting off itself would be a no-op).
   const sourceGroupId  = useRef<string | null>(null)
   const sourceMultiTab = useRef(false)
   // True while the drag started from a floating panel's Pin (the center / float zone then reads as a
   // neutral no-op, since the panel is already a window).
   const sourceIsFloating = useRef(false)

   function registerGroup(groupId: string, element: HTMLElement | null): void {
      if (element) groupElements.current.set(groupId, element)
      else groupElements.current.delete(groupId)
   }

   function registerDock(side: DockSide, element: HTMLElement | null): void {
      if (element) dockElements.current.set(side, element)
      else dockElements.current.delete(side)
   }

   function pointerInside(rect: DOMRect, x: number, y: number): boolean {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
   }

   // Resolve where a drop at (x, y) would land, in precedence order: a group's three bands (above / merge
   // / below, with the panel's own group center reading as cancel); the rest of a populated dock (its
   // empty area, so a dock of collapsed groups still has a big target) docks to that side; an empty
   // side's edge rail starts a dock there; and the open center pops the panel out as a window.
   function computeDropTarget(pointerX: number, pointerY: number): DockDropTarget | null {
      for (const [groupId, element] of groupElements.current) {
         const rect = element.getBoundingClientRect()
         if (!pointerInside(rect, pointerX, pointerY)) continue
         const fraction = (pointerY - rect.top) / rect.height
         const band: 'before' | 'merge' | 'after' =
            fraction < DROP_BEFORE_MAX ? 'before' : fraction < DROP_AFTER_MIN ? 'merge' : 'after'

         if (groupId === sourceGroupId.current) {
            if (band === 'merge' || !sourceMultiTab.current) return { kind: 'cancel', groupId }
            return { kind: 'adjacent', groupId, position: band }
         }
         if (band === 'merge') return { kind: 'merge', groupId }
         return { kind: 'adjacent', groupId, position: band }
      }

      // Over a populated dock but not any group: its empty area is one large "dock here" target.
      for (const [side, element] of dockElements.current) {
         if (pointerInside(element.getBoundingClientRect(), pointerX, pointerY)) return { kind: 'dockSide', side }
      }

      const region = regionRef.current?.getBoundingClientRect()
      if (!region) return null
      if (!dock.layout.left  && pointerX <= region.left  + EDGE_RAIL_PX) return { kind: 'emptySide', side: 'left' }
      if (!dock.layout.right && pointerX >= region.right - EDGE_RAIL_PX) return { kind: 'emptySide', side: 'right' }
      if (pointerInside(region, pointerX, pointerY)) return { kind: 'float' }
      return null
   }

   function applyDrop(panelId: PanelId, target: DockDropTarget | null): void {
      if (!target) return
      if (target.kind === 'merge') {
         dock.mergePanelIntoGroup(panelId, target.groupId, groupPanelCount(dock.layout, target.groupId))
      } else if (target.kind === 'adjacent') {
         dock.movePanelAdjacentToGroup(panelId, target.groupId, target.position)
      } else if (target.kind === 'emptySide' || target.kind === 'dockSide') {
         // Both start a new group at the bottom of that side (movePanelToSide creates the column if
         // the side is empty), so an edge-rail drop and a populated-dock drop share the same action.
         dock.movePanelToSide(panelId, target.side)
      } else if (target.kind === 'float') {
         // A tab dropped in the center pops out; a panel that is ALREADY floating stays put (no-op).
         if (!sourceIsFloating.current) dock.floatPanel(panelId)
      }
      // 'cancel' is a deliberate no-op.
   }

   // One drag pipeline for both sources: a docked tab (click activates it) and a floating panel's Pin
   // (click docks it to its remembered side). A drag past the activation distance runs the shared
   // hit-test + drop.
   function beginDrag(panelId: PanelId, source: DragSource, event: ReactPointerEvent<HTMLButtonElement>): void {
      if (event.button !== 0) return
      const startX = event.clientX
      const startY = event.clientY
      let started = false

      sourceGroupId.current    = source.kind === 'tab' ? source.groupId : null
      sourceIsFloating.current = source.kind === 'floating'
      if (source.kind === 'tab') {
         const sourceGroup = [...(dock.layout.left?.groups ?? []), ...(dock.layout.right?.groups ?? [])].find(group => group.id === source.groupId)
         sourceMultiTab.current = (sourceGroup?.panels.length ?? 1) > 1
      } else {
         sourceMultiTab.current = false
      }

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
            // Never crossed the threshold, so it was a click.
            if (source.kind === 'tab') dock.setActiveTab(source.groupId, panelId)
            else dock.dockPanel(panelId)
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

   function handleTabPointerDown(panelId: PanelId, groupId: string, event: ReactPointerEvent<HTMLButtonElement>): void {
      beginDrag(panelId, { kind: 'tab', groupId }, event)
   }

   function handlePinPointerDown(panelId: PanelId, event: ReactPointerEvent<HTMLButtonElement>): void {
      beginDrag(panelId, { kind: 'floating' }, event)
   }

   const drag: DockDragApi = { draggingPanelId, dropTarget, onTabPointerDown: handleTabPointerDown, registerGroup, registerDock }
   const isDragging = draggingPanelId !== null

   return (
      <div ref={regionRef} className="relative flex flex-1 min-h-0 overflow-hidden">
         <DockHost side="left"  layout={dock.layout} panelBodies={panelBodies} actions={dock} drag={drag} />

         {/* Center: the editor, plus the float drop zone shown while dragging (drop here to pop out). */}
         <div className="relative flex-1 min-w-0 min-h-0 flex">
            {children}
            {isDragging && <CenterFloatOverlay active={dropTarget?.kind === 'float'} />}
         </div>

         <DockHost side="right" layout={dock.layout} panelBodies={panelBodies} actions={dock} drag={drag} />

         {/* Edge rails: only shown on a currently empty side while dragging, as a target to start a dock. */}
         {isDragging && !dock.layout.left && (
            <EdgeRail side="left"  active={dropTarget?.kind === 'emptySide' && dropTarget.side === 'left'} />
         )}
         {isDragging && !dock.layout.right && (
            <EdgeRail side="right" active={dropTarget?.kind === 'emptySide' && dropTarget.side === 'right'} />
         )}

         {isDragging && pointer && <DragGhost panelId={draggingPanelId} pointer={pointer} />}

         {/* Floating panel windows (Phase 3), portaled to the body from within PanelWindow. */}
         {(Object.keys(dock.floatingPanels) as PanelId[]).map((panelId) => {
            const placement = dock.floatingPanels[panelId]
            if (!placement) return null
            return (
               <PanelWindow
                  key={panelId}
                  panelId={panelId}
                  placement={placement}
                  body={panelBodies[panelId]}
                  onPinPointerDown={(event) => handlePinPointerDown(panelId, event)}
                  dragging={draggingPanelId === panelId}
                  onClose={() => dock.togglePanelVisibility(panelId)}
                  onCommitPlacement={(next) => dock.setFloatingPlacement(panelId, next)}
               />
            )
         })}
      </div>
   )
}

// #####################################
// # DROP ZONES (edge / center) + GHOST #
// #####################################

/** The center float zone over the editor: a faint hint while dragging, filled when it is the target
 *  (a drop there pops the panel out as a window). */
function CenterFloatOverlay({ active }: { active: boolean }) {
   return (
      <div
         className={[
            'absolute inset-2 z-40 pointer-events-none border-2 border-dashed rounded-lg transition-colors',
            active ? 'border-accent bg-accent/15' : 'border-accent/25 bg-accent/[0.03]',
         ].join(' ')}
      />
   )
}

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

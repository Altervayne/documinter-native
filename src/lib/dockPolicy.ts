// ###############################################################################################
// # DOCK POLICY                                                                                 #
// #                                                                                             #
// # Pure policy on top of the structural dock model (lib/dockLayout.ts): which panels should be #
// # docked right now, and where a panel returns to when it comes back. Split out from the       #
// # structural transforms so it stays unit-testable with no React and no registry coupling      #
// # (the registry-derived inputs, applicable ids + default sides, are injected by useDockState).#
// #                                                                                             #
// # Two rules it encodes:                                                                       #
// #  - Applicability: a panel that is not applicable to the current document (e.g. Pages in an   #
// #    infinite doc) is force-undocked and remembered, then auto-restored when it applies again. #
// #  - Deliberate close: a panel the user closed by hand stays closed, even while applicable,    #
// #    until the user reopens it. That intent outranks auto-restore.                             #
// ###############################################################################################

// -- Type Imports --
import type { DockLayout, DockSide, PanelId, FloatingPanels, WindowPlacement } from './dockLayout'

// -- Lib Imports --
import { addPanel, removePanel, isPanelDocked, locatePanel, dockedPanels } from './dockLayout'

// #########
// # TYPES #
// #########

/**
 * Why a panel is currently not docked, and where it last lived.
 *  - `auto: true`  the system undocked it because it stopped being applicable; restore it when it
 *                  applies again.
 *  - `auto: false` the user closed it on purpose; leave it closed until the user reopens it.
 */
export interface PanelMemory {
   side: DockSide
   auto: boolean
   /** Present only when the panel was floating when it was hidden: showing it restores it as a floating
    *  window at this geometry rather than docking it. Set by a deliberate hide of a floating panel. */
   placement?: WindowPlacement
}

export type ClosedPanels = Partial<Record<PanelId, PanelMemory>>

/** A monotonic source of fresh group ids. Injected so the policy stays pure and deterministic in
 *  tests (pass a counter); the hook passes a real unique-id generator. */
export type GroupIdFactory = () => string

// #############################
// # VISIBILITY (show / hide)  #
// #############################

/** The full visibility state of the side panels: docked (in `layout`), floating (in `floating`), or
 *  hidden (remembered in `hidden`). Every panel is in at most one of the three. */
export interface VisibilityState {
   layout:   DockLayout
   floating: FloatingPanels
   hidden:   ClosedPanels
}

/** A panel is visible when it is docked or floating. */
export function isPanelVisible(layout: DockLayout, floating: FloatingPanels, panelId: PanelId): boolean {
   return isPanelDocked(layout, panelId) || panelId in floating
}

/**
 * Toggles a panel between visible and hidden, remembering enough to restore it exactly. Hiding a docked
 * panel remembers its side; hiding a floating panel remembers its window geometry. Showing restores it
 * the way it was hidden (floating at its geometry, or docked at its side), or docks it at its default
 * side the first time. All hides are deliberate (auto: false), so the applicability reconcile leaves
 * them alone until the user shows them again.
 */
export function togglePanelVisibility(
   state:       VisibilityState,
   panelId:     PanelId,
   defaultSide: DockSide,
   nextGroupId: GroupIdFactory,
): VisibilityState {
   const { layout, floating, hidden } = state

   if (panelId in floating) {
      // Hide a floating panel, remembering its geometry so it comes back floating.
      const placement = floating[panelId]!
      const nextFloating = { ...floating }
      delete nextFloating[panelId]
      return { layout, floating: nextFloating, hidden: { ...hidden, [panelId]: { side: defaultSide, auto: false, placement } } }
   }

   if (isPanelDocked(layout, panelId)) {
      // Hide a docked panel, remembering its side so it comes back docked.
      const side = locatePanel(layout, panelId)!.side
      return { layout: removePanel(layout, panelId), floating, hidden: { ...hidden, [panelId]: { side, auto: false } } }
   }

   // Show a hidden panel, restoring how it was hidden.
   const memory = hidden[panelId]
   const nextHidden = { ...hidden }
   delete nextHidden[panelId]
   if (memory?.placement) {
      return { layout, floating: { ...floating, [panelId]: memory.placement }, hidden: nextHidden }
   }
   const side = memory?.side ?? defaultSide
   return { layout: addPanel(layout, panelId, side, nextGroupId()), floating, hidden: nextHidden }
}

// #####################
// # RECONCILE (apply) #
// #####################

/**
 * Brings the layout in line with what is applicable to the current document:
 *  1. Any docked panel that is no longer applicable is undocked and remembered (auto), so it can come
 *     back to the same side later.
 *  2. Any applicable panel that is not docked is either auto-restored (if it was auto-undocked),
 *     left closed (if the user closed it deliberately), or first-time auto-docked to its default side.
 * Deliberate closes are never overridden. Returns the reconciled layout + updated memory map.
 */
export function reconcileDock(
   layout:      DockLayout,
   closed:      ClosedPanels,
   applicable:  PanelId[],
   defaultSides: Record<PanelId, DockSide>,
   nextGroupId: GroupIdFactory,
): { layout: DockLayout; closed: ClosedPanels } {
   let nextLayout = layout
   const nextClosed: ClosedPanels = { ...closed }

   // ===== 1. Undock panels that are docked but no longer applicable =====
   for (const panelId of dockedPanels(layout)) {
      if (applicable.includes(panelId)) continue
      const location = locatePanel(nextLayout, panelId)
      if (!location) continue
      nextClosed[panelId] = { side: location.side, auto: true }
      nextLayout = removePanel(nextLayout, panelId)
   }

   // ===== 2. Restore or first-time-dock applicable panels that are not docked =====
   for (const panelId of applicable) {
      if (isPanelDocked(nextLayout, panelId)) {
         delete nextClosed[panelId]   // it is shown, so drop any stale memory
         continue
      }
      const memory = nextClosed[panelId]
      if (memory && !memory.auto) continue   // user closed it deliberately, respect that

      const side = memory?.side ?? defaultSides[panelId]
      nextLayout = addPanel(nextLayout, panelId, side, nextGroupId())
      delete nextClosed[panelId]
   }

   return { layout: nextLayout, closed: nextClosed }
}

// #####################
// # FLOATING WINDOWS  #
// #####################

/**
 * Closes any floating panel that is no longer applicable to the current document (for example a
 * floated Pages window when the document turns infinite), remembering it as auto-closed so the normal
 * dock reconcile can bring it back later. Floating position is not preserved across an applicability
 * cycle (it returns docked); that is the accepted v1 simplification. Returns the trimmed floating map
 * plus the updated close-memory. Applicable floating panels are left exactly as they are.
 */
export function reconcileFloating(
   floating:     FloatingPanels,
   closed:       ClosedPanels,
   applicable:   PanelId[],
   defaultSides: Record<PanelId, DockSide>,
): { floating: FloatingPanels; closed: ClosedPanels } {
   const nextFloating: FloatingPanels = { ...floating }
   const nextClosed: ClosedPanels     = { ...closed }

   for (const panelId of Object.keys(floating) as PanelId[]) {
      if (applicable.includes(panelId)) continue
      delete nextFloating[panelId]
      nextClosed[panelId] = { side: defaultSides[panelId], auto: true }
   }

   return { floating: nextFloating, closed: nextClosed }
}

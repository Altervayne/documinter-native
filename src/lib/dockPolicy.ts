// ###############################################################################################
// # DOCK POLICY                                                                                 #
// #                                                                                             #
// # Pure policy over the structural dock model (lib/dockLayout.ts): which panels are docked now,#
// # and where a panel returns when it comes back. Split from the structural transforms so it is #
// # testable with no React and no registry coupling (inputs injected by useDockState).          #
// #                                                                                             #
// # Two rules:                                                                                  #
// #  - Applicability: a panel not applicable to the current document (e.g. Pages in an infinite #
// #    doc) is force-undocked and remembered, then auto-restored when it applies again.         #
// #  - Deliberate close: a panel the user closed by hand stays closed until reopened, over      #
// #    auto-restore.                                                                            #
// ###############################################################################################

// -- Type Imports --
import type { DockLayout, DockSide, PanelId, FloatingPanels, WindowPlacement } from './dockLayout'

// -- Lib Imports --
import { addPanel, removePanel, isPanelDocked, locatePanel, dockedPanels, toggleGroupCollapsed, groupExists, mergePanelIntoGroup } from './dockLayout'

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
   /** Present only when the panel was floating when hidden: showing it restores it floating at this
    *  geometry rather than docking it. */
   placement?: WindowPlacement
   /** The group was collapsed when the panel was undocked; restore that on re-dock so a panel that
    *  cycles out and back returns collapsed, not expanded. */
   collapsed?: boolean
   /** The group the panel was tabbed into, so it rejoins that exact group instead of a new standalone
    *  one. The group may be gone by restore time (dropped if the panel was alone in it), which falls
    *  back to a fresh group. */
   groupId?: string
   /** The tab position within `groupId`. Only meaningful alongside `groupId`; clamped on restore since
    *  the group's tab count may have shifted while the panel was gone. */
   tabIndex?: number
}

export type ClosedPanels = Partial<Record<PanelId, PanelMemory>>

/** A monotonic source of fresh group ids. Injected so the policy stays pure and deterministic in
 *  tests (pass a counter); the hook passes a real unique-id generator. */
export type GroupIdFactory = () => string

// ####################
// # INTERNAL HELPERS #
// ####################

/**
 * Docks a panel back at `side`, rejoining the group it was tabbed into when it still exists, else a
 * fresh standalone group. Capturing `groupId` on the way out is always safe: a panel alone in its
 * group takes the group with it, so `groupExists` is false here and this falls back to the new-group
 * path. The remembered `collapsed` state is restored only on that new-group path; a group we merge
 * into already owns its collapsed state, so toggling it here would fight the user's current setting.
 */
function dockRemembered(
   layout:      DockLayout,
   panelId:     PanelId,
   memory:      PanelMemory | undefined,
   side:        DockSide,
   nextGroupId: GroupIdFactory,
): DockLayout {
   if (memory?.groupId && groupExists(layout, memory.groupId)) {
      return mergePanelIntoGroup(layout, panelId, memory.groupId, memory.tabIndex ?? Infinity)
   }
   const newId = nextGroupId()
   let next = addPanel(layout, panelId, side, newId)
   if (memory?.collapsed) next = toggleGroupCollapsed(next, newId)
   return next
}

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
 * Toggles a panel between visible and hidden, remembering enough to restore it exactly. Showing
 * restores it the way it was hidden (floating at its geometry, or docked at its side), or docks it at
 * its default side the first time. All hides are deliberate (auto: false), so the applicability
 * reconcile leaves them alone until the user shows them again.
 */
export function togglePanelVisibility(
   state:       VisibilityState,
   panelId:     PanelId,
   defaultSide: DockSide,
   nextGroupId: GroupIdFactory,
): VisibilityState {
   const { layout, floating, hidden } = state

   if (panelId in floating) {
      const placement = floating[panelId]!
      const nextFloating = { ...floating }
      delete nextFloating[panelId]
      return { layout, floating: nextFloating, hidden: { ...hidden, [panelId]: { side: defaultSide, auto: false, placement } } }
   }

   if (isPanelDocked(layout, panelId)) {
      const location = locatePanel(layout, panelId)!
      const memory: PanelMemory = { side: location.side, auto: false, groupId: location.groupId, tabIndex: location.tabIndex }
      return { layout: removePanel(layout, panelId), floating, hidden: { ...hidden, [panelId]: memory } }
   }

   const memory = hidden[panelId]
   const nextHidden = { ...hidden }
   delete nextHidden[panelId]
   if (memory?.placement) {
      return { layout, floating: { ...floating, [panelId]: memory.placement }, hidden: nextHidden }
   }
   const side = memory?.side ?? defaultSide
   return { layout: dockRemembered(layout, panelId, memory, side, nextGroupId), floating, hidden: nextHidden }
}

// #####################
// # RECONCILE (apply) #
// #####################

/**
 * Brings the layout in line with what is applicable to the current document:
 *  1. A docked panel that is no longer applicable is undocked and remembered (auto).
 *  2. An applicable panel that is not docked is auto-restored (if auto-undocked), left closed (if the
 *     user closed it), or first-time docked to its default side (default-open panels only); a
 *     default-closed panel never placed stays hidden until revealed.
 * Deliberate closes are never overridden. Returns the reconciled layout + updated memory map.
 */
export function reconcileDock(
   layout:      DockLayout,
   closed:      ClosedPanels,
   applicable:  PanelId[],
   defaultSides: Record<PanelId, DockSide>,
   defaultOpen: Set<PanelId>,
   nextGroupId: GroupIdFactory,
): { layout: DockLayout; closed: ClosedPanels } {
   let nextLayout = layout
   const nextClosed: ClosedPanels = { ...closed }

   // ===== 1. Undock panels that are docked but no longer applicable =====
   for (const panelId of dockedPanels(layout)) {
      if (applicable.includes(panelId)) continue
      const location = locatePanel(nextLayout, panelId)
      if (!location) continue
      // Remember the collapsed state and group / tab so re-docking rejoins that group, not a new one.
      const wasCollapsed = !!nextLayout[location.side]?.groups[location.groupIndex]?.collapsed
      nextClosed[panelId] = {
         side: location.side,
         auto: true,
         groupId: location.groupId,
         tabIndex: location.tabIndex,
         ...(wasCollapsed ? { collapsed: true } : {}),
      }
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

      // A default-closed panel with no memory has never been placed: it waits for a deliberate reveal.
      // A panel with an AUTO memory still restores below, regardless of defaultOpen.
      if (!memory && !defaultOpen.has(panelId)) continue

      const side = memory?.side ?? defaultSides[panelId]
      nextLayout = dockRemembered(nextLayout, panelId, memory, side, nextGroupId)
      delete nextClosed[panelId]
   }

   return { layout: nextLayout, closed: nextClosed }
}

// #####################
// # FLOATING WINDOWS  #
// #####################

/**
 * Closes any floating panel no longer applicable to the current document, remembering it as
 * auto-closed so the dock reconcile can bring it back later. Floating position is not preserved across
 * an applicability cycle; the panel returns docked instead. Applicable floating panels are untouched.
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

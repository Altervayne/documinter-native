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
import type { DockLayout, DockSide, PanelId } from './dockLayout'

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
}

export type ClosedPanels = Partial<Record<PanelId, PanelMemory>>

/** A monotonic source of fresh group ids. Injected so the policy stays pure and deterministic in
 *  tests (pass a counter); the hook passes a real unique-id generator. */
export type GroupIdFactory = () => string

// ##########################
// # PRESENCE (toggle) LOGIC #
// ##########################

/**
 * Toggles whether a panel is docked. Closing records a deliberate-close memory (so reconcile will not
 * auto-reopen it); opening restores it to its remembered side, or its default side on first open, and
 * clears the memory. Returns the next layout + closed-memory map.
 */
export function togglePanelPresence(
   layout:      DockLayout,
   closed:      ClosedPanels,
   panelId:     PanelId,
   defaultSide: DockSide,
   nextGroupId: GroupIdFactory,
): { layout: DockLayout; closed: ClosedPanels } {
   if (isPanelDocked(layout, panelId)) {
      const side = locatePanel(layout, panelId)!.side
      return {
         layout: removePanel(layout, panelId),
         closed: { ...closed, [panelId]: { side, auto: false } },
      }
   }

   const side       = closed[panelId]?.side ?? defaultSide
   const nextClosed = { ...closed }
   delete nextClosed[panelId]
   return {
      layout: addPanel(layout, panelId, side, nextGroupId()),
      closed: nextClosed,
   }
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

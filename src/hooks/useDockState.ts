// -- React Imports --
import { useEffect, useState } from 'react'

// -- Lib Imports --
import {
   createDefaultDockLayout,
   addPanel as addPanelTransform,
   removePanel as removePanelTransform,
   movePanelToSide as movePanelToSideTransform,
   movePanelAdjacentToGroup as movePanelAdjacentToGroupTransform,
   mergePanelIntoGroup as mergePanelIntoGroupTransform,
   splitPanelToNewGroup as splitPanelToNewGroupTransform,
   setActiveTab as setActiveTabTransform,
   reorderTabInGroup as reorderTabInGroupTransform,
   toggleGroupCollapsed as toggleGroupCollapsedTransform,
   toggleColumnCollapsed as toggleColumnCollapsedTransform,
   setColumnWidth as setColumnWidthTransform,
   setGroupFlex as setGroupFlexTransform,
   type DockLayout,
   type DockSide,
   type PanelId,
   type FloatingPanels,
   type WindowPlacement,
} from '../lib/dockLayout'
import { togglePanelVisibility as togglePanelVisibilityPure, reconcileDock, reconcileFloating, type ClosedPanels } from '../lib/dockPolicy'
import { applicablePanels, DEFAULT_PANEL_SIDES, type PanelContext } from '../lib/panelRegistry'

// ##################
// # STORAGE SCHEMA #
// ##################

interface DockStorage {
   activeLayout: DockLayout
   /** Panels not currently docked, with where they last lived + whether the user closed them. */
   closedPanels: ClosedPanels
   /** Panels currently floating as windows, with their geometry. */
   floatingPanels: FloatingPanels
}

// Default geometry for a freshly popped-out window, cascaded so several do not stack exactly.
const DEFAULT_WINDOW_SIZE = { width: 320, height: 440 }

function defaultWindowPlacement(existingCount: number): WindowPlacement {
   const offset = existingCount * 28
   const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
   return {
      top:    88 + offset,
      left:   Math.max(48, Math.round(viewportWidth / 2 - DEFAULT_WINDOW_SIZE.width / 2)) + offset,
      width:  DEFAULT_WINDOW_SIZE.width,
      height: DEFAULT_WINDOW_SIZE.height,
   }
}

const STORAGE_KEY = 'documinter-dock-layout'

// Legacy keys from the pre-dock single Structure panel, read once to migrate the first load.
const LEGACY_OPEN_KEY = 'documinter-panel-open'
const LEGACY_DOCK_KEY = 'documinter-panel-dock'

/** A group id unique across sessions. Stored ids persist, so a reset-prone counter is avoided. */
function newGroupId(): string {
   if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `group-${crypto.randomUUID()}`
   }
   return `group-${Math.random().toString(36).slice(2)}`
}

/** Builds the first-load layout from the old Structure panel's stored open + side, so an existing
 *  user's dock starts exactly where their single panel was (migrated side, migrated collapsed rail). */
function migrateFromLegacy(): DockStorage {
   const open = localStorage.getItem(LEGACY_OPEN_KEY) !== 'false'
   const side = localStorage.getItem(LEGACY_DOCK_KEY) === 'right' ? 'right' : 'left'

   let layout = createDefaultDockLayout(newGroupId())               // Structure on the left
   if (side === 'right') layout = movePanelToSideTransform(layout, 'structure', 'right', newGroupId())
   if (!open) layout = toggleColumnCollapsedTransform(layout, side) // the old collapsed rail

   return { activeLayout: layout, closedPanels: {}, floatingPanels: {} }
}

function loadStorage(): DockStorage {
   try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
         const parsed = JSON.parse(raw)
         if (parsed && typeof parsed === 'object' && parsed.activeLayout) {
            return {
               activeLayout:   parsed.activeLayout,
               closedPanels:   parsed.closedPanels ?? {},
               floatingPanels: parsed.floatingPanels ?? {},
            }
         }
      }
   } catch {}
   return migrateFromLegacy()
}

function sameStorage(a: DockStorage, b: DockStorage): boolean {
   return JSON.stringify(a) === JSON.stringify(b)
}

// ########
// # HOOK #
// ########

export interface DockStateResult {
   layout: DockLayout
   /** Panels currently floating as windows, with their geometry. */
   floatingPanels: FloatingPanels
   /** Show or hide a panel, remembering how it was shown (docked-where or floating-at-geometry) so a
    *  later show restores it exactly. Drives the View-menu panel toggles and the panel close controls. */
   togglePanelVisibility: (panelId: PanelId) => void
   /** Pop a panel out of the dock into a floating window. */
   floatPanel:            (panelId: PanelId) => void
   /** Return a floating panel to the dock (its remembered or default side). */
   dockPanel:             (panelId: PanelId) => void
   /** Persist a floating window's moved / resized geometry. */
   setFloatingPlacement:  (panelId: PanelId, placement: WindowPlacement) => void
   movePanelToSide:       (panelId: PanelId, side: DockSide) => void
   movePanelAdjacentToGroup: (panelId: PanelId, targetGroupId: string, position: 'before' | 'after') => void
   mergePanelIntoGroup:   (panelId: PanelId, targetGroupId: string, tabIndex: number) => void
   splitPanelToNewGroup:  (panelId: PanelId, side: DockSide, columnIndex: number) => void
   setActiveTab:          (groupId: string, panelId: PanelId) => void
   reorderTabInGroup:     (groupId: string, fromIndex: number, toIndex: number) => void
   toggleGroupCollapsed:  (groupId: string) => void
   toggleColumnCollapsed: (side: DockSide) => void
   setColumnWidth:        (side: DockSide, width: number) => void
   setGroupFlex:          (groupId: string, flex: number) => void
}

/**
 * Owns the side-panel dock layout: loads + persists it, generates group ids, migrates the legacy
 * single-panel state, and reconciles applicability whenever the document context changes (for
 * example Pages appearing when the document turns paged, or leaving when it turns infinite). The pure
 * work lives in lib/dockLayout + lib/dockPolicy; this hook is the thin React shell around them.
 */
export function useDockState(context: PanelContext): DockStateResult {
   const [storage, setStorage] = useState<DockStorage>(loadStorage)

   useEffect(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storage))
   }, [storage])

   // Reconcile whenever the applicable-panel set changes. The key is a stable primitive so the effect
   // only fires on a real change; the closure reads the fresh `applicable` computed alongside it.
   const applicable    = applicablePanels(context)
   const applicableKey = applicable.join(',')
   useEffect(() => {
      setStorage(current => {
         // Close floating windows that stopped being applicable first, then reconcile the dock over the
         // panels that are neither floating nor already placed (a floating panel must not also auto-dock).
         const floated = reconcileFloating(current.floatingPanels, current.closedPanels, applicable, DEFAULT_PANEL_SIDES)
         const dockApplicable = applicable.filter(panelId => !(panelId in floated.floating))
         const docked = reconcileDock(current.activeLayout, floated.closed, dockApplicable, DEFAULT_PANEL_SIDES, newGroupId)
         const next: DockStorage = { activeLayout: docked.layout, closedPanels: docked.closed, floatingPanels: floated.floating }
         return sameStorage(current, next) ? current : next
      })
      // applicable is derived from applicableKey; depending on the key keeps this to real changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [applicableKey])

   function updateLayout(transform: (layout: DockLayout) => DockLayout): void {
      setStorage(current => ({ ...current, activeLayout: transform(current.activeLayout) }))
   }

   // A relocation that lands the panel in the dock: apply the layout transform AND clear any floating
   // entry for it, so a panel dragged out of a window into the dock can never stay both floating and
   // docked. Harmless for a normal tab drag (the panel is not floating).
   function relocateIntoDock(panelId: PanelId, transform: (layout: DockLayout) => DockLayout): void {
      setStorage(current => {
         const floating = { ...current.floatingPanels }
         delete floating[panelId]
         return { ...current, activeLayout: transform(current.activeLayout), floatingPanels: floating }
      })
   }

   return {
      layout: storage.activeLayout,
      floatingPanels: storage.floatingPanels,

      togglePanelVisibility: panelId => setStorage(current => {
         const result = togglePanelVisibilityPure(
            { layout: current.activeLayout, floating: current.floatingPanels, hidden: current.closedPanels },
            panelId, DEFAULT_PANEL_SIDES[panelId], newGroupId,
         )
         return { activeLayout: result.layout, floatingPanels: result.floating, closedPanels: result.hidden }
      }),

      floatPanel: panelId => setStorage(current => {
         const nextClosed = { ...current.closedPanels }
         delete nextClosed[panelId]
         // Prefer a remembered floating geometry (current or last-hidden), else a cascaded default.
         const placement = current.floatingPanels[panelId]
            ?? current.closedPanels[panelId]?.placement
            ?? defaultWindowPlacement(Object.keys(current.floatingPanels).length)
         return {
            activeLayout:   removePanelTransform(current.activeLayout, panelId),
            closedPanels:   nextClosed,
            floatingPanels: { ...current.floatingPanels, [panelId]: placement },
         }
      }),

      dockPanel: panelId => setStorage(current => {
         const side = current.closedPanels[panelId]?.side ?? DEFAULT_PANEL_SIDES[panelId]
         const nextClosed = { ...current.closedPanels }
         delete nextClosed[panelId]
         const nextFloating = { ...current.floatingPanels }
         delete nextFloating[panelId]
         return {
            activeLayout:   addPanelTransform(current.activeLayout, panelId, side, newGroupId()),
            closedPanels:   nextClosed,
            floatingPanels: nextFloating,
         }
      }),

      setFloatingPlacement: (panelId, placement) => setStorage(current => {
         if (!(panelId in current.floatingPanels)) return current
         return { ...current, floatingPanels: { ...current.floatingPanels, [panelId]: placement } }
      }),

      movePanelToSide:      (panelId, side)                 => relocateIntoDock(panelId, layout => movePanelToSideTransform(layout, panelId, side, newGroupId())),
      movePanelAdjacentToGroup: (panelId, targetGroupId, position) => relocateIntoDock(panelId, layout => movePanelAdjacentToGroupTransform(layout, panelId, targetGroupId, position, newGroupId())),
      splitPanelToNewGroup: (panelId, side, columnIndex)    => relocateIntoDock(panelId, layout => splitPanelToNewGroupTransform(layout, panelId, side, columnIndex, newGroupId())),
      mergePanelIntoGroup:  (panelId, targetGroupId, index) => relocateIntoDock(panelId, layout => mergePanelIntoGroupTransform(layout, panelId, targetGroupId, index)),
      setActiveTab:         (groupId, panelId)              => updateLayout(layout => setActiveTabTransform(layout, groupId, panelId)),
      reorderTabInGroup:    (groupId, fromIndex, toIndex)   => updateLayout(layout => reorderTabInGroupTransform(layout, groupId, fromIndex, toIndex)),
      toggleGroupCollapsed: groupId                         => updateLayout(layout => toggleGroupCollapsedTransform(layout, groupId)),
      toggleColumnCollapsed: side                           => updateLayout(layout => toggleColumnCollapsedTransform(layout, side)),
      setColumnWidth:       (side, width)                  => updateLayout(layout => setColumnWidthTransform(layout, side, width)),
      setGroupFlex:         (groupId, flex)                => updateLayout(layout => setGroupFlexTransform(layout, groupId, flex)),
   }
}

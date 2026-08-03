// -- React Imports --
import { useEffect, useState } from 'react'

// -- Lib Imports --
import {
   createDefaultDockLayout,
   movePanelToSide as movePanelToSideTransform,
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
} from '../lib/dockLayout'
import { togglePanelPresence, reconcileDock, type ClosedPanels } from '../lib/dockPolicy'
import { applicablePanels, DEFAULT_PANEL_SIDES, type PanelContext } from '../lib/panelRegistry'

// ##################
// # STORAGE SCHEMA #
// ##################

interface DockStorage {
   activeLayout: DockLayout
   /** Panels not currently docked, with where they last lived + whether the user closed them. */
   closedPanels: ClosedPanels
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

   return { activeLayout: layout, closedPanels: {} }
}

function loadStorage(): DockStorage {
   try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
         const parsed = JSON.parse(raw)
         if (parsed && typeof parsed === 'object' && parsed.activeLayout) {
            return { activeLayout: parsed.activeLayout, closedPanels: parsed.closedPanels ?? {} }
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
   /** Add a panel (to its remembered or default side) or close it. */
   togglePanel:           (panelId: PanelId) => void
   movePanelToSide:       (panelId: PanelId, side: DockSide) => void
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
         const result = reconcileDock(current.activeLayout, current.closedPanels, applicable, DEFAULT_PANEL_SIDES, newGroupId)
         const next: DockStorage = { activeLayout: result.layout, closedPanels: result.closed }
         return sameStorage(current, next) ? current : next
      })
      // applicable is derived from applicableKey; depending on the key keeps this to real changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [applicableKey])

   function updateLayout(transform: (layout: DockLayout) => DockLayout): void {
      setStorage(current => ({ ...current, activeLayout: transform(current.activeLayout) }))
   }

   return {
      layout: storage.activeLayout,

      togglePanel: panelId => setStorage(current => {
         const result = togglePanelPresence(current.activeLayout, current.closedPanels, panelId, DEFAULT_PANEL_SIDES[panelId], newGroupId)
         return { activeLayout: result.layout, closedPanels: result.closed }
      }),

      movePanelToSide:      (panelId, side)                 => updateLayout(layout => movePanelToSideTransform(layout, panelId, side, newGroupId())),
      splitPanelToNewGroup: (panelId, side, columnIndex)    => updateLayout(layout => splitPanelToNewGroupTransform(layout, panelId, side, columnIndex, newGroupId())),
      mergePanelIntoGroup:  (panelId, targetGroupId, index) => updateLayout(layout => mergePanelIntoGroupTransform(layout, panelId, targetGroupId, index)),
      setActiveTab:         (groupId, panelId)              => updateLayout(layout => setActiveTabTransform(layout, groupId, panelId)),
      reorderTabInGroup:    (groupId, fromIndex, toIndex)   => updateLayout(layout => reorderTabInGroupTransform(layout, groupId, fromIndex, toIndex)),
      toggleGroupCollapsed: groupId                         => updateLayout(layout => toggleGroupCollapsedTransform(layout, groupId)),
      toggleColumnCollapsed: side                           => updateLayout(layout => toggleColumnCollapsedTransform(layout, side)),
      setColumnWidth:       (side, width)                  => updateLayout(layout => setColumnWidthTransform(layout, side, width)),
      setGroupFlex:         (groupId, flex)                => updateLayout(layout => setGroupFlexTransform(layout, groupId, flex)),
   }
}

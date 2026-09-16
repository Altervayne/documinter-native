import { useCallback, useEffect, useState } from 'react'
import type { PaneId, PaneNode } from '../types'
import {
   countVisiblePanels,
   hasExactPanels,
   insertPanelRight,
   isPanelVisible,
   removePanel,
   visiblePanels,
} from '../lib/paneTree'

// ##################
// # STORAGE SCHEMA #
// ##################

interface WorkspaceStorage {
   activeLayout:    PaneNode
   storedPositions: Partial<Record<PaneId, PaneNode>>
}

const STORAGE_KEY = 'documinter-pane-layout'

const DEFAULT_STORAGE: WorkspaceStorage = {
   activeLayout:    { kind: 'leaf', paneId: 'wysiwyg' },
   storedPositions: {},
}

function loadStorage(): WorkspaceStorage {
   try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return DEFAULT_STORAGE
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return DEFAULT_STORAGE
      // Migration: old format stored a PaneNode directly (has `kind` at root level)
      if ('kind' in parsed) return { activeLayout: parsed as PaneNode, storedPositions: {} }
      if ('activeLayout' in parsed) return parsed as WorkspaceStorage
   } catch {}
   return DEFAULT_STORAGE
}

function saveStorage(storage: WorkspaceStorage): void {
   localStorage.setItem(STORAGE_KEY, JSON.stringify(storage))
}

// ########
// # HOOK #
// ########

export interface WorkspaceStateResult {
   paneLayout:    PaneNode
   togglePanel:   (id: PaneId) => void
   setPaneLayout: (layout: PaneNode) => void
}

/**
 * Workspace panel layout state with position-preserving toggle semantics: toggling a panel off snapshots
 * the full layout into `storedPositions`, toggling it back on restores that snapshot only if
 * `hasExactPanels` confirms its panel set still matches, else drops the stale arrangement.
 */
export function useWorkspaceState(): WorkspaceStateResult {
   const [storage, setStorage] = useState<WorkspaceStorage>(loadStorage)

   useEffect(() => { saveStorage(storage) }, [storage])

   const togglePanel = useCallback((id: PaneId) => {
      setStorage(current => {
         const { activeLayout, storedPositions } = current

         if (isPanelVisible(activeLayout, id)) {
            // ===========
            //  Toggle OFF
            // ===========
            if (countVisiblePanels(activeLayout) <= 1) return current   // guard: keep at least one panel

            const newLayout    = removePanel(activeLayout, id)!
            const newPositions = { ...storedPositions, [id]: activeLayout }
            return { activeLayout: newLayout, storedPositions: newPositions }
         } else {
            // ==========
            //  Toggle ON
            // ==========
            const targetSet = new Set(visiblePanels(activeLayout))
            targetSet.add(id)

            const stored = storedPositions[id]
            const newLayout: PaneNode =
               stored !== undefined && hasExactPanels(stored, targetSet)
                  ? stored
                  : insertPanelRight(activeLayout, id)

            const newPositions = { ...storedPositions }
            delete newPositions[id]
            return { activeLayout: newLayout, storedPositions: newPositions }
         }
      })
   }, [])

   const setPaneLayout = useCallback((layout: PaneNode) => {
      setStorage(current => ({ ...current, activeLayout: layout }))
   }, [])

   return { paneLayout: storage.activeLayout, togglePanel, setPaneLayout }
}

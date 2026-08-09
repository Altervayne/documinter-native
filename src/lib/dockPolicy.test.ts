import { describe, it, expect } from 'vitest'

import { createDefaultDockLayout, isPanelDocked, locatePanel, toggleGroupCollapsed, type DockLayout, type DockGroup, type PanelId, type DockSide } from './dockLayout'
import { togglePanelVisibility, isPanelVisible, reconcileDock, reconcileFloating, type ClosedPanels } from './dockPolicy'
import type { FloatingPanels } from './dockLayout'

// A deterministic id factory for tests: group-0, group-1, ...
function makeIdFactory() {
   let count = 0
   return () => `group-${count++}`
}

const DEFAULT_SIDES: Record<PanelId, DockSide> = { structure: 'left', pages: 'right', anchors: 'left' }

function base(): DockLayout {
   return createDefaultDockLayout('group-structure')
}

describe('togglePanelVisibility', () => {
   const placement = { top: 90, left: 120, width: 320, height: 440 }

   it('hides a docked panel, remembering its side', () => {
      const result = togglePanelVisibility({ layout: base(), floating: {}, hidden: {} }, 'structure', 'left', makeIdFactory())
      expect(isPanelDocked(result.layout, 'structure')).toBe(false)
      expect(result.hidden.structure).toEqual({ side: 'left', auto: false })
   })

   it('shows a hidden docked panel back to its remembered side', () => {
      const hidden: ClosedPanels = { pages: { side: 'right', auto: false } }
      const result = togglePanelVisibility({ layout: base(), floating: {}, hidden }, 'pages', 'right', makeIdFactory())
      expect(locatePanel(result.layout, 'pages')?.side).toBe('right')
      expect(result.hidden.pages).toBeUndefined()
   })

   it('hides a floating panel, remembering its placement so it comes back floating', () => {
      const result = togglePanelVisibility({ layout: base(), floating: { pages: placement }, hidden: {} }, 'pages', 'right', makeIdFactory())
      expect(result.floating.pages).toBeUndefined()
      expect(result.hidden.pages).toEqual({ side: 'right', auto: false, placement })
   })

   it('shows a panel hidden while floating back as a floating window at its geometry', () => {
      const hidden: ClosedPanels = { pages: { side: 'right', auto: false, placement } }
      const result = togglePanelVisibility({ layout: base(), floating: {}, hidden }, 'pages', 'right', makeIdFactory())
      expect(result.floating.pages).toEqual(placement)
      expect(isPanelDocked(result.layout, 'pages')).toBe(false)
      expect(result.hidden.pages).toBeUndefined()
   })

   it('shows a never-seen panel on its default side', () => {
      const result = togglePanelVisibility({ layout: base(), floating: {}, hidden: {} }, 'pages', 'right', makeIdFactory())
      expect(locatePanel(result.layout, 'pages')?.side).toBe('right')
   })
})

describe('isPanelVisible', () => {
   it('is true when docked or floating, false when neither', () => {
      expect(isPanelVisible(base(), {}, 'structure')).toBe(true)
      expect(isPanelVisible(base(), {}, 'pages')).toBe(false)
      expect(isPanelVisible(base(), { pages: { top: 0, left: 0, width: 1, height: 1 } }, 'pages')).toBe(true)
   })
})

describe('reconcileDock', () => {
   it('first-time-docks an applicable panel to its default side', () => {
      // Pages becomes applicable (paged mode); it has never been placed
      const { layout } = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, makeIdFactory())
      expect(locatePanel(layout, 'pages')?.side).toBe('right')
      expect(isPanelDocked(layout, 'structure')).toBe(true)
   })

   it('undocks a panel that stops being applicable and remembers its side (auto)', () => {
      // start with pages docked, then reconcile with pages no longer applicable (infinite mode)
      const paged = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, makeIdFactory()).layout
      const { layout, closed } = reconcileDock(paged, {}, ['structure'], DEFAULT_SIDES, makeIdFactory())
      expect(isPanelDocked(layout, 'pages')).toBe(false)
      expect(closed.pages).toEqual({ side: 'right', auto: true })
   })

   it('auto-restores an auto-undocked panel when it applies again', () => {
      const closed: ClosedPanels = { pages: { side: 'right', auto: true } }
      const { layout, closed: next } = reconcileDock(base(), closed, ['structure', 'pages'], DEFAULT_SIDES, makeIdFactory())
      expect(locatePanel(layout, 'pages')?.side).toBe('right')
      expect(next.pages).toBeUndefined()
   })

   it('leaves a deliberately-closed panel closed even while applicable', () => {
      const closed: ClosedPanels = { pages: { side: 'right', auto: false } }
      const { layout, closed: next } = reconcileDock(base(), closed, ['structure', 'pages'], DEFAULT_SIDES, makeIdFactory())
      expect(isPanelDocked(layout, 'pages')).toBe(false)
      expect(next.pages).toEqual({ side: 'right', auto: false })
   })

   it('does not touch panels that are floating (they are reconciled separately)', () => {
      // pages is floating (not docked); reconcileDock should leave the dock alone for it
      const { layout } = reconcileDock(base(), {}, ['structure'], DEFAULT_SIDES, makeIdFactory())
      expect(isPanelDocked(layout, 'pages')).toBe(false)
   })

   it('restores a collapsed group across an undock→redock applicability cycle', () => {
      const idFactory = makeIdFactory()
      const groupOf = (layout: DockLayout, panelId: PanelId): DockGroup | undefined => {
         const location = locatePanel(layout, panelId)
         return location ? layout[location.side]?.groups[location.groupIndex] : undefined
      }
      // Paged: Pages auto-docks as its own group; the user collapses it.
      let layout = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, idFactory).layout
      layout = toggleGroupCollapsed(layout, locatePanel(layout, 'pages')!.groupId)
      expect(groupOf(layout, 'pages')?.collapsed).toBe(true)
      // Switch to infinite (Pages undocks, remembering it was collapsed)...
      const undocked = reconcileDock(layout, {}, ['structure'], DEFAULT_SIDES, idFactory)
      expect(undocked.closed.pages).toEqual({ side: 'right', auto: true, collapsed: true })
      // ...then back to paged: Pages re-docks AND is collapsed again (not silently re-expanded).
      const redocked = reconcileDock(undocked.layout, undocked.closed, ['structure', 'pages'], DEFAULT_SIDES, idFactory)
      expect(isPanelDocked(redocked.layout, 'pages')).toBe(true)
      expect(groupOf(redocked.layout, 'pages')?.collapsed).toBe(true)
   })

   it('round-trips: user hides Pages in paged mode, and it stays hidden across a format switch', () => {
      const idFactory = makeIdFactory()
      // paged: Pages auto-docks
      const layout = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, idFactory).layout
      expect(isPanelDocked(layout, 'pages')).toBe(true)
      // user hides Pages by hand
      const hiddenState = togglePanelVisibility({ layout, floating: {}, hidden: {} }, 'pages', 'right', idFactory)
      expect(hiddenState.hidden.pages).toEqual({ side: 'right', auto: false })
      // switch to infinite (pages not applicable), then back to paged
      let reconciled = reconcileDock(hiddenState.layout, hiddenState.hidden, ['structure'], DEFAULT_SIDES, idFactory)
      reconciled = reconcileDock(reconciled.layout, reconciled.closed, ['structure', 'pages'], DEFAULT_SIDES, idFactory)
      // still hidden, because the user hid it on purpose
      expect(isPanelDocked(reconciled.layout, 'pages')).toBe(false)
   })
})

describe('reconcileFloating', () => {
   const placement = { top: 90, left: 120, width: 320, height: 440 }

   it('leaves an applicable floating panel untouched', () => {
      const floating: FloatingPanels = { pages: placement }
      const result = reconcileFloating(floating, {}, ['structure', 'pages'], DEFAULT_SIDES)
      expect(result.floating.pages).toEqual(placement)
      expect(result.closed.pages).toBeUndefined()
   })

   it('closes a floating panel that stops being applicable, remembering it as auto', () => {
      const floating: FloatingPanels = { pages: placement }
      const result = reconcileFloating(floating, {}, ['structure'], DEFAULT_SIDES)
      expect(result.floating.pages).toBeUndefined()
      expect(result.closed.pages).toEqual({ side: 'right', auto: true })
   })
})

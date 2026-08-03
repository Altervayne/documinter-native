import { describe, it, expect } from 'vitest'

import { createDefaultDockLayout, isPanelDocked, locatePanel, type DockLayout, type PanelId, type DockSide } from './dockLayout'
import { togglePanelPresence, reconcileDock, type ClosedPanels } from './dockPolicy'

// A deterministic id factory for tests: group-0, group-1, ...
function makeIdFactory() {
   let count = 0
   return () => `group-${count++}`
}

const DEFAULT_SIDES: Record<PanelId, DockSide> = { structure: 'left', pages: 'right' }

function base(): DockLayout {
   return createDefaultDockLayout('group-structure')
}

describe('togglePanelPresence', () => {
   it('closes a docked panel and records a deliberate-close memory', () => {
      const { layout, closed } = togglePanelPresence(base(), {}, 'structure', 'left', makeIdFactory())
      expect(isPanelDocked(layout, 'structure')).toBe(false)
      expect(closed.structure).toEqual({ side: 'left', auto: false })
   })

   it('reopens a closed panel to its remembered side and clears the memory', () => {
      const closed: ClosedPanels = { pages: { side: 'right', auto: false } }
      const { layout, closed: next } = togglePanelPresence(base(), closed, 'pages', 'right', makeIdFactory())
      expect(locatePanel(layout, 'pages')?.side).toBe('right')
      expect(next.pages).toBeUndefined()
   })

   it('opens a never-seen panel on its default side', () => {
      const { layout } = togglePanelPresence(base(), {}, 'pages', 'right', makeIdFactory())
      expect(locatePanel(layout, 'pages')?.side).toBe('right')
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

   it('round-trips: user closes Pages in paged mode, and it stays closed across a format switch', () => {
      const idFactory = makeIdFactory()
      // paged: Pages auto-docks
      let state = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, idFactory)
      expect(isPanelDocked(state.layout, 'pages')).toBe(true)
      // user closes Pages by hand
      state = togglePanelPresence(state.layout, state.closed, 'pages', 'right', idFactory)
      expect(state.closed.pages).toEqual({ side: 'right', auto: false })
      // switch to infinite (pages not applicable), then back to paged
      state = reconcileDock(state.layout, state.closed, ['structure'], DEFAULT_SIDES, idFactory)
      state = reconcileDock(state.layout, state.closed, ['structure', 'pages'], DEFAULT_SIDES, idFactory)
      // still closed, because the user closed it on purpose
      expect(isPanelDocked(state.layout, 'pages')).toBe(false)
   })
})

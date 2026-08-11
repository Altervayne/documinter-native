import { describe, it, expect } from 'vitest'

import { createDefaultDockLayout, isPanelDocked, locatePanel, toggleGroupCollapsed, addPanel, mergePanelIntoGroup, groupExists, type DockLayout, type DockGroup, type PanelId, type DockSide } from './dockLayout'
import { togglePanelVisibility, isPanelVisible, reconcileDock, reconcileFloating, type ClosedPanels } from './dockPolicy'
import type { FloatingPanels } from './dockLayout'

// A deterministic id factory for tests: group-0, group-1, ...
function makeIdFactory() {
   let count = 0
   return () => `group-${count++}`
}

const DEFAULT_SIDES: Record<PanelId, DockSide> = {
   structure: 'left', pages: 'right', anchors: 'left', pagesetup: 'right', presentation: 'right', documentnav: 'right', templates: 'right',
}

// The panels that auto-dock the first time they apply. Structure / Pages / Anchors are default-open; the
// settings-editor panels (pagesetup / presentation / documentnav / templates) are default-closed, so they
// are absent.
const DEFAULT_OPEN = new Set<PanelId>(['structure', 'pages', 'anchors'])

function base(): DockLayout {
   return createDefaultDockLayout('group-structure')
}

describe('togglePanelVisibility', () => {
   const placement = { top: 90, left: 120, width: 320, height: 440 }

   it('hides a docked panel, remembering its side and group', () => {
      const result = togglePanelVisibility({ layout: base(), floating: {}, hidden: {} }, 'structure', 'left', makeIdFactory())
      expect(isPanelDocked(result.layout, 'structure')).toBe(false)
      expect(result.hidden.structure).toEqual({ side: 'left', auto: false, groupId: 'group-structure', tabIndex: 0 })
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

   it('hiding then showing a panel tabbed with a sibling rejoins the same group', () => {
      const idFactory = makeIdFactory()
      // Pages tabbed into Document nav's group; Document nav is the sibling that keeps the group alive.
      let layout = addPanel(base(), 'documentnav', 'right', 'group-nav')
      layout = mergePanelIntoGroup(layout, 'pages', 'group-nav', 1)

      const hiddenState = togglePanelVisibility({ layout, floating: {}, hidden: {} }, 'pages', 'right', idFactory)
      expect(isPanelDocked(hiddenState.layout, 'pages')).toBe(false)
      expect(locatePanel(hiddenState.layout, 'documentnav')?.groupId).toBe('group-nav')   // sibling untouched

      const shownState = togglePanelVisibility(hiddenState, 'pages', 'right', idFactory)
      expect(locatePanel(shownState.layout, 'pages')?.groupId).toBe('group-nav')
      expect(locatePanel(shownState.layout, 'documentnav')?.groupId).toBe('group-nav')
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
      const { layout } = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(locatePanel(layout, 'pages')?.side).toBe('right')
      expect(isPanelDocked(layout, 'structure')).toBe(true)
   })

   it('does not auto-dock a default-closed panel that has never been placed, but does dock a default-open one', () => {
      // pagesetup is applicable (edit mode) but default-closed with no memory: it must stay hidden.
      // anchors is applicable AND default-open with no memory: it first-time-docks.
      const { layout } = reconcileDock(base(), {}, ['structure', 'anchors', 'pagesetup'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(isPanelDocked(layout, 'pagesetup')).toBe(false)
      expect(isPanelDocked(layout, 'anchors')).toBe(true)
   })

   it('still auto-restores a default-closed panel that was auto-undocked (it has an auto memory)', () => {
      // A default-closed panel that WAS docked and went inapplicable keeps its auto memory, so coming back
      // applicable restores it regardless of defaultOpen (defaultOpen only gates the never-placed case).
      const closed: ClosedPanels = { pagesetup: { side: 'right', auto: true } }
      const { layout, closed: next } = reconcileDock(base(), closed, ['structure', 'pagesetup'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(locatePanel(layout, 'pagesetup')?.side).toBe('right')
      expect(next.pagesetup).toBeUndefined()
   })

   it('undocks a panel that stops being applicable and remembers its side, group and tab (auto)', () => {
      // start with pages docked, then reconcile with pages no longer applicable (infinite mode)
      const paged = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory()).layout
      const pagesGroupId = locatePanel(paged, 'pages')!.groupId
      const { layout, closed } = reconcileDock(paged, {}, ['structure'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(isPanelDocked(layout, 'pages')).toBe(false)
      expect(closed.pages).toEqual({ side: 'right', auto: true, groupId: pagesGroupId, tabIndex: 0 })
   })

   it('auto-restores an auto-undocked panel when it applies again', () => {
      const closed: ClosedPanels = { pages: { side: 'right', auto: true } }
      const { layout, closed: next } = reconcileDock(base(), closed, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(locatePanel(layout, 'pages')?.side).toBe('right')
      expect(next.pages).toBeUndefined()
   })

   it('leaves a deliberately-closed panel closed even while applicable', () => {
      const closed: ClosedPanels = { pages: { side: 'right', auto: false } }
      const { layout, closed: next } = reconcileDock(base(), closed, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(isPanelDocked(layout, 'pages')).toBe(false)
      expect(next.pages).toEqual({ side: 'right', auto: false })
   })

   it('does not touch panels that are floating (they are reconciled separately)', () => {
      // pages is floating (not docked); reconcileDock should leave the dock alone for it
      const { layout } = reconcileDock(base(), {}, ['structure'], DEFAULT_SIDES, DEFAULT_OPEN, makeIdFactory())
      expect(isPanelDocked(layout, 'pages')).toBe(false)
   })

   it('restores a collapsed group across an undock→redock applicability cycle', () => {
      const idFactory = makeIdFactory()
      const groupOf = (layout: DockLayout, panelId: PanelId): DockGroup | undefined => {
         const location = locatePanel(layout, panelId)
         return location ? layout[location.side]?.groups[location.groupIndex] : undefined
      }
      // Paged: Pages auto-docks as its own group; the user collapses it.
      let layout = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory).layout
      const pagesGroupId = locatePanel(layout, 'pages')!.groupId
      layout = toggleGroupCollapsed(layout, pagesGroupId)
      expect(groupOf(layout, 'pages')?.collapsed).toBe(true)
      // Switch to infinite (Pages undocks, remembering it was collapsed)...
      const undocked = reconcileDock(layout, {}, ['structure'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      expect(undocked.closed.pages).toEqual({ side: 'right', auto: true, collapsed: true, groupId: pagesGroupId, tabIndex: 0 })
      // Pages was alone in its group, so the group was dropped when it left: the remembered groupId no
      // longer exists, and restoring correctly falls back to a new group (still collapsed, per memory).
      expect(groupExists(undocked.layout, pagesGroupId)).toBe(false)
      // ...then back to paged: Pages re-docks AND is collapsed again (not silently re-expanded).
      const redocked = reconcileDock(undocked.layout, undocked.closed, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      expect(isPanelDocked(redocked.layout, 'pages')).toBe(true)
      expect(groupOf(redocked.layout, 'pages')?.collapsed).toBe(true)
   })

   it('rejoins the same group after an applicability cycle when it shared that group with an applicable sibling', () => {
      const idFactory = makeIdFactory()
      // Pages tabbed into Document nav's group (mirrors the real bug: Pages tabbed with Document nav).
      let layout = addPanel(base(), 'documentnav', 'right', 'group-nav')
      layout = mergePanelIntoGroup(layout, 'pages', 'group-nav', 1)
      expect(locatePanel(layout, 'pages')?.groupId).toBe('group-nav')

      // Infinite-canvas doc: Pages is no longer applicable and auto-undocks. Document nav stays applicable
      // and docked, so its group survives with one panel in it.
      const undocked = reconcileDock(layout, {}, ['structure', 'documentnav'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      expect(isPanelDocked(undocked.layout, 'pages')).toBe(false)
      expect(locatePanel(undocked.layout, 'documentnav')?.groupId).toBe('group-nav')
      expect(groupExists(undocked.layout, 'group-nav')).toBe(true)   // the sibling kept it alive

      // Back to a paged doc: Pages must rejoin group-nav, not spin up a fresh standalone group.
      const redocked = reconcileDock(undocked.layout, undocked.closed, ['structure', 'pages', 'documentnav'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      const pagesLocation = locatePanel(redocked.layout, 'pages')
      const documentnavLocation = locatePanel(redocked.layout, 'documentnav')
      expect(pagesLocation?.groupId).toBe('group-nav')
      expect(pagesLocation?.groupId).toBe(documentnavLocation?.groupId)
      expect(redocked.layout.right?.groups.filter(group => group.id === 'group-nav')).toHaveLength(1)
   })

   it('falls back to a new group when the remembered group no longer exists (panel was alone in it)', () => {
      const idFactory = makeIdFactory()
      const docked = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory).layout
      const originalGroupId = locatePanel(docked, 'pages')!.groupId

      // Infinite: Pages was alone in its group, so the group is dropped along with it.
      const undocked = reconcileDock(docked, {}, ['structure'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      expect(groupExists(undocked.layout, originalGroupId)).toBe(false)

      // Paged again: no group to rejoin, so Pages comes back as its own new group, same as before this fix.
      const redocked = reconcileDock(undocked.layout, undocked.closed, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      expect(isPanelDocked(redocked.layout, 'pages')).toBe(true)
      const newGroupId = locatePanel(redocked.layout, 'pages')!.groupId
      expect(newGroupId).not.toBe(originalGroupId)
      expect(redocked.layout.right?.groups.find(group => group.id === newGroupId)?.panels).toEqual(['pages'])
   })

   it('round-trips: user hides Pages in paged mode, and it stays hidden across a format switch', () => {
      const idFactory = makeIdFactory()
      // paged: Pages auto-docks
      const layout = reconcileDock(base(), {}, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory).layout
      expect(isPanelDocked(layout, 'pages')).toBe(true)
      const pagesGroupId = locatePanel(layout, 'pages')!.groupId
      // user hides Pages by hand
      const hiddenState = togglePanelVisibility({ layout, floating: {}, hidden: {} }, 'pages', 'right', idFactory)
      expect(hiddenState.hidden.pages).toEqual({ side: 'right', auto: false, groupId: pagesGroupId, tabIndex: 0 })
      // switch to infinite (pages not applicable), then back to paged
      let reconciled = reconcileDock(hiddenState.layout, hiddenState.hidden, ['structure'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
      reconciled = reconcileDock(reconciled.layout, reconciled.closed, ['structure', 'pages'], DEFAULT_SIDES, DEFAULT_OPEN, idFactory)
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

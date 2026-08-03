import { describe, it, expect } from 'vitest'

import {
   createDefaultDockLayout,
   locatePanel,
   isPanelDocked,
   dockedPanels,
   addPanel,
   removePanel,
   mergePanelIntoGroup,
   splitPanelToNewGroup,
   movePanelToSide,
   setActiveTab,
   reorderTabInGroup,
   toggleGroupCollapsed,
   setColumnWidth,
   setGroupFlex,
   MIN_COLUMN_WIDTH,
   MAX_COLUMN_WIDTH,
   DEFAULT_COLUMN_WIDTH,
   type DockLayout,
} from './dockLayout'

// ==========================================================
//  Shared invariant checks. Every transform must leave these true, they encode the ratified rules:
//  no empty groups, no empty columns stored (the side is null instead), a valid active tab per group,
//  and a panel present in exactly one place (no duplicates).
// ==========================================================
function assertInvariants(layout: DockLayout): void {
   const seen = new Set<string>()
   for (const side of ['left', 'right'] as const) {
      const column = layout[side]
      if (column === null) continue
      expect(column.groups.length).toBeGreaterThan(0)   // an empty column must be stored as null
      for (const group of column.groups) {
         expect(group.panels.length).toBeGreaterThan(0)             // no empty group
         expect(group.panels).toContain(group.activePanel)         // active tab is a real tab
         for (const panelId of group.panels) {
            expect(seen.has(panelId)).toBe(false)                  // no duplicate panel anywhere
            seen.add(panelId)
         }
      }
   }
}

// A convenient starting point: Structure alone in the left dock.
function defaultLayout(): DockLayout {
   return createDefaultDockLayout('group-structure')
}

describe('createDefaultDockLayout', () => {
   it('places Structure alone in a left dock at the default width, right empty', () => {
      const layout = defaultLayout()
      expect(layout.right).toBeNull()
      expect(layout.left?.width).toBe(DEFAULT_COLUMN_WIDTH)
      expect(layout.left?.groups).toHaveLength(1)
      expect(layout.left?.groups[0]).toMatchObject({
         id:          'group-structure',
         panels:      ['structure'],
         activePanel: 'structure',
      })
      assertInvariants(layout)
   })
})

describe('queries', () => {
   it('locates a docked panel and reports docked panels in order', () => {
      const layout = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      expect(locatePanel(layout, 'structure')).toEqual({
         side: 'left', groupId: 'group-structure', groupIndex: 0, tabIndex: 0,
      })
      expect(locatePanel(layout, 'pages')).toEqual({
         side: 'right', groupId: 'group-pages', groupIndex: 0, tabIndex: 0,
      })
      expect(isPanelDocked(layout, 'pages')).toBe(true)
      expect(dockedPanels(layout)).toEqual(['structure', 'pages'])
   })

   it('returns null / false for an undocked panel', () => {
      const layout = defaultLayout()
      expect(locatePanel(layout, 'pages')).toBeNull()
      expect(isPanelDocked(layout, 'pages')).toBe(false)
   })
})

describe('addPanel', () => {
   it('adds a panel as a new group on the requested side, creating the column', () => {
      const layout = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      expect(layout.right?.width).toBe(DEFAULT_COLUMN_WIDTH)
      expect(layout.right?.groups).toHaveLength(1)
      expect(layout.right?.groups[0].panels).toEqual(['pages'])
      assertInvariants(layout)
   })

   it('appends to the bottom of an existing column', () => {
      let layout = addPanel(defaultLayout(), 'pages', 'left', 'group-pages')
      expect(layout.left?.groups.map(group => group.id)).toEqual(['group-structure', 'group-pages'])
      assertInvariants(layout)
   })

   it('is a no-op when the panel is already docked (no duplicates)', () => {
      const once  = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      const twice = addPanel(once, 'pages', 'left', 'group-pages-again')
      expect(twice).toEqual(once)
      expect(dockedPanels(twice)).toEqual(['structure', 'pages'])
      assertInvariants(twice)
   })
})

describe('removePanel', () => {
   it('drops a lone panel, pruning its group and its now-empty column', () => {
      const layout  = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      const removed = removePanel(layout, 'pages')
      expect(removed.right).toBeNull()
      expect(isPanelDocked(removed, 'pages')).toBe(false)
      assertInvariants(removed)
   })

   it('falls the active tab back to the first remaining panel when the active one is removed', () => {
      const merged  = mergePanelIntoGroup(
         addPanel(defaultLayout(), 'pages', 'left', 'group-pages'),
         'pages', 'group-structure', 1,
      )
      // pages was merged into the structure group and became active
      expect(merged.left?.groups[0].activePanel).toBe('pages')
      const removed = removePanel(merged, 'pages')
      expect(removed.left?.groups[0].panels).toEqual(['structure'])
      expect(removed.left?.groups[0].activePanel).toBe('structure')
      assertInvariants(removed)
   })
})

describe('mergePanelIntoGroup (tabbing)', () => {
   it('merges a panel into a group as a tab and makes it active, detaching it from its old spot', () => {
      const layout = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      const merged = mergePanelIntoGroup(layout, 'pages', 'group-structure', 1)
      // pages left the right dock entirely
      expect(merged.right).toBeNull()
      // and now tabs alongside structure, active
      expect(merged.left?.groups).toHaveLength(1)
      expect(merged.left?.groups[0].panels).toEqual(['structure', 'pages'])
      expect(merged.left?.groups[0].activePanel).toBe('pages')
      assertInvariants(merged)
   })

   it('is a no-op when the target group vanishes after detaching the panel', () => {
      // pages is alone in group-pages; merging pages into group-pages is meaningless
      const layout = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      const result = mergePanelIntoGroup(layout, 'pages', 'group-pages', 0)
      expect(result).toEqual(layout)
      assertInvariants(result)
   })
})

describe('splitPanelToNewGroup (superpose)', () => {
   it('moves a tabbed panel out into its own group at the given column index', () => {
      // structure + pages tabbed together in the left dock
      const tabbed = mergePanelIntoGroup(
         addPanel(defaultLayout(), 'pages', 'left', 'group-pages'),
         'pages', 'group-structure', 1,
      )
      expect(tabbed.left?.groups).toHaveLength(1)
      // split pages back out, stacked above structure
      const split = splitPanelToNewGroup(tabbed, 'pages', 'left', 0, 'group-pages-2')
      expect(split.left?.groups.map(group => group.id)).toEqual(['group-pages-2', 'group-structure'])
      expect(split.left?.groups[0].panels).toEqual(['pages'])
      expect(split.left?.groups[1].panels).toEqual(['structure'])
      assertInvariants(split)
   })
})

describe('movePanelToSide', () => {
   it('moves a panel to the other dock, at the bottom of that column', () => {
      // both panels stacked on the left
      const stacked = addPanel(addPanel(defaultLayout(), 'pages', 'left', 'group-pages'), 'structure', 'left', 'noop')
      const moved   = movePanelToSide(stacked, 'pages', 'right', 'group-pages-right')
      expect(locatePanel(moved, 'pages')?.side).toBe('right')
      expect(moved.left?.groups.map(group => group.id)).toEqual(['group-structure'])
      assertInvariants(moved)
   })

   it('never duplicates a panel already docked on the target side', () => {
      const layout = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      const moved  = movePanelToSide(layout, 'pages', 'right', 'group-pages-2')
      expect(dockedPanels(moved)).toEqual(['structure', 'pages'])
      assertInvariants(moved)
   })
})

describe('tab + collapse state', () => {
   it('sets the active tab only when the panel is in that group', () => {
      const tabbed = mergePanelIntoGroup(
         addPanel(defaultLayout(), 'pages', 'left', 'group-pages'),
         'pages', 'group-structure', 1,
      )
      const activated = setActiveTab(tabbed, 'group-structure', 'structure')
      expect(activated.left?.groups[0].activePanel).toBe('structure')
      // panel not in the group leaves it unchanged
      const unchanged = setActiveTab(activated, 'group-structure', 'pages')
      expect(unchanged.left?.groups[0].activePanel).toBe('pages')
   })

   it('reorders tabs within a group', () => {
      const tabbed = mergePanelIntoGroup(
         addPanel(defaultLayout(), 'pages', 'left', 'group-pages'),
         'pages', 'group-structure', 1,
      )
      expect(tabbed.left?.groups[0].panels).toEqual(['structure', 'pages'])
      const reordered = reorderTabInGroup(tabbed, 'group-structure', 1, 0)
      expect(reordered.left?.groups[0].panels).toEqual(['pages', 'structure'])
      assertInvariants(reordered)
   })

   it('toggles per-group collapsed state', () => {
      const layout    = defaultLayout()
      const collapsed = toggleGroupCollapsed(layout, 'group-structure')
      expect(collapsed.left?.groups[0].collapsed).toBe(true)
      const expanded  = toggleGroupCollapsed(collapsed, 'group-structure')
      expect(expanded.left?.groups[0].collapsed).toBe(false)
   })
})

describe('resize transforms', () => {
   it('clamps column width to the allowed range', () => {
      const layout = defaultLayout()
      expect(setColumnWidth(layout, 'left', 10).left?.width).toBe(MIN_COLUMN_WIDTH)
      expect(setColumnWidth(layout, 'left', 9999).left?.width).toBe(MAX_COLUMN_WIDTH)
      expect(setColumnWidth(layout, 'left', 300).left?.width).toBe(300)
   })

   it('is a no-op setting width on an empty side', () => {
      const layout = defaultLayout()
      expect(setColumnWidth(layout, 'right', 300)).toEqual(layout)
   })

   it('keeps group flex positive', () => {
      const layout = defaultLayout()
      expect(setGroupFlex(layout, 'group-structure', -5).left?.groups[0].flex).toBeGreaterThan(0)
      expect(setGroupFlex(layout, 'group-structure', 2).left?.groups[0].flex).toBe(2)
   })
})

describe('immutability', () => {
   it('never mutates the input layout', () => {
      const layout = addPanel(defaultLayout(), 'pages', 'right', 'group-pages')
      const before = JSON.stringify(layout)
      removePanel(layout, 'pages')
      mergePanelIntoGroup(layout, 'pages', 'group-structure', 1)
      setActiveTab(layout, 'group-structure', 'structure')
      expect(JSON.stringify(layout)).toBe(before)
   })
})

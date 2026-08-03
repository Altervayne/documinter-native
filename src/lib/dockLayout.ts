// ###############################################################################################
// # DOCK LAYOUT MODEL                                                                           #
// #                                                                                             #
// # The pure data model + transforms for the side-panel docking system (see                    #
// # docs/reference/side_panel_docking_study.md). A DockLayout is a flat structure: each side    #
// # (left / right) holds at most one Column, a Column is a top-to-bottom stack of Groups, and a #
// # Group is a tabbed container of one or more Panels. Docks attach only to the left or right    #
// # edge of the workspace; there is no top or bottom dock (ratified). Vertical arrangement       #
// # exists only as group stacking inside a column.                                              #
// #                                                                                             #
// # Every function here is pure and returns a new layout, mirroring the discipline of the       #
// # center-pane engine in lib/paneTree.ts so the whole thing stays unit-testable with no React. #
// ###############################################################################################

// #########
// # TYPES #
// #########

export type DockSide = 'left' | 'right'

// The registered side-panel ids. Extend this union as new panels register (see lib/panelRegistry).
// A given panel id appears in a DockLayout at most once: the no-duplicates rule (ratified).
export type PanelId = 'structure' | 'pages'

export interface DockGroup {
   /** Stable id. Survives reorder so it can key React nodes and be a drag / config-menu target. */
   id:          string
   /** Tab order, shown left-to-right in the group header. Always holds at least one panel. */
   panels:      PanelId[]
   /** The visible tab. Always one of `panels`. */
   activePanel: PanelId
   /** Relative height weight within the column (used as flex-grow). Positive; new groups start at 1. */
   flex:        number
   /** When true the group shows only its tab strip and hides its body. */
   collapsed?:  boolean
}

export interface DockColumn {
   /** Column width in px, clamped to [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]. */
   width:  number
   /** Groups stacked top-to-bottom. A column is never stored empty (the side is set to null instead). */
   groups: DockGroup[]
}

export interface DockLayout {
   left:  DockColumn | null
   right: DockColumn | null
}

/** Where a panel currently sits, resolved by `locatePanel`. */
export interface PanelLocation {
   side:       DockSide
   groupId:    string
   groupIndex: number
   tabIndex:   number
}

// #############
// # CONSTANTS #
// #############

/** A comfortable floor for a tabbed panel column. */
export const MIN_COLUMN_WIDTH = 176      // 11rem
/** Keeps a single dock from eating the whole workspace. */
export const MAX_COLUMN_WIDTH = 480      // 30rem
/** Matches the pre-dock Structure panel width, so the migrated default feels unchanged. */
export const DEFAULT_COLUMN_WIDTH = 288  // 18rem

const DEFAULT_GROUP_FLEX = 1
const MIN_GROUP_FLEX = 0.1

const DOCK_SIDES: readonly DockSide[] = ['left', 'right']

function clamp(value: number, min: number, max: number): number {
   return Math.max(min, Math.min(value, max))
}

// ####################
// # INTERNAL HELPERS #
// ####################

function makeGroup(id: string, panelId: PanelId): DockGroup {
   return { id, panels: [panelId], activePanel: panelId, flex: DEFAULT_GROUP_FLEX }
}

/** Returns a new layout with one side's column replaced (type-safe alternative to a computed key). */
function withSide(layout: DockLayout, side: DockSide, column: DockColumn | null): DockLayout {
   return side === 'left'
      ? { ...layout, left: column }
      : { ...layout, right: column }
}

/**
 * Removes `panelId` from wherever it lives, everywhere. A group that loses its last panel is dropped;
 * a column that loses its last group becomes null; if the removed panel was a group's active tab, the
 * active tab falls back to the group's new first panel. Because a panel exists in at most one place,
 * this touches at most one group, but scanning both sides keeps it total and simple. This is the
 * detach step every insert transform runs first, which is what enforces the no-duplicates rule.
 */
function detachPanel(layout: DockLayout, panelId: PanelId): DockLayout {
   const strip = (column: DockColumn | null): DockColumn | null => {
      if (!column) return null
      const groups: DockGroup[] = []
      for (const group of column.groups) {
         if (!group.panels.includes(panelId)) {
            groups.push(group)
            continue
         }
         const panels = group.panels.filter(id => id !== panelId)
         if (panels.length === 0) continue   // group emptied by the removal, so drop it
         groups.push({
            ...group,
            panels,
            activePanel: group.activePanel === panelId ? panels[0] : group.activePanel,
         })
      }
      return groups.length === 0 ? null : { ...column, groups }
   }
   return { left: strip(layout.left), right: strip(layout.right) }
}

/** Inserts a fresh single-panel group at `index` in a side's column, creating the column if needed.
 *  Assumes the panel is already detached from its previous location. */
function insertNewGroup(
   layout:     DockLayout,
   panelId:    PanelId,
   side:       DockSide,
   index:      number,
   newGroupId: string,
): DockLayout {
   const group  = makeGroup(newGroupId, panelId)
   const column = layout[side]
   const groups = column ? [...column.groups] : []
   const at     = clamp(index, 0, groups.length)
   groups.splice(at, 0, group)
   return withSide(layout, side, { width: column?.width ?? DEFAULT_COLUMN_WIDTH, groups })
}

/** Locates a group by id. Internal, returns enough to rebuild the containing column. */
function findGroup(layout: DockLayout, groupId: string): { side: DockSide; groupIndex: number } | null {
   for (const side of DOCK_SIDES) {
      const column = layout[side]
      if (!column) continue
      const groupIndex = column.groups.findIndex(group => group.id === groupId)
      if (groupIndex !== -1) return { side, groupIndex }
   }
   return null
}

/** Applies `transform` to the single group matching `groupId`, leaving everything else untouched. */
function mapGroup(layout: DockLayout, groupId: string, transform: (group: DockGroup) => DockGroup): DockLayout {
   const update = (column: DockColumn | null): DockColumn | null => {
      if (!column) return null
      let changed = false
      const groups = column.groups.map(group => {
         if (group.id !== groupId) return group
         changed = true
         return transform(group)
      })
      return changed ? { ...column, groups } : column
   }
   return { left: update(layout.left), right: update(layout.right) }
}

// ################
// # CONSTRUCTORS #
// ################

/** The default layout used when there is no stored one: Structure alone in a left dock, right empty.
 *  Pages is not in the default; the dock-state policy adds it to the right dock when it first applies. */
export function createDefaultDockLayout(structureGroupId: string): DockLayout {
   return {
      left:  { width: DEFAULT_COLUMN_WIDTH, groups: [makeGroup(structureGroupId, 'structure')] },
      right: null,
   }
}

// ###########
// # QUERIES #
// ###########

/** Where the panel currently sits, or null when it is not docked anywhere. */
export function locatePanel(layout: DockLayout, panelId: PanelId): PanelLocation | null {
   for (const side of DOCK_SIDES) {
      const column = layout[side]
      if (!column) continue
      for (let groupIndex = 0; groupIndex < column.groups.length; groupIndex++) {
         const group    = column.groups[groupIndex]
         const tabIndex = group.panels.indexOf(panelId)
         if (tabIndex !== -1) return { side, groupId: group.id, groupIndex, tabIndex }
      }
   }
   return null
}

export function isPanelDocked(layout: DockLayout, panelId: PanelId): boolean {
   return locatePanel(layout, panelId) !== null
}

/** Every panel currently in the layout, left column first (top-to-bottom), then right. */
export function dockedPanels(layout: DockLayout): PanelId[] {
   const result: PanelId[] = []
   for (const side of DOCK_SIDES) {
      const column = layout[side]
      if (!column) continue
      for (const group of column.groups) result.push(...group.panels)
   }
   return result
}

// ########################
// # STRUCTURAL TRANSFORMS #
// ########################

/** Docks a not-yet-docked panel as a new group at the bottom of a side's column. No-op if the panel
 *  is already docked (use a move transform to relocate it), which upholds the no-duplicates rule. */
export function addPanel(layout: DockLayout, panelId: PanelId, side: DockSide, newGroupId: string): DockLayout {
   if (isPanelDocked(layout, panelId)) return layout
   const endIndex = layout[side]?.groups.length ?? 0
   return insertNewGroup(layout, panelId, side, endIndex, newGroupId)
}

/** Removes a panel from the layout, pruning an emptied group and, in turn, an emptied column. */
export function removePanel(layout: DockLayout, panelId: PanelId): DockLayout {
   return detachPanel(layout, panelId)
}

/** Merges a panel into an existing group as a tab at `tabIndex`, making it that group's active tab.
 *  This is the "tabbing" reconfiguration. No-op when the target group no longer exists after detach
 *  (for example when the panel was alone in the very group it was asked to merge into). */
export function mergePanelIntoGroup(
   layout:        DockLayout,
   panelId:       PanelId,
   targetGroupId: string,
   tabIndex:      number,
): DockLayout {
   const detached = detachPanel(layout, panelId)
   const found    = findGroup(detached, targetGroupId)
   if (!found) return layout

   const { side, groupIndex } = found
   const column = detached[side]!
   const target = column.groups[groupIndex]
   const at     = clamp(tabIndex, 0, target.panels.length)

   const panels = [...target.panels]
   panels.splice(at, 0, panelId)

   const nextGroup: DockGroup = { ...target, panels, activePanel: panelId }
   const groups = column.groups.map((group, index) => (index === groupIndex ? nextGroup : group))
   return withSide(detached, side, { ...column, groups })
}

/** Moves a panel into its own new group at `columnIndex` within a side's column. This is the
 *  "superpose" reconfiguration (stacking a group above or below others). */
export function splitPanelToNewGroup(
   layout:      DockLayout,
   panelId:     PanelId,
   side:        DockSide,
   columnIndex: number,
   newGroupId:  string,
): DockLayout {
   return insertNewGroup(detachPanel(layout, panelId), panelId, side, columnIndex, newGroupId)
}

/** Moves a panel to the other dock as its own group at the bottom of that side's column. The
 *  overflow-menu "Move to left / right dock" action. */
export function movePanelToSide(layout: DockLayout, panelId: PanelId, side: DockSide, newGroupId: string): DockLayout {
   const detached = detachPanel(layout, panelId)
   const endIndex = detached[side]?.groups.length ?? 0
   return insertNewGroup(detached, panelId, side, endIndex, newGroupId)
}

/** Changes which tab is active in a group. No-op if the panel is not in that group. */
export function setActiveTab(layout: DockLayout, groupId: string, panelId: PanelId): DockLayout {
   return mapGroup(layout, groupId, group =>
      group.panels.includes(panelId) ? { ...group, activePanel: panelId } : group,
   )
}

/** Reorders a tab within its group (drag-to-reorder support; index-clamped, no cross-group move). */
export function reorderTabInGroup(layout: DockLayout, groupId: string, fromIndex: number, toIndex: number): DockLayout {
   return mapGroup(layout, groupId, group => {
      const from = clamp(fromIndex, 0, group.panels.length - 1)
      const to   = clamp(toIndex,   0, group.panels.length - 1)
      if (from === to) return group
      const panels = [...group.panels]
      const [moved] = panels.splice(from, 1)
      panels.splice(to, 0, moved)
      return { ...group, panels }
   })
}

/** Flips a single group's collapsed state (per-group collapse). */
export function toggleGroupCollapsed(layout: DockLayout, groupId: string): DockLayout {
   return mapGroup(layout, groupId, group => ({ ...group, collapsed: !group.collapsed }))
}

// #####################
// # RESIZE TRANSFORMS #
// #####################

/** Sets a dock column's width in px, clamped to the allowed range. No-op if that side is empty. */
export function setColumnWidth(layout: DockLayout, side: DockSide, width: number): DockLayout {
   const column = layout[side]
   if (!column) return layout
   return withSide(layout, side, { ...column, width: clamp(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH) })
}

/** Sets a group's relative height weight (flex-grow). Kept positive so a group never fully collapses
 *  its own body by weight alone (use `toggleGroupCollapsed` for that). */
export function setGroupFlex(layout: DockLayout, groupId: string, flex: number): DockLayout {
   return mapGroup(layout, groupId, group => ({ ...group, flex: Math.max(MIN_GROUP_FLEX, flex) }))
}

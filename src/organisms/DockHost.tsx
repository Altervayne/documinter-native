// -- React Imports --
import { useState, Fragment } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, CSSProperties } from 'react'

// -- Icon Imports --
import {
   MoreVertical, ChevronUp, ChevronDown, X,
   PanelLeft, PanelRight, PanelLeftClose, PanelRightClose, PanelLeftOpen, PanelRightOpen,
   Rows2, Combine, PictureInPicture2,
} from 'lucide-react'

// -- Molecule / Lib / Hook / Context Imports --
import { ContextMenu, type ContextMenuEntry } from '../molecules/ContextMenu'
import { PANEL_REGISTRY } from '../lib/panelRegistry'
import type { DockLayout, DockColumn, DockGroup, DockSide, PanelId } from '../lib/dockLayout'
import type { DockStateResult } from '../hooks/useDockState'
import { useLang } from '../contexts/LangContext'
import type { T } from '../lib/i18n'

// #########
// # TYPES #
// #########

/** Where a dragged tab would land, resolved by group id so an index shift after detaching the panel
 *  can never misplace it. `emptySide` is the edge-rail drop onto a currently empty dock, `dockSide` is
 *  a drop over a populated dock's empty area (append as a new group at the bottom), `float` is the
 *  center drop that pops the panel out as a window, and `cancel` is the neutral no-op zone over the
 *  panel's own group (its center / its icon). */
export type DockDropTarget =
   | { kind: 'merge';     groupId: string }
   | { kind: 'adjacent';  groupId: string; position: 'before' | 'after' }
   | { kind: 'emptySide'; side: DockSide }
   | { kind: 'dockSide';  side: DockSide }
   | { kind: 'float' }
   | { kind: 'cancel';    groupId: string }

// A group's drop bands by fraction of its height: above (new group before), merge (add as a tab), and
// below (new group after). Shared with the hit-testing in DockedWorkspace so the drawn zone and the
// resolved target always agree.
export const DROP_BEFORE_MAX = 0.36
export const DROP_AFTER_MIN  = 0.64

/** The drag state + callbacks the DockedWorkspace shares with both DockHosts, so a tab dragged out of
 *  one dock can land in the other. */
export interface DockDragApi {
   draggingPanelId:  PanelId | null
   dropTarget:       DockDropTarget | null
   /** Begin a tab press: the workspace decides click-to-activate vs drag by an activation distance. */
   onTabPointerDown: (panelId: PanelId, groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
   /** A group reports its rendered element (or null on unmount) for pointer hit-testing during a drag. */
   registerGroup:    (groupId: string, element: HTMLElement | null) => void
   /** A dock reports its rendered aside (or null on unmount), so a drop over its empty area docks there. */
   registerDock:     (side: DockSide, element: HTMLElement | null) => void
}

interface DockHostProps {
   side:        DockSide
   layout:      DockLayout
   /** Rendered panel bodies keyed by id, supplied by App (mirrors WorkspaceLayout's `panels` record). */
   panelBodies: Record<PanelId, ReactNode>
   actions:     DockStateResult
   drag:        DockDragApi
}

// ##################
// # SMALL HELPERS  #
// ##################

const CLAMP_MIN_FRACTION = 0.15
const CLAMP_MAX_FRACTION = 0.85

function clampFraction(value: number): number {
   return Math.max(CLAMP_MIN_FRACTION, Math.min(value, CLAMP_MAX_FRACTION))
}

/** Every group across both docks, so the config menu can offer "merge into" the other groups. */
function allGroups(layout: DockLayout): DockGroup[] {
   return [...(layout.left?.groups ?? []), ...(layout.right?.groups ?? [])]
}

// #############
// # COMPONENT #
// #############

/**
 * Renders one side's dock: a resizable column of groups, each a tabbed container of panel bodies, with
 * per-group and whole-dock collapse and a config menu for menu-driven reconfiguration (move to the
 * other dock, split into its own group, merge into another group, collapse, close). The panel bodies
 * are supplied by App; this component owns only the dock chrome. Drag-and-drop and the config menu are
 * the two ways to reconfigure the layout.
 */
export function DockHost({ side, layout, panelBodies, actions, drag }: DockHostProps) {
   const column = layout[side]
   if (!column) return null

   if (column.collapsed) {
      return <CollapsedDockRail side={side} column={column} actions={actions} drag={drag} />
   }

   const borderClass = side === 'left' ? 'border-r' : 'border-l'

   const rail = <DockRail side={side} column={column} actions={actions} drag={drag} />
   const content = (
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
         {column.groups.map((group, groupIndex) => {
            // The resize handle only exists between two EXPANDED neighbours: the only case where
            // dragging changes anything (a collapsed group is a fixed-height header, a lone expanded
            // group already fills). When it is hidden, a static top border marks the boundary between
            // groups instead (a 4px bg-border line).
            const showDivider = groupIndex > 0 && !group.collapsed && !column.groups[groupIndex - 1].collapsed
            return (
            <div
               key={group.id}
               className={`flex flex-col overflow-hidden${groupIndex > 0 && !showDivider ? ' border-t border-border' : ''}`}
               style={groupFlexStyle(group)}
            >
               {showDivider && (
                  <GroupDivider
                     onResize={(upperFraction) => {
                        actions.setGroupFlex(column.groups[groupIndex - 1].id, upperFraction)
                        actions.setGroupFlex(group.id, 1 - upperFraction)
                     }}
                  />
               )}
               <DockGroupContent
                  group={group}
                  side={side}
                  layout={layout}
                  groupIndex={groupIndex}
                  body={panelBodies[group.activePanel]}
                  actions={actions}
                  drag={drag}
               />
            </div>
            )
         })}
      </div>
   )

   return (
      <aside
         ref={(element) => drag.registerDock(side, element)}
         style={{ width: column.width }}
         className={`relative shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex h-full overflow-hidden`}
      >
         {/* Rail on the INNER edge (toward the center): left dock -> rail on the right, right dock -> left. */}
         {side === 'left' ? <>{content}{rail}</> : <>{rail}{content}</>}

         <WidthDivider side={side} onResize={(width) => actions.setColumnWidth(side, width)} />
         <DockDropOverlay side={side} drag={drag} />
      </aside>
   )
}

// ##########################
// # DOCK DROP OVERLAY      #
// ##########################

/** A full-dock wash shown while dragging over a populated dock's empty area (below / around its group
 *  headers), where releasing docks the panel as a new group at the bottom. This is what gives a dock
 *  of all-collapsed groups a large, reachable drop target instead of slivers on each tiny header. */
function DockDropOverlay({ side, drag }: { side: DockSide; drag: DockDragApi }) {
   const target = drag.dropTarget
   if (drag.draggingPanelId === null || target === null) return null
   if (target.kind !== 'dockSide' || target.side !== side) return null
   return <div className="absolute inset-1 z-40 pointer-events-none rounded-md border-2 border-dashed border-accent bg-accent/15" />
}

// ##########################
// # DOCK RAIL (SPINE)      #
// ##########################

/** The dock's persistent icon rail on its inner edge: the whole-dock collapse button at the top, then
 *  every panel's icon (grouped, active one highlighted). Always present, so the tab icons stay visible
 *  and switchable even when a group's body is collapsed. Each icon is a tab selector (click) and a drag
 *  handle (drag past the threshold to reconfigure). */
function DockRail({ side, column, actions, drag }: { side: DockSide; column: DockColumn; actions: DockStateResult; drag: DockDragApi }) {
   const { t } = useLang()
   const CollapseDockIcon = side === 'left' ? PanelLeftClose : PanelRightClose
   // The rail's border faces the content column: left dock -> content is to the rail's left (border-l),
   // right dock -> content is to the rail's right (border-r).
   const borderClass = side === 'left' ? 'border-l' : 'border-r'

   return (
      <div className={`shrink-0 flex flex-col items-center gap-1 p-1 ${borderClass} border-border`}>
         {/* Whole-dock collapse, at the top of the rail. */}
         <button
            onClick={() => actions.toggleColumnCollapsed(side)}
            title={t.dockCollapseDock}
            aria-label={t.dockCollapseDock}
            className="shrink-0 text-muted hover:text-accent p-1.5 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
         >
            <CollapseDockIcon size={16} />
         </button>

         <div className="w-5 h-px bg-border shrink-0" />

         <div role="tablist" className="flex flex-col items-center gap-1">
            {column.groups.map((group, groupIndex) => (
               <Fragment key={group.id}>
                  {groupIndex > 0 && <div className="w-4 h-px bg-border/50 my-0.5 shrink-0" />}
                  {group.panels.map((panelId) => {
                     const descriptor = PANEL_REGISTRY[panelId]
                     const isActive   = panelId === group.activePanel
                     return (
                        <button
                           key={panelId}
                           role="tab"
                           aria-selected={isActive}
                           title={descriptor.title(t)}
                           aria-label={descriptor.title(t)}
                           onPointerDown={(event) => drag.onTabPointerDown(panelId, group.id, event)}
                           className={[
                              'w-7 h-7 flex items-center justify-center rounded-md cursor-grab border-0 transition-colors touch-none select-none shrink-0',
                              isActive ? 'text-accent bg-accent/10' : 'text-muted/60 hover:text-text hover:bg-accent/8 bg-transparent',
                           ].join(' ')}
                        >
                           {descriptor.icon}
                        </button>
                     )
                  })}
               </Fragment>
            ))}
         </div>
      </div>
   )
}

function groupFlexStyle(group: DockGroup): CSSProperties {
   // A collapsed group shrinks to just its header.
   if (group.collapsed) return { flex: '0 0 auto' }
   // Expanded groups share the column by flex weight. Two subtleties:
   //  - Guard a missing `flex` (an older or partial layout): default to 1, else `flex: undefined 1 0` is invalid.
   //  - Scale the grow factor by 100 so it is always >= 1. A divider stores fractional weights (for
   //    example 0.47 / 0.53) that sum to 1 only while both groups are expanded; once a sibling collapses
   //    (grow goes to 0), a lone 0.47 grow is under 1, and CSS flexbox distributes only 47% of the free
   //    space, leaving a large blank below. Scaling keeps the ratio between expanded groups but the
   //    sum >= 1 (fills).
   const weight = group.flex && group.flex > 0 ? group.flex : 1
   return { flex: `${weight * 100} 1 0`, minHeight: 0 }
}

// #################
// # ONE GROUP     #
// #################

interface DockGroupContentProps {
   group:      DockGroup
   side:       DockSide
   layout:     DockLayout
   groupIndex: number
   body:       ReactNode
   actions:    DockStateResult
   drag:       DockDragApi
}

/** One group's content column: a header (active tab identity as a drag handle, an always-present group
 *  collapse/expand button, and the config menu) plus the active panel's body when expanded. The tab
 *  icons live in the dock-level DockRail, not here; the whole-dock collapse lives at the rail's top.
 *  This element is what the drag hit-test registers, so its rect defines the group's drop bands. */
function DockGroupContent({ group, side, layout, groupIndex, body, actions, drag }: DockGroupContentProps) {
   const { t } = useLang()
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   const activeDescriptor = PANEL_REGISTRY[group.activePanel]

   function openConfigMenu(event: ReactMouseEvent<HTMLButtonElement>) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenuPosition({ x: rect.left, y: rect.bottom + 4 })
   }

   return (
      <div
         ref={(element) => drag.registerGroup(group.id, element)}
         className="relative flex flex-col overflow-hidden flex-1 min-h-0"
      >
         {/* Header adopts the active tab's icon + label (the group's identity), which doubles as a drag
             handle for the active panel. Same height for every group, so headers never mismatch. */}
         <div className="flex items-center h-9 pl-2 pr-1 border-b border-border shrink-0 gap-1">
            <button
               onPointerDown={(event) => drag.onTabPointerDown(group.activePanel, group.id, event)}
               title={activeDescriptor.title(t)}
               className="flex-1 flex items-center gap-1.5 min-w-0 text-left cursor-grab border-0 bg-transparent touch-none select-none"
            >
               <span className="shrink-0 text-accent">{activeDescriptor.icon}</span>
               <span className="truncate text-xs font-semibold text-text">{activeDescriptor.title(t)}</span>
            </button>

            {/* Per-group collapse, always available (not only via the config menu). */}
            <button
               onClick={() => actions.toggleGroupCollapsed(group.id)}
               title={group.collapsed ? t.dockExpandGroup : t.dockCollapseGroup}
               aria-label={group.collapsed ? t.dockExpandGroup : t.dockCollapseGroup}
               className="shrink-0 text-muted hover:text-accent p-1 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
            >
               {group.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>

            <button
               onClick={openConfigMenu}
               title={t.dockConfigMenu}
               aria-label={t.dockConfigMenu}
               className="shrink-0 text-muted hover:text-accent p-1 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
            >
               <MoreVertical size={15} />
            </button>
         </div>

         {!group.collapsed && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
               {body}
            </div>
         )}

         {menuPosition && (
            <ContextMenu
               position={menuPosition}
               entries={buildConfigEntries(group, side, groupIndex, layout, actions, t)}
               onClose={() => setMenuPosition(null)}
            />
         )}

         <GroupDropOverlay groupId={group.id} drag={drag} />
      </div>
   )
}

// ##########################
// # DROP OVERLAY           #
// ##########################

/** The highlight shown on a group that is the current drag drop target: a full-group wash for a merge
 *  (drop onto the tab strip), or a thin insertion bar at the top / bottom edge for an adjacent drop
 *  (a new group above / below). */
function GroupDropOverlay({ groupId, drag }: { groupId: string; drag: DockDragApi }) {
   const target = drag.dropTarget
   if (drag.draggingPanelId === null || target === null) return null
   if (target.kind === 'emptySide' || target.kind === 'dockSide' || target.kind === 'float') return null
   if (target.groupId !== groupId) return null

   // The panel's own group: a neutral "release to cancel" wash, so a no-op drop reads as intentional.
   if (target.kind === 'cancel') {
      return <div className="absolute inset-0 z-30 pointer-events-none rounded-sm border-2 border-dashed border-muted/40 bg-muted/15" />
   }

   // A full filled band showing exactly where the panel will land: above / merge (center) / below.
   const bandStyle: CSSProperties =
      target.kind === 'merge'        ? { top: `${DROP_BEFORE_MAX * 100}%`, bottom: `${(1 - DROP_AFTER_MIN) * 100}%` }
      : target.position === 'before' ? { top: 0,    height: `${DROP_BEFORE_MAX * 100}%` }
      :                                { bottom: 0, height: `${(1 - DROP_AFTER_MIN) * 100}%` }

   return <div className="absolute left-0 right-0 z-30 pointer-events-none border-2 border-accent/50 bg-accent/20 rounded-sm" style={bandStyle} />
}

// ##########################
// # CONFIG-MENU ENTRIES    #
// ##########################

/** The reconfiguration options for a group, acting on its active tab. */
function buildConfigEntries(
   group:      DockGroup,
   side:       DockSide,
   groupIndex: number,
   layout:     DockLayout,
   actions:    DockStateResult,
   t:          T,
): ContextMenuEntry[] {
   const activePanel = group.activePanel
   const otherSide: DockSide = side === 'left' ? 'right' : 'left'
   const entries: ContextMenuEntry[] = []

   // ===== Move to the other dock =====
   entries.push({
      label:    otherSide === 'left' ? t.dockMoveToLeftDock : t.dockMoveToRightDock,
      icon:     otherSide === 'left' ? <PanelLeft size={13} /> : <PanelRight size={13} />,
      onSelect: () => actions.movePanelToSide(activePanel, otherSide),
   })

   // ===== Split a tabbed panel into its own group (only meaningful when the group has tabs) =====
   if (group.panels.length > 1) {
      entries.push({
         label:    t.dockSplitToNewGroup,
         icon:     <Rows2 size={13} />,
         onSelect: () => actions.splitPanelToNewGroup(activePanel, side, groupIndex + 1),
      })
   }

   // ===== Merge into any other group (tabbing) =====
   for (const target of allGroups(layout)) {
      if (target.id === group.id) continue
      entries.push({
         label:    `${t.dockMergeIntoPrefix} ${PANEL_REGISTRY[target.activePanel].title(t)}`,
         icon:     <Combine size={13} />,
         onSelect: () => actions.mergePanelIntoGroup(activePanel, target.id, target.panels.length),
      })
   }

   // ===== Pop out into a floating window =====
   if (PANEL_REGISTRY[activePanel].canFloat) {
      entries.push({
         label:    t.dockPopOut,
         icon:     <PictureInPicture2 size={13} />,
         onSelect: () => actions.floatPanel(activePanel),
      })
   }

   entries.push({ type: 'separator' })

   entries.push({
      label:    group.collapsed ? t.dockExpandGroup : t.dockCollapseGroup,
      icon:     group.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />,
      onSelect: () => actions.toggleGroupCollapsed(group.id),
   })
   entries.push({
      label:    t.dockCollapseDock,
      icon:     side === 'left' ? <PanelLeftClose size={13} /> : <PanelRightClose size={13} />,
      onSelect: () => actions.toggleColumnCollapsed(side),
   })

   entries.push({ type: 'separator' })

   entries.push({
      label:    t.dockClosePanel,
      icon:     <X size={13} />,
      danger:   true,
      onSelect: () => actions.togglePanelVisibility(activePanel),
   })

   return entries
}

// ##########################
// # COLLAPSED DOCK RAIL    #
// ##########################

interface CollapsedDockRailProps {
   side:    DockSide
   column:  DockColumn
   actions: DockStateResult
   drag:    DockDragApi
}

function CollapsedDockRail({ side, column, actions, drag }: CollapsedDockRailProps) {
   const { t } = useLang()
   const ExpandIcon  = side === 'left' ? PanelLeftOpen : PanelRightOpen
   const borderClass = side === 'left' ? 'border-r' : 'border-l'
   const panels      = column.groups.flatMap((group) => group.panels)

   return (
      <aside
         ref={(element) => drag.registerDock(side, element)}
         style={{ width: '2.5rem' }}
         className={`relative shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex flex-col items-center p-2 gap-1 h-full overflow-hidden`}
      >
         <DockDropOverlay side={side} drag={drag} />
         <button
            onClick={() => actions.toggleColumnCollapsed(side)}
            title={t.dockExpandDock}
            aria-label={t.dockExpandDock}
            className="text-muted hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
         >
            <ExpandIcon size={18} />
         </button>

         {/* One icon per docked panel; clicking expands the dock and shows that panel. */}
         {panels.map((panelId) => {
            const descriptor = PANEL_REGISTRY[panelId]
            const groupId    = column.groups.find((group) => group.panels.includes(panelId))?.id
            return (
               <button
                  key={panelId}
                  onClick={() => {
                     if (groupId) actions.setActiveTab(groupId, panelId)
                     actions.toggleColumnCollapsed(side)
                  }}
                  title={descriptor.title(t)}
                  aria-label={descriptor.title(t)}
                  className="text-muted/70 hover:text-accent p-2 rounded-lg hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
               >
                  {descriptor.icon}
               </button>
            )
         })}
      </aside>
   )
}

// ##########################
// # DIVIDERS               #
// ##########################

/** The column-width resize handle on the dock's inner edge (facing the center workspace). */
function WidthDivider({ side, onResize }: { side: DockSide; onResize: (width: number) => void }) {
   function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
   }
   function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const asideRect = event.currentTarget.parentElement!.getBoundingClientRect()
      const width = side === 'left' ? event.clientX - asideRect.left : asideRect.right - event.clientX
      onResize(width)
   }
   function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      event.currentTarget.releasePointerCapture(event.pointerId)
   }

   const edgeClass = side === 'left' ? 'right-0' : 'left-0'
   return (
      <div
         className={`absolute top-0 bottom-0 ${edgeClass} w-1 z-10 cursor-col-resize bg-transparent hover:bg-accent/60 transition-colors select-none touch-none`}
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
      />
   )
}

/** The height resize handle between two stacked groups. `onResize` already targets the correct pair
 *  of groups (it is bound at the call site), so this only reports the pointer's fraction of the column. */
function GroupDivider({ onResize }: { onResize: (upperFraction: number) => void }) {
   function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
   }
   function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      // The divider sits inside the upper group's wrapper; the dock column is two levels up.
      const columnRect = event.currentTarget.closest('aside')?.getBoundingClientRect()
      if (!columnRect) return
      onResize(clampFraction((event.clientY - columnRect.top) / columnRect.height))
   }
   function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      event.currentTarget.releasePointerCapture(event.pointerId)
   }

   return (
      <div
         className="shrink-0 h-1 cursor-row-resize bg-border hover:bg-accent/60 transition-colors select-none touch-none"
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
      />
   )
}

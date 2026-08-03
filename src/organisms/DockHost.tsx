// -- React Imports --
import { useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent, CSSProperties } from 'react'

// -- Icon Imports --
import {
   MoreVertical, ChevronUp, ChevronDown, X,
   PanelLeft, PanelRight, PanelLeftClose, PanelRightClose, PanelLeftOpen, PanelRightOpen,
   Rows2, Combine,
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

interface DockHostProps {
   side:        DockSide
   layout:      DockLayout
   /** Rendered panel bodies keyed by id, supplied by App (mirrors WorkspaceLayout's `panels` record). */
   panelBodies: Record<PanelId, ReactNode>
   actions:     DockStateResult
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
 * per-group and whole-dock collapse and a config menu for the menu-driven reconfiguration (move to the
 * other dock, split into its own group, merge into another group, collapse, close). The panel bodies
 * are supplied by App; this component owns only the dock chrome. Drag-and-drop reconfiguration comes in
 * Phase 2; the config menu stays permanently as the second way to reconfigure.
 */
export function DockHost({ side, layout, panelBodies, actions }: DockHostProps) {
   const column = layout[side]
   if (!column) return null

   if (column.collapsed) {
      return <CollapsedDockRail side={side} column={column} actions={actions} />
   }

   const borderClass = side === 'left' ? 'border-r' : 'border-l'

   return (
      <aside
         style={{ width: column.width }}
         className={`relative shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex flex-col h-full overflow-hidden`}
      >
         {column.groups.map((group, groupIndex) => (
            <div key={group.id} className="flex flex-col overflow-hidden" style={groupFlexStyle(group)}>
               {groupIndex > 0 && (
                  <GroupDivider
                     onResize={(upperFraction) => {
                        actions.setGroupFlex(column.groups[groupIndex - 1].id, upperFraction)
                        actions.setGroupFlex(group.id, 1 - upperFraction)
                     }}
                  />
               )}
               <DockGroupView
                  group={group}
                  side={side}
                  layout={layout}
                  groupIndex={groupIndex}
                  body={panelBodies[group.activePanel]}
                  actions={actions}
               />
            </div>
         ))}

         <WidthDivider side={side} onResize={(width) => actions.setColumnWidth(side, width)} />
      </aside>
   )
}

function groupFlexStyle(group: DockGroup): CSSProperties {
   // A collapsed group shrinks to just its header; an expanded one shares the column by its flex weight.
   return group.collapsed ? { flex: '0 0 auto' } : { flex: `${group.flex} 1 0`, minHeight: 0 }
}

// #################
// # ONE GROUP     #
// #################

interface DockGroupViewProps {
   group:      DockGroup
   side:       DockSide
   layout:     DockLayout
   groupIndex: number
   body:       ReactNode
   actions:    DockStateResult
}

function DockGroupView({ group, side, layout, groupIndex, body, actions }: DockGroupViewProps) {
   const { t } = useLang()
   const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

   function openConfigMenu(event: ReactPointerEvent<HTMLButtonElement>) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenuPosition({ x: rect.left, y: rect.bottom + 4 })
   }

   return (
      <div className="flex flex-col overflow-hidden flex-1 min-h-0">
         {/* Header: tab strip + collapse + config. One shared header for every group, so headers are
             always the same height (this is what fixes the old two-panel header mismatch). */}
         <div className="flex items-center h-9 pl-1.5 pr-1 border-b border-border shrink-0 gap-1">
            <div className="flex-1 flex items-center gap-0.5 overflow-hidden" role="tablist">
               {group.panels.map((panelId) => {
                  const descriptor = PANEL_REGISTRY[panelId]
                  const isActive   = panelId === group.activePanel
                  return (
                     <button
                        key={panelId}
                        role="tab"
                        aria-selected={isActive}
                        title={descriptor.title(t)}
                        onClick={() => actions.setActiveTab(group.id, panelId)}
                        className={[
                           'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer border-0 transition-colors min-w-0',
                           isActive
                              ? 'text-accent bg-accent/10'
                              : 'text-muted/70 hover:text-text hover:bg-accent/8 bg-transparent',
                        ].join(' ')}
                     >
                        <span className="shrink-0">{descriptor.icon}</span>
                        <span className="truncate">{descriptor.title(t)}</span>
                     </button>
                  )
               })}
            </div>

            <button
               onClick={() => actions.toggleGroupCollapsed(group.id)}
               title={group.collapsed ? t.dockExpandGroup : t.dockCollapseGroup}
               aria-label={group.collapsed ? t.dockExpandGroup : t.dockCollapseGroup}
               className="shrink-0 text-muted hover:text-accent p-1 rounded-md hover:bg-accent/8 cursor-pointer border-0 bg-transparent transition-colors"
            >
               {group.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>

            <button
               onPointerDown={openConfigMenu}
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
      </div>
   )
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
      onSelect: () => actions.togglePanel(activePanel),
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
}

function CollapsedDockRail({ side, column, actions }: CollapsedDockRailProps) {
   const { t } = useLang()
   const ExpandIcon  = side === 'left' ? PanelLeftOpen : PanelRightOpen
   const borderClass = side === 'left' ? 'border-r' : 'border-l'
   const panels      = column.groups.flatMap((group) => group.panels)

   return (
      <aside
         style={{ width: '2.5rem' }}
         className={`shrink-0 bg-raised ${borderClass} border-border border-t-2 border-t-accent/30 flex flex-col items-center p-2 gap-1 h-full overflow-hidden`}
      >
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

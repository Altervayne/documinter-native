// -- React Imports --
import { useState } from 'react'
import type React from 'react'

// -- DnD Imports --
import {
   DndContext, closestCenter,
   PointerSensor, useSensor, useSensors,
   type DragEndEvent, type Modifier,
} from '@dnd-kit/core'
import {
   SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Library Imports --
import { GripVertical, X } from 'lucide-react'

// -- Lib Imports --
import type { GraphSpec, GraphTheme, ScatterPlot, ScatterPoint } from '../lib/graph'
import { resolveSeriesColor, MAX_SERIES } from '../lib/graph'
import {
   addScatterSeries,
   removeScatterSeries,
   insertScatterSeriesAt,
   moveScatterSeries,
   setScatterSeriesName,
   setScatterSeriesColor,
   addScatterPoint,
   removeScatterPoint,
   insertScatterPointAt,
   moveScatterPoint,
   setScatterPointField,
} from '../lib/graphEdit'
import type { T } from '../lib/i18n'

// -- Molecule Imports --
import { GraphSeriesColorPopover } from './GraphDataGrid'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

// #############
// # CONSTANTS #
// #############

/** Positional sortable id prefixes. A scatter series carries a `scatter-series-<index>` synthetic
 *  id (series have no stable model id); each point carries a `scatter-point-<index>` id WITHIN its
 *  series' own DndContext (isolated per series, so a bare point index suffices, the series index is
 *  captured in the drag-end closure). onDragEnd parses the trailing index back into the helper. */
const SCATTER_SERIES_ID_PREFIX = 'scatter-series-'
const SCATTER_POINT_ID_PREFIX  = 'scatter-point-'

/** A single-axis lock shared by both sortable levels: every scatter drag (series block OR point row)
 *  glides VERTICALLY only (x pinned), without depending on `@dnd-kit/modifiers` (not installed). */
const LOCK_VERTICAL_MODIFIER: Modifier = ({ transform }) => ({ ...transform, x: 0 })

// ###########
// # HELPERS #
// ###########

/**
 * Parse a clipboard payload as delimited rows: split on newlines (normalizing CRLF/CR, dropping a
 * single trailing newline), then each row on TAB or COMMA, so a scatter paste accepts spreadsheet
 * TSV, comma-separated `x,y`, or newline-separated single x values. Returns [] for an empty payload.
 * Never throws.
 */
function parseScatterClipboard(text: string): string[][] {
   const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
   if (normalized === '') return []
   return normalized.split('\n').map(line => line.split(/[\t,]/))
}

/** Whether a parsed grid spans more than one cell (so it is a paste worth expanding into). */
function isMultiCellPaste(grid: string[][]): boolean {
   return grid.length > 1 || grid.some(row => row.length > 1)
}

/**
 * Parse one pasted cell into a finite `number`, or `NaN` for an empty / non-numeric cell (the
 * blank-gap seed the renderer + fence serializer both skip). Surrounding whitespace and thousands-
 * grouping is not stripped beyond a trim, a comma is a COLUMN delimiter here, not a grouping mark.
 */
function parsePointNumber(raw: string): number {
   const trimmed = raw.trim()
   if (trimmed === '') return NaN
   const parsed = Number(trimmed)
   return Number.isFinite(parsed) ? parsed : NaN
}

// #########
// # TYPES #
// #########

/** The drag-handle wiring a sortable series/point hands back to its grip: the activator ref + the
 *  ARIA/listener props dnd-kit needs on the grab affordance (mirrors GraphDataGrid). */
type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'>

/** The open right-click menu: a whole series head, or one point row within a series. `pointIndex` is
 *  unused for a `series` menu. Anchored at the click point. */
interface ScatterContextMenu {
   kind:        'series' | 'point'
   seriesIndex: number
   pointIndex:  number
   x:           number
   y:           number
}

interface ScatterEditorProps {
   /** The live working spec (GraphBlock's local draft); the editor renders from + edits this. */
   spec:  GraphSpec
   /** Resolved chart theme, so a swatch shows the real palette slot color a series draws in. */
   theme: GraphTheme
   /** UI strings. */
   t:     T
   /** Mark an edit in progress (guards GraphBlock's external-sync from clobbering typing). */
   onEditStart:   () => void
   /** Apply a spec edit to the live draft WITHOUT committing to the document (text/number typing). */
   onDraft:       (next: GraphSpec) => void
   /** Apply a spec edit AND commit it to the document (discrete: add/remove/color). */
   onCommit:      (next: GraphSpec) => void
   /** Commit the current working spec to the document (fired on a text/number input blur). */
   onCommitField: () => void
}

/** A safe fallback so the editor never operates on an undefined scatterPlot. In practice
 *  `graphEdit.setType` seeds a real scatterPlot the moment a spec switches to `scatter`, so this
 *  is a defensive-only backstop, never the normal path. */
const FALLBACK_SCATTER_PLOT: ScatterPlot = { series: [{ name: '', points: [{ x: 0, y: 0 }] }] }

/** Which (series, point, field) numeric cell is being typed into, holding its raw text so an
 *  unparseable intermediate ("-", "1.") stays on screen without corrupting the stored value,
 *  mirrors GraphDataGrid's `EditingCell` / EquationEditor's `EditingDomainField`. */
interface EditingPointField {
   seriesIndex: number
   pointIndex:  number
   field:       'x' | 'y'
   text:        string
   invalid:     boolean
}

/** Which series' color popover is open, and the swatch rect that anchors it. */
interface ScatterColorTarget {
   index: number
   rect:  DOMRect
}

// #####################
// # SORTABLE WRAPPERS  #
// #####################

interface SortableScatterSeriesProps {
   seriesIndex: number
   /** Render the series block; receives the grip wiring to place on the heading's drag handle. */
   children:    (handle: DragHandleProps) => React.ReactNode
}

/**
 * A whole scatter series block made vertically sortable. The block is the sortable NODE; only the
 * grip on the heading bar carries the drag listeners (render-prop `handle`), so typing in the name
 * or any point cell never starts a series reorder. A raised z-index while dragging keeps the lifted
 * block above its neighbors (mirrors GraphDataGrid's SortableSeriesHeader). The series right-click
 * menu is bound to the heading bar (not this whole block) so a point-row right-click, nested inside
 * the same block, never also resolves to the series menu.
 */
function SortableScatterSeries({ seriesIndex, children }: SortableScatterSeriesProps) {
   const { setNodeRef, transform, transition, isDragging, attributes, listeners, setActivatorNodeRef } =
      useSortable({ id: `${SCATTER_SERIES_ID_PREFIX}${seriesIndex}` })
   const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      zIndex:  isDragging ? 5 : undefined,
   }
   return (
      <div
         ref={setNodeRef}
         style={style}
         className={`graph-editor-group${isDragging ? ' graph-col-dragging' : ''}`}
      >
         {children({ attributes, listeners, setActivatorNodeRef })}
      </div>
   )
}

interface SortableScatterPointProps {
   pointIndex:    number
   /** Right-click the point row opens the point context menu. */
   onContextMenu: (event: React.MouseEvent) => void
   /** Render the point row; receives the grip wiring to place on the leading drag handle. */
   children:      (handle: DragHandleProps) => React.ReactNode
}

/**
 * One point row made vertically sortable within its series' own DndContext. The row is the sortable
 * NODE; only the leading grip carries the drag listeners, so typing in the X/Y cells never starts a
 * reorder (mirrors SortableEquationRow). The bare point index is a safe id because each series hosts
 * its OWN DndContext, so ids never collide across series.
 */
function SortableScatterPoint({ pointIndex, onContextMenu, children }: SortableScatterPointProps) {
   const { setNodeRef, transform, transition, isDragging, attributes, listeners, setActivatorNodeRef } =
      useSortable({ id: `${SCATTER_POINT_ID_PREFIX}${pointIndex}` })
   const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
   }
   return (
      <div
         ref={setNodeRef}
         style={style}
         className={`graph-scatter-point-row${isDragging ? ' graph-row-dragging' : ''}`}
         onContextMenu={onContextMenu}
      >
         {children({ attributes, listeners, setActivatorNodeRef })}
      </div>
   )
}

// #############
// # COMPONENT #
// #############

/**
 * The Data-tab editor for a `scatter` chart: one block per series (color swatch + name + a small
 * X/Y numeric grid of that series' points, with add/remove point) followed by a "+ Series" footer,
 * replacing `GraphDataGrid` for this type, a scatter series has no categories and no shared
 * domain, so it earns its own dedicated surface (mirrors `EquationEditor`'s layout, one block per
 * SERIES here instead of one row per equation).
 *
 * Draft/commit model exactly like `EquationEditor`/`GraphDataGrid`: numeric x/y typing drafts on
 * every keystroke (instant preview) and commits on blur; add/remove/color commit immediately.
 * v1 is points-only, no per-series trendline (a deferred fast-follow, not built here).
 */
export function ScatterEditor({ spec, theme, t, onEditStart, onDraft, onCommit, onCommitField }: ScatterEditorProps) {
   const scatterPlot = spec.scatterPlot ?? FALLBACK_SCATTER_PLOT
   const { series } = scatterPlot

   // The one (series, point, field) numeric cell mid-edit (see EditingPointField above).
   const [editingPoint, setEditingPoint] = useState<EditingPointField | null>(null)
   // Which series' swatch color popover is open.
   const [colorPopover, setColorPopover] = useState<ScatterColorTarget | null>(null)
   // Which series-head / point-row right-click menu is open (null = none), and where it was invoked.
   const [contextMenu, setContextMenu] = useState<ScatterContextMenu | null>(null)

   // One pointer sensor with a 5px activation threshold (matching the grid), shared by both sortable
   // levels so a click on a grip that doesn't move never registers as a drag.
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   // ================
   //  Point x/y fields
   // ================
   function pointFieldText(seriesIndex: number, pointIndex: number, field: 'x' | 'y', value: number): string {
      if (editingPoint
         && editingPoint.seriesIndex === seriesIndex
         && editingPoint.pointIndex === pointIndex
         && editingPoint.field === field) return editingPoint.text
      // A blank-seeded point (non-finite x/y) renders as an empty field, the muted "–" placeholder
      // then reads it as a gap to type over, not a literal "0" to select-and-overwrite.
      return Number.isFinite(value) ? String(value) : ''
   }

   function pointFieldIsInvalid(seriesIndex: number, pointIndex: number, field: 'x' | 'y'): boolean {
      return !!editingPoint
         && editingPoint.seriesIndex === seriesIndex
         && editingPoint.pointIndex === pointIndex
         && editingPoint.field === field
         && editingPoint.invalid
   }

   function handlePointFieldChange(seriesIndex: number, pointIndex: number, field: 'x' | 'y', rawText: string): void {
      onEditStart()
      const trimmed = rawText.trim()
      const parsed = Number(trimmed)
      const isValid = trimmed !== '' && Number.isFinite(parsed)
      setEditingPoint({ seriesIndex, pointIndex, field, text: rawText, invalid: !isValid })
      // Only push a parseable number into the model; an intermediate like "1." or "-" keeps the raw
      // text visible (via editingPoint) but leaves the last valid value in place until it parses.
      if (isValid) onDraft(setScatterPointField(spec, seriesIndex, pointIndex, field, parsed))
   }

   function handlePointFieldBlur(): void {
      setEditingPoint(null)
      onCommitField()
   }

   // ================
   //  Color popover
   // ================
   function openColorPopover(index: number, rect: DOMRect): void {
      if (colorPopover && colorPopover.index === index) {
         setColorPopover(null)
         return
      }
      setColorPopover({ index, rect })
   }

   const activePopover = colorPopover && {
      value:   resolveSeriesColor(colorPopover.index, series[colorPopover.index]?.color, theme),
      onPick:  (hex: string) => onCommit(setScatterSeriesColor(spec, colorPopover.index, hex)),
      onReset: () => { onCommit(setScatterSeriesColor(spec, colorPopover.index, undefined)); setColorPopover(null) },
   }

   // ================
   //  Drag reorder (two levels: series blocks, and points within one series)
   // ================
   // The outer DndContext reorders the series blocks; the active/over ids share the series prefix.
   function handleSeriesDragEnd(event: DragEndEvent): void {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = Number(String(active.id).slice(SCATTER_SERIES_ID_PREFIX.length))
      const toIndex   = Number(String(over.id).slice(SCATTER_SERIES_ID_PREFIX.length))
      onCommit(moveScatterSeries(spec, fromIndex, toIndex))
   }

   // Each series hosts its OWN inner DndContext for its points; `seriesIndex` is captured here so the
   // bare point ids resolve to the right series (no cross-series id collision is possible).
   function handlePointDragEnd(seriesIndex: number, event: DragEndEvent): void {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = Number(String(active.id).slice(SCATTER_POINT_ID_PREFIX.length))
      const toIndex   = Number(String(over.id).slice(SCATTER_POINT_ID_PREFIX.length))
      onCommit(moveScatterPoint(spec, seriesIndex, fromIndex, toIndex))
   }

   // ================
   //  Context menu (series-head / point-row insert + delete)
   // ================
   function openSeriesMenu(event: React.MouseEvent, seriesIndex: number): void {
      event.preventDefault()
      setContextMenu({ kind: 'series', seriesIndex, pointIndex: 0, x: event.clientX, y: event.clientY })
   }

   function openPointMenu(event: React.MouseEvent, seriesIndex: number, pointIndex: number): void {
      event.preventDefault()
      setContextMenu({ kind: 'point', seriesIndex, pointIndex, x: event.clientX, y: event.clientY })
   }

   /** Insert-before / insert-after / delete for a series block. Inserts respect MAX_SERIES; delete is
    *  disabled at the last remaining series. */
   function seriesMenuEntries(seriesIndex: number): ContextMenuEntry[] {
      const atCap = series.length >= MAX_SERIES
      return [
         { label: t.graphInsertSeriesBefore, disabled: atCap, onSelect: () => onCommit(insertScatterSeriesAt(spec, seriesIndex)) },
         { label: t.graphInsertSeriesAfter,  disabled: atCap, onSelect: () => onCommit(insertScatterSeriesAt(spec, seriesIndex + 1)) },
         { type: 'separator' },
         { label: t.graphRemoveSeries, danger: true, disabled: series.length <= 1, onSelect: () => onCommit(removeScatterSeries(spec, seriesIndex)) },
      ]
   }

   /** Insert-before / insert-after / delete for a point row. Delete is disabled at the series' last
    *  remaining point. */
   function pointMenuEntries(seriesIndex: number, pointIndex: number): ContextMenuEntry[] {
      const pointCount = series[seriesIndex]?.points.length ?? 0
      return [
         { label: t.graphInsertPointBefore, onSelect: () => onCommit(insertScatterPointAt(spec, seriesIndex, pointIndex)) },
         { label: t.graphInsertPointAfter,  onSelect: () => onCommit(insertScatterPointAt(spec, seriesIndex, pointIndex + 1)) },
         { type: 'separator' },
         { label: t.graphRemovePoint, danger: true, disabled: pointCount <= 1, onSelect: () => onCommit(removeScatterPoint(spec, seriesIndex, pointIndex)) },
      ]
   }

   // ================
   //  Bulk paste (into the point grid)
   // ================
   // A paste over a point cell parses TSV / comma / newline rows as `x[<tab|comma>y]`, auto-appending
   // points downward from the FOCUSED row (never past MAX, a series has no point cap). A single value
   // falls through to normal typing. Non-numeric cells land as a NaN gap (the same blank seed a `+
   // Point` uses); a single-column paste fills x and leaves y blank. Applied over the pure transforms
   // and committed once, mirrors GraphDataGrid.handleMultiSeriesPaste.
   function handlePointPaste(event: React.ClipboardEvent<HTMLInputElement>, seriesIndex: number, focusPointIndex: number): void {
      const grid = parseScatterClipboard(event.clipboardData.getData('text/plain'))
      if (!isMultiCellPaste(grid)) return
      event.preventDefault()
      setEditingPoint(null)
      let next = spec
      for (let rowOffset = 0; rowOffset < grid.length; rowOffset++) {
         const pointIndex = focusPointIndex + rowOffset
         // Grow the series' point list until it reaches the target row (uncapped, points have no MAX).
         while (pointIndex >= (next.scatterPlot?.series[seriesIndex]?.points.length ?? 0)) {
            next = addScatterPoint(next, seriesIndex)
         }
         const cells = grid[rowOffset]
         next = setScatterPointField(next, seriesIndex, pointIndex, 'x', parsePointNumber(cells[0]))
         next = setScatterPointField(next, seriesIndex, pointIndex, 'y', cells.length >= 2 ? parsePointNumber(cells[1]) : NaN)
      }
      onCommit(next)
   }

   /** The grip affordance a sortable series/point hands its listeners to (mirrors GraphDataGrid). */
   function dragGrip(handle: DragHandleProps, ariaLabel: string): React.ReactElement {
      return (
         <span
            className="graph-drag-handle"
            ref={handle.setActivatorNodeRef}
            {...handle.attributes}
            {...handle.listeners}
            aria-label={ariaLabel}
            title={ariaLabel}
         >
            <GripVertical size={13} />
         </span>
      )
   }

   // ================
   //  Point rows
   // ================
   function pointRowContent(seriesIndex: number, pointIndex: number, point: ScatterPoint, pointCount: number, handle: DragHandleProps): React.ReactNode {
      const xInvalid = pointFieldIsInvalid(seriesIndex, pointIndex, 'x')
      const yInvalid = pointFieldIsInvalid(seriesIndex, pointIndex, 'y')
      return (
         <>
            {dragGrip(handle, t.graphReorderPoint)}
            <input
               className={`graph-text-input graph-scatter-point-input${xInvalid ? ' is-invalid' : ''}`}
               type="text"
               inputMode="decimal"
               placeholder="–"
               value={pointFieldText(seriesIndex, pointIndex, 'x', point.x)}
               aria-label={t.graphScatterX}
               aria-invalid={xInvalid || undefined}
               title={xInvalid ? t.graphInvalidNumber : undefined}
               onFocus={onEditStart}
               onChange={event => handlePointFieldChange(seriesIndex, pointIndex, 'x', event.target.value)}
               onPaste={event => handlePointPaste(event, seriesIndex, pointIndex)}
               onBlur={handlePointFieldBlur}
            />
            <input
               className={`graph-text-input graph-scatter-point-input${yInvalid ? ' is-invalid' : ''}`}
               type="text"
               inputMode="decimal"
               placeholder="–"
               value={pointFieldText(seriesIndex, pointIndex, 'y', point.y)}
               aria-label={t.graphScatterY}
               aria-invalid={yInvalid || undefined}
               title={yInvalid ? t.graphInvalidNumber : undefined}
               onFocus={onEditStart}
               onChange={event => handlePointFieldChange(seriesIndex, pointIndex, 'y', event.target.value)}
               onPaste={event => handlePointPaste(event, seriesIndex, pointIndex)}
               onBlur={handlePointFieldBlur}
            />
            <button
               type="button"
               className="graph-icon-btn"
               onClick={() => onCommit(removeScatterPoint(spec, seriesIndex, pointIndex))}
               disabled={pointCount <= 1}
               aria-label={t.graphRemovePoint}
               title={t.graphRemovePoint}
            ><X size={13} /></button>
         </>
      )
   }

   // ================
   //  Series blocks
   // ================
   function seriesBlockContent(seriesIndex: number, handle: DragHandleProps): React.ReactNode {
      const oneSeries = series[seriesIndex]
      const resolvedColor = resolveSeriesColor(seriesIndex, oneSeries.color, theme)
      const pointIds = oneSeries.points.map((_point, pointIndex) => `${SCATTER_POINT_ID_PREFIX}${pointIndex}`)
      return (
         <>
            {/* A scatter series is a whole table of points, so its name titles the card as a
                full-width heading bar (not a small field beside the swatch); the grip leads it. The
                right-click menu is bound to THIS head only, so a point-row right-click doesn't also
                hit the series menu. */}
            <div className="graph-scatter-series-head" onContextMenu={event => openSeriesMenu(event, seriesIndex)}>
               {dragGrip(handle, t.graphReorderSeries)}
               <button
                  type="button"
                  className="graph-lead-swatch"
                  data-graph-color-trigger
                  style={{ background: resolvedColor }}
                  aria-label={t.graphSeriesColor}
                  title={t.graphSeriesColor}
                  onClick={event => openColorPopover(seriesIndex, event.currentTarget.getBoundingClientRect())}
               />
               <input
                  className="graph-lead-name graph-scatter-series-name"
                  type="text"
                  value={oneSeries.name}
                  placeholder={`${t.graphSeriesDefault} ${seriesIndex + 1}`}
                  aria-label={t.graphSeriesName}
                  onFocus={onEditStart}
                  onChange={event => { onEditStart(); onDraft(setScatterSeriesName(spec, seriesIndex, event.target.value)) }}
                  onBlur={onCommitField}
               />
               <button
                  type="button"
                  className="graph-icon-btn"
                  onClick={() => onCommit(removeScatterSeries(spec, seriesIndex))}
                  disabled={series.length <= 1}
                  aria-label={t.graphRemoveSeries}
                  title={t.graphRemoveSeries}
               ><X size={13} /></button>
            </div>
            <div className="graph-scatter-points">
               <div className="graph-scatter-points-header">
                  {/* Spacer aligning the X/Y captions with the point inputs (past each row's grip). */}
                  <span className="graph-drag-handle-spacer" aria-hidden="true" />
                  <span className="graph-scatter-points-header-x">{t.graphScatterX}</span>
                  <span className="graph-scatter-points-header-y">{t.graphScatterY}</span>
               </div>
               {/* Each series hosts its OWN point-reorder context, isolated from other series. */}
               <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[LOCK_VERTICAL_MODIFIER]}
                  onDragEnd={event => handlePointDragEnd(seriesIndex, event)}
               >
                  <SortableContext items={pointIds} strategy={verticalListSortingStrategy}>
                     {oneSeries.points.map((point, pointIndex) => (
                        <SortableScatterPoint
                           key={`${SCATTER_POINT_ID_PREFIX}${pointIndex}`}
                           pointIndex={pointIndex}
                           onContextMenu={event => openPointMenu(event, seriesIndex, pointIndex)}
                        >
                           {pointHandle => pointRowContent(seriesIndex, pointIndex, point, oneSeries.points.length, pointHandle)}
                        </SortableScatterPoint>
                     ))}
                  </SortableContext>
               </DndContext>
               <button
                  type="button"
                  className="graph-grid-btn graph-scatter-add-point"
                  onClick={() => onCommit(addScatterPoint(spec, seriesIndex))}
                  title={t.graphAddPoint}
               >{t.graphAddPoint}</button>
            </div>
         </>
      )
   }

   const seriesIds = series.map((_oneSeries, seriesIndex) => `${SCATTER_SERIES_ID_PREFIX}${seriesIndex}`)

   return (
      <div className="graph-scatter-editor">
         {/* Outer context: reorder the series blocks vertically. Inner point contexts nest inside. */}
         <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[LOCK_VERTICAL_MODIFIER]}
            onDragEnd={handleSeriesDragEnd}
         >
            <SortableContext items={seriesIds} strategy={verticalListSortingStrategy}>
               {series.map((_oneSeries, seriesIndex) => (
                  <SortableScatterSeries
                     key={`${SCATTER_SERIES_ID_PREFIX}${seriesIndex}`}
                     seriesIndex={seriesIndex}
                  >
                     {handle => seriesBlockContent(seriesIndex, handle)}
                  </SortableScatterSeries>
               ))}
            </SortableContext>
         </DndContext>
         <button
            type="button"
            className="graph-grid-btn graph-scatter-add-series"
            onClick={() => onCommit(addScatterSeries(spec))}
            disabled={series.length >= MAX_SERIES}
            title={t.graphAddSeries}
         >{t.graphAddSeries}</button>

         {colorPopover && activePopover && (
            <GraphSeriesColorPopover
               anchorRect={colorPopover.rect}
               value={activePopover.value}
               title={t.graphSeriesColor}
               resetLabel={t.graphResetColor}
               onPick={activePopover.onPick}
               onReset={activePopover.onReset}
               onClose={() => setColorPopover(null)}
            />
         )}

         {contextMenu && (
            <ContextMenu
               position={{ x: contextMenu.x, y: contextMenu.y }}
               entries={contextMenu.kind === 'series'
                  ? seriesMenuEntries(contextMenu.seriesIndex)
                  : pointMenuEntries(contextMenu.seriesIndex, contextMenu.pointIndex)}
               onClose={() => setContextMenu(null)}
            />
         )}
      </div>
   )
}

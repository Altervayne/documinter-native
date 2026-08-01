import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { BarChart3, Pencil, X } from 'lucide-react'
import {
   renderGraphToSvg,
   LIGHT_GRAPH_THEME,
   DARK_GRAPH_THEME,
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
   compileExpression,
} from '../../../lib/graph'
import type { GraphSource, GraphSpec, GraphType, Overlay, OverlayKind } from '../../../lib/graph'
import {
   setType, setOption, addOverlay, removeOverlay, updateOverlay,
   setSource, updateSourceMapping, unlinkSource,
} from '../../../lib/graphEdit'
import { tableFromGraphData, graphDataFromTable, resolveGraphSpec, graphDataEquals } from '../../../lib/graphTableData'
import type { LinkableTable } from '../../../lib/graphTableData'
import { generateUniqueHandle } from '../../../lib/document'
import { GraphDataGrid } from '../../../molecules/GraphDataGrid'
import { EquationEditor } from '../../../molecules/EquationEditor'
import { ScatterEditor } from '../../../molecules/ScatterEditor'
import { HistogramEditor } from '../../../molecules/HistogramEditor'
import { GraphTypePicker } from '../../../molecules/GraphTypePicker'
import { GraphLinkPanel } from '../../../molecules/GraphLinkPanel'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'
import { useDocTheme } from '../../../contexts/DocThemeContext'
import { useDocumentTables, useLinkableTables } from '../../../contexts/DocumentTablesContext'
import { useDocumentHandles } from '../../../contexts/DocumentHandlesContext'
import { useDocumentMutations } from '../../../contexts/DocumentMutationsContext'
import { useBlockEditorWindow } from '../../../contexts/BlockEditorWindowContext'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface GraphBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   /** Inserts an already-built block right after this graph block (the "Extract data to a table"
    *  one-shot extract — see docs/reference/graph_table_linking_study.md, stage 1). */
   onInsertBlockAfter: (newBlock: Block) => void
   readOnly?: boolean
}

/** The two editor tabs: the visual controls (type + display options) and the data table. */
type GraphEditorTab = 'visual' | 'data'

/** A safe fallback so the editor never operates on an undefined spec (mkBlock always sets one). */
const FALLBACK_SPEC: GraphSpec = {
   type: 'bar',
   data: { labels: ['A'], series: [{ name: '', values: [null] }] },
   options: {},
}

/** The radial types have no axes; hide the x/y caption fields (and show the donut hole for donut). */
const RADIAL_TYPES = new Set<GraphType>(['pie', 'donut'])

/** The bar family — the only types that show the bar-width control. */
const BAR_TYPES = new Set<GraphType>(['bar', 'bar-grouped', 'bar-stacked'])

/** Line & area — the types that show the line-thickness control and the point-markers toggle.
 *  `function` curves are drawn with the SAME line renderer, so they earn the line-thickness
 *  control too; the point-markers toggle needs its own per-type default (see `defaultShowPoints`
 *  below) rather than reusing GRAPH_DEFAULT_SHOW_POINTS, since the renderer defaults points OFF
 *  for a sampled equation curve. */
const LINE_AREA_TYPES = new Set<GraphType>(['line', 'area', 'function'])

const DEFAULT_DONUT_HOLE = 0.55

/**
 * Debounce for the linked-graph snapshot write-back (see the effect in GraphBlock). A run of table
 * keystrokes coalesces into ONE snapshot patch this long after the last edit, so a fast typist in
 * the source table does not spray a mutation per character.
 */
const SNAPSHOT_WRITEBACK_DELAY_MS = 400

/**
 * The series list the Analysis section's overlay target-series `<select>` reads from, for the
 * CURRENT chart type. Every cartesian data type but `scatter` targets `data.series` (the ordinary
 * numeric grid); `scatter` has no `data.series` at all — its points live in `scatterPlot.series` —
 * so mean/trend need this small name+index projection instead. `GraphSeries` and `ScatterSeries`
 * otherwise differ in shape (`values` vs `points`), which the select doesn't care about.
 */
function overlayTargetSeriesList(spec: GraphSpec): { name: string; index: number }[] {
   if (spec.type === 'scatter') {
      return (spec.scatterPlot?.series ?? []).map((series, index) => ({ name: series.name, index }))
   }
   return spec.data.series.map((series, index) => ({ name: series.name, index }))
}

/**
 * Graph (chart) block. Mirrors the math block's render path: the stored `graph` spec is turned
 * into a self-contained SVG string by the pure `renderGraphToSvg`, then injected via
 * `dangerouslySetInnerHTML` inside a `.doc-graph` wrapper — no runtime, no external font. The
 * SVG bakes literal theme hex, so the theme is picked from the document theme (light/dark).
 *
 * WINDOWED EDITOR (block-editor-window adopter #1): inline, the block shows only its rendered
 * chart plus a hover-reveal Edit pill; the full editor — chart-type selector, editable data grid,
 * option controls — moves into a floating BlockEditorWindow opened via the
 * BlockEditorWindowContext. The draft/commit-on-blur model is unchanged (a local working spec
 * keeps typing smooth, committed via `patch({ graph })`); it simply lives in the window now. The
 * window is rendered inline by this component only while this block is the open one, so deleting
 * the block unmounts the window with it for free.
 */
export function GraphBlock({ block, patch, onInsertBlockAfter, readOnly }: GraphBlockProps) {
   const { t }        = useLang()
   const docTheme     = useDocTheme()
   const graphTheme   = docTheme === 'dark' ? DARK_GRAPH_THEME : LIGHT_GRAPH_THEME
   const editorWindow = useBlockEditorWindow()
   const isEditing    = !readOnly && editorWindow.isEditing(block.id)
   // The document-wide `handle -> table cells` catalog a LINKED graph resolves its data from. A
   // table edit changes this map's identity, which re-renders this block and re-resolves the link.
   const documentTables = useDocumentTables()
   // The "Link to a table…" picker's full listing (every table, handled or not) — stage 2b, the
   // editor UX built here. Unused in readOnly, but hooks must still run unconditionally.
   const linkableTables = useLinkableTables()
   // Every handle in the document, for generating a collision-free handle when auto-assigning one to
   // a handle-less table on link (see handleLinkTable below).
   const allHandles = useDocumentHandles()
   // Cross-block mutations: linking a graph to a handle-less table patches THAT table's block, which
   // is outside this block's own scoped `patch` — needs the raw mutation context.
   const documentMutations = useDocumentMutations()

   // Local working spec so the preview + grid update live on every keystroke without spamming a
   // document mutation; committed via `patch({ graph })` on blur / discrete change. Mirrors the
   // math block's not-editing sync pattern.
   const [working, setWorking] = useState<GraphSpec>(block.graph ?? FALLBACK_SPEC)
   const editing = useRef(false)
   // Which editor tab is showing.
   const [activeTab, setActiveTab] = useState<GraphEditorTab>('visual')
   // Hover state for the inline Edit pill (opacity-reveal, mirroring the DnD grip affordance).
   const [outputHovered, setOutputHovered] = useState(false)
   // The block's own root, measured (in the Edit handler, never during render) for the window's
   // initial placement anchor; the captured rect drives the window's opening position.
   const rootRef = useRef<HTMLDivElement>(null)
   const [anchorRect, setAnchorRect] = useState<DOMRect>(() => new DOMRect())

   // Capture the block's rect at click time, then open the window (single-window context lever).
   function openEditorWindow(): void {
      setAnchorRect(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      editorWindow.openEditor(block.id)
   }

   // External changes (undo, tab switch, load) sync in only when not actively editing.
   useEffect(() => {
      if (!editing.current) setWorking(block.graph ?? FALLBACK_SPEC)
   }, [block.graph])

   // ==================================================================
   //  Linked-graph snapshot write-back (avoids a mutation ping-pong)
   // ==================================================================
   // A linked graph keeps a MATERIALIZED SNAPSHOT of the resolved table data in `block.graph.data`
   // so it still serializes (the fence body) and still renders when the link dangles. This effect
   // keeps that snapshot current when the source table changes. Three guards make it loop-safe:
   //   1. IDENTITY GUARD — it patches only when the freshly resolved data STRUCTURALLY differs from
   //      the stored snapshot (`graphDataEquals`), so the patch it emits — which changes `sections`
   //      and thus re-runs this effect — immediately compares equal and stops. No ping-pong.
   //   2. NOT-DURING-RENDER — it runs in an effect, never in the render that READS the snapshot.
   //   3. DEBOUNCED — a rapid run of source-table keystrokes coalesces into one patch; the cleanup
   //      cancels a pending write whenever `block.graph`/`documentTables` changes, so the timer only
   //      ever fires with the latest committed spec (stale option edits can't overwrite fresher ones).
   // Skipped entirely in readOnly (no mutations) and for unlinked graphs (no `source`).
   const snapshotTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
   useEffect(() => {
      if (readOnly) return
      const stored = block.graph
      const source = stored?.source
      if (!source) return
      const entry = documentTables.get(source.handle)
      if (!entry) return // dangling: keep the last-known snapshot untouched
      const resolved = graphDataFromTable(entry.richHeaders, entry.richRows, {
         labelColumn: source.labelColumn,
         orient:      source.orient,
      })
      if (graphDataEquals(resolved, stored.data)) return // already current: nothing to write
      clearTimeout(snapshotTimer.current)
      snapshotTimer.current = setTimeout(() => {
         patch({ graph: { ...stored, data: resolved } })
      }, SNAPSHOT_WRITEBACK_DELAY_MS)
      return () => clearTimeout(snapshotTimer.current)
   }, [readOnly, block.graph, documentTables, patch])

   // ============
   //  Edit levers
   // ============
   // A live draft edit (text/number typing): update the working spec, mark editing, but do NOT
   // commit — the commit stays on blur, exactly like the math block.
   function draft(next: GraphSpec): void {
      editing.current = true
      setWorking(next)
   }
   // A discrete edit (add/remove, type change, color pick, toggle): update the working spec AND
   // commit to the document immediately.
   function commit(next: GraphSpec): void {
      editing.current = false
      setWorking(next)
      patch({ graph: next })
   }
   // A text/number input blur: commit the current working spec if it drifted from the stored one.
   function commitField(): void {
      editing.current = false
      if (working !== block.graph) patch({ graph: working })
   }
   function editStart(): void {
      editing.current = true
   }

   // One-shot extract: build a table block from this chart's current tabular data and drop it in
   // right after the graph. Pure data mapping (tableFromGraphData); no link is retained — this is
   // stage 1 of graph<->table linking, the live link is a separate, unbuilt stage 2. Only offered
   // for the tabular chart types (see the `dataTab` gate below — `function`/`scatter`/`histogram`
   // carry no `GraphData`).
   function handleExtractTable(): void {
      const { richHeaders, richRows } = tableFromGraphData(working.data)
      const newBlock: Block = { id: crypto.randomUUID(), type: 'table', richHeaders, richRows }
      onInsertBlockAfter(newBlock)
   }

   // Switching an overlay's kind REPLACES the whole overlay (not a shallow merge) so no stray field
   // from the previous kind lingers — e.g. a `series` left over after switching to a reference line,
   // or an `expression` left over after switching AWAY from an equation curve.
   function setOverlayKind(overlayIndex: number, kind: OverlayKind): void {
      const current = working.options.overlays ?? []
      const previous = current[overlayIndex]
      if (!previous) return
      const replacement: Overlay = kind === 'reference'
         ? { kind: 'reference', value: previous.value ?? 0, ...(previous.label ? { label: previous.label } : {}) }
         : kind === 'equation'
         ? { kind: 'equation', expression: previous.kind === 'equation' ? (previous.expression ?? '') : '' }
         : { kind, series: previous.series ?? 0, ...(kind === 'trend' && previous.showEquation ? { showEquation: true } : {}) }
      const overlays = current.map((overlay, index) => (index === overlayIndex ? replacement : overlay))
      commit(setOption(working, 'overlays', overlays))
   }

   // ================
   //  Read-only view
   // ================
   if (readOnly) {
      if (!block.graph) return null
      // Resolve a live table link (if any) to concrete data before the pure renderer; a dangling
      // link falls back to the materialized snapshot, so the read view never blanks or throws.
      const { renderSpec } = resolveGraphSpec(block.graph, documentTables)
      const svg = renderGraphToSvg(renderSpec, graphTheme)
      if (!svg) return null
      return <div className="doc-graph" dangerouslySetInnerHTML={{ __html: svg }} />
   }

   // ============
   //  Shared bits
   // ============
   const isRadial   = RADIAL_TYPES.has(working.type)
   const isBarFamily = BAR_TYPES.has(working.type)
   const isLineArea  = LINE_AREA_TYPES.has(working.type)
   const isFunction  = working.type === 'function'
   const isScatter   = working.type === 'scatter'
   const isHistogram = working.type === 'histogram'
   // The point-markers toggle's OWN default, mirroring the renderer's local default (see
   // cartesian.ts's renderFunctionPlot): off for a sampled equation curve, GRAPH_DEFAULT_SHOW_POINTS
   // (on) for a genuine line/area data series.
   const defaultShowPoints = isFunction ? false : GRAPH_DEFAULT_SHOW_POINTS
   const options    = working.options
   // The inline output renders from the live working spec, so the chart updates behind the window
   // as the window's controls are used — no separate in-window preview needed. A linked graph
   // resolves its data from the document's tables first (dangling → the materialized snapshot);
   // the pure renderer only ever sees concrete data, never `source`.
   const { renderSpec: previewRenderSpec, dangling: sourceDangling } = resolveGraphSpec(working, documentTables)
   const previewSvg = renderGraphToSvg(previewRenderSpec, graphTheme)

   // ==================================================================
   //  Table-link editing (stage 2b): link / re-link, mapping, unlink
   // ==================================================================
   // Link (or re-link) this graph to a table picked from GraphLinkPanel's picker. A handle-less
   // table is auto-assigned a fresh, document-unique handle FIRST (a mutation on that OTHER block,
   // routed through the raw mutation context — outside this graph's own scoped `patch` — addressed
   // via the picked entry's `container`, if any). `data` is deliberately left untouched: the
   // existing debounced snapshot write-back effect above refreshes it from the newly linked table on
   // the next resolve, exactly like any other source change.
   function handleLinkTable(entry: LinkableTable): void {
      let handle = entry.handle
      if (!handle) {
         handle = generateUniqueHandle({ id: entry.blockId, type: 'table' }, allHandles)
         if (entry.container) {
            documentMutations.containerMutations.updateBlock(
               entry.sectionId, entry.container.blockId, entry.container.side, entry.blockId, { handle },
            )
         } else {
            documentMutations.updateBlock(entry.sectionId, entry.blockId, { handle })
         }
      }
      commit(setSource(working, handle))
   }

   // Mapping change (label column / orientation): a discrete `<select>` edit, commits immediately.
   function handleUpdateMapping(partial: Partial<Omit<GraphSource, 'handle'>>): void {
      commit(updateSourceMapping(working, partial))
   }

   // Unlink: materialize the CURRENTLY resolved data (the live remap, or the last snapshot if
   // dangling — exactly what the read-only preview is already showing) onto `data`, drop `source`.
   function handleUnlink(): void {
      commit(unlinkSource(working, previewRenderSpec.data))
   }

   // ============
   //  Windowed editor body — the full controls + data grid + live preview.
   // ============
   // The editor is APP CHROME, not document content: it mounts directly in the window body (which
   // portals to <body> under the app's html[data-theme]), so the `.graph-editor`-scoped rules pick
   // up the app --color-* tokens and flip light/dark automatically — no `.doc-render`/`.doc-dark`
   // wrapper. The document theme is still used, but only for what shows document content: the
   // rendered chart SVG and the data color swatches (both via `graphTheme` below).
   // Roving-tab keyboard nav: Left/Right (and Home/End) move between the two tabs.
   function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'End') {
         event.preventDefault()
         setActiveTab('visual')
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'Home') {
         event.preventDefault()
         setActiveTab('data')
      }
   }

   // =============== Visual tab: chart-type cards + grouped display options ===============
   const visualTab = (
      <div className="graph-visual-tab">
         <GraphTypePicker
            value={working.type}
            onChange={type => commit(setType(working, type))}
            theme={graphTheme}
            t={t}
         />

         <div className="graph-options">
            <span className="graph-section-label">{t.graphDisplaySection}</span>

            <label className="graph-field">
               <span className="graph-field-label">{t.graphOptionTitle}</span>
               <input
                  className="graph-text-input"
                  type="text"
                  value={options.title ?? ''}
                  onFocus={editStart}
                  onChange={event => draft(setOption(working, 'title', event.target.value || undefined))}
                  onBlur={commitField}
               />
            </label>

            {!isRadial && (
               <label className="graph-field">
                  <span className="graph-field-label">{t.graphOptionXLabel}</span>
                  <input
                     className="graph-text-input"
                     type="text"
                     value={options.xLabel ?? ''}
                     onFocus={editStart}
                     onChange={event => draft(setOption(working, 'xLabel', event.target.value || undefined))}
                     onBlur={commitField}
                  />
               </label>
            )}

            {!isRadial && (
               <label className="graph-field">
                  <span className="graph-field-label">{t.graphOptionYLabel}</span>
                  <input
                     className="graph-text-input"
                     type="text"
                     value={options.yLabel ?? ''}
                     onFocus={editStart}
                     onChange={event => draft(setOption(working, 'yLabel', event.target.value || undefined))}
                     onBlur={commitField}
                  />
               </label>
            )}

            <div className="graph-toggle-row">
               {/* A histogram is always ONE dataset — a legend would have nothing to distinguish
                   it from, so the toggle is hidden rather than left dead (see cartesian.ts's
                   renderHistogram, which never reserves/draws a legend for this type). */}
               {!isHistogram && (
                  <label className="graph-toggle">
                     <input
                        type="checkbox"
                        checked={options.legend ?? true}
                        onChange={event => commit(setOption(working, 'legend', event.target.checked))}
                     />
                     <span>{t.graphOptionLegend}</span>
                  </label>
               )}
               <label className="graph-toggle">
                  <input
                     type="checkbox"
                     checked={options.showValues ?? false}
                     onChange={event => commit(setOption(working, 'showValues', event.target.checked || undefined))}
                  />
                  <span>{t.graphOptionValues}</span>
               </label>
            </div>

            {working.type === 'donut' && (
               <label className="graph-field graph-field-hole">
                  <span className="graph-field-label">{t.graphOptionHole}</span>
                  <div className="graph-range-row">
                     <input
                        className="graph-range-input"
                        type="range"
                        min={0}
                        max={0.9}
                        step={0.05}
                        value={options.donutHole ?? DEFAULT_DONUT_HOLE}
                        onChange={event => commit(setOption(working, 'donutHole', Number(event.target.value)))}
                     />
                     <span className="graph-range-value">{Math.round((options.donutHole ?? DEFAULT_DONUT_HOLE) * 100)}%</span>
                  </div>
               </label>
            )}

            {/* ============ Per-type: bar width (bar family only) ============ */}
            {isBarFamily && (
               <label className="graph-field">
                  <span className="graph-field-label">{t.graphOptionBarWidth}</span>
                  <div className="graph-range-row">
                     <input
                        className="graph-range-input"
                        type="range"
                        min={0.3}
                        max={1}
                        step={0.05}
                        value={options.barWidth ?? GRAPH_DEFAULT_BAR_WIDTH}
                        onChange={event => commit(setOption(working, 'barWidth', Number(event.target.value)))}
                     />
                     <span className="graph-range-value">{Math.round((options.barWidth ?? GRAPH_DEFAULT_BAR_WIDTH) * 100)}%</span>
                  </div>
               </label>
            )}

            {/* ============ Per-type: connect bar tops with a line (bar family only) ============ */}
            {isBarFamily && (
               <div className="graph-toggle-row">
                  <label className="graph-toggle">
                     <input
                        type="checkbox"
                        checked={options.barPeakLine ?? false}
                        onChange={event => commit(setOption(working, 'barPeakLine', event.target.checked || undefined))}
                     />
                     <span>{t.graphOptionPeakLine}</span>
                  </label>
               </div>
            )}

            {/* ============ Per-type: line thickness (line & area only) ============ */}
            {isLineArea && (
               <label className="graph-field">
                  <span className="graph-field-label">{t.graphOptionLineWidth}</span>
                  <div className="graph-range-row">
                     <input
                        className="graph-range-input"
                        type="range"
                        min={1}
                        max={5}
                        step={0.5}
                        value={options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH}
                        onChange={event => commit(setOption(working, 'lineWidth', Number(event.target.value)))}
                     />
                     <span className="graph-range-value">{options.lineWidth ?? GRAPH_DEFAULT_LINE_WIDTH}px</span>
                  </div>
               </label>
            )}

            {/* ============ Per-type: point markers toggle (line & area only) ============ */}
            {isLineArea && (
               <div className="graph-toggle-row">
                  <label className="graph-toggle">
                     <input
                        type="checkbox"
                        checked={options.showPoints ?? defaultShowPoints}
                        onChange={event => commit(setOption(working, 'showPoints', event.target.checked))}
                     />
                     <span>{t.graphOptionPoints}</span>
                  </label>
               </div>
            )}

            {/* ============ Per-type: fill opacity (area only) ============ */}
            {working.type === 'area' && (
               <label className="graph-field">
                  <span className="graph-field-label">{t.graphOptionFillOpacity}</span>
                  <div className="graph-range-row">
                     <input
                        className="graph-range-input"
                        type="range"
                        min={0.05}
                        max={0.7}
                        step={0.05}
                        value={options.areaFillOpacity ?? GRAPH_DEFAULT_AREA_FILL_OPACITY}
                        onChange={event => commit(setOption(working, 'areaFillOpacity', Number(event.target.value)))}
                     />
                     <span className="graph-range-value">{Math.round((options.areaFillOpacity ?? GRAPH_DEFAULT_AREA_FILL_OPACITY) * 100)}%</span>
                  </div>
               </label>
            )}
         </div>
      </div>
   )

   // =============== Analysis: statistical overlays — rendered in the DATA tab ===============
   // Overlays are computed from a target series, meaningless for radial (no series) AND for
   // `function`/`histogram` (no series payload at all — their data lives in `functionPlot`/
   // `histogramData`, not a series list). `scatter` DOES get analysis — a trendline/mean is exactly
   // the point of a scatter plot — targeting `scatterPlot.series` via `overlayTargetSeriesList`
   // instead of `data.series` (see that helper above). histogram analysis (e.g. a mean/std-dev
   // overlay) is a v1.1 concern, not built here.
   const analysisSection = !isRadial && !isFunction && !isHistogram && (
      <div className="graph-options graph-analysis">
         <span className="graph-section-label">{t.graphAnalysisSection}</span>

         {(options.overlays ?? []).map((overlay, overlayIndex) => (
            <div className="graph-overlay-row" key={overlayIndex}>
               <select
                  className="graph-overlay-select"
                  aria-label={t.graphAnalysisSection}
                  value={overlay.kind}
                  onChange={event => setOverlayKind(overlayIndex, event.target.value as OverlayKind)}
               >
                  <option value="mean">{t.graphOverlayMean}</option>
                  <option value="trend">{t.graphOverlayTrend}</option>
                  <option value="reference">{t.graphOverlayReference}</option>
                  {/* Equation curve is chart-level over the CATEGORICAL index axis; scatter has no
                      such axis, so it isn't offered there (a natural follow-up, not built in v1). */}
                  {!isScatter && <option value="equation">{t.graphOverlayEquation}</option>}
               </select>

               {/* Computed kinds (mean/trend): a target-series select including "All series". */}
               {overlay.kind !== 'reference' && overlay.kind !== 'equation' && (
                  <select
                     className="graph-overlay-select"
                     aria-label={t.graphSeriesName}
                     value={overlay.series === 'all' ? 'all' : String(overlay.series ?? 0)}
                     onChange={event => commit(updateOverlay(working, overlayIndex, {
                        series: event.target.value === 'all' ? 'all' : Number(event.target.value),
                     }))}
                  >
                     {overlayTargetSeriesList(working).map(series => (
                        <option key={series.index} value={series.index}>
                           {series.name || `${t.graphSeriesDefault} ${series.index + 1}`}
                        </option>
                     ))}
                     <option value="all">{t.graphOverlayAllSeries}</option>
                  </select>
               )}

               {/* Trend: opt-in equation label. */}
               {overlay.kind === 'trend' && (
                  <label className="graph-toggle">
                     <input
                        type="checkbox"
                        checked={overlay.showEquation ?? false}
                        onChange={event => commit(updateOverlay(working, overlayIndex, {
                           showEquation: event.target.checked || undefined,
                        }))}
                     />
                     <span>{t.graphOverlayShowEquation}</span>
                  </label>
               )}

               {/* Equation curve: a monospace expression input, live-validated via compileExpression
                   (the same invalid-ring + tooltip affordance EquationEditor's expression cells use). */}
               {overlay.kind === 'equation' && (() => {
                  const expressionText = overlay.expression ?? ''
                  const isInvalidExpression = expressionText.trim() !== '' && compileExpression(expressionText) === null
                  return (
                     <input
                        className={`graph-equation-expression${isInvalidExpression ? ' is-invalid' : ''}`}
                        type="text"
                        aria-label={t.graphOverlayEquationExpression}
                        placeholder={t.graphOverlayEquationPlaceholder}
                        title={isInvalidExpression ? t.graphInvalidExpression : undefined}
                        aria-invalid={isInvalidExpression || undefined}
                        value={expressionText}
                        onFocus={editStart}
                        onChange={event => draft(updateOverlay(working, overlayIndex, { expression: event.target.value }))}
                        onBlur={commitField}
                     />
                  )
               })()}

               {/* Reference: a constant value + an optional free-text label (draft/commit-on-blur). */}
               {overlay.kind === 'reference' && (
                  <>
                     <input
                        className="graph-text-input graph-overlay-value"
                        type="number"
                        aria-label={t.graphOverlayValue}
                        placeholder={t.graphOverlayValue}
                        value={overlay.value ?? ''}
                        onFocus={editStart}
                        onChange={event => draft(updateOverlay(working, overlayIndex, {
                           value: event.target.value === '' ? undefined : Number(event.target.value),
                        }))}
                        onBlur={commitField}
                     />
                     <input
                        className="graph-text-input graph-overlay-label"
                        type="text"
                        aria-label={t.graphOverlayLabel}
                        placeholder={t.graphOverlayLabel}
                        value={overlay.label ?? ''}
                        onFocus={editStart}
                        onChange={event => draft(updateOverlay(working, overlayIndex, {
                           label: event.target.value || undefined,
                        }))}
                        onBlur={commitField}
                     />
                  </>
               )}

               <button
                  type="button"
                  className="graph-icon-btn graph-overlay-remove"
                  aria-label={t.graphRemoveOverlay}
                  title={t.graphRemoveOverlay}
                  onClick={() => commit(removeOverlay(working, overlayIndex))}
               ><X size={13} /></button>
            </div>
         ))}

         <button
            type="button"
            className="graph-grid-btn graph-overlay-add"
            onClick={() => commit(addOverlay(working, { kind: 'mean', series: 0 }))}
         >{t.graphAddOverlay}</button>
      </div>
   )

   // =============== Data tab: the editable table (or, for `function`/`scatter`/`histogram`, their
   // own dedicated editors) + the analysis section below it (hidden for radial, `function`, AND
   // `histogram` — scatter DOES get it, see analysisSection above) ===============
   const dataTab = (
      <div className="graph-data-tab">
         {isFunction ? (
            <EquationEditor
               spec={working}
               theme={graphTheme}
               t={t}
               onEditStart={editStart}
               onDraft={draft}
               onCommit={commit}
               onCommitField={commitField}
            />
         ) : isScatter ? (
            <ScatterEditor
               spec={working}
               theme={graphTheme}
               t={t}
               onEditStart={editStart}
               onDraft={draft}
               onCommit={commit}
               onCommitField={commitField}
            />
         ) : isHistogram ? (
            <HistogramEditor
               spec={working}
               theme={graphTheme}
               t={t}
               onEditStart={editStart}
               onDraft={draft}
               onCommit={commit}
               onCommitField={commitField}
            />
         ) : (
            <>
               {/* Table link (stage 2b): a compact picker above the grid while unlinked, or the
                   whole linked-state management UI (banner + read-only preview + mapping + unlink)
                   REPLACING the grid entirely once `working.source` is set. Tabular types only —
                   function/scatter/histogram never reach this branch. */}
               <GraphLinkPanel
                  spec={working}
                  t={t}
                  linkableTables={linkableTables}
                  resolvedData={previewRenderSpec.data}
                  dangling={sourceDangling}
                  onLinkTable={handleLinkTable}
                  onUpdateMapping={handleUpdateMapping}
                  onUnlink={handleUnlink}
               />
               {!working.source && (
                  <>
                     <GraphDataGrid
                        spec={working}
                        theme={graphTheme}
                        t={t}
                        onEditStart={editStart}
                        onDraft={draft}
                        onCommit={commit}
                        onCommitField={commitField}
                     />
                     <button
                        type="button"
                        className="graph-grid-btn graph-extract-table-btn"
                        onClick={handleExtractTable}
                     >{t.graphExtractTable}</button>
                  </>
               )}
            </>
         )}
         {analysisSection}
      </div>
   )

   const editorBody = (
      <div className="graph-editor">
         {/* No in-window preview: the block renders live BEHIND the non-modal window (that is the
             point of a draggable window), so an in-window copy is redundant. The window holds only
             the controls; the chart updates inline as you edit. */}

         {/* =============== Tab bar =============== */}
         <div className="graph-editor-tabs" role="tablist" aria-label={t.graphWindowTitle}>
            <button
               type="button"
               role="tab"
               id="graph-tab-visual"
               aria-selected={activeTab === 'visual'}
               aria-controls="graph-tabpanel-visual"
               tabIndex={activeTab === 'visual' ? 0 : -1}
               className={`graph-editor-tab${activeTab === 'visual' ? ' is-active' : ''}`}
               onClick={() => setActiveTab('visual')}
               onKeyDown={handleTabKeyDown}
            >{t.graphTabVisual}</button>
            <button
               type="button"
               role="tab"
               id="graph-tab-data"
               aria-selected={activeTab === 'data'}
               aria-controls="graph-tabpanel-data"
               tabIndex={activeTab === 'data' ? 0 : -1}
               className={`graph-editor-tab${activeTab === 'data' ? ' is-active' : ''}`}
               onClick={() => setActiveTab('data')}
               onKeyDown={handleTabKeyDown}
            >{t.graphTabData}</button>
         </div>

         {/* =============== Tab content (scrolls in the remaining space) =============== */}
         <div
            className="graph-editor-tabpanel"
            role="tabpanel"
            id={activeTab === 'visual' ? 'graph-tabpanel-visual' : 'graph-tabpanel-data'}
            aria-labelledby={activeTab === 'visual' ? 'graph-tab-visual' : 'graph-tab-data'}
         >
            {activeTab === 'visual' ? visualTab : dataTab}
         </div>
      </div>
   )

   // ============
   //  Inline: output only + a hover-reveal Edit opener. The controls live in the window.
   // ============
   return (
      <div className="graph-block" ref={rootRef}>
         <div
            className="graph-block-output"
            onMouseEnter={() => setOutputHovered(true)}
            onMouseLeave={() => setOutputHovered(false)}
         >
            <div className="doc-graph" dangerouslySetInnerHTML={{ __html: previewSvg }} />
            {/* Dangling link: the source table's handle wasn't found. The chart still renders from
                the materialized snapshot (see resolveGraphSpec); this is a quiet in-editor hint, not
                serialized and never shown in the read view / export (those bake the snapshot). */}
            {sourceDangling && (
               <div className="graph-source-missing" role="status">{t.graphSourceMissing}</div>
            )}
            {!isEditing && (
               <button
                  type="button"
                  className={`graph-edit-btn${outputHovered ? ' graph-edit-btn-visible' : ''}`}
                  aria-label={t.graphEditChart}
                  title={t.graphEditChart}
                  onClick={openEditorWindow}
               >
                  <Pencil size={13} />
                  <span>{t.graphEditChart}</span>
               </button>
            )}
         </div>

         {isEditing && (
            <BlockEditorWindow
               title={t.graphWindowTitle}
               icon={<BarChart3 size={15} />}
               anchorRect={anchorRect}
               onClose={editorWindow.closeEditor}
            >
               {editorBody}
            </BlockEditorWindow>
         )}
      </div>
   )
}

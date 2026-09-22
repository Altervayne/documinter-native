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
   GRAPH_DEFAULT_OVERLAY_SIGMA,
   GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW,
   GRAPH_DEFAULT_TREND_DEGREE,
   compileExpression,
   supportsLogScale,
} from '../../../lib/graph'
import type { GraphSource, GraphSpec, GraphType, Overlay, OverlayKind } from '../../../lib/graph'
import {
   setType, setOption, addOverlay, removeOverlay, updateOverlay,
   setSource, updateSourceMapping, unlinkSource, logScaleWouldFallBackToLinear,
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
import { usePopAWindow } from 'react-pop-a-window'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface GraphBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   /** Inserts an already-built block right after this one (the one-shot table extract; no live link). */
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

/** The bar family, the only types that show the bar-width control. */
const BAR_TYPES = new Set<GraphType>(['bar', 'bar-grouped', 'bar-stacked'])

/** Line & area, the types showing the line-thickness control and point-markers toggle. `function`
 *  curves use the same line renderer, so they get line-thickness too, but default points OFF (see
 *  `defaultShowPoints`) rather than reusing GRAPH_DEFAULT_SHOW_POINTS. */
const LINE_AREA_TYPES = new Set<GraphType>(['line', 'area', 'function'])

const DEFAULT_DONUT_HOLE = 0.55

/** Debounce for the linked-graph snapshot write-back: a run of source-table keystrokes coalesces into
 *  ONE snapshot patch this long after the last edit. */
const SNAPSHOT_WRITEBACK_DELAY_MS = 400

/** The series list the overlay target-series `<select>` reads, for the current chart type. `scatter`
 *  has no `data.series` (its points live in `scatterPlot.series`), so it needs this name+index
 *  projection; every other cartesian type targets `data.series`. */
function overlayTargetSeriesList(spec: GraphSpec): { name: string; index: number }[] {
   if (spec.type === 'scatter') {
      return (spec.scatterPlot?.series ?? []).map((series, index) => ({ name: series.name, index }))
   }
   return spec.data.series.map((series, index) => ({ name: series.name, index }))
}

/*
 * The graph (chart) block. The stored `graph` spec renders to a self-contained SVG (pure
 * renderGraphToSvg, theme hex baked from the doc theme) injected in a `.doc-graph` wrapper. Inline it
 * shows the chart + a hover Edit pill; the full editor (type selector, data grid, option controls)
 * lives in a floating BlockEditorWindow. A local working spec keeps typing smooth, committed via
 * patch({ graph }) on blur.
 */
export function GraphBlock({ block, patch, onInsertBlockAfter, readOnly }: GraphBlockProps) {
   const { t }        = useLang()
   const docTheme     = useDocTheme()
   const graphTheme   = docTheme === 'dark' ? DARK_GRAPH_THEME : LIGHT_GRAPH_THEME
   const editorWindow = usePopAWindow()
   const isEditing    = !readOnly && editorWindow.isOpen(block.id)
   // The document-wide `handle -> table cells` catalog a LINKED graph resolves from. A table edit
   // changes this map's identity, re-rendering this block and re-resolving the link.
   const documentTables = useDocumentTables()
   // The "Link to a table..." picker's full listing. Unused in readOnly, but hooks run unconditionally.
   const linkableTables = useLinkableTables()
   // Every document handle, for minting a collision-free handle for a handle-less table on link.
   const allHandles = useDocumentHandles()
   // Linking to a handle-less table patches THAT table's block, outside this block's scoped `patch`.
   const documentMutations = useDocumentMutations()

   // Local working spec so preview + grid update live without spamming a mutation; committed via
   // patch({ graph }) on blur / discrete change.
   const [working, setWorking] = useState<GraphSpec>(block.graph ?? FALLBACK_SPEC)
   const editing = useRef(false)
   const [activeTab, setActiveTab] = useState<GraphEditorTab>('visual')
   const [outputHovered, setOutputHovered] = useState(false)
   // Measured in the Edit handler (never during render) to anchor the window's opening position.
   const rootRef = useRef<HTMLDivElement>(null)
   const [anchorRect, setAnchorRect] = useState<DOMRect>(() => new DOMRect())

   function openEditorWindow(): void {
      setAnchorRect(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      editorWindow.open(block.id)
   }

   // External changes (undo, tab switch, load) sync in only when not actively editing.
   useEffect(() => {
      if (!editing.current) setWorking(block.graph ?? FALLBACK_SPEC)
   }, [block.graph])

   // ==================================================================
   //  Linked-graph snapshot write-back (avoids a mutation ping-pong)
   // ==================================================================
   // A linked graph keeps a materialized snapshot of the resolved table data in `block.graph.data`, so
   // it still serializes and still renders when the link dangles. This effect keeps it current. Loop-safe
   // via three guards: it patches only when the resolved data structurally differs from the snapshot
   // (`graphDataEquals`), so its own re-run compares equal and stops; it runs in an effect, not the
   // render that reads the snapshot; and it debounces, the cleanup cancelling a pending write on change.
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
   // A live draft edit (typing): update the working spec, mark editing, but commit on blur.
   function draft(next: GraphSpec): void {
      editing.current = true
      setWorking(next)
   }
   // A discrete edit (add/remove, type change, color, toggle): update AND commit immediately.
   function commit(next: GraphSpec): void {
      editing.current = false
      setWorking(next)
      patch({ graph: next })
   }
   // Blur: commit the working spec if it drifted from the stored one.
   function commitField(): void {
      editing.current = false
      if (working !== block.graph) patch({ graph: working })
   }
   function editStart(): void {
      editing.current = true
   }

   // One-shot extract: build a table block from this chart's data and drop it in after the graph. No
   // link is retained. Tabular types only (function/scatter/histogram carry no GraphData).
   function handleExtractTable(): void {
      const { richHeaders, richRows } = tableFromGraphData(working.data)
      const newBlock: Block = { id: crypto.randomUUID(), type: 'table', richHeaders, richRows }
      onInsertBlockAfter(newBlock)
   }

   // Switching an overlay's kind REPLACES the whole overlay (not a merge) so no stray field from the
   // previous kind lingers (a `series` after switching to reference, an `expression` after leaving equation).
   function setOverlayKind(overlayIndex: number, kind: OverlayKind): void {
      const current = working.options.overlays ?? []
      const previous = current[overlayIndex]
      if (!previous) return
      const replacement: Overlay = kind === 'reference'
         ? { kind: 'reference', value: previous.value ?? 0,
             ...(previous.orientation ? { orientation: previous.orientation } : {}),
             ...(previous.label ? { label: previous.label } : {}) }
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
      // Resolve a live table link to concrete data first; a dangling link falls back to the snapshot.
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
   // The point-markers default mirrors the renderer's: off for a sampled equation curve, on for a
   // genuine line/area data series.
   const defaultShowPoints = isFunction ? false : GRAPH_DEFAULT_SHOW_POINTS
   const options    = working.options
   // The inline output renders from the live working spec, so it updates behind the window. A linked
   // graph resolves from the document's tables first (snapshot when dangling); the renderer sees only
   // concrete data, never `source`.
   const { renderSpec: previewRenderSpec, dangling: sourceDangling } = resolveGraphSpec(working, documentTables)
   const previewSvg = renderGraphToSvg(previewRenderSpec, graphTheme)

   // ==================================================================
   //  Table-link editing: link / re-link, mapping, unlink
   // ==================================================================
   // Link (or re-link) this graph to a picked table. A handle-less table is auto-assigned a fresh,
   // document-unique handle FIRST (a mutation on that OTHER block, via the raw mutation context). `data`
   // is left untouched: the debounced snapshot write-back refreshes it on the next resolve.
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

   function handleUpdateMapping(partial: Partial<Omit<GraphSource, 'handle'>>): void {
      commit(updateSourceMapping(working, partial))
   }

   // Unlink: materialize the currently resolved data (live remap, or last snapshot if dangling) onto
   // `data`, drop `source`.
   function handleUnlink(): void {
      commit(unlinkSource(working, previewRenderSpec.data))
   }

   // ============
   //  Windowed editor body
   // ============
   // The editor is APP CHROME: it mounts in the window body (portaled under html[data-theme]), so the
   // `.graph-editor` rules pick up the app --color-* tokens and flip light/dark. The doc theme drives
   // only document content (the chart SVG + data swatches, via `graphTheme`).
   // Roving-tab nav: Left/Right (and Home/End) move between the two tabs.
   function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'End') {
         event.preventDefault()
         setActiveTab('visual')
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'Home') {
         event.preventDefault()
         setActiveTab('data')
      }
   }

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
               {/* A histogram is always ONE dataset, so a legend has nothing to distinguish; hide it. */}
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

   // Analysis: statistical overlays, in the DATA tab. Hidden for radial and histogram (no series).
   // The offered overlay KINDS differ by type: bar family / line / area get the full set; scatter gets
   // mean / trend / reference (targeting `scatterPlot.series`); function gets reference lines only (a
   // sampled f(x) curve has no discrete series to fit).
   const analysisSection = !isRadial && !isHistogram && (
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
                  {/* The series-computed kinds all need a discrete data series, which a function chart
                      lacks, so they hide there (reference-only). */}
                  {!isFunction && <option value="mean">{t.graphOverlayMean}</option>}
                  {!isFunction && <option value="median">{t.graphOverlayMedian}</option>}
                  {!isFunction && <option value="trend">{t.graphOverlayTrend}</option>}
                  {!isFunction && <option value="stddev">{t.graphOverlayStddev}</option>}
                  {!isFunction && <option value="range">{t.graphOverlayRange}</option>}
                  {!isFunction && <option value="movingAverage">{t.graphOverlayMovingAverage}</option>}
                  <option value="reference">{t.graphOverlayReference}</option>
                  {/* Equation curve is over the CATEGORICAL index axis; scatter has none and a function
                      chart would just duplicate its plot, so it isn't offered for either. */}
                  {!isScatter && !isFunction && <option value="equation">{t.graphOverlayEquation}</option>}
               </select>

               {/* Computed kinds: a target-series select including "All series". */}
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

               {/* Std-dev band: the sigma multiplier (band spans mean +/- sigma * stddev). */}
               {overlay.kind === 'stddev' && (
                  <label className="graph-field">
                     <span className="graph-field-label">{t.graphOverlaySigma}</span>
                     <div className="graph-range-row">
                        <input
                           className="graph-range-input"
                           type="range"
                           min={1}
                           max={3}
                           step={0.5}
                           value={overlay.sigma ?? GRAPH_DEFAULT_OVERLAY_SIGMA}
                           onChange={event => commit(updateOverlay(working, overlayIndex, { sigma: Number(event.target.value) }))}
                        />
                        <span className="graph-range-value">{overlay.sigma ?? GRAPH_DEFAULT_OVERLAY_SIGMA}</span>
                     </div>
                  </label>
               )}

               {overlay.kind === 'movingAverage' && (
                  <label className="graph-field">
                     <span className="graph-field-label">{t.graphOverlayWindow}</span>
                     <div className="graph-range-row">
                        <input
                           className="graph-range-input"
                           type="range"
                           min={2}
                           max={15}
                           step={1}
                           value={overlay.window ?? GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW}
                           onChange={event => commit(updateOverlay(working, overlayIndex, { window: Number(event.target.value) }))}
                        />
                        <span className="graph-range-value">{overlay.window ?? GRAPH_DEFAULT_MOVING_AVERAGE_WINDOW}</span>
                     </div>
                  </label>
               )}

               {overlay.kind === 'trend' && (
                  <>
                     <select
                        className="graph-overlay-select"
                        aria-label={t.graphOverlayFit}
                        value={overlay.fit ?? 'linear'}
                        onChange={event => {
                           const fit = event.target.value as NonNullable<Overlay['fit']>
                           // Linear drops fit + degree (serializes lean); polynomial seeds a degree; the rest carry none.
                           const patch: Partial<Overlay> = fit === 'linear'
                              ? { fit: undefined, degree: undefined }
                              : fit === 'polynomial'
                              ? { fit, degree: overlay.degree ?? GRAPH_DEFAULT_TREND_DEGREE }
                              : { fit, degree: undefined }
                           commit(updateOverlay(working, overlayIndex, patch))
                        }}
                     >
                        <option value="linear">{t.graphOverlayFitLinear}</option>
                        <option value="polynomial">{t.graphOverlayFitPolynomial}</option>
                        <option value="exponential">{t.graphOverlayFitExponential}</option>
                        <option value="logarithmic">{t.graphOverlayFitLogarithmic}</option>
                        <option value="power">{t.graphOverlayFitPower}</option>
                     </select>

                     {overlay.fit === 'polynomial' && (
                        <label className="graph-field">
                           <span className="graph-field-label">{t.graphOverlayDegree}</span>
                           <div className="graph-range-row">
                              <input
                                 className="graph-range-input"
                                 type="range"
                                 min={2}
                                 max={5}
                                 step={1}
                                 value={overlay.degree ?? GRAPH_DEFAULT_TREND_DEGREE}
                                 onChange={event => commit(updateOverlay(working, overlayIndex, { degree: Number(event.target.value) }))}
                              />
                              <span className="graph-range-value">{overlay.degree ?? GRAPH_DEFAULT_TREND_DEGREE}</span>
                           </div>
                        </label>
                     )}

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
                  </>
               )}

               {/* Equation curve: a monospace expression input, live-validated via compileExpression. */}
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

               {overlay.kind === 'reference' && (
                  <>
                     {/* Orientation (function/scatter only): horizontal y = value or vertical x = value.
                         Categorical charts have no vertical analog, so it's hidden there. */}
                     {(isFunction || isScatter) && (
                        <select
                           className="graph-overlay-select"
                           aria-label={t.graphOverlayOrientation}
                           value={overlay.orientation === 'vertical' ? 'vertical' : 'horizontal'}
                           onChange={event => commit(updateOverlay(working, overlayIndex, {
                              orientation: event.target.value === 'vertical' ? 'vertical' : undefined,
                           }))}
                        >
                           <option value="horizontal">{t.graphOverlayOrientationHorizontal}</option>
                           <option value="vertical">{t.graphOverlayOrientationVertical}</option>
                        </select>
                     )}
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
            onClick={() => commit(addOverlay(working,
               isFunction ? { kind: 'reference', value: 0 } : { kind: 'mean', series: 0 }))}
         >{t.graphAddOverlay}</button>
      </div>
   )

   // Data tab: the editable table (or, for function/scatter/histogram, their own editors) + the
   // analysis section below it.
   const dataTab = (
      <div className="graph-data-tab">
         {/* Value (y) axis scale + custom origin, at the top since both frame how the data is plotted.
             Hidden for the radial types and bar-stacked (no value axis, or no log analog for stacking),
             the SAME rule the renderer enforces defensively for a hand-edited fence. */}
         {supportsLogScale(working.type) && (
            <div className="graph-editor-group graph-axis-controls">
               <div className="graph-toggle-row">
                  <label className="graph-toggle">
                     <input
                        type="checkbox"
                        checked={options.yScale === 'log'}
                        onChange={event => commit(setOption(working, 'yScale', event.target.checked ? 'log' : undefined))}
                     />
                     <span>{t.graphOptionLogScale}</span>
                  </label>
               </div>
               {options.yScale === 'log' && logScaleWouldFallBackToLinear(working) && (
                  <div className="graph-log-scale-notice" role="status">{t.graphLogScaleFallbackNotice}</div>
               )}

               {/* Custom axis origin ("textbook" axes), function/scatter only: the axes cross at a
                   chosen (x, y) instead of the plot edges. Enabling seeds (0, 0). Ignored under log scale. */}
               {(isFunction || isScatter) && (
                  <div className="graph-field graph-axis-origin">
                     <label className="graph-toggle">
                        <input
                           type="checkbox"
                           checked={options.axisOrigin !== undefined}
                           onChange={event => commit(setOption(working, 'axisOrigin',
                              event.target.checked ? { x: 0, y: 0 } : undefined))}
                        />
                        <span>{t.graphOptionAxisOrigin}</span>
                     </label>
                     {options.axisOrigin !== undefined && (
                        <div className="graph-axis-origin-inputs">
                           <label className="graph-field">
                              <span className="graph-field-label">{t.graphAxisOriginX}</span>
                              <input
                                 className="graph-text-input"
                                 type="number"
                                 value={options.axisOrigin.x}
                                 onFocus={editStart}
                                 onChange={event => draft(setOption(working, 'axisOrigin', {
                                    x: Number(event.target.value),
                                    y: options.axisOrigin?.y ?? 0,
                                 }))}
                                 onBlur={commitField}
                              />
                           </label>
                           <label className="graph-field">
                              <span className="graph-field-label">{t.graphAxisOriginY}</span>
                              <input
                                 className="graph-text-input"
                                 type="number"
                                 value={options.axisOrigin.y}
                                 onFocus={editStart}
                                 onChange={event => draft(setOption(working, 'axisOrigin', {
                                    x: options.axisOrigin?.x ?? 0,
                                    y: Number(event.target.value),
                                 }))}
                                 onBlur={commitField}
                              />
                           </label>
                        </div>
                     )}
                  </div>
               )}
            </div>
         )}

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
               {/* Table link: a compact picker above the grid while unlinked, or the linked-state UI
                   (banner + preview + mapping + unlink) REPLACING the grid once `working.source` is set. */}
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
         {/* No in-window preview: the block renders live behind the non-modal window. */}
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

   // Inline: output only + a hover-reveal Edit opener. The controls live in the window.
   return (
      <div className="graph-block" ref={rootRef}>
         <div
            className="graph-block-output"
            onMouseEnter={() => setOutputHovered(true)}
            onMouseLeave={() => setOutputHovered(false)}
         >
            <div className="doc-graph" dangerouslySetInnerHTML={{ __html: previewSvg }} />
            {/* Dangling link: the source handle wasn't found. The chart still renders from the snapshot;
                this is a quiet in-editor hint, not serialized, never in the read view / export. */}
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
               onClose={() => editorWindow.close()}
            >
               {editorBody}
            </BlockEditorWindow>
         )}
      </div>
   )
}

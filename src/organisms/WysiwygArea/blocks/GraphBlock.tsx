import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { BarChart3, Pencil } from 'lucide-react'
import {
   renderGraphToSvg,
   LIGHT_GRAPH_THEME,
   DARK_GRAPH_THEME,
   GRAPH_DEFAULT_BAR_WIDTH,
   GRAPH_DEFAULT_LINE_WIDTH,
   GRAPH_DEFAULT_SHOW_POINTS,
   GRAPH_DEFAULT_AREA_FILL_OPACITY,
} from '../../../lib/graph'
import type { GraphSpec, GraphType, Overlay, OverlayKind } from '../../../lib/graph'
import { setType, setOption, addOverlay, removeOverlay, updateOverlay } from '../../../lib/graphEdit'
import { GraphDataGrid } from '../../../molecules/GraphDataGrid'
import { EquationEditor } from '../../../molecules/EquationEditor'
import { GraphTypePicker } from '../../../molecules/GraphTypePicker'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'
import { useDocTheme } from '../../../contexts/DocThemeContext'
import { useBlockEditorWindow } from '../../../contexts/BlockEditorWindowContext'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface GraphBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
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
export function GraphBlock({ block, patch, readOnly }: GraphBlockProps) {
   const { t }        = useLang()
   const docTheme     = useDocTheme()
   const graphTheme   = docTheme === 'dark' ? DARK_GRAPH_THEME : LIGHT_GRAPH_THEME
   const editorWindow = useBlockEditorWindow()
   const isEditing    = !readOnly && editorWindow.isEditing(block.id)

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

   // Switching an overlay's kind REPLACES the whole overlay (not a shallow merge) so no stray field
   // from the previous kind lingers — e.g. a `series` left over after switching to a reference line.
   function setOverlayKind(overlayIndex: number, kind: OverlayKind): void {
      const current = working.options.overlays ?? []
      const previous = current[overlayIndex]
      if (!previous) return
      const replacement: Overlay = kind === 'reference'
         ? { kind: 'reference', value: previous.value ?? 0, ...(previous.label ? { label: previous.label } : {}) }
         : { kind, series: previous.series ?? 0, ...(kind === 'trend' && previous.showEquation ? { showEquation: true } : {}) }
      const overlays = current.map((overlay, index) => (index === overlayIndex ? replacement : overlay))
      commit(setOption(working, 'overlays', overlays))
   }

   // ================
   //  Read-only view
   // ================
   if (readOnly) {
      const svg = block.graph ? renderGraphToSvg(block.graph, graphTheme) : ''
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
   // The point-markers toggle's OWN default, mirroring the renderer's local default (see
   // cartesian.ts's renderFunctionPlot): off for a sampled equation curve, GRAPH_DEFAULT_SHOW_POINTS
   // (on) for a genuine line/area data series.
   const defaultShowPoints = isFunction ? false : GRAPH_DEFAULT_SHOW_POINTS
   const options    = working.options
   // The inline output renders from the live working spec, so the chart updates behind the window
   // as the window's controls are used — no separate in-window preview needed.
   const previewSvg = renderGraphToSvg(working, graphTheme)

   // ============
   //  Windowed editor body — the full controls + data grid + live preview.
   // ============
   // The graph editor styles are scoped under `.doc-render` (and `.doc-dark .doc-render` for dark),
   // but the window portals to <body>, outside that tree. Re-establish the scope here: a `.doc-dark`
   // wrapper (per the DOCUMENT theme, so the controls match the chart) over a `.doc-render` whose
   // page padding is neutralized inside the window (see doc.css .block-editor-doc-render).
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
               <label className="graph-toggle">
                  <input
                     type="checkbox"
                     checked={options.legend ?? true}
                     onChange={event => commit(setOption(working, 'legend', event.target.checked))}
                  />
                  <span>{t.graphOptionLegend}</span>
               </label>
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

   // =============== Analysis: statistical overlays (cartesian data-series only) — rendered in the DATA tab ===============
   // Overlays are computed FROM a `data.series` index, meaningless for radial (no series) AND for
   // `function` (no `data.series` at all — its payload is `functionPlot`, not the numeric grid).
   const analysisSection = !isRadial && !isFunction && (
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
               </select>

               {/* Computed kinds (mean/trend): a target-series select including "All series". */}
               {overlay.kind !== 'reference' && (
                  <select
                     className="graph-overlay-select"
                     aria-label={t.graphSeriesName}
                     value={overlay.series === 'all' ? 'all' : String(overlay.series ?? 0)}
                     onChange={event => commit(updateOverlay(working, overlayIndex, {
                        series: event.target.value === 'all' ? 'all' : Number(event.target.value),
                     }))}
                  >
                     {working.data.series.map((series, seriesIndex) => (
                        <option key={seriesIndex} value={seriesIndex}>
                           {series.name || `${t.graphSeriesDefault} ${seriesIndex + 1}`}
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
               >×</button>
            </div>
         ))}

         <button
            type="button"
            className="graph-grid-btn graph-overlay-add"
            onClick={() => commit(addOverlay(working, { kind: 'mean', series: 0 }))}
         >{t.graphAddOverlay}</button>
      </div>
   )

   // =============== Data tab: the editable table (or, for `function`, the equation editor) + the
   // analysis section below it (hidden for both radial and `function`, see analysisSection above) ===============
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
         ) : (
            <GraphDataGrid
               spec={working}
               theme={graphTheme}
               t={t}
               onEditStart={editStart}
               onDraft={draft}
               onCommit={commit}
               onCommitField={commitField}
            />
         )}
         {analysisSection}
      </div>
   )

   const editorBody = (
    <div className={`graph-editor-root${docTheme === 'dark' ? ' doc-dark' : ''}`}>
     <div className="doc-render block-editor-doc-render">
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

import { useEffect, useRef, useState } from 'react'
import { renderGraphToSvg, LIGHT_GRAPH_THEME, DARK_GRAPH_THEME } from '../../../lib/graph'
import type { GraphSpec, GraphType } from '../../../lib/graph'
import { setType, setOption } from '../../../lib/graphEdit'
import { GraphDataGrid } from '../../../molecules/GraphDataGrid'
import { useDocTheme } from '../../../contexts/DocThemeContext'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface GraphBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

// The 7 chart types in the order they appear in the selector, each paired with the i18n key for
// its label. Kept here (next to the block) so the selector and the type union never drift.
const GRAPH_TYPES: { type: GraphType; labelKey: 'graphTypeBar' | 'graphTypeBarGrouped' | 'graphTypeBarStacked' | 'graphTypeLine' | 'graphTypeArea' | 'graphTypePie' | 'graphTypeDonut' }[] = [
   { type: 'bar',         labelKey: 'graphTypeBar' },
   { type: 'bar-grouped', labelKey: 'graphTypeBarGrouped' },
   { type: 'bar-stacked', labelKey: 'graphTypeBarStacked' },
   { type: 'line',        labelKey: 'graphTypeLine' },
   { type: 'area',        labelKey: 'graphTypeArea' },
   { type: 'pie',         labelKey: 'graphTypePie' },
   { type: 'donut',       labelKey: 'graphTypeDonut' },
]

/** A safe fallback so the editor never operates on an undefined spec (mkBlock always sets one). */
const FALLBACK_SPEC: GraphSpec = {
   type: 'bar',
   data: { labels: ['A'], series: [{ name: '', values: [null] }] },
   options: {},
}

/** The radial types have no axes; hide the x/y caption fields (and show the donut hole for donut). */
const RADIAL_TYPES = new Set<GraphType>(['pie', 'donut'])

const DEFAULT_DONUT_HOLE = 0.55

/**
 * Graph (chart) block. Mirrors the math block's render path: the stored `graph` spec is turned
 * into a self-contained SVG string by the pure `renderGraphToSvg`, then injected via
 * `dangerouslySetInnerHTML` inside a `.doc-graph` wrapper — no runtime, no external font. The
 * SVG bakes literal theme hex, so the theme is picked from the document theme (light/dark).
 *
 * STAGE 3 scope: a full interactive editor — a chart-type selector, an editable data grid
 * (categories x series, with a per-series color picker), option controls, and a live preview.
 * The editing model mirrors the math block: a local working spec keeps typing smooth (the
 * preview renders from it live), external changes sync in only when not actively editing, and
 * the document is committed via `patch({ graph })` on blur + immediately on discrete changes.
 */
export function GraphBlock({ block, patch, readOnly }: GraphBlockProps) {
   const { t }      = useLang()
   const docTheme   = useDocTheme()
   const graphTheme = docTheme === 'dark' ? DARK_GRAPH_THEME : LIGHT_GRAPH_THEME

   // Local working spec so the preview + grid update live on every keystroke without spamming a
   // document mutation; committed via `patch({ graph })` on blur / discrete change. Mirrors the
   // math block's not-editing sync pattern.
   const [working, setWorking] = useState<GraphSpec>(block.graph ?? FALLBACK_SPEC)
   const editing = useRef(false)

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

   // ================
   //  Read-only view
   // ================
   if (readOnly) {
      const svg = block.graph ? renderGraphToSvg(block.graph, graphTheme) : ''
      if (!svg) return null
      return <div className="doc-graph" dangerouslySetInnerHTML={{ __html: svg }} />
   }

   // ============
   //  Editor view
   // ============
   const isRadial = RADIAL_TYPES.has(working.type)
   const options  = working.options
   const previewSvg = renderGraphToSvg(working, graphTheme)

   return (
      <div className="graph-block">
         {/* =============== Chart-type selector + options =============== */}
         <div className="graph-controls">
            <label className="graph-control">
               <span className="graph-control-label">{t.graphChartType}</span>
               <select
                  className="graph-type-select"
                  value={working.type}
                  onChange={event => commit(setType(working, event.target.value as GraphType))}
               >
                  {GRAPH_TYPES.map(({ type, labelKey }) => (
                     <option key={type} value={type}>{t[labelKey]}</option>
                  ))}
               </select>
            </label>

            <label className="graph-control">
               <span className="graph-control-label">{t.graphOptionTitle}</span>
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
               <label className="graph-control">
                  <span className="graph-control-label">{t.graphOptionXLabel}</span>
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
               <label className="graph-control">
                  <span className="graph-control-label">{t.graphOptionYLabel}</span>
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

            <div className="graph-toggles">
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
               <label className="graph-control graph-control-hole">
                  <span className="graph-control-label">{t.graphOptionHole}</span>
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
               </label>
            )}
         </div>

         {/* =============== Data grid =============== */}
         <GraphDataGrid
            spec={working}
            theme={graphTheme}
            t={t}
            onEditStart={editStart}
            onDraft={draft}
            onCommit={commit}
            onCommitField={commitField}
         />

         {/* =============== Live preview =============== */}
         <div className="graph-preview doc-graph" dangerouslySetInnerHTML={{ __html: previewSvg }} />
      </div>
   )
}

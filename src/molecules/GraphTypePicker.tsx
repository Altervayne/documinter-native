// -- Lib Imports --
import { renderGraphToSvg } from '../lib/graph'
import type { GraphSpec, GraphType, GraphTheme } from '../lib/graph'
import type { T } from '../lib/i18n'

// #########
// # TYPES #
// #########

interface GraphTypePickerProps {
   /** The currently selected chart type (drives the accent highlight). */
   value:    GraphType
   /** Apply a type change; called with a fresh type when a card is clicked. */
   onChange: (type: GraphType) => void
   /** Resolved chart theme, so the mini previews match the document's light/dark theme. */
   theme:    GraphTheme
   /** UI strings (the per-type labels). */
   t:        T
}

// #############
// # TYPE LIST #
// #############

/**
 * The chart types in the order they appear in the picker, each paired with the i18n key for its
 * label. Kept here (next to the picker) so the card grid and the GraphType union never drift; it
 * used to live in GraphBlock next to the old `<select>` and moved here with the control.
 */
type GraphTypeLabelKey =
   | 'graphTypeBar'
   | 'graphTypeBarGrouped'
   | 'graphTypeBarStacked'
   | 'graphTypeLine'
   | 'graphTypeArea'
   | 'graphTypePie'
   | 'graphTypeDonut'
   | 'graphTypeFunction'
   | 'graphTypeScatter'
   | 'graphTypeHistogram'

const GRAPH_TYPES: { type: GraphType; labelKey: GraphTypeLabelKey }[] = [
   { type: 'bar',         labelKey: 'graphTypeBar' },
   { type: 'bar-grouped', labelKey: 'graphTypeBarGrouped' },
   { type: 'bar-stacked', labelKey: 'graphTypeBarStacked' },
   { type: 'line',        labelKey: 'graphTypeLine' },
   { type: 'area',        labelKey: 'graphTypeArea' },
   { type: 'pie',         labelKey: 'graphTypePie' },
   { type: 'donut',       labelKey: 'graphTypeDonut' },
   { type: 'function',    labelKey: 'graphTypeFunction' },
   { type: 'scatter',     labelKey: 'graphTypeScatter' },
   { type: 'histogram',   labelKey: 'graphTypeHistogram' },
]

// ################
// # CANNED SAMPLE #
// ################

/**
 * A small, illustrative, STABLE dataset per chart type used only to render the card thumbnails,
 * NOT the author's data, so the cards never re-shape as the real spec is edited. Legend + title +
 * value labels are left off (options stay lean) so the chart SHAPE reads clearly at thumbnail size.
 * Pure and deterministic: same type in, same spec out.
 */
export function sampleSpecForType(type: GraphType): GraphSpec {
   switch (type) {
      case 'pie':
         return {
            type,
            data: { labels: ['A', 'B', 'C', 'D'], series: [{ name: '', values: [8, 5, 4, 3] }] },
            options: { legend: false },
         }
      case 'donut':
         return {
            type,
            data: { labels: ['A', 'B', 'C', 'D'], series: [{ name: '', values: [8, 5, 4, 3] }] },
            options: { legend: false, donutHole: 0.55 },
         }
      case 'bar':
         return {
            type,
            data: { labels: ['A', 'B', 'C', 'D'], series: [{ name: '', values: [4, 7, 5, 8] }] },
            options: { legend: false },
         }
      case 'bar-grouped':
      case 'bar-stacked':
         return {
            type,
            data: {
               labels: ['A', 'B', 'C'],
               series: [
                  { name: '', values: [4, 6, 5] },
                  { name: '', values: [6, 3, 7] },
               ],
            },
            options: { legend: false },
         }
      case 'line':
      case 'area':
         return {
            type,
            data: {
               labels: ['A', 'B', 'C', 'D', 'E'],
               series: [
                  { name: '', values: [3, 6, 4, 7, 6] },
                  { name: '', values: [5, 3, 6, 4, 8] },
               ],
            },
            options: { legend: false },
         }
      case 'function':
         // The 8th card's thumbnail: a canned sin(x) curve over a small domain, illustrative only.
         return {
            type,
            data: { labels: [], series: [] },
            options: { legend: false },
            functionPlot: {
               domain: { xMin: -6.5, xMax: 6.5, samples: 120 },
               equations: [{ name: 'f', expression: 'sin(x)' }],
            },
         }
      case 'scatter':
         // The 9th card's thumbnail: a small canned 2-series point cloud, illustrative only.
         return {
            type,
            data: { labels: [], series: [] },
            options: { legend: false },
            scatterPlot: {
               series: [
                  { name: '', points: [{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 6 }] },
                  { name: '', points: [{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 7 }, { x: 4, y: 5 }] },
               ],
            },
         }
      case 'histogram':
         // The 10th card's thumbnail: a small canned, roughly bell-shaped sample list, illustrative only.
         return {
            type,
            data: { labels: [], series: [] },
            options: { legend: false },
            histogramData: {
               samples: [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9],
            },
         }
   }
}

// #############
// # COMPONENT #
// #############

/**
 * The chart-type picker: a grid of preview cards (one per GraphType) replacing the old dropdown.
 * Each card renders a REAL mini chart of that type via the shared `renderGraphToSvg`, fed the
 * canned sample spec above, so the author picks a shape by seeing it rather than reading a label.
 * The cards depend only on the type list + theme (never on the author's data), so they are stable.
 * Clicking a card routes through the pure `setType` helper via `onChange`.
 */
export function GraphTypePicker({ value, onChange, theme, t }: GraphTypePickerProps) {
   return (
      <div className="graph-type-grid" role="radiogroup" aria-label={t.graphChartType}>
         {GRAPH_TYPES.map(({ type, labelKey }) => {
            const thumbnailSvg = renderGraphToSvg(sampleSpecForType(type), theme)
            const isSelected = type === value
            return (
               <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`graph-type-card${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onChange(type)}
                  title={t[labelKey]}
               >
                  <span className="graph-type-card-chart" dangerouslySetInnerHTML={{ __html: thumbnailSvg }} />
                  <span className="graph-type-card-label">{t[labelKey]}</span>
               </button>
            )
         })}
      </div>
   )
}

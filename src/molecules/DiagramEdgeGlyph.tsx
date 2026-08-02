// -- Type Imports --
import type { EdgeArrow, EdgeRouting } from '../lib/diagram'
import type { SegmentedIconToggleOption } from '../atoms/SegmentedIconToggle'
import type { T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

/** Shared glyph viewBox so every edge-option button lines up visually. */
const EDGE_GLYPH_VIEW_BOX = '0 0 28 18'

/** A line-style toggle value (maps to the model's boolean `dashed`). */
export type EdgeLineStyle = 'solid' | 'dashed'

// #########
// # GLYPHS #
// #########

/**
 * A small inline-SVG glyph reading as an edge with the given arrowhead placement (a line with a
 * filled triangle at the chosen end(s)), so the arrowhead toggle doubles as a live legend.
 * `currentColor` follows the button's own text color (muted idle, accent selected — set by the CSS).
 */
export function EdgeArrowGlyph({ arrow }: { arrow: EdgeArrow }) {
   const hasStart = arrow === 'start' || arrow === 'both'
   const hasEnd = arrow === 'end' || arrow === 'both'
   return (
      <svg viewBox={EDGE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         <line x1={hasStart ? 8 : 3} y1={9} x2={hasEnd ? 20 : 25} y2={9} stroke="currentColor" strokeWidth={1.6} />
         {hasStart && <polygon points="3,9 9,5 9,13" fill="currentColor" />}
         {hasEnd && <polygon points="25,9 19,5 19,13" fill="currentColor" />}
      </svg>
   )
}

/** A glyph reading as the routing style: a straight diagonal, or a right-angle elbow. */
export function EdgeRoutingGlyph({ routing }: { routing: EdgeRouting }) {
   return (
      <svg viewBox={EDGE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         {routing === 'orthogonal' ? (
            <polyline points="4,4 4,14 24,14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
         ) : (
            <line x1={4} y1={14} x2={24} y2={4} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
         )}
      </svg>
   )
}

/** A glyph reading as the line style: a solid or a dashed horizontal line. */
export function EdgeLineStyleGlyph({ style }: { style: EdgeLineStyle }) {
   return (
      <svg viewBox={EDGE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         <line
            x1={3} y1={9} x2={25} y2={9}
            stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"
            strokeDasharray={style === 'dashed' ? '4 3' : undefined}
         />
      </svg>
   )
}

// #####################
// # SEGMENTED OPTIONS  #
// #####################

/** The arrowhead-placement options for the inspector's `SegmentedIconToggle`, in a stable order. */
export function buildArrowOptions(t: T): SegmentedIconToggleOption<EdgeArrow>[] {
   const labels: Record<EdgeArrow, string> = {
      none:  t.diagramEdgeArrowNone,
      start: t.diagramEdgeArrowStart,
      end:   t.diagramEdgeArrowEnd,
      both:  t.diagramEdgeArrowBoth,
   }
   const order: EdgeArrow[] = ['none', 'start', 'end', 'both']
   return order.map(arrow => ({ value: arrow, label: labels[arrow], icon: <EdgeArrowGlyph arrow={arrow} /> }))
}

/** The routing options for the inspector's `SegmentedIconToggle`. */
export function buildRoutingOptions(t: T): SegmentedIconToggleOption<EdgeRouting>[] {
   const labels: Record<EdgeRouting, string> = {
      straight:   t.diagramEdgeRoutingStraight,
      orthogonal: t.diagramEdgeRoutingOrthogonal,
   }
   const order: EdgeRouting[] = ['straight', 'orthogonal']
   return order.map(routing => ({ value: routing, label: labels[routing], icon: <EdgeRoutingGlyph routing={routing} /> }))
}

/** The line-style options (solid / dashed) for the inspector's `SegmentedIconToggle`. */
export function buildLineStyleOptions(t: T): SegmentedIconToggleOption<EdgeLineStyle>[] {
   const labels: Record<EdgeLineStyle, string> = {
      solid:  t.diagramEdgeLineSolid,
      dashed: t.diagramEdgeLineDashed,
   }
   const order: EdgeLineStyle[] = ['solid', 'dashed']
   return order.map(style => ({ value: style, label: labels[style], icon: <EdgeLineStyleGlyph style={style} /> }))
}

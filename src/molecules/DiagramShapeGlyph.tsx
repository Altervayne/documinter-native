// -- Type Imports --
import type { NodeShape } from '../lib/diagram'
import type { SegmentedIconToggleOption } from '../atoms/SegmentedIconToggle'
import type { T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

/** Shared glyph viewBox so every shape button lines up visually. */
const SHAPE_GLYPH_VIEW_BOX = '0 0 28 18'

/** The v1 node shapes, in a stable display order (used by the palette + the inspector toggle). The
 *  two heading shapes (banner/chevron) trail the geometric shapes, grouped together. */
export const NODE_SHAPE_ORDER: NodeShape[] =
   ['rectangle', 'rounded', 'pill', 'ellipse', 'diamond', 'banner', 'chevron']

/** The i18n key for each shape's human label. */
export const NODE_SHAPE_LABEL_KEYS: Record<NodeShape,
   'diagramShapeRectangle' | 'diagramShapeRounded' | 'diagramShapePill' | 'diagramShapeEllipse'
   | 'diagramShapeDiamond' | 'diagramShapeBanner' | 'diagramShapeChevron'> = {
   rectangle: 'diagramShapeRectangle',
   rounded:   'diagramShapeRounded',
   pill:      'diagramShapePill',
   ellipse:   'diagramShapeEllipse',
   diamond:   'diagramShapeDiamond',
   banner:    'diagramShapeBanner',
   chevron:   'diagramShapeChevron',
}

// #########
// # GLYPH #
// #########

/**
 * A small inline-SVG glyph that READS AS the node shape it names (an actual rounded rect, ellipse,
 * diamond, …) rather than a generic icon, so the palette button + the inspector's segmented shape
 * toggle double as a live legend. `currentColor` follows the button's own text color (muted when
 * idle, accent when active/selected — set by the CSS, not the glyph).
 */
export function NodeShapeGlyph({ shape }: { shape: NodeShape }) {
   return (
      <svg viewBox={SHAPE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         {shape === 'ellipse' ? (
            <ellipse cx={14} cy={9} rx={11} ry={6} fill="none" stroke="currentColor" strokeWidth={1.6} />
         ) : shape === 'diamond' ? (
            <polygon points="14,2 26,9 14,16 2,9" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
         ) : shape === 'chevron' ? (
            // A right-pointing arrow/process banner: the same six-vertex pentagon `chevronPoints`
            // draws on the canvas, scaled to the glyph's 28×18 viewBox.
            <polygon points="3,4 19,4 25,9 19,14 3,14 9,9" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
         ) : shape === 'banner' ? (
            // A flat heading bar with a bottom accent rule, echoing `renderBannerShape`.
            <g fill="none" stroke="currentColor" strokeWidth={1.6}>
               <rect x={3} y={4} width={22} height={10} rx={2} ry={2} />
               <line x1={4} y1={12} x2={24} y2={12} strokeWidth={2} />
            </g>
         ) : (
            <rect
               x={3} y={4} width={22} height={10}
               rx={shape === 'pill' ? 5 : shape === 'rounded' ? 3 : 0}
               fill="none" stroke="currentColor" strokeWidth={1.6}
            />
         )}
      </svg>
   )
}

// #####################
// # SEGMENTED OPTIONS  #
// #####################

/** Build the five shape options for the inspector's `SegmentedIconToggle` from the current strings. */
export function buildShapeOptions(t: T): SegmentedIconToggleOption<NodeShape>[] {
   return NODE_SHAPE_ORDER.map(shape => ({
      value: shape,
      label: t[NODE_SHAPE_LABEL_KEYS[shape]],
      icon:  <NodeShapeGlyph shape={shape} />,
   }))
}

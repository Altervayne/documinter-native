/**
 * shapes.ts, one SVG element builder per NodeShape for the diagram renderer.
 *
 * PURE FUNCTIONS producing self-contained SVG element strings via the shared `lib/svg.ts` builders
 * (the same escaping/number-format source of truth the graph + image-markup blocks use). Each
 * builder draws only the SHAPE (fill + border); the centered label is layered on separately by
 * index.ts. Colors arrive as resolved literal hex (theme default or per-node override), so the
 * output needs no CSS variables and inlines straight into an export.
 */

import type { DiagramNode, NodeShape } from './types'
import { selfClosingElement } from '../svg'

// #############
// # CONSTANTS #
// #############

/** Node border stroke width, in diagram units. */
export const NODE_STROKE_WIDTH = 1.5

/** Corner radius for the 'rounded' shape, in diagram units. */
const ROUNDED_CORNER_RADIUS = 8

/** Corner radius for the 'banner' heading shape, in diagram units, lighter than 'rounded'. */
const BANNER_CORNER_RADIUS = 4

/** Height of the 'banner' shape's bottom accent bar, in diagram units (the "underline" that reads
 *  as a section-heading rule). Solid-filled with the resolved stroke color, no border of its own. */
const BANNER_ACCENT_HEIGHT = 4

/**
 * The 'chevron' shape's point/notch depth as a fraction of the node's half-height. Tuned so the
 * point reads clearly without the notch vertex eating too far into the label area; always additionally
 * capped at a fraction of the width (see {@link chevronPointDepth}) so a narrow/short node can never
 * produce a self-intersecting (inverted) polygon.
 */
const CHEVRON_POINT_DEPTH_RATIO = 0.6

/** The largest the chevron point/notch depth may be, as a fraction of the node's width, so the left
 *  notch vertex and the right point never cross past the node's own center. */
const CHEVRON_MAX_DEPTH_WIDTH_RATIO = 0.45

// #####################
// # RESOLVED FILL/INK #
// #####################

/** The colors one node is drawn with: a per-node override, else the theme default. */
export interface ResolvedNodeColors {
   fill:   string
   stroke: string
}

/**
 * Build the shape element for a node at its literal diagram-unit coordinates. Dispatches on
 * `node.shape`; an unknown shape (should not occur, the parser clamps to a valid one) falls back
 * to a rectangle so the renderer is total.
 */
export function renderNodeShape(node: DiagramNode, colors: ResolvedNodeColors): string {
   const shape: NodeShape = node.shape
   const commonStyle = {
      fill:           colors.fill,
      stroke:         colors.stroke,
      'stroke-width': NODE_STROKE_WIDTH,
   }

   if (shape === 'ellipse') {
      return selfClosingElement('ellipse', {
         cx: node.x + node.width / 2,
         cy: node.y + node.height / 2,
         rx: node.width / 2,
         ry: node.height / 2,
         ...commonStyle,
      })
   }

   if (shape === 'diamond') {
      const points = diamondPoints(node)
      return selfClosingElement('polygon', { points, ...commonStyle })
   }

   if (shape === 'chevron') {
      const points = chevronPoints(node)
      return selfClosingElement('polygon', { points, ...commonStyle })
   }

   if (shape === 'banner') {
      return renderBannerShape(node, colors)
   }

   // rectangle / rounded / pill are all rects; only the corner radius differs.
   const cornerRadius =
      shape === 'pill'    ? Math.min(node.width, node.height) / 2 :
      shape === 'rounded' ? ROUNDED_CORNER_RADIUS :
      0

   return selfClosingElement('rect', {
      x:      node.x,
      y:      node.y,
      width:  node.width,
      height: node.height,
      rx:     cornerRadius || undefined,
      ry:     cornerRadius || undefined,
      ...commonStyle,
   })
}

/** The four vertex points of a diamond (rhombus) inscribed in the node's bounding box. */
function diamondPoints(node: DiagramNode): string {
   const centerX = node.x + node.width / 2
   const centerY = node.y + node.height / 2
   const right  = node.x + node.width
   const bottom = node.y + node.height
   // top, right, bottom, left mid-edge vertices.
   return `${centerX},${node.y} ${right},${centerY} ${centerX},${bottom} ${node.x},${centerY}`
}

// #####################
// # HEADING SHAPES    #
// #####################
// 'banner' (a flat heading bar) and 'chevron' (a right-pointing arrow/process heading) are ordinary
// node shapes for labeling steps/phases in a process chart, same place/label/style/move/resize/
// serialize/color as every other shape, just a distinct silhouette. See types.ts's NodeShape doc.

/**
 * The 'chevron' point/notch depth (diagram units): how far the right tip pokes toward the node's
 * own center and how far the left notch is cut inward. Derived from the node's half-height (a taller
 * node gets a deeper point), then capped at a fraction of the width so the notch vertex and the point
 * can never cross the center (which would self-intersect the polygon). Exported so the renderer can
 * reserve the same inset for the label (kept clear of the point, per the spec) and so it's unit-testable.
 */
export function chevronPointDepth(node: DiagramNode): number {
   const depth = (node.height / 2) * CHEVRON_POINT_DEPTH_RATIO
   const maxDepth = node.width * CHEVRON_MAX_DEPTH_WIDTH_RATIO
   return Math.max(0, Math.min(depth, maxDepth))
}

/**
 * The six vertex points of the chevron polygon: a rectangle whose right end comes to a point (the tip
 * sits ON the bounding box's right wall, at its vertical center) and whose left end is cut with a
 * matching inward notch (the classic "process arrow" pentagon), so a row of them approximates
 * interlocking arrows when placed edge-to-edge. Pure polygon geometry from x/y/width/height.
 */
function chevronPoints(node: DiagramNode): string {
   const depth = chevronPointDepth(node)
   const right = node.x + node.width
   const bottom = node.y + node.height
   const centerY = node.y + node.height / 2
   return [
      `${node.x},${node.y}`,                 // top-left
      `${right - depth},${node.y}`,          // top-right shoulder (before the tip)
      `${right},${centerY}`,                 // the point (right-pointing tip)
      `${right - depth},${bottom}`,          // bottom-right shoulder
      `${node.x},${bottom}`,                 // bottom-left
      `${node.x + depth},${centerY}`,        // the notch vertex (cut inward)
   ].join(' ')
}

/**
 * Render the 'banner' shape: a lightly-rounded rect (reads as a flat heading bar) plus a thin solid
 * accent bar along its bottom edge in the resolved border color, the "underline" that gives it a
 * section-heading silhouette distinct from plain 'rounded'. Two elements, no separate stroke on the
 * accent (it's a fill-only rule sitting inside the main box).
 */
function renderBannerShape(node: DiagramNode, colors: ResolvedNodeColors): string {
   const body = selfClosingElement('rect', {
      x: node.x, y: node.y, width: node.width, height: node.height,
      rx: BANNER_CORNER_RADIUS, ry: BANNER_CORNER_RADIUS,
      fill: colors.fill, stroke: colors.stroke, 'stroke-width': NODE_STROKE_WIDTH,
   })
   const accentHeight = Math.min(BANNER_ACCENT_HEIGHT, Math.max(0, node.height / 4))
   const accent = accentHeight > 0
      ? selfClosingElement('rect', {
           x: node.x, y: node.y + node.height - accentHeight, width: node.width, height: accentHeight,
           fill: colors.stroke,
        })
      : ''
   return `${body}${accent}`
}

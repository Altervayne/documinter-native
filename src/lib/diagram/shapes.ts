/*
 * One SVG element builder per NodeShape. Each draws only the shape (fill + border); the centered
 * label is layered on separately by index.ts. Colors arrive as resolved literal hex.
 */

import type { DiagramNode, NodeShape } from './types'
import { selfClosingElement } from '../svg'

// #############
// # CONSTANTS #
// #############

export const NODE_STROKE_WIDTH = 1.5

const ROUNDED_CORNER_RADIUS = 8

const BANNER_CORNER_RADIUS = 4

/** Height of the 'banner' shape's bottom accent bar, the "underline" that reads as a heading rule. */
const BANNER_ACCENT_HEIGHT = 4

/** Chevron point/notch depth as a fraction of the node's half-height. Capped by
 *  {@link CHEVRON_MAX_DEPTH_WIDTH_RATIO} so a short/narrow node never self-intersects. */
const CHEVRON_POINT_DEPTH_RATIO = 0.6

/** Cap on the chevron point/notch depth (fraction of width) so the notch and point never cross center. */
const CHEVRON_MAX_DEPTH_WIDTH_RATIO = 0.45

// #####################
// # RESOLVED FILL/INK #
// #####################

/** A per-node override, else the theme default. */
export interface ResolvedNodeColors {
   fill:   string
   stroke: string
}

/** Dispatches on `node.shape`; an unknown shape falls back to a rectangle so the renderer is total. */
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
   return `${centerX},${node.y} ${right},${centerY} ${centerX},${bottom} ${node.x},${centerY}`
}

// #####################
// # HEADING SHAPES    #
// #####################

/**
 * The chevron point/notch depth (diagram units): how far the right tip pokes toward center and the
 * left notch cuts inward. From the half-height, then capped at a fraction of the width so the notch
 * and point never cross center. Exported so the renderer reserves the same inset for the label.
 */
export function chevronPointDepth(node: DiagramNode): number {
   const depth = (node.height / 2) * CHEVRON_POINT_DEPTH_RATIO
   const maxDepth = node.width * CHEVRON_MAX_DEPTH_WIDTH_RATIO
   return Math.max(0, Math.min(depth, maxDepth))
}

/**
 * The six vertex points of the chevron polygon: a rectangle whose right end comes to a point (on the
 * box's right wall, vertical center) and whose left end is cut with a matching inward notch (the
 * "process arrow" pentagon), so a row of them interlocks edge-to-edge.
 */
function chevronPoints(node: DiagramNode): string {
   const depth = chevronPointDepth(node)
   const right = node.x + node.width
   const bottom = node.y + node.height
   const centerY = node.y + node.height / 2
   return [
      `${node.x},${node.y}`,
      `${right - depth},${node.y}`,
      `${right},${centerY}`,
      `${right - depth},${bottom}`,
      `${node.x},${bottom}`,
      `${node.x + depth},${centerY}`,
   ].join(' ')
}

/** A lightly-rounded rect plus a fill-only bottom accent bar in the border color (the "underline"
 *  that distinguishes it from plain 'rounded'). */
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

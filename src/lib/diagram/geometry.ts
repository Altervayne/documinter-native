/*
 * DOM-free geometry helpers for the diagram renderer: node center/anchor geometry, edge endpoint
 * clipping to a shape's border (ray-shape intersection per shape), and the DOM-free label wrap/clip.
 * Total: a degenerate input (zero-size node, coincident points) degrades to the node center, no NaN.
 */

import type { DiagramNode, DiagramEdge, NodeShape, EdgeRouting } from './types'
import { DEFAULT_EDGE_ROUTING } from './types'

// #############
// # CONSTANTS #
// #############

/** Average glyph advance as a fraction of the font size. Deliberately generous so estimated widths
 *  over-reserve rather than clip, the honest constraint of string-generated SVG. */
export const AVERAGE_CHAR_WIDTH_RATIO = 0.6

/** Line-height as a multiple of the font size, for multi-line labels. */
export const LINE_HEIGHT_RATIO = 1.25

// #########
// # TYPES #
// #########

export interface Point {
   x: number
   y: number
}

export interface Bounds {
   minX: number
   minY: number
   maxX: number
   maxY: number
}

// ##################
// # NODE GEOMETRY  #
// ##################

/** The center point of a node's bounding box. */
export function nodeCenter(node: DiagramNode): Point {
   return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

/**
 * The point on a node's BORDER along the ray from center toward `toward`, so an edge touches the
 * shape edge not its center. Ellipse + diamond use their exact intersection; every rect-family shape
 * (including banner/chevron) approximates as the bounding rectangle. A zero-length ray or zero-size
 * node returns the center, never NaN.
 */
export function intersectNodeBoundary(node: DiagramNode, toward: Point): Point {
   const center = nodeCenter(node)
   const radiusX = node.width / 2
   const radiusY = node.height / 2
   const directionX = toward.x - center.x
   const directionY = toward.y - center.y

   if (radiusX <= 0 || radiusY <= 0) return center
   if (directionX === 0 && directionY === 0) return center

   const scale = boundaryScale(node.shape, directionX, directionY, radiusX, radiusY)
   if (!Number.isFinite(scale) || scale <= 0) return center

   return { x: center.x + directionX * scale, y: center.y + directionY * scale }
}

/** The scalar `t` such that `center + t * direction` lands on the shape's border. Positive finite,
 *  or Infinity for a degenerate direction (the caller falls back to the center). */
function boundaryScale(
   shape: NodeShape, directionX: number, directionY: number, radiusX: number, radiusY: number,
): number {
   if (shape === 'ellipse') {
      // (t*dx/rx)^2 + (t*dy/ry)^2 = 1  ->  t = 1 / sqrt((dx/rx)^2 + (dy/ry)^2)
      const normalizedX = directionX / radiusX
      const normalizedY = directionY / radiusY
      const denominator = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
      return denominator === 0 ? Infinity : 1 / denominator
   }
   if (shape === 'diamond') {
      // |t*dx|/rx + |t*dy|/ry = 1  ->  t = 1 / (|dx|/rx + |dy|/ry)
      const denominator = Math.abs(directionX) / radiusX + Math.abs(directionY) / radiusY
      return denominator === 0 ? Infinity : 1 / denominator
   }
   // rectangle / rounded / pill / banner / chevron: clip the ray to the box half-extents, take the
   // nearer wall (the bounding-rectangle approximation described above).
   const scaleX = directionX === 0 ? Infinity : radiusX / Math.abs(directionX)
   const scaleY = directionY === 0 ? Infinity : radiusY / Math.abs(directionY)
   return Math.min(scaleX, scaleY)
}

// ###################
// # EDGE GEOMETRY   #
// ###################

/**
 * The polyline an edge is drawn along, clipped to each endpoint's border. The SINGLE source of truth
 * shared by the renderer and the editor's hit-test, so a click lands on the line the author sees.
 * Waypoints define the bends; else an orthogonal single-mid elbow or a straight center-to-center
 * segment. Never obstacle-avoiding.
 */
export function edgePolyline(edge: DiagramEdge, fromNode: DiagramNode, toNode: DiagramNode): Point[] {
   const waypoints = (edge.waypoints ?? []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))

   if (waypoints.length > 0) {
      const start = intersectNodeBoundary(fromNode, waypoints[0])
      const end = intersectNodeBoundary(toNode, waypoints[waypoints.length - 1])
      return [start, ...waypoints, end]
   }

   const routing: EdgeRouting = edge.routing && isValidRouting(edge.routing) ? edge.routing : DEFAULT_EDGE_ROUTING
   if (routing === 'orthogonal') {
      return orthogonalElbow(fromNode, toNode)
   }

   const start = intersectNodeBoundary(fromNode, nodeCenter(toNode))
   const end = intersectNodeBoundary(toNode, nodeCenter(fromNode))
   return [start, end]
}

/** Whether a routing value is one of the accepted set (a hand-edited spec may carry garbage). */
function isValidRouting(routing: string): routing is EdgeRouting {
   return routing === 'straight' || routing === 'orthogonal'
}

/**
 * A perpendicular-exit elbow between two node borders. The dominant separation axis (by center
 * delta) picks which sides the edge exits/enters; a single mid-line bend joins the two right-angle
 * exits. Not obstacle-avoiding.
 */
function orthogonalElbow(fromNode: DiagramNode, toNode: DiagramNode): Point[] {
   const fromCenter = nodeCenter(fromNode)
   const toCenter = nodeCenter(toNode)
   const deltaX = toCenter.x - fromCenter.x
   const deltaY = toCenter.y - fromCenter.y

   if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      // Horizontal dominant: exit the left/right side, enter the opposite side.
      const start: Point = deltaX >= 0
         ? { x: fromNode.x + fromNode.width, y: fromCenter.y }
         : { x: fromNode.x, y: fromCenter.y }
      const end: Point = deltaX >= 0
         ? { x: toNode.x, y: toCenter.y }
         : { x: toNode.x + toNode.width, y: toCenter.y }
      const midX = (start.x + end.x) / 2
      return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
   }

   // Vertical dominant: exit the top/bottom, enter the opposite side.
   const start: Point = deltaY >= 0
      ? { x: fromCenter.x, y: fromNode.y + fromNode.height }
      : { x: fromCenter.x, y: fromNode.y }
   const end: Point = deltaY >= 0
      ? { x: toCenter.x, y: toNode.y }
      : { x: toCenter.x, y: toNode.y + toNode.height }
   const midY = (start.y + end.y) / 2
   return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
}

// ###################
// # BOUNDING BOXES  #
// ###################

/** The bounding box enclosing every point, padded on all sides. Empty geometry returns a small
 *  default box so the viewBox is never degenerate. */
export function contentBounds(points: Point[], padding: number): Bounds {
   if (points.length === 0) {
      return { minX: 0, minY: 0, maxX: padding * 2, maxY: padding * 2 }
   }
   let minX = Infinity
   let minY = Infinity
   let maxX = -Infinity
   let maxY = -Infinity
   for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      if (point.x < minX) minX = point.x
      if (point.y < minY) minY = point.y
      if (point.x > maxX) maxX = point.x
      if (point.y > maxY) maxY = point.y
   }
   if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, maxX: padding * 2, maxY: padding * 2 }
   }
   return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
   }
}

/** The four corner points of a node's bounding box. */
export function nodeCornerPoints(node: DiagramNode): Point[] {
   return [
      { x: node.x, y: node.y },
      { x: node.x + node.width, y: node.y },
      { x: node.x, y: node.y + node.height },
      { x: node.x + node.width, y: node.y + node.height },
   ]
}

// ###################
// # TEXT ESTIMATION #
// ###################

/** Estimate the rendered width of `text` with no DOM: `chars x fontSize x AVERAGE_CHAR_WIDTH_RATIO`. */
export function estimateTextWidth(text: string, fontSize: number): number {
   if (text.length === 0) return 0
   return text.length * fontSize * AVERAGE_CHAR_WIDTH_RATIO
}

/**
 * Wrap `label` to fit `maxWidth`, honoring explicit '\n' breaks then greedily word-wrapping. Past
 * `maxLines` the last kept line is ellipsized, the DOM-free analog of CSS line-clamp. A single word
 * wider than `maxWidth` is kept whole (never chopped) and may overflow. Empty label returns [].
 */
export function wrapLabel(label: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
   if (label === '') return []
   const authoredLines = label.split('\n')
   const wrapped: string[] = []

   for (const authored of authoredLines) {
      const words = authored.split(/\s+/).filter(word => word !== '')
      if (words.length === 0) {
         // A blank authored line is kept as an empty line.
         wrapped.push('')
         continue
      }
      let current = ''
      for (const word of words) {
         const candidate = current === '' ? word : `${current} ${word}`
         if (current !== '' && estimateTextWidth(candidate, fontSize) > maxWidth) {
            wrapped.push(current)
            current = word
         } else {
            current = candidate
         }
      }
      if (current !== '') wrapped.push(current)
   }

   if (maxLines > 0 && wrapped.length > maxLines) {
      const kept = wrapped.slice(0, maxLines)
      kept[kept.length - 1] = ellipsize(kept[kept.length - 1], maxWidth, fontSize)
      return kept
   }
   return wrapped
}

/** Trim `text` and append an ellipsis until it fits within `maxWidth` (at least the ellipsis). */
function ellipsize(text: string, maxWidth: number, fontSize: number): string {
   const ellipsis = '…'
   if (estimateTextWidth(text + ellipsis, fontSize) <= maxWidth) return text + ellipsis
   let trimmed = text
   while (trimmed.length > 0 && estimateTextWidth(trimmed + ellipsis, fontSize) > maxWidth) {
      trimmed = trimmed.slice(0, -1)
   }
   return trimmed + ellipsis
}

/** The maximum label lines that fit in a box of `height`. Always at least 1. */
export function maxLabelLines(height: number, fontSize: number): number {
   const lineHeight = fontSize * LINE_HEIGHT_RATIO
   if (lineHeight <= 0) return 1
   return Math.max(1, Math.floor(height / lineHeight))
}

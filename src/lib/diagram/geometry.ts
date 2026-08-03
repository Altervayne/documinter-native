/**
 * geometry.ts, the DOM-free geometry helpers for the diagram renderer.
 *
 * PURE FUNCTIONS. An SVG string has no DOM, so text cannot be measured and every coordinate must
 * be computed by hand. This module holds the genuinely non-trivial home-grown pieces flagged by
 * the study (docs/reference/diagrams_study.md, Q2):
 *   - node anchor / center geometry,
 *   - edge endpoint clipping to a shape's border (a ray-shape intersection per shape),
 *   - the DOM-free label wrap/clip estimate.
 *
 * Everything here is deterministic (no locale, no Date, no random) and total (a degenerate input,
 * e.g. a zero-size node or coincident points, degrades to the node center rather than emitting
 * NaN geometry), matching the "invalid never breaks the document" contract.
 */

import type { DiagramNode, DiagramEdge, NodeShape, EdgeRouting } from './types'
import { DEFAULT_EDGE_ROUTING } from './types'

// #############
// # CONSTANTS #
// #############

/**
 * Average glyph advance as a fraction of the font-size, for the system-ui sans the labels inherit.
 * Deliberately generous (~0.6em), the same estimate the graph layout uses, so estimated widths
 * over-reserve rather than clip. This is the honest constraint of string-generated SVG.
 */
export const AVERAGE_CHAR_WIDTH_RATIO = 0.6

/** Line-height as a multiple of the font size, for multi-line labels. */
export const LINE_HEIGHT_RATIO = 1.25

// #########
// # TYPES #
// #########

/** A 2D point in diagram units. */
export interface Point {
   x: number
   y: number
}

/** An axis-aligned bounding box in diagram units. */
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
 * The point on a node's BORDER along the ray from the node center toward `toward`. So an edge
 * touches the shape's edge, not its center. Shape-specific:
 *   - rectangle / rounded / pill / banner / chevron: a ray-box intersection (rounded corners, the
 *     banner's accent bar, and the chevron's point/notch are all approximated as the bounding
 *     rectangle, an accepted v1 simplification, headings rarely carry edges, and the error is a
 *     few px at most).
 *   - ellipse: the parametric ellipse intersection.
 *   - diamond: the rhombus (|dx|/rx + |dy|/ry = 1) intersection.
 * A `toward` point coincident with the center (zero-length ray) or a zero-size node returns the
 * center unchanged, never NaN.
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

/**
 * The scalar `t` such that `center + t * direction` lands on the shape's border. Factored out so
 * the per-shape math is testable in isolation. Returns a positive finite number, or Infinity for a
 * degenerate direction (the caller falls back to the center).
 */
function boundaryScale(
   shape: NodeShape, directionX: number, directionY: number, radiusX: number, radiusY: number,
): number {
   if (shape === 'ellipse') {
      // (t*dx/rx)^2 + (t*dy/ry)^2 = 1  →  t = 1 / sqrt((dx/rx)^2 + (dy/ry)^2)
      const normalizedX = directionX / radiusX
      const normalizedY = directionY / radiusY
      const denominator = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
      return denominator === 0 ? Infinity : 1 / denominator
   }
   if (shape === 'diamond') {
      // |t*dx|/rx + |t*dy|/ry = 1  →  t = 1 / (|dx|/rx + |dy|/ry)
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
 * The polyline an edge is drawn along, clipped to each endpoint node's border. This is the SINGLE
 * source of truth shared by the renderer (index.ts draws exactly this) and the interactive editor
 * (`lib/diagram/edit.ts` hit-tests against exactly this), so a click lands on the same line the
 * author sees. Three cases:
 *   - waypoints present: straight segments through them, clipped at both ends toward the nearer
 *     waypoint (the author's bends define the shape).
 *   - orthogonal, no waypoints: a perpendicular-exit single-mid elbow.
 *   - straight, no waypoints: a direct center-to-center segment clipped to both borders.
 * Never obstacle-avoiding (deferred per the study, Q4).
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
 * A perpendicular-exit orthogonal (elbow) path between two node borders. The dominant separation
 * axis (horizontal vs vertical, by center delta) decides which sides the edge exits/enters, so the
 * first and last segments leave each node at a right angle to its border; a single mid-line bend
 * joins them. Not obstacle-avoiding (deferred per the study, Q4) but clean and bounded.
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

/**
 * The bounding box enclosing every node (its full width/height) and every edge waypoint, padded
 * by `padding` on all sides. Used to compute an autofit viewBox when the spec carries no explicit
 * `options.canvas`. An empty geometry returns a small default box so the viewBox is never
 * degenerate.
 */
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
   // Every point was non-finite: fall back to the default box.
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

/** The four corner points of a node's bounding box (feeds contentBounds). */
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

/**
 * Estimate the rendered width of `text` at `fontSize`, with no DOM to measure against:
 * `characters × fontSize × AVERAGE_CHAR_WIDTH_RATIO`. Tuned to over-reserve. Empty text is zero.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
   if (text.length === 0) return 0
   return text.length * fontSize * AVERAGE_CHAR_WIDTH_RATIO
}

/**
 * Wrap `label` into lines that fit within `maxWidth` at `fontSize`, honoring explicit '\n' breaks
 * first, then greedily word-wrapping each authored line. If the wrapped result exceeds `maxLines`,
 * it is truncated and the last kept line is ellipsized ("…"), so a label can never overflow its
 * box unboundedly, the DOM-free analog of CSS line-clamp. A single word wider than `maxWidth`
 * is kept whole on its own line (never chopped mid-word); it may visually overflow, which the
 * author fixes by widening the node (author-sized boxes are the source of truth, per the study).
 *
 * Returns [] for an empty label (the renderer then draws no <text>).
 */
export function wrapLabel(label: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
   if (label === '') return []
   const authoredLines = label.split('\n')
   const wrapped: string[] = []

   for (const authored of authoredLines) {
      const words = authored.split(/\s+/).filter(word => word !== '')
      if (words.length === 0) {
         // A blank authored line (e.g. a deliberate empty row) is kept as an empty line.
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

/**
 * The maximum number of label lines that fit in a box of `height` at `fontSize` (accounting for
 * the line-height multiple). Always at least 1 so a short box still shows one line.
 */
export function maxLabelLines(height: number, fontSize: number): number {
   const lineHeight = fontSize * LINE_HEIGHT_RATIO
   if (lineHeight <= 0) return 1
   return Math.max(1, Math.floor(height / lineHeight))
}

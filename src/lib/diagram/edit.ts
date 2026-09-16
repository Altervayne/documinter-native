/*
 * PURE structural + geometric transforms for the diagram interactive editor. Each function returns a
 * BRAND-NEW value with one edit applied, never mutating the input, so the editor component stays thin
 * glue and the interaction math is unit-tested here. `removeNode` also drops every edge incident to
 * the deleted node, so the model never keeps a dangling reference. Every geometric field is in
 * ABSTRACT DIAGRAM UNITS; model writes round to whole units (see {@link roundUnit}).
 */

import type { DiagramSpec, DiagramNode, DiagramEdge, NodeShape, EdgeArrow, EdgeRouting } from './types'
import {
   DIAGRAM_DEFAULT_NODE_WIDTH, DIAGRAM_DEFAULT_NODE_HEIGHT,
   DIAGRAM_HEADING_NODE_WIDTH, DIAGRAM_HEADING_NODE_HEIGHT, isHeadingShape,
   DEFAULT_EDGE_ARROW, DEFAULT_EDGE_ROUTING,
} from './types'
import type { Point } from './geometry'
import { nodeCornerPoints, contentBounds, edgePolyline } from './geometry'

// #########
// # TYPES #
// #########

/** An axis-aligned box in diagram units (top-left + size). */
export interface NodeBox {
   x: number
   y: number
   width:  number
   height: number
}

/** The editor canvas viewBox in diagram units, held FIXED for a session so dragging never reflows
 *  the coordinate frame under the pointer (unlike the read-only block, which autofits). */
export interface DiagramViewBox {
   minX:   number
   minY:   number
   width:  number
   height: number
}

/** A minimal DOM-rect shape, so this stays DOM-free + testable. */
export interface CanvasRect {
   left:   number
   top:    number
   width:  number
   height: number
}

/**
 * The EPHEMERAL editor view transform: a zoom + pan on top of the fixed frame, mapping a diagram
 * point to view space (`view = scale * diagram + translate`). Never persisted or serialized; it only
 * reshapes what the canvas shows.
 */
export interface ViewTransform {
   scale:      number
   translateX: number
   translateY: number
}

/**
 * A single alignment guide drawn while a node is dragged. A 'vertical' guide is a constant-x line, a
 * 'horizontal' one constant-y; `position` is that constant, `from`/`to` the span on the other axis.
 */
export interface AlignmentGuide {
   orientation: 'vertical' | 'horizontal'
   position:    number
   from:        number
   to:          number
}

/** The snapped LEFT (`snapX`) and/or TOP (`snapY`) a dragged node should take, plus the guides. */
export interface AlignmentSnapResult {
   snapX?:  number
   snapY?:  number
   guides:  AlignmentGuide[]
}

/** The eight corner + edge midpoints of a node's box. */
export type NodeResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** A connection port on a node's perimeter (the four mid-edge sides), source/target of an edge drag. */
export type NodePort = 'n' | 'e' | 's' | 'w'

/** A port's identity + position, sitting just OUTSIDE the node border (see PORT_GAP). */
export interface NodePortPoint {
   port:  NodePort
   point: Point
}

/**
 * A style patch for an edge. A key present with a value SETS it, but the enumerated fields drop back
 * to lean at their render default (no redundant `arrow: 'end'`). `stroke` follows the override
 * convention: present-`undefined` CLEARS it, absent leaves it.
 */
export interface EdgeStylePatch {
   arrow?:   EdgeArrow
   routing?: EdgeRouting
   dashed?:  boolean
   stroke?:  string | undefined
}

/** A handle's identity + position, for rendering the selection chrome. */
export interface NodeHandlePoint {
   handle: NodeResizeHandle
   point:  Point
}

/**
 * A style patch for a node. A key present with `undefined` CLEARS that override (dropped so the theme
 * default returns and the fence stays lean); absent leaves it. `shape` has no clear, so an undefined
 * `shape` is ignored.
 */
export interface NodeStylePatch {
   shape?:     NodeShape
   fill?:      string | undefined
   stroke?:    string | undefined
   textColor?: string | undefined
}

// #############
// # CONSTANTS #
// #############

/** Smallest a node may be resized to, so a shape never collapses to zero. */
export const NODE_MIN_WIDTH = 24
export const NODE_MIN_HEIGHT = 20

/** The eight box handles, in a stable order (corners then edge midpoints). */
export const NODE_BOX_HANDLES: NodeResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const NODE_HANDLE_HIT_TOLERANCE = 10

/** How far the connection ports sit OUTSIDE the border, clear of the mid-edge resize handles that
 *  sit ON it, reading as the familiar floating-port affordance. */
export const PORT_GAP = 10

export const PORT_HIT_TOLERANCE = 8

/** Edge-select tolerance. The caller converts a screen-pixel threshold through the current zoom, so
 *  a thin line stays clickable at any scale. Also the default when omitted. */
export const EDGE_HIT_TOLERANCE = 6

export const EDITOR_CANVAS_PADDING = 40
export const EDITOR_CANVAS_MIN_WIDTH = 320
export const EDITOR_CANVAS_MIN_HEIGHT = 220

export const VIEW_MIN_SCALE = 0.25
export const VIEW_MAX_SCALE = 4

export const IDENTITY_VIEW_TRANSFORM: ViewTransform = { scale: 1, translateX: 0, translateY: 0 }

export const FIT_VIEW_PADDING = 24

/** Snap distance. The caller converts a screen-pixel threshold through the current zoom; also the
 *  default when omitted. */
export const ALIGNMENT_SNAP_THRESHOLD = 6

/** Two alignment lines within this distance count as coincident when spanning guides. */
export const GUIDE_MATCH_EPSILON = 0.5

/** User-resizable editor-canvas height (screen px), default + clamp range. Never persisted. */
export const CANVAS_MIN_HEIGHT = 200
export const CANVAS_MAX_HEIGHT = 900
export const CANVAS_DEFAULT_HEIGHT = 380

// ###########
// # HELPERS #
// ###########

/** Round a diagram-unit coordinate to a whole number; a non-finite value collapses to 0. */
export function roundUnit(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value)
}

/** Replace the node sharing `next.id`, preserving order (no-op if the id is absent). */
export function setNode(spec: DiagramSpec, next: DiagramNode): DiagramSpec {
   return { ...spec, nodes: spec.nodes.map(node => (node.id === next.id ? next : node)) }
}

const replaceNode = setNode

export function findNode(spec: DiagramSpec, id: string): DiagramNode | null {
   return spec.nodes.find(node => node.id === id) ?? null
}

// ####################
// # VIEW TRANSFORM   #
// ####################

export function clampViewScale(scale: number): number {
   if (!Number.isFinite(scale)) return 1
   return Math.min(VIEW_MAX_SCALE, Math.max(VIEW_MIN_SCALE, scale))
}

export function applyViewTransform(point: Point, view: ViewTransform): Point {
   return { x: view.scale * point.x + view.translateX, y: view.scale * point.y + view.translateY }
}

/** Inverse of {@link applyViewTransform}. A zero/non-finite scale falls back to 1. */
export function invertViewTransform(point: Point, view: ViewTransform): Point {
   const scale = Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1
   return { x: (point.x - view.translateX) / scale, y: (point.y - view.translateY) / scale }
}

/** Zoom to `nextScale` (clamped) while keeping the diagram point under `viewCursor` (view space)
 *  pinned: zoom toward the cursor. */
export function zoomViewToward(view: ViewTransform, viewCursor: Point, nextScale: number): ViewTransform {
   const scale = clampViewScale(nextScale)
   const anchor = invertViewTransform(viewCursor, view)
   return {
      scale,
      translateX: viewCursor.x - scale * anchor.x,
      translateY: viewCursor.y - scale * anchor.y,
   }
}

/** A view transform that frames every node within `frame`, centered, with `padding` breathing room
 *  and the scale clamped. An empty diagram returns the identity transform. */
export function fitViewToContent(
   spec: DiagramSpec, frame: DiagramViewBox, padding: number = FIT_VIEW_PADDING,
): ViewTransform {
   const points: Point[] = []
   for (const node of spec.nodes) points.push(...nodeCornerPoints(node))
   if (points.length === 0) return IDENTITY_VIEW_TRANSFORM

   const bounds = contentBounds(points, 0)
   const contentWidth  = Math.max(1, bounds.maxX - bounds.minX)
   const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
   const availableWidth  = Math.max(1, frame.width  - padding * 2)
   const availableHeight = Math.max(1, frame.height - padding * 2)

   const scale = clampViewScale(Math.min(availableWidth / contentWidth, availableHeight / contentHeight))
   const contentCenterX = (bounds.minX + bounds.maxX) / 2
   const contentCenterY = (bounds.minY + bounds.maxY) / 2
   const frameCenterX = frame.minX + frame.width  / 2
   const frameCenterY = frame.minY + frame.height / 2
   return {
      scale,
      translateX: frameCenterX - scale * contentCenterX,
      translateY: frameCenterY - scale * contentCenterY,
   }
}

/**
 * The editor canvas's render viewBox in diagram units, from the fixed `frame` and the view transform.
 * The heart of the unbounded-canvas model: nodes draw at absolute coordinates and only this window
 * limits what is visible, so any node is reachable by panning/zooming. Inverting the view transform
 * for the container edges gives `minX = -translateX / scale`, `width = frame.width / scale`. Zero/
 * non-finite scale falls back to 1; the viewport shares the frame aspect, so no letterbox.
 */
export function viewportViewBox(frame: { width: number; height: number }, view: ViewTransform): DiagramViewBox {
   const scale = Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1
   // `+ 0` normalizes a negative zero (from `-0 / scale`) to `0` so the viewBox string stays clean.
   return {
      minX:   -view.translateX / scale + 0,
      minY:   -view.translateY / scale + 0,
      width:  frame.width  / scale,
      height: frame.height / scale,
   }
}

/** Clamp a requested editor-canvas height (screen px); non-finite falls back to the default. */
export function clampCanvasHeight(height: number): number {
   if (!Number.isFinite(height)) return CANVAS_DEFAULT_HEIGHT
   return Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, height))
}

/**
 * The editor's fixed reference frame, whose aspect ratio EXACTLY matches the container's. This is what
 * makes a user-resizable-height canvas correct: the frame follows the container aspect, so the
 * screen-to-diagram map and the SVG viewBox stay consistent and undistorted at any height. Height =
 * referenceWidth / (containerWidth / containerHeight); a degenerate container falls back to a
 * square-ish frame. Origin is (0, 0).
 */
export function frameFromContainer(
   referenceWidth: number, containerWidth: number, containerHeight: number,
): DiagramViewBox {
   const width = referenceWidth > 0 ? referenceWidth : EDITOR_CANVAS_MIN_WIDTH
   const aspect = containerWidth > 0 && containerHeight > 0 ? containerWidth / containerHeight : 1
   const height = aspect > 0 ? width / aspect : width
   return { minX: 0, minY: 0, width, height }
}

// ####################
// # POINTER MAPPING  #
// ####################

/**
 * Map a pointer's viewport coordinates to a VIEW-SPACE point relative to the canvas `rect`. Transform
 * INDEPENDENT (no zoom/pan applied): the same screen pixel over the same rect always yields the same
 * point, which a pan delta and a zoom anchor need. A zero-size rect maps to the frame origin.
 */
export function screenToFramePoint(clientX: number, clientY: number, rect: CanvasRect, frame: DiagramViewBox): Point {
   const x = rect.width  > 0 ? frame.minX + (clientX - rect.left) / rect.width  * frame.width  : frame.minX
   const y = rect.height > 0 ? frame.minY + (clientY - rect.top)  / rect.height * frame.height : frame.minY
   return { x, y }
}

/**
 * Map a pointer's viewport coordinates to DIAGRAM units, composing the `view` transform on top of the
 * fixed `frame`: screen -> view space -> diagram units. The identity transform (the default) is the
 * plain proportional frame map. NOT rounded; model writes round at mutation time.
 */
export function pointerToDiagramPoint(
   clientX: number, clientY: number, rect: CanvasRect, frame: DiagramViewBox,
   view: ViewTransform = IDENTITY_VIEW_TRANSFORM,
): Point {
   return invertViewTransform(screenToFramePoint(clientX, clientY, rect, frame), view)
}

/** A FIXED editor-canvas extent covering the content with padding, floored at a minimum. Origin is
 *  always (0, 0); held fixed for the session so the frame stays stable while nodes are dragged. */
export function computeEditorCanvas(spec: DiagramSpec): { width: number; height: number } {
   const points: Point[] = []
   for (const node of spec.nodes) points.push(...nodeCornerPoints(node))
   for (const edge of spec.edges ?? []) {
      for (const waypoint of edge.waypoints ?? []) points.push(waypoint)
   }
   if (points.length === 0) {
      return { width: EDITOR_CANVAS_MIN_WIDTH, height: EDITOR_CANVAS_MIN_HEIGHT }
   }
   const bounds = contentBounds(points, EDITOR_CANVAS_PADDING)
   return {
      width:  Math.max(EDITOR_CANVAS_MIN_WIDTH,  Math.ceil(Math.max(bounds.maxX, 0))),
      height: Math.max(EDITOR_CANVAS_MIN_HEIGHT, Math.ceil(Math.max(bounds.maxY, 0))),
   }
}

// ####################
// # BOUNDING BOX     #
// ####################

/** A node's axis-aligned bounding box (width/height normalized non-negative). */
export function nodeBox(node: DiagramNode): NodeBox {
   const width  = Math.max(0, node.width)
   const height = Math.max(0, node.height)
   return { x: node.x, y: node.y, width, height }
}

// ##################
// # CREATE / ADD   #
// ##################

/** Build a new node of `shape` centered on `center`. A HEADING shape seeds at the wider, shorter
 *  heading size (see {@link isHeadingShape}); style overrides start empty (theme defaults). */
export function createNode(shape: NodeShape, center: Point, label: string, id: string): DiagramNode {
   const heading = isHeadingShape(shape)
   const width  = heading ? DIAGRAM_HEADING_NODE_WIDTH  : DIAGRAM_DEFAULT_NODE_WIDTH
   const height = heading ? DIAGRAM_HEADING_NODE_HEIGHT : DIAGRAM_DEFAULT_NODE_HEIGHT
   return {
      id,
      x: roundUnit(center.x - width / 2),
      y: roundUnit(center.y - height / 2),
      width,
      height,
      shape,
      label,
   }
}

/** Append a node to the end of the node list (later = drawn on top / hit first). */
export function addNode(spec: DiagramSpec, node: DiagramNode): DiagramSpec {
   return { ...spec, nodes: [...spec.nodes, node] }
}

/** Clone `node` with a NEW id and its top-left nudged by `offset` on both axes, so the copy sits
 *  clear of the original. The caller inserts the result with {@link addNode}. */
export function duplicateNode(node: DiagramNode, idFactory: () => string, offset: number): DiagramNode {
   return {
      ...node,
      id: idFactory(),
      x: roundUnit(node.x + offset),
      y: roundUnit(node.y + offset),
   }
}

/** Remove the node with `id` AND every edge incident to it, so the model never keeps a dangling edge. */
export function removeNode(spec: DiagramSpec, id: string): DiagramSpec {
   return {
      ...spec,
      nodes: spec.nodes.filter(node => node.id !== id),
      edges: (spec.edges ?? []).filter(edge => edge.from !== id && edge.to !== id),
   }
}

// ########
// # MOVE #
// ########

/** Translate the node `id` by (deltaX, deltaY), returning a new spec. No clamping: a node may be
 *  dragged anywhere and the read-only block autofits. No-op if the id is absent. */
export function moveNode(spec: DiagramSpec, id: string, deltaX: number, deltaY: number): DiagramSpec {
   const node = findNode(spec, id)
   if (!node) return spec
   return replaceNode(spec, translateNode(node, deltaX, deltaY))
}

/** Translate one node, returning a new node with the moved, rounded top-left. A live move-drag applies
 *  the delta to the node captured AT DRAG START, so repeated moves never accumulate rounding error. */
export function translateNode(node: DiagramNode, deltaX: number, deltaY: number): DiagramNode {
   return { ...node, x: roundUnit(node.x + deltaX), y: roundUnit(node.y + deltaY) }
}

// ##########
// # RESIZE #
// ##########

/** Move the `handle` of the node `id` to `point`, keeping the opposite edge(s) fixed and re-deriving
 *  the box, floored at the min size so it never inverts. No-op if the id is absent. */
export function resizeNode(spec: DiagramSpec, id: string, handle: NodeResizeHandle, point: Point): DiagramSpec {
   const node = findNode(spec, id)
   if (!node) return spec
   return replaceNode(spec, resizeNodeBox(node, handle, point))
}

function resizeNodeBox(node: DiagramNode, handle: NodeResizeHandle, point: Point): DiagramNode {
   let left   = node.x
   let top    = node.y
   let right  = node.x + node.width
   let bottom = node.y + node.height

   // Left-side handles move the left edge; right-side move the right edge; likewise top/bottom.
   if (handle === 'nw' || handle === 'w' || handle === 'sw') left = point.x
   if (handle === 'ne' || handle === 'e' || handle === 'se') right = point.x
   if (handle === 'nw' || handle === 'n' || handle === 'ne') top = point.y
   if (handle === 'sw' || handle === 's' || handle === 'se') bottom = point.y

   // Floor the size so an edge dragged past its opposite one stops at the minimum, never inverting.
   if (right - left < NODE_MIN_WIDTH) {
      if (handle === 'nw' || handle === 'w' || handle === 'sw') left = right - NODE_MIN_WIDTH
      else right = left + NODE_MIN_WIDTH
   }
   if (bottom - top < NODE_MIN_HEIGHT) {
      if (handle === 'nw' || handle === 'n' || handle === 'ne') top = bottom - NODE_MIN_HEIGHT
      else bottom = top + NODE_MIN_HEIGHT
   }

   return {
      ...node,
      x:      roundUnit(left),
      y:      roundUnit(top),
      width:  roundUnit(right - left),
      height: roundUnit(bottom - top),
   }
}

// ################
// # LABEL / STYLE #
// ################

/** Set the label of the node `id` (no-op if the id is absent). */
export function updateNodeLabel(spec: DiagramSpec, id: string, label: string): DiagramSpec {
   const node = findNode(spec, id)
   if (!node) return spec
   return replaceNode(spec, { ...node, label })
}

/** Apply a style patch to the node `id`: a value SETS, present-`undefined` CLEARS (theme default
 *  returns), absent leaves untouched. `shape` is set only when defined. No-op if the id is absent. */
export function updateNodeStyle(spec: DiagramSpec, id: string, patch: NodeStylePatch): DiagramSpec {
   const node = findNode(spec, id)
   if (!node) return spec

   const next: DiagramNode = { ...node }
   if (patch.shape !== undefined) next.shape = patch.shape
   applyOverride(next, 'fill', patch)
   applyOverride(next, 'stroke', patch)
   applyOverride(next, 'textColor', patch)
   return replaceNode(spec, next)
}

/** Set an optional override when the key is present; present-`undefined` clears it. */
function applyOverride(node: DiagramNode, key: 'fill' | 'stroke' | 'textColor', patch: NodeStylePatch): void {
   if (!(key in patch)) return
   const value = patch[key]
   if (value === undefined) delete node[key]
   else node[key] = value
}

// ############
// # HIT TEST #
// ############

/** The TOPMOST node under `point` (last = drawn on top = hit first), or null. Every shape hit-tests
 *  against its bounding box grown by `tolerance` (deliberately forgiving, no shape-exact test). */
export function hitTestNode(spec: DiagramSpec, point: Point, tolerance = 0): DiagramNode | null {
   for (let index = spec.nodes.length - 1; index >= 0; index -= 1) {
      const box = nodeBox(spec.nodes[index])
      if (point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance
         && point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance) {
         return spec.nodes[index]
      }
   }
   return null
}

/** The eight resize handles of a node, with their positions. */
export function nodeHandlePoints(node: DiagramNode): NodeHandlePoint[] {
   const { x, y, width, height } = node
   const midX = x + width / 2
   const midY = y + height / 2
   const positions: Record<NodeResizeHandle, Point> = {
      nw: { x,          y },
      n:  { x: midX,    y },
      ne: { x: x + width, y },
      e:  { x: x + width, y: midY },
      se: { x: x + width, y: y + height },
      s:  { x: midX,    y: y + height },
      sw: { x,          y: y + height },
      w:  { x,          y: midY },
   }
   return NODE_BOX_HANDLES.map(handle => ({ handle, point: positions[handle] }))
}

/** The resize handle of `node` within `tolerance` of `point` (nearest wins), or null. Decides, on
 *  pointer-down over the selected node, whether the press begins a resize rather than a move. */
export function hitTestNodeHandle(
   node: DiagramNode, point: Point, tolerance = NODE_HANDLE_HIT_TOLERANCE,
): NodeResizeHandle | null {
   let best: NodeResizeHandle | null = null
   let bestDistance = tolerance
   for (const { handle, point: handlePoint } of nodeHandlePoints(node)) {
      const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y)
      if (distance <= bestDistance) {
         best = handle
         bestDistance = distance
      }
   }
   return best
}

// #################
// # ALIGNMENT SNAP #
// #################

/** A box's three vertical reference lines (left / center / right). */
function boxVerticalLines(box: NodeBox): number[] {
   return [box.x, box.x + box.width / 2, box.x + box.width]
}

/** A box's three horizontal reference lines (top / center / bottom). */
function boxHorizontalLines(box: NodeBox): number[] {
   return [box.y, box.y + box.height / 2, box.y + box.height]
}

/** The signed offset (`otherLine - draggedLine`) snapping the NEAREST pair within `threshold`, or
 *  null. First nearest pair wins ties, so the result is deterministic. */
function nearestLineSnap(draggedLines: number[], otherLines: number[][], threshold: number): number | null {
   let best: number | null = null
   let bestDistance = Infinity
   for (const draggedLine of draggedLines) {
      for (const lines of otherLines) {
         for (const otherLine of lines) {
            const offset = otherLine - draggedLine
            const distance = Math.abs(offset)
            if (distance <= threshold && distance < bestDistance) {
               best = offset
               bestDistance = distance
            }
         }
      }
   }
   return best
}

/** The cross-axis span [start, end] of a box (y for a vertical guide, x for a horizontal one). */
function crossExtentOf(orientation: 'vertical' | 'horizontal', box: NodeBox): [number, number] {
   return orientation === 'vertical' ? [box.y, box.y + box.height] : [box.x, box.x + box.width]
}

/** The single alignment guide for `movingBox` at `position`, or null when no OTHER box has a line
 *  coincident (within {@link GUIDE_MATCH_EPSILON}). Spans the moving box + every coincident box. */
function buildAxisGuide(
   orientation: 'vertical' | 'horizontal', position: number, movingBox: NodeBox, others: NodeBox[],
): AlignmentGuide | null {
   const referenceLines = orientation === 'vertical' ? boxVerticalLines : boxHorizontalLines
   const coincident = others.filter(
      other => referenceLines(other).some(line => Math.abs(line - position) <= GUIDE_MATCH_EPSILON),
   )
   if (coincident.length === 0) return null
   const crossValues: number[] = [...crossExtentOf(orientation, movingBox)]
   for (const other of coincident) crossValues.push(...crossExtentOf(orientation, other))
   return { orientation, position, from: Math.min(...crossValues), to: Math.max(...crossValues) }
}

/** The guide lines for a snapped axis: one guide per reference line of the snapped box that coincides
 *  with an other box's line. Deduplicated by rounded position. */
function axisGuides(orientation: 'vertical' | 'horizontal', shifted: NodeBox, others: NodeBox[]): AlignmentGuide[] {
   const referenceLines = orientation === 'vertical' ? boxVerticalLines : boxHorizontalLines

   const guides: AlignmentGuide[] = []
   const seenPositions = new Set<number>()
   for (const position of referenceLines(shifted)) {
      const guide = buildAxisGuide(orientation, position, shifted, others)
      if (!guide) continue
      const positionKey = Math.round(position)
      if (seenPositions.has(positionKey)) continue
      seenPositions.add(positionKey)
      guides.push(guide)
   }
   return guides
}

/**
 * Probe the dragged node against every other for edge/center alignment. Compares left/center/right and
 * top/center/bottom against every other box's lines; within `threshold` the axis snaps to the nearest
 * matching line, INDEPENDENTLY on x and y. The caller applies `snapX`/`snapY` as a normal node move.
 */
export function computeAlignmentSnaps(
   dragged: NodeBox, others: NodeBox[], threshold: number = ALIGNMENT_SNAP_THRESHOLD,
): AlignmentSnapResult {
   const otherVerticalLines   = others.map(boxVerticalLines)
   const otherHorizontalLines = others.map(boxHorizontalLines)

   const offsetX = nearestLineSnap(boxVerticalLines(dragged), otherVerticalLines, threshold)
   const offsetY = nearestLineSnap(boxHorizontalLines(dragged), otherHorizontalLines, threshold)

   const snapX = offsetX !== null ? dragged.x + offsetX : undefined
   const snapY = offsetY !== null ? dragged.y + offsetY : undefined

   const shifted: NodeBox = {
      x:      snapX ?? dragged.x,
      y:      snapY ?? dragged.y,
      width:  dragged.width,
      height: dragged.height,
   }

   const guides: AlignmentGuide[] = []
   if (snapX !== undefined) guides.push(...axisGuides('vertical', shifted, others))
   if (snapY !== undefined) guides.push(...axisGuides('horizontal', shifted, others))

   return { snapX, snapY, guides }
}

// ####################
// # RESIZE SNAP      #
// ####################

/** Which edges of a node's box a given resize handle moves (the others stay pinned). */
export interface MovingEdges {
   left?:   boolean
   right?:  boolean
   top?:    boolean
   bottom?: boolean
}

/** The box edges a resize `handle` drags: a side handle moves one edge, a corner moves the two
 *  meeting at it. Matches {@link resizeNode}'s geometry. */
export function resizeHandleEdges(handle: NodeResizeHandle): MovingEdges {
   return {
      left:   handle === 'nw' || handle === 'w' || handle === 'sw',
      right:  handle === 'ne' || handle === 'e' || handle === 'se',
      top:    handle === 'nw' || handle === 'n' || handle === 'ne',
      bottom: handle === 'sw' || handle === 's' || handle === 'se',
   }
}

/** The snapped, min-size-floored rect plus the guide lines to draw for a resize-drag snap. */
export interface ResizeSnapResult {
   rect:   NodeBox
   guides: AlignmentGuide[]
}

/**
 * Snap the MOVING edge(s) of an in-progress resized `rect` to nearby other-node edge/center lines.
 * Unlike {@link computeAlignmentSnaps} (which slides the whole box), this snaps only the edges the
 * `handle` drags (see {@link resizeHandleEdges}), leaving the opposite edge pinned, so the box's SIZE
 * changes to meet the neighbor. Re-floored to the min size, backing the snap off if it would collapse
 * the box. A guide is emitted for every snapped moving edge that lands on an other line.
 */
export function computeResizeSnaps(
   rect: NodeBox, handle: NodeResizeHandle, others: NodeBox[], threshold: number = ALIGNMENT_SNAP_THRESHOLD,
): ResizeSnapResult {
   const edges = resizeHandleEdges(handle)
   const otherVerticalLines   = others.map(boxVerticalLines)
   const otherHorizontalLines = others.map(boxHorizontalLines)

   let left   = rect.x
   let right  = rect.x + rect.width
   let top    = rect.y
   let bottom = rect.y + rect.height

   // Snap each MOVING edge to the nearest matching other line (the pinned edges never move).
   if (edges.left) {
      const offset = nearestLineSnap([left], otherVerticalLines, threshold)
      if (offset !== null) left += offset
   }
   if (edges.right) {
      const offset = nearestLineSnap([right], otherVerticalLines, threshold)
      if (offset !== null) right += offset
   }
   if (edges.top) {
      const offset = nearestLineSnap([top], otherHorizontalLines, threshold)
      if (offset !== null) top += offset
   }
   if (edges.bottom) {
      const offset = nearestLineSnap([bottom], otherHorizontalLines, threshold)
      if (offset !== null) bottom += offset
   }

   // Re-floor: a snap past the minimum backs off on the MOVING edge, keeping the pinned edge fixed.
   if (right - left < NODE_MIN_WIDTH) {
      if (edges.left) left = right - NODE_MIN_WIDTH
      else right = left + NODE_MIN_WIDTH
   }
   if (bottom - top < NODE_MIN_HEIGHT) {
      if (edges.top) top = bottom - NODE_MIN_HEIGHT
      else bottom = top + NODE_MIN_HEIGHT
   }

   const snapped: NodeBox = { x: left, y: top, width: right - left, height: bottom - top }

   // A guide only for a snapped MOVING edge, so a resize never draws one for a pinned side that
   // happened to already align.
   const guides: AlignmentGuide[] = []
   const pushGuide = (guide: AlignmentGuide | null): void => { if (guide) guides.push(guide) }
   if (edges.left)   pushGuide(buildAxisGuide('vertical',   snapped.x,                    snapped, others))
   if (edges.right)  pushGuide(buildAxisGuide('vertical',   snapped.x + snapped.width,    snapped, others))
   if (edges.top)    pushGuide(buildAxisGuide('horizontal', snapped.y,                    snapped, others))
   if (edges.bottom) pushGuide(buildAxisGuide('horizontal', snapped.y + snapped.height,   snapped, others))

   return { rect: snapped, guides }
}

// #################
// # EDGE CRUD      #
// #################

/** Build a new straight, default-arrow edge from one node id to another. */
export function createEdge(from: string, to: string, id: string): DiagramEdge {
   return { id, from, to }
}

/** Append an edge to the end of the edge list (later = drawn on top / hit first on a tie). */
export function addEdge(spec: DiagramSpec, edge: DiagramEdge): DiagramSpec {
   return { ...spec, edges: [...(spec.edges ?? []), edge] }
}

/** Remove the edge with `id` (no-op if the id is absent). */
export function deleteEdge(spec: DiagramSpec, id: string): DiagramSpec {
   return { ...spec, edges: (spec.edges ?? []).filter(edge => edge.id !== id) }
}

export function findEdge(spec: DiagramSpec, id: string): DiagramEdge | null {
   return (spec.edges ?? []).find(edge => edge.id === id) ?? null
}

/** Replace the edge sharing `next.id`, preserving order (no-op if the id is absent). */
export function setEdge(spec: DiagramSpec, next: DiagramEdge): DiagramSpec {
   return { ...spec, edges: (spec.edges ?? []).map(edge => (edge.id === next.id ? next : edge)) }
}

/** Set the label of the edge `id`. An empty label DROPS the field so the fence stays lean. No-op if
 *  the id is absent. */
export function updateEdgeLabel(spec: DiagramSpec, id: string, label: string): DiagramSpec {
   const edge = findEdge(spec, id)
   if (!edge) return spec
   const next: DiagramEdge = { ...edge }
   if (label.trim() === '') delete next.label
   else next.label = label
   return setEdge(spec, next)
}

/** Apply a style patch to the edge `id`. A value equal to the render default is DROPPED (a lean spec
 *  never stores `arrow: 'end'`); `stroke` clears on present-`undefined`. No-op if the id is absent. */
export function updateEdgeStyle(spec: DiagramSpec, id: string, patch: EdgeStylePatch): DiagramSpec {
   const edge = findEdge(spec, id)
   if (!edge) return spec
   const next: DiagramEdge = { ...edge }

   if (patch.arrow !== undefined) {
      if (patch.arrow === DEFAULT_EDGE_ARROW) delete next.arrow
      else next.arrow = patch.arrow
   }
   if (patch.routing !== undefined) {
      if (patch.routing === DEFAULT_EDGE_ROUTING) delete next.routing
      else next.routing = patch.routing
   }
   if ('dashed' in patch) {
      if (patch.dashed) next.dashed = true
      else delete next.dashed
   }
   if ('stroke' in patch) {
      if (patch.stroke === undefined) delete next.stroke
      else next.stroke = patch.stroke
   }
   return setEdge(spec, next)
}

// #################
// # PORT GEOMETRY  #
// #################

/** A node's four connection ports (N/E/S/W mid-edges), each offset `gap` OUTSIDE the border. The
 *  author drags FROM these to draw an edge; the offset keeps them clear of the resize handles. */
export function nodePorts(node: DiagramNode, gap: number = PORT_GAP): NodePortPoint[] {
   const { x, y, width, height } = node
   const midX = x + width / 2
   const midY = y + height / 2
   return [
      { port: 'n', point: { x: midX,          y: y - gap } },
      { port: 'e', point: { x: x + width + gap, y: midY } },
      { port: 's', point: { x: midX,          y: y + height + gap } },
      { port: 'w', point: { x: x - gap,        y: midY } },
   ]
}

/** The connection port of `node` within `tolerance` of `point` (nearest wins), or null. Decides, on
 *  pointer-down over a hovered node, whether the press begins an edge-connect drag rather than a move. */
export function hitTestPort(
   node: DiagramNode, point: Point, tolerance: number = PORT_HIT_TOLERANCE,
): NodePort | null {
   let best: NodePort | null = null
   let bestDistance = tolerance
   for (const { port, point: portPoint } of nodePorts(node)) {
      const distance = Math.hypot(point.x - portPoint.x, point.y - portPoint.y)
      if (distance <= bestDistance) {
         best = port
         bestDistance = distance
      }
   }
   return best
}

// #################
// # EDGE HIT TEST  #
// #################

/** The perpendicular distance from `point` to the segment a-b (clamped to the segment's extent). */
export function distancePointToSegment(point: Point, a: Point, b: Point): number {
   const deltaX = b.x - a.x
   const deltaY = b.y - a.y
   const lengthSquared = deltaX * deltaX + deltaY * deltaY
   if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)
   let t = ((point.x - a.x) * deltaX + (point.y - a.y) * deltaY) / lengthSquared
   t = Math.max(0, Math.min(1, t))
   const projectedX = a.x + t * deltaX
   const projectedY = a.y + t * deltaY
   return Math.hypot(point.x - projectedX, point.y - projectedY)
}

/** The minimum distance from `point` to any segment of the polyline (Infinity for fewer than 2 points). */
export function distanceToPolyline(point: Point, polyline: Point[]): number {
   let minimum = Infinity
   for (let index = 0; index < polyline.length - 1; index += 1) {
      const distance = distancePointToSegment(point, polyline[index], polyline[index + 1])
      if (distance < minimum) minimum = distance
   }
   return minimum
}

/** The edge whose drawn polyline passes within `tolerance` of `point` (nearest wins, later edges win a
 *  tie), or null. Reconstructs each polyline via the SHARED {@link edgePolyline} so the hit area
 *  matches what the renderer draws. A dangling edge is skipped. */
export function hitTestEdge(spec: DiagramSpec, point: Point, tolerance: number = EDGE_HIT_TOLERANCE): DiagramEdge | null {
   const nodesById = new Map<string, DiagramNode>()
   for (const node of spec.nodes) nodesById.set(node.id, node)

   let best: DiagramEdge | null = null
   let bestDistance = tolerance
   for (const edge of spec.edges ?? []) {
      const fromNode = nodesById.get(edge.from)
      const toNode = nodesById.get(edge.to)
      if (!fromNode || !toNode) continue
      const polyline = edgePolyline(edge, fromNode, toNode)
      if (polyline.length < 2) continue
      const distance = distanceToPolyline(point, polyline)
      if (distance <= bestDistance) {
         best = edge
         bestDistance = distance
      }
   }
   return best
}

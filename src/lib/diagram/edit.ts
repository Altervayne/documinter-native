/**
 * edit.ts, PURE structural + geometric transforms for the diagram (nodes + links) interactive editor.
 *
 * PURE DATA / PURE FUNCTIONS, side-effect free, imports only the diagram types + the (pure, DOM-free)
 * geometry helpers. Each function takes a DiagramSpec (or a node) and returns a BRAND-NEW value with
 * one edit applied, NEVER mutating the input. This is the single tested place the node editor's
 * pointer-driven add / move / resize / delete / hit-test / label / style operations live (mirrors
 * `lib/imageMarkup/edit.ts` for the image-markup block and `lib/graphEdit.ts` for the graph block):
 * the editor component (`blocks/DiagramBlock.tsx` + the `molecules/Diagram*` panels) is thin glue
 * over these helpers, so the interaction math is all unit-tested here rather than in the UI.
 *
 * Covers both nodes and edges. Every node transform leaves edges untouched except `removeNode`,
 * which also drops every edge incident to the deleted node, so the model never keeps a dangling
 * reference.
 *
 * Coordinate convention (see types.ts): every geometric field is in ABSTRACT DIAGRAM UNITS, not
 * screen pixels. Pointer coordinates are mapped into this space via {@link pointerToDiagramPoint}
 * against the on-screen canvas rect + the canvas viewBox. Model writes round to whole diagram units
 * (see {@link roundUnit}) so a hand-edited fence table stays clean and the SVG output is compact.
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

/**
 * The numeric render viewBox of the editor canvas, in diagram units. The editor holds this FIXED for
 * an editing session so dragging a node never reflows the coordinate frame under the pointer (unlike
 * the read-only block, which autofits). Maps 1:1 with the on-screen canvas via {@link pointerToDiagramPoint}.
 */
export interface DiagramViewBox {
   minX:   number
   minY:   number
   width:  number
   height: number
}

/** A minimal DOM-rect shape (only the fields the mapping needs), so this stays DOM-free + testable. */
export interface CanvasRect {
   left:   number
   top:    number
   width:  number
   height: number
}

/**
 * The EPHEMERAL editor view transform: a zoom + pan applied ON TOP of the fixed editor frame
 * ({@link DiagramViewBox}). It maps a diagram-unit point to a "view-space" point (the coordinate
 * space the container displays 1:1 with the fixed frame):
 *
 *     viewX = scale * diagramX + translateX      viewY = scale * diagramY + translateY
 *
 * It is NEVER persisted to the document or serialized (a given spec renders byte-identically); it
 * only reshapes what the editor canvas shows. Held as editor-local state, reset/refit on window open.
 */
export interface ViewTransform {
   scale:      number
   translateX: number
   translateY: number
}

/**
 * A single alignment guide drawn while a node is dragged. A 'vertical' guide is a constant-x line
 * (a left/center/right alignment); a 'horizontal' guide is a constant-y line (top/center/bottom).
 * `position` is that constant coordinate; `from`/`to` are the span endpoints on the OTHER axis
 * (the cross-axis extent covering every involved node), all in diagram units.
 */
export interface AlignmentGuide {
   orientation: 'vertical' | 'horizontal'
   position:    number
   from:        number
   to:          number
}

/**
 * The result of an alignment-snap probe for a dragged node: the snapped LEFT (`snapX`) and/or TOP
 * (`snapY`) the node should take (absent on an axis with no snap), plus the guide lines to draw.
 */
export interface AlignmentSnapResult {
   snapX?:  number
   snapY?:  number
   guides:  AlignmentGuide[]
}

/** A node resize handle: the eight corner + edge midpoints of the node's bounding box. */
export type NodeResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** A connection port on a node's perimeter (the four mid-edge sides), the source/target of an edge drag. */
export type NodePort = 'n' | 'e' | 's' | 'w'

/** A port's identity + its position (diagram units), sitting just OUTSIDE the node border (see PORT_GAP). */
export interface NodePortPoint {
   port:  NodePort
   point: Point
}

/**
 * A style patch for an edge. A KEY PRESENT with a value SETS it; the enumerated fields (`arrow`,
 * `routing`, `dashed`) drop back to lean when set to their render default (so a spec never carries a
 * redundant `arrow: 'end'` / `routing: 'straight'` / `dashed: false`, matching the fence's lean
 * serialization). `stroke` follows the node override convention: a key present with `undefined`
 * CLEARS the override (theme default returns); a key absent leaves that field untouched.
 */
export interface EdgeStylePatch {
   arrow?:   EdgeArrow
   routing?: EdgeRouting
   dashed?:  boolean
   stroke?:  string | undefined
}

/** A handle's identity + its position (diagram units), for rendering the selection chrome. */
export interface NodeHandlePoint {
   handle: NodeResizeHandle
   point:  Point
}

/**
 * A style patch for a node. A KEY PRESENT with `undefined` CLEARS that override (the field is dropped
 * so the renderer's theme default kicks back in and the fence serializes lean); a key absent leaves
 * that field untouched. `shape` has no "clear" (a node always has a shape), so an undefined `shape`
 * is ignored.
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

/** Smallest a node may be resized to (diagram units), so a shape never collapses to zero. */
export const NODE_MIN_WIDTH = 24
export const NODE_MIN_HEIGHT = 20

/** The eight box handles, in a stable order (corners then edge midpoints). */
export const NODE_BOX_HANDLES: NodeResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** How close (diagram units) a pointer must be to a handle to grab it for a resize. */
export const NODE_HANDLE_HIT_TOLERANCE = 10

/**
 * How far (diagram units) a node's connection ports sit OUTSIDE its border. Offsetting the ports
 * clear of the border keeps them from colliding with the mid-edge resize handles (which sit ON the
 * border) and reads as the familiar "hover a node, drag from a floating port" affordance.
 */
export const PORT_GAP = 10

/** How close (diagram units) a pointer must be to a port to grab it for an edge-connect drag. */
export const PORT_HIT_TOLERANCE = 8

/**
 * How close (diagram units) a pointer must be to an edge's polyline to select it. The caller passes a
 * value converted from a constant screen-pixel threshold through the current zoom (like the alignment
 * snap), so a thin line stays comfortably clickable at any scale. Also the default when omitted.
 */
export const EDGE_HIT_TOLERANCE = 6

/** Padding + minimum extent for the fixed editor canvas (see {@link computeEditorCanvas}). */
export const EDITOR_CANVAS_PADDING = 40
export const EDITOR_CANVAS_MIN_WIDTH = 320
export const EDITOR_CANVAS_MIN_HEIGHT = 220

/** The allowed zoom range for the editor view transform (clamped in {@link clampViewScale}). */
export const VIEW_MIN_SCALE = 0.25
export const VIEW_MAX_SCALE = 4

/** The identity view transform (scale 1, no pan): the editor's initial + reset state. */
export const IDENTITY_VIEW_TRANSFORM: ViewTransform = { scale: 1, translateX: 0, translateY: 0 }

/** Padding (diagram units) left around the content when fitting the view to it. */
export const FIT_VIEW_PADDING = 24

/**
 * How near (diagram units, after the caller converts a screen-pixel threshold through the current
 * zoom) two alignment lines must be to snap. Also the default when a caller omits the threshold.
 */
export const ALIGNMENT_SNAP_THRESHOLD = 6

/** Two alignment lines within this many diagram units are treated as coincident when spanning guides. */
export const GUIDE_MATCH_EPSILON = 0.5

/**
 * The user-resizable editor-canvas HEIGHT in SCREEN pixels: a sensible default plus a clamp range so
 * the editing surface can be grown for room to work but never gets uselessly tiny or absurdly tall.
 * Ephemeral editor state, never persisted; the stored spec is unaffected.
 */
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

/** Replace the node sharing `next.id` in the spec, preserving order (no-op if the id is absent). */
export function setNode(spec: DiagramSpec, next: DiagramNode): DiagramSpec {
   return { ...spec, nodes: spec.nodes.map(node => (node.id === next.id ? next : node)) }
}

/** Alias kept internal to this module for readability at the many call sites below. */
const replaceNode = setNode

/** Find a node by id, or null. */
export function findNode(spec: DiagramSpec, id: string): DiagramNode | null {
   return spec.nodes.find(node => node.id === id) ?? null
}

// ####################
// # VIEW TRANSFORM   #
// ####################

/** Clamp a scale into the allowed zoom range ({@link VIEW_MIN_SCALE}..{@link VIEW_MAX_SCALE}). */
export function clampViewScale(scale: number): number {
   if (!Number.isFinite(scale)) return 1
   return Math.min(VIEW_MAX_SCALE, Math.max(VIEW_MIN_SCALE, scale))
}

/** Map a diagram-unit point into view space: `view = scale * point + translate`. */
export function applyViewTransform(point: Point, view: ViewTransform): Point {
   return { x: view.scale * point.x + view.translateX, y: view.scale * point.y + view.translateY }
}

/**
 * Map a view-space point back to diagram units: `point = (view - translate) / scale`. The exact
 * inverse of {@link applyViewTransform}. A zero/non-finite scale falls back to 1 (never divides by 0).
 */
export function invertViewTransform(point: Point, view: ViewTransform): Point {
   const scale = Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1
   return { x: (point.x - view.translateX) / scale, y: (point.y - view.translateY) / scale }
}

/**
 * Produce a new view transform that zooms to `nextScale` (clamped) while keeping the diagram point
 * currently under `viewCursor` (a VIEW-SPACE point, e.g. from {@link screenToFramePoint}) pinned in
 * place, the "zoom toward the cursor" behavior. Derives the diagram point under the cursor from the
 * OLD transform, then chooses the translation that lands it back under the cursor at the new scale.
 */
export function zoomViewToward(view: ViewTransform, viewCursor: Point, nextScale: number): ViewTransform {
   const scale = clampViewScale(nextScale)
   const anchor = invertViewTransform(viewCursor, view)
   return {
      scale,
      translateX: viewCursor.x - scale * anchor.x,
      translateY: viewCursor.y - scale * anchor.y,
   }
}

/**
 * Compute a view transform that FRAMES every node within the fixed editor `frame` (view-space
 * `0 0 W H`), centered, with `padding` diagram units of breathing room and the scale clamped to the
 * zoom range. An empty diagram (no nodes) returns the identity transform. Used by the fit / reset
 * control and can be the initial view when a diagram is reopened.
 */
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
 * Derive the editor canvas's render VIEWPORT (the viewBox to draw through) in diagram units from the
 * fixed reference `frame` (the scale-1 viewport size + the container aspect) and the current view
 * transform. This is the heart of the unbounded-canvas model: nodes are drawn at their ABSOLUTE
 * diagram coordinates and only this viewport window limits what is visible, so nothing is ever clipped
 * to a fixed frame and any node is reachable by panning/zooming the viewport.
 *
 * Inverting `viewX = scale*d + translate` for the container edges (view-space 0 and W/H) gives the
 * visible diagram rectangle:  minX = -translateX / scale,  width = frame.width / scale  (same for y).
 * With the identity transform this is exactly `0 0 frame.width frame.height`. A zero/non-finite scale
 * falls back to 1. The viewport always shares the frame's aspect ratio (width/height = frame ratio),
 * so it maps onto the aspect-locked container with no letterbox.
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

/** Clamp a requested editor-canvas height (screen px) into the allowed range (non-finite falls back to default). */
export function clampCanvasHeight(height: number): number {
   if (!Number.isFinite(height)) return CANVAS_DEFAULT_HEIGHT
   return Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, height))
}

/**
 * Build the editor's fixed reference frame from a stable reference WIDTH (diagram units) and the
 * measured on-screen container size (screen px), so the frame's aspect ratio EXACTLY matches the
 * container's. This is the correctness keystone for a user-resizable-height canvas: the container is
 * no longer aspect-locked to a fixed frame, so instead the frame FOLLOWS the container aspect. That
 * keeps the per-axis screen-to-diagram map ({@link screenToFramePoint} / {@link pointerToDiagramPoint})
 * and the meet/none SVG viewBox mutually consistent + undistorted at any height, the pointer mapping
 * stays pixel-accurate, and (since {@link viewportViewBox} preserves the frame aspect) so does the
 * unbounded-canvas viewport clip. A taller container makes a taller frame, which makes a taller
 * viewport, so more vertical diagram is visible at the same zoom. Height = referenceWidth / (containerWidth / containerHeight);
 * a degenerate container (unmeasured / zero) falls back to a square-ish frame. Origin is (0, 0).
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
 * Map a pointer's viewport coordinates to a VIEW-SPACE point (the coordinate space the container
 * displays 1:1 with the fixed `frame`), relative to the on-screen canvas `rect`. Transform-INDEPENDENT
 * (it does not apply the zoom/pan): the same screen pixel over the same rect always yields the same
 * view-space point, which is what a pan delta and a zoom anchor need. A zero-size rect maps to the
 * frame origin rather than dividing by zero.
 */
export function screenToFramePoint(clientX: number, clientY: number, rect: CanvasRect, frame: DiagramViewBox): Point {
   const x = rect.width  > 0 ? frame.minX + (clientX - rect.left) / rect.width  * frame.width  : frame.minX
   const y = rect.height > 0 ? frame.minY + (clientY - rect.top)  / rect.height * frame.height : frame.minY
   return { x, y }
}

/**
 * Map a pointer's viewport coordinates to a point in DIAGRAM units, composing the editor `view`
 * transform (zoom/pan) on top of the fixed `frame`: screen -> view space (via {@link screenToFramePoint})
 * -> diagram units (via {@link invertViewTransform}). With the identity transform (the default) this is
 * the plain proportional frame map, so callers that pass no `view` are unaffected. The editor canvas
 * fills a container whose aspect ratio equals the frame's, so the screen-to-view map is a straight scale
 * on each axis (no letterbox math). The result is NOT rounded, model writes round at mutation time.
 */
export function pointerToDiagramPoint(
   clientX: number, clientY: number, rect: CanvasRect, frame: DiagramViewBox,
   view: ViewTransform = IDENTITY_VIEW_TRANSFORM,
): Point {
   return invertViewTransform(screenToFramePoint(clientX, clientY, rect, frame), view)
}

/**
 * Compute a FIXED editor-canvas extent (diagram units) covering the current content with padding and
 * floored at a sane minimum. Origin is always (0, 0): the seed diagram's nodes are positive, so the
 * canvas frames them from the top-left; the extent is the padded content bounding box's far corner.
 * Held fixed for the editing session so the coordinate frame stays stable while nodes are dragged.
 */
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

/** A node's axis-aligned bounding box (its own x/y/width/height, normalized non-negative). */
export function nodeBox(node: DiagramNode): NodeBox {
   const width  = Math.max(0, node.width)
   const height = Math.max(0, node.height)
   return { x: node.x, y: node.y, width, height }
}

// ##################
// # CREATE / ADD   #
// ##################

/**
 * Build a new node of `shape`, sized at the default node box and CENTERED on `center` (diagram
 * units). A HEADING shape (`banner` / `chevron`) seeds at the wider, shorter heading size instead
 * (see {@link isHeadingShape}), so it reads as a step/phase heading immediately; every other shape
 * keeps the general default. The label is seeded from `label`; style overrides start empty (theme
 * defaults). Coordinates are rounded to whole units.
 */
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

/**
 * Clone `node` into a fresh node with a NEW id (from `idFactory`) and its top-left nudged by `offset`
 * diagram units on BOTH axes, so the copy sits visibly clear of the original rather than exactly on
 * top. Every other field, shape, label, size, and the optional fill/stroke/textColor overrides, is
 * carried through unchanged by the spread. Position is rounded to whole units like every model write.
 * PURE: the caller inserts the result with {@link addNode}. Backs both the Ctrl+C -> Ctrl+V paste and the
 * right-click "Duplicate node" action.
 */
export function duplicateNode(node: DiagramNode, idFactory: () => string, offset: number): DiagramNode {
   return {
      ...node,
      id: idFactory(),
      x: roundUnit(node.x + offset),
      y: roundUnit(node.y + offset),
   }
}

/**
 * Remove the node with `id` AND every edge incident to it (so the model never keeps a dangling edge
 * reference after a node delete). No-op for the node if the id is absent; incident edges are still
 * filtered defensively.
 */
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

/**
 * Translate the node `id` by (deltaX, deltaY) diagram units, returning a new spec. The delta is
 * applied to the node's stored top-left and rounded to whole units. No clamping: the fixed editor
 * canvas is generous and a node may be dragged anywhere (the read-only block autofits to whatever the
 * final positions are). No-op if the id is absent.
 */
export function moveNode(spec: DiagramSpec, id: string, deltaX: number, deltaY: number): DiagramSpec {
   const node = findNode(spec, id)
   if (!node) return spec
   return replaceNode(spec, translateNode(node, deltaX, deltaY))
}

/**
 * Translate a single node by (deltaX, deltaY), returning a new node with the moved, rounded top-left.
 * Used by a live move-drag, which applies the delta to the node captured AT DRAG START (the "origin"),
 * so repeated moves never accumulate rounding error the way an incremental per-move delta would.
 */
export function translateNode(node: DiagramNode, deltaX: number, deltaY: number): DiagramNode {
   return { ...node, x: roundUnit(node.x + deltaX), y: roundUnit(node.y + deltaY) }
}

// ##########
// # RESIZE #
// ##########

/**
 * Move the given `handle` of the node `id` to `point` (diagram units), keeping the opposite edge(s)
 * fixed and re-deriving x/y/width/height, floored at {@link NODE_MIN_WIDTH}/{@link NODE_MIN_HEIGHT}
 * so the box never inverts or collapses. No-op if the id is absent.
 */
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

   // Floor the size so an edge dragged past its opposite one stops at the minimum rather than
   // inverting the box (no flip this pass).
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

/** Set the label of the node `id`, returning a new spec (no-op if the id is absent). */
export function updateNodeLabel(spec: DiagramSpec, id: string, label: string): DiagramSpec {
   const node = findNode(spec, id)
   if (!node) return spec
   return replaceNode(spec, { ...node, label })
}

/**
 * Apply a style patch to the node `id`. A patch key present with a value SETS that override; a key
 * present with `undefined` CLEARS it (the field is deleted so the renderer's theme default returns
 * and the fence serializes lean); an absent key is left untouched. `shape` is set only when defined
 * (a node always has a shape). No-op if the id is absent.
 */
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

/** Set an optional override from the patch when the key is present; a present-but-undefined clears it. */
function applyOverride(node: DiagramNode, key: 'fill' | 'stroke' | 'textColor', patch: NodeStylePatch): void {
   if (!(key in patch)) return
   const value = patch[key]
   if (value === undefined) delete node[key]
   else node[key] = value
}

// ############
// # HIT TEST #
// ############

/**
 * Return the TOPMOST node under `point` (last in the array = drawn on top = hit first), or null. Every
 * shape hit-tests against its bounding box grown by `tolerance`, so a diamond/ellipse click near the
 * box's corner still selects it (deliberately forgiving). No shape-exact hit-testing.
 */
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

/** The eight resize handles of a node, with their positions in diagram units. */
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

/**
 * Return the resize handle of `node` within `tolerance` (diagram units) of `point` (nearest wins), or
 * null. Used by the editor to decide, on pointer-down over the SELECTED node, whether the press
 * begins a resize (on a handle) rather than a move (on the body).
 */
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

/** A box's three vertical reference lines (left / horizontal-center / right), in diagram units. */
function boxVerticalLines(box: NodeBox): number[] {
   return [box.x, box.x + box.width / 2, box.x + box.width]
}

/** A box's three horizontal reference lines (top / vertical-center / bottom), in diagram units. */
function boxHorizontalLines(box: NodeBox): number[] {
   return [box.y, box.y + box.height / 2, box.y + box.height]
}

/**
 * The signed offset (`otherLine - draggedLine`) that snaps the NEAREST pair of reference lines
 * within `threshold`, or null when none is close enough. Applying this offset to the dragged box's
 * position slides the matching dragged line exactly onto the matching other line. The first nearest
 * pair wins ties, so the result is deterministic.
 */
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

/**
 * Build the single alignment guide for `movingBox` at `position` on the given axis, or null when no
 * OTHER box has a reference line coincident (within {@link GUIDE_MATCH_EPSILON}) with `position`. The
 * guide spans the cross-axis extent of `movingBox` plus every coincident other box. Shared by the
 * move-snap ({@link axisGuides}) and the resize-snap ({@link computeResizeSnaps}) guide builders.
 */
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

/**
 * The guide lines for a snapped axis. For each reference line of the (already-snapped) dragged box
 * that coincides (within {@link GUIDE_MATCH_EPSILON}) with a reference line of any other box, emit one
 * guide at that position spanning the cross-axis extent of the dragged box + every coincident other
 * box. Vertical guides (constant x) span in y; horizontal guides (constant y) span in x. Deduplicated
 * by rounded position so two dragged lines landing on the same coordinate emit a single guide.
 */
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
 * Probe the dragged node against every other node for edge/center alignment and return the snap it
 * should take plus the guide lines to draw. Compares the dragged box's left/center/right (x) and
 * top/center/bottom (y) against every other box's corresponding lines; within `threshold` (diagram
 * units, the caller converts a constant screen-pixel threshold through the current zoom), the axis
 * snaps to the nearest matching line, INDEPENDENTLY on x and y (either, both, or neither). Guides span
 * the involved boxes. PURE: no distribution/equal-spacing guides this pass; the caller applies the
 * returned `snapX`/`snapY` as a normal node move (so serialization stays byte-identical).
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

/**
 * The box edges a resize `handle` drags. A side handle moves one edge (e -> right, w -> left, n -> top,
 * s -> bottom); a corner moves the two edges meeting at it (se -> right + bottom, nw -> left + top, and so on).
 * The opposite edge(s) stay fixed, exactly matching {@link resizeNode}'s geometry.
 */
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
 * Snap the MOVING edge(s) of an in-progress resized `rect` (already computed by {@link resizeNode} /
 * {@link resizeNodeBox} for the current handle) to nearby other-node edge/center lines, and report the
 * guide lines to draw. Unlike {@link computeAlignmentSnaps}, which slides the WHOLE box by one offset
 * (a move), this snaps ONLY the edges the `handle` drags (see {@link resizeHandleEdges}), leaving the
 * opposite edge pinned, so the box's SIZE changes to meet the neighbor. Each moving vertical edge
 * (left/right) snaps to the nearest other left/center/right within `threshold`; each moving horizontal
 * edge (top/bottom) to the nearest other top/center/bottom. The result is re-floored to
 * {@link NODE_MIN_WIDTH}/{@link NODE_MIN_HEIGHT} (backing the snap off if it would collapse the box),
 * and a guide is emitted for every snapped moving edge that lands on an other line. PURE: the caller
 * applies `rect` as the node's new geometry (rounding at write time), so serialization stays lean.
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

   // Re-floor: a snap that would shrink the box past the minimum backs off on the MOVING edge, keeping
   // the pinned edge fixed (mirrors resizeNodeBox's flooring so a snap can never invert/collapse a box).
   if (right - left < NODE_MIN_WIDTH) {
      if (edges.left) left = right - NODE_MIN_WIDTH
      else right = left + NODE_MIN_WIDTH
   }
   if (bottom - top < NODE_MIN_HEIGHT) {
      if (edges.top) top = bottom - NODE_MIN_HEIGHT
      else bottom = top + NODE_MIN_HEIGHT
   }

   const snapped: NodeBox = { x: left, y: top, width: right - left, height: bottom - top }

   // A guide for each snapped moving edge that coincides with an other line (moving edges only, so a
   // resize never draws a guide for the pinned side that happened to already align).
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

/** Find an edge by id, or null. */
export function findEdge(spec: DiagramSpec, id: string): DiagramEdge | null {
   return (spec.edges ?? []).find(edge => edge.id === id) ?? null
}

/** Replace the edge sharing `next.id`, preserving order (no-op if the id is absent). */
export function setEdge(spec: DiagramSpec, next: DiagramEdge): DiagramSpec {
   return { ...spec, edges: (spec.edges ?? []).map(edge => (edge.id === next.id ? next : edge)) }
}

/**
 * Set the label of the edge `id`. An empty (or whitespace-only) label DROPS the field so the fence
 * serializes lean and the renderer draws no mid-edge label. No-op if the id is absent.
 */
export function updateEdgeLabel(spec: DiagramSpec, id: string, label: string): DiagramSpec {
   const edge = findEdge(spec, id)
   if (!edge) return spec
   const next: DiagramEdge = { ...edge }
   if (label.trim() === '') delete next.label
   else next.label = label
   return setEdge(spec, next)
}

/**
 * Apply a style patch to the edge `id`. `arrow`/`routing`/`dashed` set the field, but a value equal
 * to the render default is DROPPED (a lean spec never stores `arrow: 'end'` / `routing: 'straight'` /
 * `dashed: false`); `stroke` follows the node override convention (present-`undefined` clears it,
 * absent leaves it). No-op if the id is absent.
 */
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

/**
 * A node's four connection ports (N / E / S / W mid-edges), each offset `gap` diagram units OUTSIDE
 * the node border. These are the affordance an author drags FROM to draw an edge; offsetting them
 * clear of the border keeps them distinct from the mid-edge resize handles that sit ON the border.
 */
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

/**
 * Return the connection port of `node` within `tolerance` (diagram units) of `point` (nearest wins),
 * or null. Used on pointer-down over a hovered node to decide whether the press begins an edge-connect
 * drag rather than a node move.
 */
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

/**
 * Return the edge whose drawn polyline passes within `tolerance` (diagram units) of `point`, nearest
 * wins; later edges (drawn on top) win a tie. Reconstructs each edge's polyline via the SHARED
 * {@link edgePolyline} (honoring waypoints + routing), so the hit area matches exactly what the
 * renderer draws. A dangling edge (missing endpoint node) is skipped. Returns null when no edge is
 * close enough.
 */
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

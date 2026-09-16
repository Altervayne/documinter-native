/*
 * PURE structural + geometric transforms for the image-markup interactive editor. Each function
 * returns a BRAND-NEW value with one edit applied, never mutating the input, so the editor component
 * stays thin glue and the interaction math is unit-tested here. Every geometric field is NORMALIZED
 * 0..1 relative to the base image, rounded to {@link MARKUP_COORDINATE_PRECISION} decimals; pointer
 * coordinates map into this space via {@link pointerToNormalized}.
 */

import type {
   MarkupElement, MarkupRect, MarkupEllipse, MarkupLine, MarkupArrow, MarkupCallout,
   MarkupText, MarkupFreehand, MarkupStrokeStyle, MarkupArrowhead, MarkupArrowheadPosition,
} from './types'
import { MARKUP_COORDINATE_PRECISION, MARKUP_DEFAULT_FONT_SIZE, MARKUP_VIEWBOX_LONG_EDGE } from './types'
import { estimateTextWidth } from '../graph/layout'

// #########
// # TYPES #
// #########

export interface NormalizedPoint {
   x: number
   y: number
}

export interface NormalizedBox {
   x: number
   y: number
   w: number
   h: number
}

/** The render viewBox dimensions. Needed to convert a text element's viewBox-unit `fontSize` + glyph
 *  width into a normalized box, since the 0..1 space is anisotropic for a non-square image. */
export interface ViewBoxDimensions {
   vbWidth:  number
   vbHeight: number
}

/** The four tools that CREATE from a drag rectangle (the `select` tool creates nothing). */
export type GeometricTool = 'rect' | 'ellipse' | 'line' | 'arrow'

/** Box shapes expose the eight corner + edge handles; line/arrow their two endpoints; a callout
 *  ADDITIONALLY a `tail` handle re-aiming its leader tip. */
export type ResizeHandle =
   | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
   | 'start' | 'end'
   | 'tail'

/** A handle's identity + normalized position, for rendering the selection chrome. */
export interface ElementHandle {
   handle: ResizeHandle
   point:  NormalizedPoint
}

/** The style fields the property controls + creation gesture apply. A creator copies only the fields
 *  meaningful to its kind (see the `create*` helpers), so an untouched element serializes lean. */
export interface MarkupDrawStyle {
   stroke?:      string
   strokeWidth?: number
   strokeStyle?: MarkupStrokeStyle
   fill?:        string
   fillOpacity?: number
   fontSize?:    number
   textColor?:   string
   /** Arrow-only: dropped for every other kind (see {@link pickStyle}). */
   arrowhead?:         MarkupArrowhead
   arrowheadPosition?: MarkupArrowheadPosition
}

/** A minimal DOM rect shape, so this stays DOM-free + testable. */
export interface CanvasRect {
   left:   number
   top:    number
   width:  number
   height: number
}

// #############
// # CONSTANTS #
// #############

/** The eight box handles, in a stable order (corners then edge midpoints). */
export const BOX_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Smallest a created/resized box may become, so a shape never collapses to zero. */
export const MIN_ELEMENT_SIZE = 0.005

/** Below this size a freshly-created element is treated as a stray CLICK, not a drag, and discarded. */
export const DEGENERATE_SIZE = 0.01

/** Default RDP tolerance applied to a freehand capture on release, small enough that the smoothed
 *  curve is visually unchanged. */
export const FREEHAND_SIMPLIFY_TOLERANCE = 0.004

/** Where a freshly-dragged callout's leader tip defaults (below the box's lower-left), so the tail
 *  points somewhere sensible before the author re-aims it. */
const CALLOUT_DEFAULT_TAIL_DROP = 0.08

// ###########
// # HELPERS #
// ###########

/** Round a normalized coordinate to the model's fixed precision; non-finite collapses to 0. */
export function roundNormalized(value: number): number {
   if (!Number.isFinite(value)) return 0
   const factor = 10 ** MARKUP_COORDINATE_PRECISION
   return Math.round(value * factor) / factor
}

function clamp01(value: number): number {
   return Math.min(1, Math.max(0, value))
}

/** Clamp into [min, max]; an inverted range returns `min`. */
function clampRange(value: number, min: number, max: number): number {
   if (min > max) return min
   return Math.min(Math.max(value, min), max)
}

// ####################
// # POINTER MAPPING  #
// ####################

/** Map a pointer's viewport coordinates to a normalized 0..1 point relative to `rect`, clamped inside
 *  the image and rounded. A zero-size rect maps to the origin. */
export function pointerToNormalized(clientX: number, clientY: number, rect: CanvasRect): NormalizedPoint {
   const x = rect.width  > 0 ? (clientX - rect.left) / rect.width  : 0
   const y = rect.height > 0 ? (clientY - rect.top)  / rect.height : 0
   return { x: roundNormalized(clamp01(x)), y: roundNormalized(clamp01(y)) }
}

// ####################
// # BOUNDING BOX     #
// ####################

/** The normalized bounding box of any element. A `text` element has no intrinsic size, so its extent
 *  is ESTIMATED from `fontSize` + glyph count when a `viewBox` is supplied ({@link textBoundingBox});
 *  without one it falls back to its zero-size anchor. */
export function getBoundingBox(element: MarkupElement, viewBox?: ViewBoxDimensions): NormalizedBox {
   switch (element.kind) {
      case 'rect':
      case 'ellipse':
      case 'callout':
         return normalizeBox(element.x, element.y, element.w, element.h)
      case 'line':
      case 'arrow':
         return boxFromPoints([{ x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }])
      case 'text':
         return viewBox ? textBoundingBox(element, viewBox) : { x: element.x, y: element.y, w: 0, h: 0 }
      case 'freehand':
         return element.points.length > 0 ? boxFromPoints(element.points) : { x: 0, y: 0, w: 0, h: 0 }
   }
}

/** A text element's selectable box in normalized units. The anchor is the LEFT BASELINE, so the box
 *  rises `ascent` above and dips `descent` below. Computed in viewBox units then divided by the
 *  (anisotropic) viewBox dims; a zero/degenerate viewBox falls back to a square long-edge canvas. */
export function textBoundingBox(element: MarkupText, viewBox: ViewBoxDimensions): NormalizedBox {
   const fontSize = element.fontSize ?? MARKUP_DEFAULT_FONT_SIZE
   const vbWidth  = viewBox.vbWidth  > 0 ? viewBox.vbWidth  : MARKUP_VIEWBOX_LONG_EDGE
   const vbHeight = viewBox.vbHeight > 0 ? viewBox.vbHeight : MARKUP_VIEWBOX_LONG_EDGE

   const estimatedWidth = estimateTextWidth(element.text ?? '', fontSize)
   const horizontalPad  = fontSize * 0.3
   const ascent  = fontSize
   const descent = fontSize * 0.3
   const widthVb  = Math.max(estimatedWidth, fontSize) + horizontalPad * 2
   const heightVb = ascent + descent

   return {
      x: element.x - horizontalPad / vbWidth,
      y: element.y - ascent / vbHeight,
      w: widthVb / vbWidth,
      h: heightVb / vbHeight,
   }
}

/** Normalize a possibly-negative-size box so `w`/`h` are non-negative (top-left anchored). */
function normalizeBox(x: number, y: number, w: number, h: number): NormalizedBox {
   return {
      x: w < 0 ? x + w : x,
      y: h < 0 ? y + h : y,
      w: Math.abs(w),
      h: Math.abs(h),
   }
}

/** The tight bounding box of a point list. */
function boxFromPoints(points: NormalizedPoint[]): NormalizedBox {
   let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
   for (const point of points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y)
   }
   return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ####################
// # CREATE FROM DRAG #
// ####################

/** Build a new element from a drag between two normalized points. Box tools normalize the drag rect so
 *  a reversed drag still yields a positive-size box; line/arrow keep the points as ordered endpoints.
 *  Only the DEFINED fields of `style` are copied on. */
export function createElementFromDrag(
   tool: GeometricTool, start: NormalizedPoint, end: NormalizedPoint, style: MarkupDrawStyle, id: string,
): MarkupElement {
   if (tool === 'line' || tool === 'arrow') {
      return {
         id, kind: tool,
         x1: roundNormalized(start.x), y1: roundNormalized(start.y),
         x2: roundNormalized(end.x),   y2: roundNormalized(end.y),
         ...pickStyle(style, tool),
      }
   }
   const box = normalizeBox(start.x, start.y, end.x - start.x, end.y - start.y)
   return {
      id, kind: tool,
      x: roundNormalized(box.x), y: roundNormalized(box.y),
      w: roundNormalized(box.w), h: roundNormalized(box.h),
      ...pickStyle(style, tool),
   }
}

/** Copy only the defined style fields. `fill`/`fillOpacity` are dropped for line/arrow (no interior). */
function pickStyle(style: MarkupDrawStyle, tool: GeometricTool): MarkupDrawStyle {
   const picked: MarkupDrawStyle = {}
   if (style.stroke !== undefined)      picked.stroke = style.stroke
   if (style.strokeWidth !== undefined) picked.strokeWidth = style.strokeWidth
   if (style.strokeStyle !== undefined) picked.strokeStyle = style.strokeStyle
   if (tool !== 'line' && tool !== 'arrow') {
      if (style.fill !== undefined)        picked.fill = style.fill
      if (style.fillOpacity !== undefined) picked.fillOpacity = style.fillOpacity
   }
   // Arrowhead shape/placement are meaningful only on an arrow, so a remembered arrow default never
   // pollutes a rect/ellipse/line.
   if (tool === 'arrow') {
      if (style.arrowhead !== undefined)         picked.arrowhead = style.arrowhead
      if (style.arrowheadPosition !== undefined) picked.arrowheadPosition = style.arrowheadPosition
   }
   return picked
}

// ####################################
// # CREATE TEXT / CALLOUT / FREEHAND #
// ####################################

/** Build a new TEXT element anchored at `point`. Text is CLICK-placed (no drag rect); only the
 *  text-relevant style fields are copied on, stroke/fill dropped. */
export function createTextElement(
   point: NormalizedPoint, text: string, style: MarkupDrawStyle, id: string,
): MarkupText {
   const element: MarkupText = {
      id, kind: 'text', x: roundNormalized(point.x), y: roundNormalized(point.y), text,
   }
   if (style.textColor !== undefined) element.textColor = style.textColor
   if (style.fontSize !== undefined)  element.fontSize = style.fontSize
   return element
}

/** Build a new CALLOUT from a drag: the normalized drag rect becomes the label box, and the leader
 *  `tip` defaults below the box's lower-left, ready for the author to re-aim via the `tail` handle. */
export function createCalloutFromDrag(
   start: NormalizedPoint, end: NormalizedPoint, text: string, style: MarkupDrawStyle, id: string,
): MarkupCallout {
   const box = normalizeBox(start.x, start.y, end.x - start.x, end.y - start.y)
   const tipX = clamp01(box.x + box.w * 0.2)
   const tipY = clamp01(box.y + box.h + CALLOUT_DEFAULT_TAIL_DROP)
   const element: MarkupCallout = {
      id, kind: 'callout',
      x: roundNormalized(box.x), y: roundNormalized(box.y),
      w: roundNormalized(box.w), h: roundNormalized(box.h),
      tipX: roundNormalized(tipX), tipY: roundNormalized(tipY),
      text,
   }
   if (style.stroke !== undefined)      element.stroke = style.stroke
   if (style.strokeWidth !== undefined) element.strokeWidth = style.strokeWidth
   if (style.fill !== undefined) {
      element.fill = style.fill
      if (style.fillOpacity !== undefined) element.fillOpacity = style.fillOpacity
   }
   if (style.textColor !== undefined) element.textColor = style.textColor
   if (style.fontSize !== undefined)  element.fontSize = style.fontSize
   return element
}

/** Build a new FREEHAND element from an already-simplified point list. Only stroke/strokeWidth are
 *  copied on (no fill). The caller passes the {@link simplifyFreehand} output, not the raw capture. */
export function createFreehandFromPoints(
   points: NormalizedPoint[], style: MarkupDrawStyle, id: string,
): MarkupFreehand {
   const element: MarkupFreehand = {
      id, kind: 'freehand',
      points: points.map(point => ({ x: roundNormalized(point.x), y: roundNormalized(point.y) })),
   }
   if (style.stroke !== undefined)      element.stroke = style.stroke
   if (style.strokeWidth !== undefined) element.strokeWidth = style.strokeWidth
   return element
}

/** Simplify a raw freehand capture with Ramer-Douglas-Peucker. 0/1/2-point inputs pass through
 *  (rounded); first + last are always retained, order preserved. */
export function simplifyFreehand(points: NormalizedPoint[], tolerance = FREEHAND_SIMPLIFY_TOLERANCE): NormalizedPoint[] {
   if (points.length <= 2) return points.map(roundPoint)
   return douglasPeucker(points, Math.max(tolerance, 0)).map(roundPoint)
}

/** Round a point to the model precision. */
function roundPoint(point: NormalizedPoint): NormalizedPoint {
   return { x: roundNormalized(point.x), y: roundNormalized(point.y) }
}

/** The recursive RDP core (distance-to-segment against the chord). Retains first + last always. */
function douglasPeucker(points: NormalizedPoint[], tolerance: number): NormalizedPoint[] {
   if (points.length < 3) return points.slice()
   const first = points[0]
   const last  = points[points.length - 1]
   let maxDistance = -1
   let splitIndex  = 0
   for (let index = 1; index < points.length - 1; index += 1) {
      const distance = distanceToSegment(points[index], first, last)
      if (distance > maxDistance) {
         maxDistance = distance
         splitIndex  = index
      }
   }
   if (maxDistance > tolerance) {
      const left  = douglasPeucker(points.slice(0, splitIndex + 1), tolerance)
      const right = douglasPeucker(points.slice(splitIndex), tolerance)
      // Drop the shared split point (last of `left` === first of `right`).
      return left.slice(0, -1).concat(right)
   }
   return [first, last]
}

/** True when a freshly-created element is too small to keep (a stray click, not a drag). */
export function elementIsDegenerate(element: MarkupElement): boolean {
   if (element.kind === 'line' || element.kind === 'arrow') {
      const deltaX = element.x2 - element.x1
      const deltaY = element.y2 - element.y1
      return Math.hypot(deltaX, deltaY) < DEGENERATE_SIZE
   }
   const box = getBoundingBox(element)
   return box.w < DEGENERATE_SIZE && box.h < DEGENERATE_SIZE
}

// ############
// # HIT TEST #
// ############

/** The TOPMOST element under `point` (last = drawn on top = hit first), or null. Box shapes hit-test
 *  against their box grown by `tolerance`; line/arrow/freehand by distance from their segment(s). */
export function hitTest(
   elements: MarkupElement[], point: NormalizedPoint, tolerance = 0.02, viewBox?: ViewBoxDimensions,
): MarkupElement | null {
   for (let index = elements.length - 1; index >= 0; index -= 1) {
      if (elementHit(elements[index], point, tolerance, viewBox)) return elements[index]
   }
   return null
}

function elementHit(element: MarkupElement, point: NormalizedPoint, tolerance: number, viewBox?: ViewBoxDimensions): boolean {
   switch (element.kind) {
      case 'rect':
      case 'ellipse':
      case 'callout':
      case 'text': {
         // Text gets its estimated glyph box when a viewBox is known, grabbable beyond its zero-size
         // anchor; the other box kinds use their intrinsic bounds.
         const box = getBoundingBox(element, viewBox)
         return point.x >= box.x - tolerance && point.x <= box.x + box.w + tolerance
             && point.y >= box.y - tolerance && point.y <= box.y + box.h + tolerance
      }
      case 'line':
      case 'arrow':
         return distanceToSegment(point, { x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }) <= tolerance
      case 'freehand': {
         const points = element.points
         for (let index = 0; index + 1 < points.length; index += 1) {
            if (distanceToSegment(point, points[index], points[index + 1]) <= tolerance) return true
         }
         return false
      }
   }
}

/** Perpendicular distance from `point` to the segment a-b (clamped to the endpoints). */
function distanceToSegment(point: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint): number {
   const segmentX = b.x - a.x
   const segmentY = b.y - a.y
   const lengthSquared = segmentX * segmentX + segmentY * segmentY
   if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)
   let t = ((point.x - a.x) * segmentX + (point.y - a.y) * segmentY) / lengthSquared
   t = Math.min(1, Math.max(0, t))
   const closestX = a.x + t * segmentX
   const closestY = a.y + t * segmentY
   return Math.hypot(point.x - closestX, point.y - closestY)
}

// ########
// # MOVE #
// ########

/** Translate an element by (deltaX, deltaY), CLAMPING the delta so the whole element stays inside the
 *  image on both axes (the shape is limited, never distorted). */
export function moveElement(element: MarkupElement, deltaX: number, deltaY: number): MarkupElement {
   const box = getBoundingBox(element)
   const clampedDeltaX = clampRange(deltaX, -box.x, 1 - (box.x + box.w))
   const clampedDeltaY = clampRange(deltaY, -box.y, 1 - (box.y + box.h))
   return shiftElement(element, clampedDeltaX, clampedDeltaY)
}

function shiftElement(element: MarkupElement, deltaX: number, deltaY: number): MarkupElement {
   const shiftX = (value: number) => roundNormalized(value + deltaX)
   const shiftY = (value: number) => roundNormalized(value + deltaY)
   switch (element.kind) {
      case 'rect':
      case 'ellipse':
         return { ...element, x: shiftX(element.x), y: shiftY(element.y) }
      case 'callout':
         return { ...element, x: shiftX(element.x), y: shiftY(element.y), tipX: shiftX(element.tipX), tipY: shiftY(element.tipY) }
      case 'line':
      case 'arrow':
         return { ...element, x1: shiftX(element.x1), y1: shiftY(element.y1), x2: shiftX(element.x2), y2: shiftY(element.y2) }
      case 'text':
         return { ...element, x: shiftX(element.x), y: shiftY(element.y) }
      case 'freehand':
         return { ...element, points: element.points.map(point => ({ x: shiftX(point.x), y: shiftY(point.y) })) }
   }
}

// ##########
// # RESIZE #
// ##########

/** Move the `handle` of an element to `point`. A callout `tail` re-aims its leader tip. Box shapes
 *  keep the opposite edge(s) fixed and re-derive the box, floored so it never inverts; line/arrow move
 *  the matching endpoint. Text and freehand have no box handles and are returned unchanged. */
export function resizeElement(element: MarkupElement, handle: ResizeHandle, point: NormalizedPoint): MarkupElement {
   if (element.kind === 'callout' && handle === 'tail') {
      return { ...element, tipX: roundNormalized(point.x), tipY: roundNormalized(point.y) }
   }
   if (element.kind === 'line' || element.kind === 'arrow') {
      return resizeLine(element, handle, point)
   }
   if (element.kind === 'rect' || element.kind === 'ellipse' || element.kind === 'callout') {
      return resizeBox(element, handle, point)
   }
   return element
}

function resizeLine(element: MarkupLine | MarkupArrow, handle: ResizeHandle, point: NormalizedPoint): MarkupLine | MarkupArrow {
   if (handle === 'start') return { ...element, x1: roundNormalized(point.x), y1: roundNormalized(point.y) }
   if (handle === 'end')   return { ...element, x2: roundNormalized(point.x), y2: roundNormalized(point.y) }
   return element
}

function resizeBox<Element extends MarkupRect | MarkupEllipse | MarkupCallout>(
   element: Element, handle: ResizeHandle, point: NormalizedPoint,
): Element {
   let left   = element.x
   let top    = element.y
   let right  = element.x + element.w
   let bottom = element.y + element.h

   // Left-side handles move the left edge; right-side move the right edge; likewise top/bottom.
   if (handle === 'nw' || handle === 'w' || handle === 'sw') left = point.x
   if (handle === 'ne' || handle === 'e' || handle === 'se') right = point.x
   if (handle === 'nw' || handle === 'n' || handle === 'ne') top = point.y
   if (handle === 'sw' || handle === 's' || handle === 'se') bottom = point.y

   // Floor the size so an edge dragged past its opposite one stops at the minimum, never inverting.
   if (right - left < MIN_ELEMENT_SIZE) {
      if (handle === 'nw' || handle === 'w' || handle === 'sw') left = right - MIN_ELEMENT_SIZE
      else right = left + MIN_ELEMENT_SIZE
   }
   if (bottom - top < MIN_ELEMENT_SIZE) {
      if (handle === 'nw' || handle === 'n' || handle === 'ne') top = bottom - MIN_ELEMENT_SIZE
      else bottom = top + MIN_ELEMENT_SIZE
   }

   return {
      ...element,
      x: roundNormalized(left),
      y: roundNormalized(top),
      w: roundNormalized(right - left),
      h: roundNormalized(bottom - top),
   }
}

// ################
// # HANDLES      #
// ################

/** The resize handles for an element. Box shapes return the eight handles; a callout ADDITIONALLY its
 *  `tail`; line/arrow their two endpoints; other kinds return none (still movable by body-drag). */
export function getElementHandles(element: MarkupElement): ElementHandle[] {
   if (element.kind === 'line' || element.kind === 'arrow') {
      return [
         { handle: 'start', point: { x: element.x1, y: element.y1 } },
         { handle: 'end',   point: { x: element.x2, y: element.y2 } },
      ]
   }
   if (element.kind === 'rect' || element.kind === 'ellipse' || element.kind === 'callout') {
      const { x, y, w, h } = element
      const midX = x + w / 2
      const midY = y + h / 2
      const positions: Record<'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w', NormalizedPoint> = {
         nw: { x,        y },
         n:  { x: midX,  y },
         ne: { x: x + w, y },
         e:  { x: x + w, y: midY },
         se: { x: x + w, y: y + h },
         s:  { x: midX,  y: y + h },
         sw: { x,        y: y + h },
         w:  { x,        y: midY },
      }
      const handles: ElementHandle[] = BOX_HANDLES.map(handle => ({
         handle, point: positions[handle as 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'],
      }))
      if (element.kind === 'callout') {
         handles.push({ handle: 'tail', point: { x: element.tipX, y: element.tipY } })
      }
      return handles
   }
   return []
}

/** The handle of `element` within `tolerance` of `point` (nearest wins), or null. Decides, on
 *  pointer-down over a selected element, whether the press begins a resize rather than a move. */
export function hitTestHandle(element: MarkupElement, point: NormalizedPoint, tolerance = 0.025): ResizeHandle | null {
   let best: ResizeHandle | null = null
   let bestDistance = tolerance
   for (const { handle, point: handlePoint } of getElementHandles(element)) {
      const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y)
      if (distance <= bestDistance) {
         best = handle
         bestDistance = distance
      }
   }
   return best
}

// ################
// # STYLE PATCH  #
// ################

/** Apply a style patch to an element. A field set to `undefined` CLEARS it (the spread copies
 *  explicit-undefined keys), so the renderer's default returns. */
export function updateElementStyle(element: MarkupElement, patch: MarkupDrawStyle): MarkupElement {
   return { ...element, ...patch }
}

/** Set the label text of a TEXT or CALLOUT element; any other kind is returned unchanged. */
export function updateElementText(element: MarkupElement, text: string): MarkupElement {
   if (element.kind === 'text' || element.kind === 'callout') {
      return { ...element, text }
   }
   return element
}

// ##########################
// # LIST ADD / REMOVE / SET #
// ##########################

/** Append an element to the top of the overlay stack (last = drawn on top). */
export function addElement(elements: MarkupElement[], element: MarkupElement): MarkupElement[] {
   return [...elements, element]
}

/** Remove the element with the given id (no-op if absent). */
export function removeElement(elements: MarkupElement[], id: string): MarkupElement[] {
   return elements.filter(element => element.id !== id)
}

/** Replace the element sharing `replacement.id`, preserving z-order (no-op if absent). */
export function replaceElement(elements: MarkupElement[], replacement: MarkupElement): MarkupElement[] {
   return elements.map(element => (element.id === replacement.id ? replacement : element))
}

// ############
// # Z-ORDER  #
// ############
// The array order IS the z-order (index 0 = bottom, last = top), so a reorder is a pure array move;
// there is no per-element z field to keep in sync.

/** Move the element one step UP the stack, swapping with its upper neighbor. */
export function bringForward(elements: MarkupElement[], id: string): MarkupElement[] {
   const index = elements.findIndex(element => element.id === id)
   if (index === -1 || index === elements.length - 1) return elements
   const next = elements.slice()
   ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
   return next
}

/** Move the element one step DOWN the stack, swapping with its lower neighbor. */
export function sendBackward(elements: MarkupElement[], id: string): MarkupElement[] {
   const index = elements.findIndex(element => element.id === id)
   if (index <= 0) return elements
   const next = elements.slice()
   ;[next[index], next[index - 1]] = [next[index - 1], next[index]]
   return next
}

/** Move the element all the way to the TOP of the stack (last = drawn on top). */
export function bringToFront(elements: MarkupElement[], id: string): MarkupElement[] {
   const index = elements.findIndex(element => element.id === id)
   if (index === -1 || index === elements.length - 1) return elements
   const next = elements.slice()
   const [moved] = next.splice(index, 1)
   next.push(moved)
   return next
}

/** Move the element all the way to the BOTTOM of the stack (first = drawn underneath). */
export function sendToBack(elements: MarkupElement[], id: string): MarkupElement[] {
   const index = elements.findIndex(element => element.id === id)
   if (index <= 0) return elements
   const next = elements.slice()
   const [moved] = next.splice(index, 1)
   next.unshift(moved)
   return next
}

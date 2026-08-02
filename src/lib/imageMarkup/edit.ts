/**
 * edit.ts, PURE structural + geometric transforms for the image-markup interactive editor.
 *
 * PURE DATA / PURE FUNCTIONS, side-effect free, imports ONLY the markup types + coordinate
 * precision. Each function takes an element (or an element list) and returns a BRAND-NEW value
 * with one edit applied, NEVER mutating the input. This is the single tested place the editor's
 * pointer-driven create / move / resize / hit-test / style / add / remove operations live (mirrors
 * `lib/graphEdit.ts` for the graph block): the editor component (`blocks/ImageMarkupEditor.tsx`,
 * the markup mode of the `image` block) is thin glue over these, so the interaction math is all
 * unit-tested here rather than in the UI.
 *
 * Coordinate convention (see types.ts): every geometric field is NORMALIZED 0..1 relative to the
 * base image, rounded to {@link MARKUP_COORDINATE_PRECISION} decimals. Pointer coordinates are
 * mapped into this space via {@link pointerToNormalized} against the on-screen canvas rect.
 *
 * Pass-1 scope: the four GEOMETRIC tools (rect / ellipse / line / arrow). `moveElement` and
 * `hitTest` still tolerate every element kind (a `.mint` reopen can carry text / callout / freehand
 * from a future pass, and they must at least be selectable + draggable); `resizeElement` handles
 * the box shapes (rect / ellipse / callout) and the line/arrow endpoints, and leaves point-anchored
 * kinds (text) and multi-point kinds (freehand) unchanged (their resize is a pass-2 concern).
 */

import type {
   MarkupElement, MarkupRect, MarkupEllipse, MarkupLine, MarkupArrow, MarkupCallout,
} from './types'
import { MARKUP_COORDINATE_PRECISION } from './types'

// #########
// # TYPES #
// #########

/** A point in normalized 0..1 image space. */
export interface NormalizedPoint {
   x: number
   y: number
}

/** An axis-aligned box in normalized 0..1 image space (top-left + size). */
export interface NormalizedBox {
   x: number
   y: number
   w: number
   h: number
}

/** The four geometric tools this pass can CREATE (the `select` tool creates nothing). */
export type GeometricTool = 'rect' | 'ellipse' | 'line' | 'arrow'

/**
 * A resize handle identifier. Box shapes (rect / ellipse / callout) expose the eight
 * corner + edge handles; line / arrow expose their two endpoints instead.
 */
export type ResizeHandle =
   | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
   | 'start' | 'end'

/** A handle's identity + its normalized position, for rendering the selection chrome. */
export interface ElementHandle {
   handle: ResizeHandle
   point:  NormalizedPoint
}

/** The subset of style fields the editor's property controls + creation gesture apply. */
export interface MarkupDrawStyle {
   stroke?:      string
   strokeWidth?: number
   fill?:        string
   fillOpacity?: number
}

/** A minimal DOM rect shape (only the fields the mapping needs), so this stays DOM-free + testable. */
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

/** Smallest a created / resized box may become (normalized), so a shape never collapses to zero. */
export const MIN_ELEMENT_SIZE = 0.005

/**
 * Below this size (normalized) a freshly-created element is treated as a stray CLICK, not a drag,
 * and discarded by the editor rather than left as an invisible speck (box: both edges below it;
 * line/arrow: total length below it).
 */
export const DEGENERATE_SIZE = 0.01

// ###########
// # HELPERS #
// ###########

/** Round a normalized coordinate to the model's fixed precision; non-finite collapses to 0. */
export function roundNormalized(value: number): number {
   if (!Number.isFinite(value)) return 0
   const factor = 10 ** MARKUP_COORDINATE_PRECISION
   return Math.round(value * factor) / factor
}

/** Clamp into [0, 1]. */
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

/**
 * Map a pointer's viewport coordinates to a normalized 0..1 point relative to the on-screen canvas
 * `rect`, clamped inside the image and rounded to the model precision. A zero-size rect (unmeasured
 * canvas) maps to the origin rather than dividing by zero.
 */
export function pointerToNormalized(clientX: number, clientY: number, rect: CanvasRect): NormalizedPoint {
   const x = rect.width  > 0 ? (clientX - rect.left) / rect.width  : 0
   const y = rect.height > 0 ? (clientY - rect.top)  / rect.height : 0
   return { x: roundNormalized(clamp01(x)), y: roundNormalized(clamp01(y)) }
}

// ####################
// # BOUNDING BOX     #
// ####################

/** The normalized axis-aligned bounding box of any element (used by hit-test + move clamping). */
export function getBoundingBox(element: MarkupElement): NormalizedBox {
   switch (element.kind) {
      case 'rect':
      case 'ellipse':
      case 'callout':
         return normalizeBox(element.x, element.y, element.w, element.h)
      case 'line':
      case 'arrow':
         return boxFromPoints([{ x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }])
      case 'text':
         return { x: element.x, y: element.y, w: 0, h: 0 }
      case 'freehand':
         return element.points.length > 0 ? boxFromPoints(element.points) : { x: 0, y: 0, w: 0, h: 0 }
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

/**
 * Build a new element from a drag between two normalized points. Box tools (rect / ellipse)
 * normalize the drag rectangle so a bottom-right → top-left drag still yields a positive-size box;
 * line / arrow keep the two points as ordered endpoints (the arrowhead is drawn at `end`). Only the
 * DEFINED fields of `style` are copied on, so an untouched default element still serializes lean.
 */
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

/**
 * Copy only the defined style fields. `fill` / `fillOpacity` are meaningless on a line / arrow
 * (they have no interior), so they are dropped for those kinds to keep the element clean.
 */
function pickStyle(style: MarkupDrawStyle, tool: GeometricTool): MarkupDrawStyle {
   const picked: MarkupDrawStyle = {}
   if (style.stroke !== undefined)      picked.stroke = style.stroke
   if (style.strokeWidth !== undefined) picked.strokeWidth = style.strokeWidth
   if (tool !== 'line' && tool !== 'arrow') {
      if (style.fill !== undefined)        picked.fill = style.fill
      if (style.fillOpacity !== undefined) picked.fillOpacity = style.fillOpacity
   }
   return picked
}

/** True when a freshly-created element is too small to keep (a stray click rather than a drag). */
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

/**
 * Return the TOPMOST element under `point` (last in the array = drawn on top = hit first), or null.
 * Box shapes hit-test against their bounding box grown by `tolerance` (so a thin outline is still
 * grabbable); line / arrow / freehand hit-test by distance from their segment(s); text hits within a
 * small pad of its anchor. `tolerance` is in normalized units.
 */
export function hitTest(
   elements: MarkupElement[], point: NormalizedPoint, tolerance = 0.02,
): MarkupElement | null {
   for (let index = elements.length - 1; index >= 0; index -= 1) {
      if (elementHit(elements[index], point, tolerance)) return elements[index]
   }
   return null
}

function elementHit(element: MarkupElement, point: NormalizedPoint, tolerance: number): boolean {
   switch (element.kind) {
      case 'rect':
      case 'ellipse':
      case 'callout':
      case 'text': {
         const box = getBoundingBox(element)
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

/** Perpendicular distance from `point` to the segment `a`→`b` (clamped to the endpoints). */
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

/**
 * Translate an element by (deltaX, deltaY) in normalized units, CLAMPING the delta so the whole
 * element stays inside the image [0, 1] on both axes (the shape is never distorted by the clamp,
 * only limited). Every coordinate the kind carries is shifted by the clamped delta.
 */
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

/**
 * Move the given `handle` of an element to `point`. Box shapes (rect / ellipse / callout) keep the
 * opposite edge(s) fixed and re-derive x/y/w/h, floored at {@link MIN_ELEMENT_SIZE} so the box never
 * inverts or collapses; line / arrow move the matching endpoint. Point-anchored (text) and
 * multi-point (freehand) kinds have no box handles this pass and are returned unchanged.
 */
export function resizeElement(element: MarkupElement, handle: ResizeHandle, point: NormalizedPoint): MarkupElement {
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

   // Floor the size so an edge dragged past its opposite one stops at MIN_ELEMENT_SIZE rather than
   // inverting the box (no flip this pass).
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

/**
 * The resize handles for an element, with their normalized positions. Box shapes return the eight
 * corner + edge handles; line / arrow return their two endpoints; other kinds return none (no
 * resize affordance this pass, they are still movable by body-drag).
 */
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
      const positions: Record<Exclude<ResizeHandle, 'start' | 'end'>, NormalizedPoint> = {
         nw: { x,        y },
         n:  { x: midX,  y },
         ne: { x: x + w, y },
         e:  { x: x + w, y: midY },
         se: { x: x + w, y: y + h },
         s:  { x: midX,  y: y + h },
         sw: { x,        y: y + h },
         w:  { x,        y: midY },
      }
      return BOX_HANDLES.map(handle => ({ handle, point: positions[handle as Exclude<ResizeHandle, 'start' | 'end'>] }))
   }
   return []
}

/**
 * Return the handle of `element` within `tolerance` of `point` (nearest wins), or null. Used by the
 * editor to decide, on pointer-down over a selected element, whether the press begins a RESIZE (on a
 * handle) rather than a move (on the body).
 */
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

/**
 * Apply a style patch to an element, returning a new element. A field set to `undefined` in the
 * patch CLEARS that field (e.g. `{ fill: undefined }` turns a filled shape back into an outline) —
 * the spread copies explicit-undefined keys, so the renderer's default kicks back in.
 */
export function updateElementStyle(element: MarkupElement, patch: MarkupDrawStyle): MarkupElement {
   return { ...element, ...patch }
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

/** Replace the element sharing `replacement.id` in place, preserving z-order (no-op if absent). */
export function replaceElement(elements: MarkupElement[], replacement: MarkupElement): MarkupElement[] {
   return elements.map(element => (element.id === replacement.id ? replacement : element))
}

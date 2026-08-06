import { describe, it, expect } from 'vitest'
import {
   pointerToNormalized, createElementFromDrag, hitTest, moveElement, resizeElement,
   updateElementStyle, addElement, removeElement, replaceElement, getElementHandles,
   hitTestHandle, getBoundingBox, textBoundingBox, elementIsDegenerate, roundNormalized,
   createTextElement, createCalloutFromDrag, createFreehandFromPoints, simplifyFreehand,
   updateElementText, bringForward, sendBackward, bringToFront, sendToBack,
   type CanvasRect, type NormalizedPoint, type ViewBoxDimensions,
} from './edit'
import type {
   MarkupArrow, MarkupCallout, MarkupEllipse, MarkupLine, MarkupRect, MarkupText,
} from './types'

/** A square viewBox for text hit-box tests (1000x1000, so viewBox units equal per-mille of the edge). */
const SQUARE_VIEWBOX: ViewBoxDimensions = { vbWidth: 1000, vbHeight: 1000 }

// A landscape canvas rect (1000x500 on-screen) for pointer-mapping tests.
const RECT: CanvasRect = { left: 100, top: 50, width: 1000, height: 500 }

function rect(overrides: Partial<MarkupRect> = {}): MarkupRect {
   return { id: 'r1', kind: 'rect', x: 0.2, y: 0.2, w: 0.4, h: 0.3, ...overrides }
}
function line(overrides: Partial<MarkupLine> = {}): MarkupLine {
   return { id: 'l1', kind: 'line', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, ...overrides }
}
function callout(overrides: Partial<MarkupCallout> = {}): MarkupCallout {
   return { id: 'c1', kind: 'callout', x: 0.2, y: 0.2, w: 0.3, h: 0.15, tipX: 0.1, tipY: 0.6, text: 'hi', ...overrides }
}

// ####################
// # POINTER MAPPING  #
// ####################

describe('pointerToNormalized', () => {
   it('maps a pointer to a normalized fraction of the canvas rect', () => {
      expect(pointerToNormalized(600, 300, RECT)).toEqual({ x: 0.5, y: 0.5 })
      expect(pointerToNormalized(100, 50, RECT)).toEqual({ x: 0, y: 0 })
      expect(pointerToNormalized(1100, 550, RECT)).toEqual({ x: 1, y: 1 })
   })

   it('clamps a pointer outside the canvas into [0, 1]', () => {
      expect(pointerToNormalized(0, 0, RECT)).toEqual({ x: 0, y: 0 })
      expect(pointerToNormalized(5000, 5000, RECT)).toEqual({ x: 1, y: 1 })
   })

   it('rounds to the model coordinate precision (4 dp)', () => {
      // 350/1000 = 0.35 exactly; 133/1000 offset gives a clean fraction. Use an awkward pixel to force rounding.
      const point = pointerToNormalized(100 + 333, 50, RECT)
      expect(point.x).toBe(0.333)
   })

   it('maps to the origin for a zero-size (unmeasured) rect rather than dividing by zero', () => {
      expect(pointerToNormalized(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
   })
})

describe('roundNormalized', () => {
   it('rounds to 4 decimals and collapses non-finite to 0', () => {
      expect(roundNormalized(0.123456)).toBe(0.1235)
      expect(roundNormalized(Number.NaN)).toBe(0)
      expect(roundNormalized(Infinity)).toBe(0)
   })
})

// ####################
// # CREATE FROM DRAG #
// ####################

describe('createElementFromDrag', () => {
   const style = { stroke: '#123456', strokeWidth: 6, fill: '#abcdef', fillOpacity: 0.5 }

   it('builds a rect from a top-left → bottom-right drag', () => {
      const element = createElementFromDrag('rect', { x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 }, style, 'id1')
      expect(element).toMatchObject({ id: 'id1', kind: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.2 })
      expect(element).toMatchObject({ stroke: '#123456', strokeWidth: 6, fill: '#abcdef', fillOpacity: 0.5 })
   })

   it('normalizes a bottom-right → top-left drag into a positive-size box', () => {
      const element = createElementFromDrag('rect', { x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 }, {}, 'id2')
      expect(element).toMatchObject({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 })
   })

   it('builds an ellipse with the same box math as rect', () => {
      const element = createElementFromDrag('ellipse', { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.4 }, {}, 'id3') as MarkupEllipse
      expect(element.kind).toBe('ellipse')
      expect(element).toMatchObject({ x: 0.1, y: 0.1, w: 0.4, h: 0.3 })
   })

   it('builds a line keeping ordered endpoints and dropping fill fields', () => {
      const element = createElementFromDrag('line', { x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }, style, 'id4') as MarkupLine
      expect(element).toMatchObject({ kind: 'line', x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.8, stroke: '#123456', strokeWidth: 6 })
      expect('fill' in element).toBe(false)
      expect('fillOpacity' in element).toBe(false)
   })

   it('builds an arrow with the head at the drag end', () => {
      const element = createElementFromDrag('arrow', { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.2 }, {}, 'id5') as MarkupArrow
      expect(element).toMatchObject({ kind: 'arrow', x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.2 })
   })

   it('omits undefined style fields so an untouched element stays lean', () => {
      const element = createElementFromDrag('rect', { x: 0, y: 0 }, { x: 0.3, y: 0.3 }, {}, 'id6')
      expect('stroke' in element).toBe(false)
      expect('strokeWidth' in element).toBe(false)
      expect('fill' in element).toBe(false)
   })

   it('carries strokeStyle onto every stroke-bearing kind (Polish 4)', () => {
      const rectElement = createElementFromDrag('rect', { x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { strokeStyle: 'dashed' }, 'r')
      const lineElement = createElementFromDrag('line', { x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { strokeStyle: 'dotted' }, 'l')
      expect(rectElement).toMatchObject({ strokeStyle: 'dashed' })
      expect(lineElement).toMatchObject({ strokeStyle: 'dotted' })
   })

   it('propagates arrowhead options only to an arrow, dropping them for other tools (Polish 5)', () => {
      const arrowStyle = { arrowhead: 'chevron' as const, arrowheadPosition: 'middle' as const }
      const arrowElement = createElementFromDrag('arrow', { x: 0, y: 0 }, { x: 0.5, y: 0 }, arrowStyle, 'a') as MarkupArrow
      expect(arrowElement).toMatchObject({ arrowhead: 'chevron', arrowheadPosition: 'middle' })
      const rectElement = createElementFromDrag('rect', { x: 0, y: 0 }, { x: 0.3, y: 0.3 }, arrowStyle, 'r2')
      expect('arrowhead' in rectElement).toBe(false)
      expect('arrowheadPosition' in rectElement).toBe(false)
   })

   it('stays byte-identical (no new keys) when the new style fields are absent', () => {
      const arrowElement = createElementFromDrag('arrow', { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.2 }, {}, 'a2')
      expect('strokeStyle' in arrowElement).toBe(false)
      expect('arrowhead' in arrowElement).toBe(false)
      expect('arrowheadPosition' in arrowElement).toBe(false)
   })
})

describe('elementIsDegenerate', () => {
   it('flags a near-zero box (a click, not a drag)', () => {
      expect(elementIsDegenerate(rect({ w: 0.001, h: 0.002 }))).toBe(true)
      expect(elementIsDegenerate(rect({ w: 0.4, h: 0.3 }))).toBe(false)
   })
   it('flags a near-zero-length line', () => {
      expect(elementIsDegenerate(line({ x1: 0.5, y1: 0.5, x2: 0.503, y2: 0.5 }))).toBe(true)
      expect(elementIsDegenerate(line({ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }))).toBe(false)
   })
})

// ####################
// # BOUNDING BOX     #
// ####################

describe('getBoundingBox', () => {
   it('returns the box for a rect directly', () => {
      expect(getBoundingBox(rect())).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.3 })
   })
   it('returns the endpoint bounds for a line regardless of direction', () => {
      const box = getBoundingBox(line({ x1: 0.6, y1: 0.7, x2: 0.2, y2: 0.3 }))
      expect(box.x).toBeCloseTo(0.2, 6)
      expect(box.y).toBeCloseTo(0.3, 6)
      expect(box.w).toBeCloseTo(0.4, 6)
      expect(box.h).toBeCloseTo(0.4, 6)
   })
})

// ############
// # HIT TEST #
// ############

describe('hitTest', () => {
   it('hits a box shape when the point is inside it', () => {
      expect(hitTest([rect()], { x: 0.4, y: 0.35 })?.id).toBe('r1')
   })
   it('misses a box shape when the point is well outside it', () => {
      expect(hitTest([rect()], { x: 0.9, y: 0.9 })).toBeNull()
   })
   it('returns the topmost (last) element when two overlap', () => {
      const bottom = rect({ id: 'bottom' })
      const top = rect({ id: 'top' })
      expect(hitTest([bottom, top], { x: 0.4, y: 0.35 })?.id).toBe('top')
   })
   it('hits a line by proximity to its segment', () => {
      // The line runs (0.1,0.1) to (0.5,0.5); a point just off the midpoint is within tolerance.
      expect(hitTest([line()], { x: 0.305, y: 0.3 })?.id).toBe('l1')
      expect(hitTest([line()], { x: 0.3, y: 0.8 })).toBeNull()
   })
})

// #####################
// # TEXT HIT BOX #
// #####################

function text(overrides: Partial<MarkupText> = {}): MarkupText {
   return { id: 'tx', kind: 'text', x: 0.3, y: 0.3, text: 'Hello', fontSize: 40, ...overrides }
}

describe('textBoundingBox', () => {
   it('estimates a real box from the anchor + fontSize + glyph run (rising above the baseline)', () => {
      const box = textBoundingBox(text(), SQUARE_VIEWBOX)
      // Anchor is the left baseline: the box starts a little left of x and ABOVE y (smaller y).
      expect(box.x).toBeLessThan(0.3)
      expect(box.y).toBeLessThan(0.3)
      expect(box.w).toBeGreaterThan(0.1) // "Hello" at 40u is roughly 120u wide plus padding, over 0.1 of a 1000u edge
      expect(box.h).toBeGreaterThan(0.03)
      // The baseline anchor sits inside the vertical span.
      expect(0.3).toBeGreaterThanOrEqual(box.y)
      expect(0.3).toBeLessThanOrEqual(box.y + box.h)
   })
   it('keeps a comfortable minimum width even for an empty label', () => {
      const box = textBoundingBox(text({ text: '' }), SQUARE_VIEWBOX)
      expect(box.w).toBeGreaterThan(0) // min one-glyph + padding, never zero
   })
   it('falls back to a square long-edge canvas for a degenerate viewBox', () => {
      const box = textBoundingBox(text(), { vbWidth: 0, vbHeight: 0 })
      expect(Number.isFinite(box.w)).toBe(true)
      expect(box.w).toBeGreaterThan(0)
   })
})

describe('hitTest with a viewBox (text is selectable near its glyphs, Bug 1)', () => {
   it('selects a text element clicked over its glyph run (to the right of the anchor)', () => {
      // Glyphs extend right/up from (0.3,0.3); a click at (0.4,0.29) is over the label.
      expect(hitTest([text()], { x: 0.4, y: 0.29 }, undefined, SQUARE_VIEWBOX)?.id).toBe('tx')
   })
   it('misses the same click without a viewBox (only the tiny zero-size anchor box is grown)', () => {
      expect(hitTest([text()], { x: 0.4, y: 0.29 })).toBeNull()
   })
   it('still misses a click well away from the label even with a viewBox', () => {
      expect(hitTest([text()], { x: 0.9, y: 0.9 }, undefined, SQUARE_VIEWBOX)).toBeNull()
   })
})

// ########
// # MOVE #
// ########

describe('moveElement', () => {
   it('shifts every coordinate of a box', () => {
      const moved = moveElement(rect(), 0.1, -0.05) as MarkupRect
      expect(moved).toMatchObject({ x: 0.3, y: 0.15, w: 0.4, h: 0.3 })
   })
   it('shifts both endpoints of a line together', () => {
      const moved = moveElement(line(), 0.1, 0.1) as MarkupLine
      expect(moved).toMatchObject({ x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.6 })
   })
   it('clamps the delta so the element cannot leave the image on the right/bottom', () => {
      const moved = moveElement(rect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }), 0.9, 0.9) as MarkupRect
      // Box is 0.4 wide/tall; the far edge stops at 1.0, so x/y cap at 0.6.
      expect(moved.x).toBeCloseTo(0.6, 6)
      expect(moved.y).toBeCloseTo(0.6, 6)
   })
   it('clamps the delta so the element cannot leave the image on the left/top', () => {
      const moved = moveElement(rect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), -0.5, -0.5) as MarkupRect
      expect(moved.x).toBeCloseTo(0, 6)
      expect(moved.y).toBeCloseTo(0, 6)
   })
})

// ##########
// # RESIZE #
// ##########

describe('resizeElement', () => {
   it('resizes a box by its SE handle (top-left fixed)', () => {
      const resized = resizeElement(rect(), 'se', { x: 0.8, y: 0.9 }) as MarkupRect
      expect(resized.x).toBeCloseTo(0.2, 6)
      expect(resized.w).toBeCloseTo(0.6, 6)
      expect(resized.h).toBeCloseTo(0.7, 6)
   })
   it('resizes a box by its NW handle (bottom-right fixed)', () => {
      const resized = resizeElement(rect(), 'nw', { x: 0.3, y: 0.3 }) as MarkupRect
      // right = 0.6, bottom = 0.5 stay fixed.
      expect(resized.x).toBeCloseTo(0.3, 6)
      expect(resized.y).toBeCloseTo(0.3, 6)
      expect(resized.w).toBeCloseTo(0.3, 6)
      expect(resized.h).toBeCloseTo(0.2, 6)
   })
   it('resizes only the top edge with the N handle', () => {
      const resized = resizeElement(rect(), 'n', { x: 0.99, y: 0.1 }) as MarkupRect
      expect(resized.x).toBeCloseTo(0.2, 6) // x unchanged (N is a vertical-only handle)
      expect(resized.w).toBeCloseTo(0.4, 6)
      expect(resized.y).toBeCloseTo(0.1, 6)
      expect(resized.h).toBeCloseTo(0.4, 6)
   })
   it('resizes only the right edge with the E handle', () => {
      const resized = resizeElement(rect(), 'e', { x: 0.75, y: 0.99 }) as MarkupRect
      expect(resized.y).toBeCloseTo(0.2, 6)
      expect(resized.h).toBeCloseTo(0.3, 6)
      expect(resized.w).toBeCloseTo(0.55, 6)
   })
   it('floors the size instead of inverting when an edge is dragged past its opposite', () => {
      const resized = resizeElement(rect(), 'se', { x: 0.1, y: 0.1 }) as MarkupRect
      expect(resized.w).toBeCloseTo(0.005, 6)
      expect(resized.h).toBeCloseTo(0.005, 6)
   })
   it('moves the start endpoint of a line', () => {
      const resized = resizeElement(line(), 'start', { x: 0.05, y: 0.06 }) as MarkupLine
      expect(resized).toMatchObject({ x1: 0.05, y1: 0.06, x2: 0.5, y2: 0.5 })
   })
   it('moves the end endpoint of a line', () => {
      const resized = resizeElement(line(), 'end', { x: 0.9, y: 0.8 }) as MarkupLine
      expect(resized).toMatchObject({ x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.8 })
   })
   it('leaves a text element unchanged (no box handles this pass)', () => {
      const text: MarkupText = { id: 't1', kind: 'text', x: 0.3, y: 0.3, text: 'hi' }
      expect(resizeElement(text, 'se', { x: 0.9, y: 0.9 })).toEqual(text)
   })
})

// ################
// # STYLE PATCH  #
// ################

describe('updateElementStyle', () => {
   it('sets style fields', () => {
      const styled = updateElementStyle(rect(), { stroke: '#ff0000', strokeWidth: 8, fill: '#00ff00' })
      expect(styled).toMatchObject({ stroke: '#ff0000', strokeWidth: 8, fill: '#00ff00' })
   })
   it('clears a field when the patch value is undefined (fill → outline)', () => {
      const filled = rect({ fill: '#00ff00', fillOpacity: 0.4 })
      const cleared = updateElementStyle(filled, { fill: undefined, fillOpacity: undefined })
      expect(cleared.fill).toBeUndefined()
      expect(cleared.fillOpacity).toBeUndefined()
   })
})

// ##########################
// # LIST ADD / REMOVE / SET #
// ##########################

describe('list transforms', () => {
   it('appends to the top of the stack', () => {
      const next = addElement([rect({ id: 'a' })], rect({ id: 'b' }))
      expect(next.map(element => element.id)).toEqual(['a', 'b'])
   })
   it('removes by id', () => {
      expect(removeElement([rect({ id: 'a' }), rect({ id: 'b' })], 'a').map(element => element.id)).toEqual(['b'])
   })
   it('replaces in place preserving order', () => {
      const replaced = replaceElement([rect({ id: 'a' }), rect({ id: 'b' })], rect({ id: 'b', x: 0.9 }))
      expect(replaced[1]).toMatchObject({ id: 'b', x: 0.9 })
      expect(replaced.map(element => element.id)).toEqual(['a', 'b'])
   })
})

// ################
// # HANDLES      #
// ################

describe('getElementHandles', () => {
   it('returns eight handles for a box shape', () => {
      const handles = getElementHandles(rect())
      expect(handles).toHaveLength(8)
      expect(handles.map(handle => handle.handle)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
      const southEast = handles.find(handle => handle.handle === 'se')!.point
      expect(southEast.x).toBeCloseTo(0.6, 6)
      expect(southEast.y).toBeCloseTo(0.5, 6)
   })
   it('returns two endpoint handles for a line', () => {
      const handles = getElementHandles(line())
      expect(handles.map(handle => handle.handle)).toEqual(['start', 'end'])
      expect(handles[0].point).toEqual({ x: 0.1, y: 0.1 })
      expect(handles[1].point).toEqual({ x: 0.5, y: 0.5 })
   })
})

describe('hitTestHandle', () => {
   it('returns the handle within tolerance of the point', () => {
      expect(hitTestHandle(rect(), { x: 0.2, y: 0.2 })).toBe('nw')
      expect(hitTestHandle(rect(), { x: 0.6, y: 0.5 })).toBe('se')
   })
   it('returns null when the point is nowhere near a handle', () => {
      expect(hitTestHandle(rect(), { x: 0.4, y: 0.35 })).toBeNull()
   })
   it('finds a line endpoint handle', () => {
      const point: NormalizedPoint = { x: 0.51, y: 0.5 }
      expect(hitTestHandle(line(), point)).toBe('end')
   })
})

// #############################
// # TEXT / CALLOUT / FREEHAND #
// #############################

describe('createTextElement', () => {
   it('places text at the click point and copies only text style fields', () => {
      const element = createTextElement({ x: 0.3, y: 0.4 }, 'Hello', { textColor: '#ff0000', fontSize: 32, stroke: '#000', fill: '#eee' }, 'tx')
      expect(element).toMatchObject({ id: 'tx', kind: 'text', x: 0.3, y: 0.4, text: 'Hello', textColor: '#ff0000', fontSize: 32 })
      // Stroke/fill are meaningless on plain text and must be dropped.
      expect('stroke' in element).toBe(false)
      expect('fill' in element).toBe(false)
   })
   it('stays lean when no style is supplied', () => {
      const element = createTextElement({ x: 0.1, y: 0.1 }, 'x', {}, 'tx2')
      expect('textColor' in element).toBe(false)
      expect('fontSize' in element).toBe(false)
   })
   it('rounds the anchor to the model precision', () => {
      const element = createTextElement({ x: 0.123456, y: 0.987654 }, 'r', {}, 'tx3')
      expect(element.x).toBe(0.1235)
      expect(element.y).toBe(0.9877)
   })
})

describe('createCalloutFromDrag', () => {
   it('builds the box from the drag and defaults the tail to a nearby point below the box', () => {
      const element = createCalloutFromDrag({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.35 }, 'Note', {}, 'co')
      expect(element).toMatchObject({ id: 'co', kind: 'callout', x: 0.2, y: 0.2, w: 0.3, h: 0.15, text: 'Note' })
      // Tail defaults below the box's lower area, clamped into [0,1].
      expect(element.tipY).toBeGreaterThan(element.y + element.h)
      expect(element.tipX).toBeGreaterThanOrEqual(0)
      expect(element.tipY).toBeLessThanOrEqual(1)
   })
   it('normalizes a reversed drag into a positive-size box', () => {
      const element = createCalloutFromDrag({ x: 0.6, y: 0.5 }, { x: 0.3, y: 0.3 }, 'n', {}, 'co2')
      expect(element).toMatchObject({ x: 0.3, y: 0.3, w: 0.3, h: 0.2 })
   })
   it('copies box + text style fields', () => {
      const element = createCalloutFromDrag({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.3 }, 't', { stroke: '#111', strokeWidth: 5, fill: '#fff', fillOpacity: 0.8, textColor: '#222', fontSize: 30 }, 'co3')
      expect(element).toMatchObject({ stroke: '#111', strokeWidth: 5, fill: '#fff', fillOpacity: 0.8, textColor: '#222', fontSize: 30 })
   })
   it('drops fillOpacity when no fill is set', () => {
      const element = createCalloutFromDrag({ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, 't', { fillOpacity: 0.5 }, 'co4')
      expect('fill' in element).toBe(false)
      expect('fillOpacity' in element).toBe(false)
   })
})

describe('createFreehandFromPoints', () => {
   it('rounds the points and copies only stroke fields', () => {
      const element = createFreehandFromPoints([{ x: 0.123456, y: 0.2 }, { x: 0.3, y: 0.4 }], { stroke: '#0a0', strokeWidth: 3, fill: '#fff' }, 'fh')
      expect(element.kind).toBe('freehand')
      expect(element.points[0]).toEqual({ x: 0.1235, y: 0.2 })
      expect(element).toMatchObject({ stroke: '#0a0', strokeWidth: 3 })
      expect('fill' in element).toBe(false)
   })
})

describe('simplifyFreehand', () => {
   it('passes through 0/1/2-point inputs (rounded)', () => {
      expect(simplifyFreehand([])).toEqual([])
      expect(simplifyFreehand([{ x: 0.1, y: 0.1 }])).toEqual([{ x: 0.1, y: 0.1 }])
      expect(simplifyFreehand([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }])).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }])
   })
   it('collapses a nearly-collinear run to its two endpoints', () => {
      const points = [
         { x: 0, y: 0 }, { x: 0.25, y: 0.0005 }, { x: 0.5, y: 0.0002 }, { x: 0.75, y: 0.0004 }, { x: 1, y: 0 },
      ]
      const simplified = simplifyFreehand(points, 0.01)
      expect(simplified).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }])
   })
   it('retains a point that spikes beyond the tolerance', () => {
      const points = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }]
      const simplified = simplifyFreehand(points, 0.01)
      expect(simplified).toHaveLength(3)
      expect(simplified[1]).toEqual({ x: 0.5, y: 0.5 })
   })
   it('always keeps the first and last point and preserves order', () => {
      const points = [{ x: 0.1, y: 0.9 }, { x: 0.4, y: 0.3 }, { x: 0.55, y: 0.31 }, { x: 0.9, y: 0.1 }]
      const simplified = simplifyFreehand(points, 0.02)
      expect(simplified[0]).toEqual({ x: 0.1, y: 0.9 })
      expect(simplified[simplified.length - 1]).toEqual({ x: 0.9, y: 0.1 })
   })
})

// ####################
// # TAIL DRAG        #
// ####################

describe('callout tail handle', () => {
   it('exposes eight box handles plus a tail handle', () => {
      const handles = getElementHandles(callout())
      expect(handles).toHaveLength(9)
      const tail = handles.find(handle => handle.handle === 'tail')!
      expect(tail.point).toEqual({ x: 0.1, y: 0.6 })
   })
   it('re-aims only the tail tip when the tail handle is dragged (box untouched)', () => {
      const resized = resizeElement(callout(), 'tail', { x: 0.8, y: 0.75 }) as MarkupCallout
      expect(resized).toMatchObject({ x: 0.2, y: 0.2, w: 0.3, h: 0.15, tipX: 0.8, tipY: 0.75 })
   })
   it('keeps the tail tip fixed when the box is resized', () => {
      const resized = resizeElement(callout(), 'se', { x: 0.7, y: 0.6 }) as MarkupCallout
      expect(resized.tipX).toBeCloseTo(0.1, 6)
      expect(resized.tipY).toBeCloseTo(0.6, 6)
   })
   it('moves the tail tip together with the box on a body drag', () => {
      const moved = moveElement(callout(), 0.1, 0.05) as MarkupCallout
      expect(moved).toMatchObject({ x: 0.3, y: 0.25, tipX: 0.2 })
      expect(moved.tipY).toBeCloseTo(0.65, 6)
   })
   it('finds the tail handle by proximity', () => {
      expect(hitTestHandle(callout(), { x: 0.1, y: 0.61 })).toBe('tail')
   })
})

// ####################
// # TEXT UPDATE      #
// ####################

describe('updateElementText', () => {
   it('sets the label on a text element', () => {
      const text: MarkupText = { id: 't', kind: 'text', x: 0.1, y: 0.1, text: 'old' }
      expect(updateElementText(text, 'new')).toMatchObject({ kind: 'text', text: 'new' })
   })
   it('sets the label on a callout element', () => {
      expect(updateElementText(callout(), 'changed')).toMatchObject({ kind: 'callout', text: 'changed' })
   })
   it('leaves a non-text element unchanged', () => {
      const original = rect()
      expect(updateElementText(original, 'nope')).toEqual(original)
   })
})

// ############
// # Z-ORDER  #
// ############

describe('z-order reorders', () => {
   const stack = () => [rect({ id: 'a' }), rect({ id: 'b' }), rect({ id: 'c' })]
   const ids = (elements: { id: string }[]) => elements.map(element => element.id)

   it('brings an element one step forward', () => {
      expect(ids(bringForward(stack(), 'a'))).toEqual(['b', 'a', 'c'])
   })
   it('is a no-op when bringing the top element forward', () => {
      const input = stack()
      expect(bringForward(input, 'c')).toBe(input)
   })
   it('sends an element one step backward', () => {
      expect(ids(sendBackward(stack(), 'c'))).toEqual(['a', 'c', 'b'])
   })
   it('is a no-op when sending the bottom element backward', () => {
      const input = stack()
      expect(sendBackward(input, 'a')).toBe(input)
   })
   it('brings an element to the front', () => {
      expect(ids(bringToFront(stack(), 'a'))).toEqual(['b', 'c', 'a'])
   })
   it('sends an element to the back', () => {
      expect(ids(sendToBack(stack(), 'c'))).toEqual(['c', 'a', 'b'])
   })
   it('is a no-op for an absent id', () => {
      const input = stack()
      expect(bringForward(input, 'zzz')).toBe(input)
      expect(sendToBack(input, 'zzz')).toBe(input)
      expect(bringToFront(input, 'zzz')).toBe(input)
      expect(sendBackward(input, 'zzz')).toBe(input)
   })
   it('does not mutate the input array', () => {
      const input = stack()
      bringToFront(input, 'a')
      expect(ids(input)).toEqual(['a', 'b', 'c'])
   })
})

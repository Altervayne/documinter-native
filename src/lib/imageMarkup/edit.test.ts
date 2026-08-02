import { describe, it, expect } from 'vitest'
import {
   pointerToNormalized, createElementFromDrag, hitTest, moveElement, resizeElement,
   updateElementStyle, addElement, removeElement, replaceElement, getElementHandles,
   hitTestHandle, getBoundingBox, elementIsDegenerate, roundNormalized,
   type CanvasRect, type NormalizedPoint,
} from './edit'
import type { MarkupArrow, MarkupEllipse, MarkupLine, MarkupRect, MarkupText } from './types'

// A landscape canvas rect (1000x500 on-screen) for pointer-mapping tests.
const RECT: CanvasRect = { left: 100, top: 50, width: 1000, height: 500 }

function rect(overrides: Partial<MarkupRect> = {}): MarkupRect {
   return { id: 'r1', kind: 'rect', x: 0.2, y: 0.2, w: 0.4, h: 0.3, ...overrides }
}
function line(overrides: Partial<MarkupLine> = {}): MarkupLine {
   return { id: 'l1', kind: 'line', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, ...overrides }
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
      // 350/1000 = 0.35 exactly; 133/1000 offset → clean fraction. Use an awkward pixel to force rounding.
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
      // The line runs (0.1,0.1)→(0.5,0.5); a point just off the midpoint is within tolerance.
      expect(hitTest([line()], { x: 0.305, y: 0.3 })?.id).toBe('l1')
      expect(hitTest([line()], { x: 0.3, y: 0.8 })).toBeNull()
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

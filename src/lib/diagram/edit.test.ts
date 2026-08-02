/**
 * edit.test.ts, unit coverage for the PURE node-editor transforms in `lib/diagram/edit.ts`.
 *
 * These mirror the image-markup + graph edit-layer test suites: every transform is exercised for the
 * happy path, the no-op (absent id) path, and the geometric edge cases (resize flooring, handle
 * hit-test tolerance, pointer→unit mapping, delete-cascades-edges). The editor component is thin glue
 * over these, so proving them here proves the interaction math without a DOM.
 */

import { describe, it, expect } from 'vitest'
import type { DiagramSpec, DiagramNode } from './types'
import {
   addNode, createNode, duplicateNode, removeNode, moveNode, resizeNode, updateNodeLabel, updateNodeStyle,
   hitTestNode, nodeHandlePoints, hitTestNodeHandle, pointerToDiagramPoint, computeEditorCanvas,
   nodeBox, findNode, roundUnit, translateNode, setNode, NODE_MIN_WIDTH, NODE_MIN_HEIGHT,
   clampViewScale, applyViewTransform, invertViewTransform, screenToFramePoint, zoomViewToward,
   fitViewToContent, viewportViewBox, frameFromContainer, clampCanvasHeight, computeAlignmentSnaps,
   computeResizeSnaps, resizeHandleEdges,
   IDENTITY_VIEW_TRANSFORM, VIEW_MIN_SCALE, VIEW_MAX_SCALE,
   CANVAS_MIN_HEIGHT, CANVAS_MAX_HEIGHT, CANVAS_DEFAULT_HEIGHT,
   createEdge, addEdge, deleteEdge, findEdge, setEdge, updateEdgeLabel, updateEdgeStyle,
   nodePorts, hitTestPort, distancePointToSegment, distanceToPolyline, hitTestEdge,
   PORT_GAP, PORT_HIT_TOLERANCE,
} from './edit'
import type { ViewTransform, NodeBox } from './edit'

// ###########
// # FIXTURE  #
// ###########

function node(id: string, over: Partial<DiagramNode> = {}): DiagramNode {
   return { id, x: 40, y: 40, width: 120, height: 56, shape: 'rounded', label: id, ...over }
}

function spec(nodes: DiagramNode[], edges: DiagramSpec['edges'] = []): DiagramSpec {
   return { nodes, edges, options: {} }
}

// ###########
// # ADD      #
// ###########

describe('createNode + addNode', () => {
   it('centers a default-sized node on the drop point, rounded to whole units', () => {
      const created = createNode('diamond', { x: 100.4, y: 60.6 }, 'Hi', 'n1')
      // default box 120x56, centered → top-left = center - half
      expect(created).toMatchObject({ id: 'n1', shape: 'diamond', label: 'Hi', width: 120, height: 56 })
      expect(created.x).toBe(roundUnit(100.4 - 60))
      expect(created.y).toBe(roundUnit(60.6 - 28))
      // no style overrides on a fresh node
      expect(created.fill).toBeUndefined()
      expect(created.stroke).toBeUndefined()
   })

   it('appends to the end of the node list (top of the z-order)', () => {
      const base = spec([node('a')])
      const next = addNode(base, createNode('rectangle', { x: 0, y: 0 }, 'B', 'b'))
      expect(next.nodes.map(single => single.id)).toEqual(['a', 'b'])
      expect(base.nodes).toHaveLength(1) // input untouched (immutability)
   })

   it('seeds a heading shape (banner/chevron) wider and shorter than the general default', () => {
      const banner = createNode('banner', { x: 100, y: 100 }, 'Phase 1', 'n1')
      const chevron = createNode('chevron', { x: 100, y: 100 }, 'Phase 2', 'n2')
      expect(banner).toMatchObject({ width: 220, height: 44 })
      expect(chevron).toMatchObject({ width: 220, height: 44 })
      // still centered on the drop point, like every other shape.
      expect(banner.x).toBe(roundUnit(100 - 110))
      expect(banner.y).toBe(roundUnit(100 - 22))
   })

   it('keeps every other shape at the general default size', () => {
      for (const shape of ['rectangle', 'rounded', 'ellipse', 'diamond', 'pill'] as const) {
         const created = createNode(shape, { x: 0, y: 0 }, '', 'n')
         expect(created).toMatchObject({ width: 120, height: 56 })
      }
   })
})

// ###############
// # DUPLICATE    #
// ###############

describe('duplicateNode', () => {
   it('clones the node with a fresh id + an offset top-left, preserving shape/label/size/colors', () => {
      const source = node('a', {
         x: 40, y: 40, width: 120, height: 56, shape: 'diamond', label: 'Step',
         fill: '#ffeecc', stroke: '#334455', textColor: '#101010',
      })
      const copy = duplicateNode(source, () => 'a-copy', 20)
      expect(copy).toEqual({
         id: 'a-copy', x: 60, y: 60, width: 120, height: 56, shape: 'diamond', label: 'Step',
         fill: '#ffeecc', stroke: '#334455', textColor: '#101010',
      })
      // the source is never mutated (immutability).
      expect(source.id).toBe('a')
      expect(source.x).toBe(40)
   })

   it('rounds the offset top-left to whole units and does not carry style keys the source lacks', () => {
      const source = node('a', { x: 10.4, y: 10.4 })
      const copy = duplicateNode(source, () => 'b', 5.2)
      expect(copy.x).toBe(roundUnit(10.4 + 5.2)) // 16
      expect(copy.y).toBe(roundUnit(10.4 + 5.2))
      expect('fill' in copy).toBe(false)
   })
})

// ###########
// # REMOVE   #
// ###########

describe('removeNode', () => {
   it('drops the node and every incident edge (both directions)', () => {
      const base = spec(
         [node('a'), node('b'), node('c')],
         [
            { id: 'e1', from: 'a', to: 'b' },
            { id: 'e2', from: 'b', to: 'c' },
            { id: 'e3', from: 'c', to: 'a' },
         ],
      )
      const next = removeNode(base, 'b')
      expect(next.nodes.map(single => single.id)).toEqual(['a', 'c'])
      // e1 (a→b) and e2 (b→c) are incident to b; only e3 (c→a) survives.
      expect((next.edges ?? []).map(edge => edge.id)).toEqual(['e3'])
   })

   it('is a no-op for an absent id but still returns a fresh spec', () => {
      const base = spec([node('a')])
      const next = removeNode(base, 'nope')
      expect(next.nodes.map(single => single.id)).toEqual(['a'])
      expect(next).not.toBe(base)
   })
})

// ###########
// # MOVE     #
// ###########

describe('moveNode', () => {
   it('translates the node by the delta, rounded, leaving size + others intact', () => {
      const base = spec([node('a', { x: 40, y: 40 }), node('b', { x: 200, y: 40 })])
      const next = moveNode(base, 'a', 15.6, -4.2)
      expect(findNode(next, 'a')).toMatchObject({ x: 56, y: 36, width: 120, height: 56 })
      expect(findNode(next, 'b')).toMatchObject({ x: 200, y: 40 }) // untouched
   })

   it('no-ops an absent id', () => {
      const base = spec([node('a')])
      expect(moveNode(base, 'ghost', 10, 10)).toEqual(base)
   })
})

describe('translateNode + setNode (origin-based drag primitives)', () => {
   it('translateNode moves a single node from its origin without drift', () => {
      const origin = node('a', { x: 40, y: 40 })
      // applying the same origin repeatedly is idempotent (no accumulation) — the drag contract
      const first  = translateNode(origin, 12.5, -3.5)
      const second = translateNode(origin, 12.5, -3.5)
      expect(first).toEqual(second)
      expect(first).toMatchObject({ x: 53, y: 37, width: 120 })
   })

   it('setNode replaces by id, preserving order, and no-ops an absent id', () => {
      const base = spec([node('a'), node('b')])
      const moved = translateNode(node('b'), 100, 0)
      const next = setNode(base, moved)
      expect(next.nodes.map(single => single.id)).toEqual(['a', 'b'])
      expect(findNode(next, 'b')).toMatchObject({ x: 140 })
      expect(setNode(base, node('ghost'))).toEqual(base)
   })
})

// ###########
// # RESIZE   #
// ###########

describe('resizeNode', () => {
   it('moves the SE handle, growing width/height, keeping the top-left fixed', () => {
      const base = spec([node('a', { x: 40, y: 40, width: 120, height: 56 })])
      const next = resizeNode(base, 'a', 'se', { x: 240, y: 160 })
      expect(findNode(next, 'a')).toMatchObject({ x: 40, y: 40, width: 200, height: 120 })
   })

   it('moves the NW handle, keeping the bottom-right fixed', () => {
      const base = spec([node('a', { x: 40, y: 40, width: 120, height: 56 })]) // br = (160, 96)
      const next = resizeNode(base, 'a', 'nw', { x: 60, y: 50 })
      expect(findNode(next, 'a')).toMatchObject({ x: 60, y: 50, width: 100, height: 46 })
   })

   it('floors the width when the west edge is dragged past the east edge', () => {
      const base = spec([node('a', { x: 40, y: 40, width: 120, height: 56 })]) // right = 160
      const next = resizeNode(base, 'a', 'w', { x: 300, y: 40 })
      const resized = findNode(next, 'a')!
      expect(resized.width).toBe(NODE_MIN_WIDTH)
      // right edge (160) stays fixed → x = 160 - MIN
      expect(resized.x).toBe(160 - NODE_MIN_WIDTH)
   })

   it('floors the height when the north edge is dragged past the south edge', () => {
      const base = spec([node('a', { x: 40, y: 40, width: 120, height: 56 })]) // bottom = 96
      const next = resizeNode(base, 'a', 'n', { x: 40, y: 300 })
      const resized = findNode(next, 'a')!
      expect(resized.height).toBe(NODE_MIN_HEIGHT)
      expect(resized.y).toBe(96 - NODE_MIN_HEIGHT)
   })
})

// ###########
// # LABEL    #
// ###########

describe('updateNodeLabel', () => {
   it('sets the label, leaving geometry intact', () => {
      const base = spec([node('a', { label: 'old' })])
      expect(findNode(updateNodeLabel(base, 'a', 'new'), 'a')).toMatchObject({ label: 'new', width: 120 })
   })
   it('no-ops an absent id', () => {
      const base = spec([node('a')])
      expect(updateNodeLabel(base, 'ghost', 'x')).toEqual(base)
   })
})

// ###########
// # STYLE    #
// ###########

describe('updateNodeStyle', () => {
   it('sets a shape + color overrides', () => {
      const base = spec([node('a')])
      const next = findNode(updateNodeStyle(base, 'a', { shape: 'ellipse', fill: '#ff0000' }), 'a')!
      expect(next.shape).toBe('ellipse')
      expect(next.fill).toBe('#ff0000')
   })

   it('clears an override when the key is present with undefined', () => {
      const base = spec([node('a', { fill: '#ff0000', stroke: '#000000' })])
      const next = findNode(updateNodeStyle(base, 'a', { fill: undefined }), 'a')!
      expect('fill' in next).toBe(false)   // dropped, not left as undefined
      expect(next.stroke).toBe('#000000')  // untouched sibling override survives
   })

   it('leaves untouched keys alone and ignores an undefined shape', () => {
      const base = spec([node('a', { shape: 'diamond', fill: '#abcabc' })])
      const next = findNode(updateNodeStyle(base, 'a', { textColor: '#111111' }), 'a')!
      expect(next.shape).toBe('diamond')
      expect(next.fill).toBe('#abcabc')
      expect(next.textColor).toBe('#111111')
   })
})

// ###########
// # HIT TEST #
// ###########

describe('hitTestNode', () => {
   const base = spec([
      node('a', { x: 0, y: 0, width: 100, height: 60 }),
      node('b', { x: 50, y: 30, width: 100, height: 60 }), // overlaps a
   ])

   it('returns the topmost (last) node when boxes overlap', () => {
      expect(hitTestNode(base, { x: 70, y: 40 })?.id).toBe('b')
   })
   it('returns the lower node where only it covers the point', () => {
      expect(hitTestNode(base, { x: 10, y: 10 })?.id).toBe('a')
   })
   it('returns null when no box covers the point', () => {
      expect(hitTestNode(base, { x: 500, y: 500 })).toBeNull()
   })
   it('honors a positive tolerance around the box', () => {
      expect(hitTestNode(base, { x: -3, y: -3 })).toBeNull()
      expect(hitTestNode(base, { x: -3, y: -3 }, 5)?.id).toBe('a')
   })
})

// ###########
// # HANDLES  #
// ###########

describe('nodeHandlePoints + hitTestNodeHandle', () => {
   const single = node('a', { x: 0, y: 0, width: 100, height: 60 })

   it('exposes the eight handles at the box corners + edge midpoints', () => {
      const points = nodeHandlePoints(single)
      expect(points).toHaveLength(8)
      const byHandle = Object.fromEntries(points.map(entry => [entry.handle, entry.point]))
      expect(byHandle.nw).toEqual({ x: 0, y: 0 })
      expect(byHandle.se).toEqual({ x: 100, y: 60 })
      expect(byHandle.n).toEqual({ x: 50, y: 0 })
      expect(byHandle.e).toEqual({ x: 100, y: 30 })
   })

   it('grabs the nearest handle within tolerance, else null', () => {
      expect(hitTestNodeHandle(single, { x: 2, y: 2 })).toBe('nw')      // near nw corner
      expect(hitTestNodeHandle(single, { x: 100, y: 62 })).toBe('se')   // near se corner (dist 2)
      expect(hitTestNodeHandle(single, { x: 50, y: 30 })).toBeNull()    // center: no handle near
   })
})

// ###########
// # POINTER  #
// ###########

describe('pointerToDiagramPoint', () => {
   const rect = { left: 100, top: 200, width: 400, height: 300 }
   const viewBox = { minX: 0, minY: 0, width: 200, height: 150 } // half-scale

   it('maps a canvas pixel to diagram units proportionally', () => {
      // center of the rect → center of the viewBox
      expect(pointerToDiagramPoint(300, 350, rect, viewBox)).toEqual({ x: 100, y: 75 })
      // top-left corner → viewBox origin
      expect(pointerToDiagramPoint(100, 200, rect, viewBox)).toEqual({ x: 0, y: 0 })
   })

   it('respects a non-zero viewBox origin', () => {
      const shifted = { minX: 20, minY: 10, width: 200, height: 150 }
      expect(pointerToDiagramPoint(100, 200, rect, shifted)).toEqual({ x: 20, y: 10 })
   })

   it('maps a zero-size rect to the viewBox origin (no divide-by-zero)', () => {
      expect(pointerToDiagramPoint(300, 350, { left: 0, top: 0, width: 0, height: 0 }, viewBox))
         .toEqual({ x: 0, y: 0 })
   })
})

// #################
// # EDITOR CANVAS  #
// #################

describe('computeEditorCanvas', () => {
   it('returns the minimum extent for an empty diagram', () => {
      expect(computeEditorCanvas(spec([]))).toEqual({ width: 320, height: 220 })
   })

   it('frames the padded content far-corner, floored at the minimum', () => {
      // one node reaching to (160, 96); + 40 padding → (200, 136) → floored to the minimum
      expect(computeEditorCanvas(spec([node('a')]))).toEqual({ width: 320, height: 220 })
      // a node far out grows the canvas past the minimum
      const wide = computeEditorCanvas(spec([node('a', { x: 400, y: 500, width: 120, height: 56 })]))
      expect(wide.width).toBe(560)  // 520 + 40
      expect(wide.height).toBe(596) // 556 + 40
   })
})

// ###########
// # MISC     #
// ###########

describe('nodeBox + roundUnit', () => {
   it('nodeBox normalizes a negative size to zero', () => {
      expect(nodeBox(node('a', { x: 5, y: 6, width: -10, height: -4 }))).toEqual({ x: 5, y: 6, width: 0, height: 0 })
   })
   it('roundUnit rounds finite, collapses non-finite to 0', () => {
      expect(roundUnit(12.6)).toBe(13)
      expect(roundUnit(Number.NaN)).toBe(0)
      expect(roundUnit(Infinity)).toBe(0)
   })
})

// #################
// # VIEW TRANSFORM #
// #################

describe('clampViewScale', () => {
   it('clamps into the zoom range and passes a mid value through', () => {
      expect(clampViewScale(0.01)).toBe(VIEW_MIN_SCALE)
      expect(clampViewScale(99)).toBe(VIEW_MAX_SCALE)
      expect(clampViewScale(1.5)).toBe(1.5)
   })
   it('falls back to 1 for a non-finite scale', () => {
      expect(clampViewScale(Number.NaN)).toBe(1)
   })
})

describe('applyViewTransform + invertViewTransform', () => {
   const view: ViewTransform = { scale: 2, translateX: 30, translateY: -10 }

   it('applies scale then translate (view = scale*point + translate)', () => {
      expect(applyViewTransform({ x: 10, y: 20 }, view)).toEqual({ x: 50, y: 30 })
   })

   it('inverts exactly (round-trips diagram → view → diagram)', () => {
      const original = { x: 37, y: -12 }
      const roundTripped = invertViewTransform(applyViewTransform(original, view), view)
      expect(roundTripped.x).toBeCloseTo(original.x, 10)
      expect(roundTripped.y).toBeCloseTo(original.y, 10)
   })

   it('invert treats a zero scale as 1 (no divide-by-zero)', () => {
      expect(invertViewTransform({ x: 5, y: 5 }, { scale: 0, translateX: 0, translateY: 0 })).toEqual({ x: 5, y: 5 })
   })
})

describe('screenToFramePoint', () => {
   const rect = { left: 100, top: 200, width: 400, height: 300 }
   const frame = { minX: 0, minY: 0, width: 200, height: 150 }

   it('maps a screen pixel to view space proportionally, transform-independent', () => {
      expect(screenToFramePoint(300, 350, rect, frame)).toEqual({ x: 100, y: 75 })
      expect(screenToFramePoint(100, 200, rect, frame)).toEqual({ x: 0, y: 0 })
   })
   it('maps a zero-size rect to the frame origin', () => {
      expect(screenToFramePoint(300, 350, { left: 0, top: 0, width: 0, height: 0 }, frame)).toEqual({ x: 0, y: 0 })
   })
})

describe('pointerToDiagramPoint under a view transform', () => {
   const rect = { left: 0, top: 0, width: 200, height: 150 }
   const frame = { minX: 0, minY: 0, width: 200, height: 150 } // 1 screen px = 1 view unit

   it('is the plain frame map with the default (identity) transform', () => {
      // screen (50,30) → view (50,30) → diagram (50,30)
      expect(pointerToDiagramPoint(50, 30, rect, frame)).toEqual({ x: 50, y: 30 })
   })

   it('composes the zoom + pan so the diagram point is the inverse-mapped view point', () => {
      const view: ViewTransform = { scale: 2, translateX: 20, translateY: 10 }
      // screen (50,30) → view (50,30) → diagram ((50-20)/2, (30-10)/2) = (15,10)
      const mapped = pointerToDiagramPoint(50, 30, rect, frame, view)
      expect(mapped.x).toBeCloseTo(15, 10)
      expect(mapped.y).toBeCloseTo(10, 10)
      // and it round-trips: that diagram point renders back at the same view-space pixel
      expect(applyViewTransform(mapped, view)).toEqual(screenToFramePoint(50, 30, rect, frame))
   })
})

describe('zoomViewToward', () => {
   const rect = { left: 0, top: 0, width: 300, height: 200 }
   const frame = { minX: 0, minY: 0, width: 300, height: 200 }

   it('keeps the diagram point under the cursor pinned across a zoom', () => {
      const view = IDENTITY_VIEW_TRANSFORM
      const cursor = screenToFramePoint(120, 80, rect, frame) // view-space cursor
      const before = pointerToDiagramPoint(120, 80, rect, frame, view)
      const zoomed = zoomViewToward(view, cursor, 2.5)
      const after = pointerToDiagramPoint(120, 80, rect, frame, zoomed)
      expect(zoomed.scale).toBe(2.5)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
   })

   it('clamps the target scale to the zoom range', () => {
      const zoomed = zoomViewToward(IDENTITY_VIEW_TRANSFORM, { x: 0, y: 0 }, 999)
      expect(zoomed.scale).toBe(VIEW_MAX_SCALE)
   })
})

describe('fitViewToContent', () => {
   const frame = { minX: 0, minY: 0, width: 320, height: 220 }

   it('returns the identity transform for an empty diagram', () => {
      expect(fitViewToContent(spec([]), frame)).toEqual(IDENTITY_VIEW_TRANSFORM)
   })

   it('centers the content bounding box within the frame', () => {
      // a single node's box center should map to the frame center under the fitted transform
      const single = node('a', { x: 40, y: 40, width: 120, height: 56 })
      const fitted = fitViewToContent(spec([single]), frame)
      const contentCenter = { x: 40 + 60, y: 40 + 28 }
      const mappedCenter = applyViewTransform(contentCenter, fitted)
      expect(mappedCenter.x).toBeCloseTo(frame.width / 2, 6)
      expect(mappedCenter.y).toBeCloseTo(frame.height / 2, 6)
   })

   it('scales large content down to fit (within the clamp) and keeps it inside the frame', () => {
      // width 1000 over a 320 frame → scale 0.32, inside the [0.25, 4] clamp so it truly fits.
      const wide = node('a', { x: 0, y: 0, width: 1000, height: 40 })
      const fitted = fitViewToContent(spec([wide]), frame, 0)
      expect(fitted.scale).toBeGreaterThanOrEqual(VIEW_MIN_SCALE)
      expect(fitted.scale).toBeLessThan(1)
      // the far corners land within [0, frame.width] after fitting
      const left = applyViewTransform({ x: 0, y: 0 }, fitted).x
      const right = applyViewTransform({ x: 1000, y: 0 }, fitted).x
      expect(left).toBeGreaterThanOrEqual(-0.001)
      expect(right).toBeLessThanOrEqual(frame.width + 0.001)
   })
})

// ############################
// # VIEWPORT (UNBOUNDED CANVAS) #
// ############################

describe('viewportViewBox', () => {
   const frame = { width: 320, height: 220 }

   it('is the full frame at the origin under the identity transform', () => {
      expect(viewportViewBox(frame, IDENTITY_VIEW_TRANSFORM)).toEqual({ minX: 0, minY: 0, width: 320, height: 220 })
   })

   it('shrinks the window (zoom in) and shifts the origin (pan)', () => {
      // zoom 2× → half-size window; pan translate (-40, 20) → origin (20, -20)
      expect(viewportViewBox(frame, { scale: 2, translateX: -40, translateY: 20 }))
         .toEqual({ minX: 20, minY: -10, width: 160, height: 110 })
   })

   it('always keeps the frame aspect ratio (maps onto the container with no letterbox)', () => {
      const viewport = viewportViewBox(frame, { scale: 0.5, translateX: 130, translateY: -70 })
      expect(viewport.width / viewport.height).toBeCloseTo(frame.width / frame.height, 10)
   })

   it('mapping through the derived viewport equals mapping through frame + view transform', () => {
      // The unbounded-canvas invariant: pointer→diagram via the viewport (a plain frame map) is exactly
      // the same as composing the view transform against the fixed frame — so pointer mapping stays
      // pixel-accurate under the new model.
      const rect = { left: 0, top: 0, width: 600, height: 400 }
      const frameBox = { minX: 0, minY: 0, width: 300, height: 200 }
      const view = { scale: 2, translateX: -40, translateY: 20 }
      const viewport = viewportViewBox(frameBox, view)
      for (const [clientX, clientY] of [[0, 0], [300, 200], [575, 111], [600, 400]]) {
         const viaViewport = pointerToDiagramPoint(clientX, clientY, rect, viewport)
         const viaCompose  = pointerToDiagramPoint(clientX, clientY, rect, frameBox, view)
         expect(viaViewport.x).toBeCloseTo(viaCompose.x, 9)
         expect(viaViewport.y).toBeCloseTo(viaCompose.y, 9)
      }
   })

   it('makes a node placed far OUTSIDE the initial frame reachable by panning (never clipped)', () => {
      const frameBox = { minX: 0, minY: 0, width: 320, height: 220 }
      const far = node('far', { x: 1000, y: 800, width: 120, height: 56 })
      // At the identity view the far node is outside the viewport (that's fine — it's just off-screen).
      const initial = viewportViewBox(frameBox, IDENTITY_VIEW_TRANSFORM)
      expect(far.x).toBeGreaterThan(initial.minX + initial.width)
      // Panning the view (translate) brings a viewport over the far node — it is drawn, not lost.
      const panned = viewportViewBox(frameBox, { scale: 1, translateX: -940, translateY: -740 })
      expect(far.x).toBeGreaterThanOrEqual(panned.minX)
      expect(far.x + far.width).toBeLessThanOrEqual(panned.minX + panned.width)
      expect(far.y).toBeGreaterThanOrEqual(panned.minY)
      expect(far.y + far.height).toBeLessThanOrEqual(panned.minY + panned.height)
   })

   it('fit-to-content frames a node placed outside the initial frame (fully within the viewport)', () => {
      const frameBox = { minX: 0, minY: 0, width: 320, height: 220 }
      const inside = node('a', { x: 40, y: 40, width: 120, height: 56 })
      const far    = node('far', { x: 900, y: 700, width: 120, height: 56 })
      const fitted = fitViewToContent(spec([inside, far]), frameBox)
      const viewport = viewportViewBox(frameBox, fitted)
      // every corner of BOTH nodes lands inside the fitted viewport
      for (const single of [inside, far]) {
         expect(single.x).toBeGreaterThanOrEqual(viewport.minX - 0.001)
         expect(single.x + single.width).toBeLessThanOrEqual(viewport.minX + viewport.width + 0.001)
         expect(single.y).toBeGreaterThanOrEqual(viewport.minY - 0.001)
         expect(single.y + single.height).toBeLessThanOrEqual(viewport.minY + viewport.height + 0.001)
      }
   })
})

// ####################################
// # RESIZABLE CANVAS HEIGHT (FRAME)  #
// ####################################

describe('clampCanvasHeight', () => {
   it('clamps into the [min, max] range and passes a mid value through', () => {
      expect(clampCanvasHeight(10)).toBe(CANVAS_MIN_HEIGHT)
      expect(clampCanvasHeight(99999)).toBe(CANVAS_MAX_HEIGHT)
      expect(clampCanvasHeight(500)).toBe(500)
   })
   it('falls back to the default for a non-finite height', () => {
      expect(clampCanvasHeight(Number.NaN)).toBe(CANVAS_DEFAULT_HEIGHT)
   })
})

describe('frameFromContainer', () => {
   it('gives the frame the EXACT aspect ratio of the container (keeps mapping undistorted)', () => {
      // reference width 320, a 640×480 container → aspect 4:3 → height 240
      const frame = frameFromContainer(320, 640, 480)
      expect(frame).toEqual({ minX: 0, minY: 0, width: 320, height: 240 })
      expect(frame.width / frame.height).toBeCloseTo(640 / 480, 10)
   })

   it('grows the frame height when the container is made TALLER (more vertical room)', () => {
      const shortContainer = frameFromContainer(320, 640, 360)
      const tallContainer  = frameFromContainer(320, 640, 720)
      // same reference width, taller container → taller frame → taller viewport → more diagram visible
      expect(tallContainer.width).toBe(shortContainer.width)
      expect(tallContainer.height).toBeGreaterThan(shortContainer.height)
   })

   it('falls back to a square-ish frame for a degenerate (unmeasured) container', () => {
      expect(frameFromContainer(320, 0, 0)).toEqual({ minX: 0, minY: 0, width: 320, height: 320 })
   })

   it('keeps pointer mapping pixel-accurate at the new (taller) frame — mapping equivalence holds', () => {
      // A taller container yields a taller frame; the viewport-vs-compose invariant must still hold, so
      // node placement/drag/resize/selection stay exact after the user grows the canvas height.
      const frame = frameFromContainer(320, 800, 600) // 4:3 → 320×240
      const rect = { left: 0, top: 0, width: 800, height: 600 }
      const view = { scale: 1.5, translateX: -30, translateY: 45 }
      const viewport = viewportViewBox(frame, view)
      for (const [clientX, clientY] of [[0, 0], [400, 300], [799, 137], [800, 600]]) {
         const viaViewport = pointerToDiagramPoint(clientX, clientY, rect, viewport)
         const viaCompose  = pointerToDiagramPoint(clientX, clientY, rect, frame, view)
         expect(viaViewport.x).toBeCloseTo(viaCompose.x, 9)
         expect(viaViewport.y).toBeCloseTo(viaCompose.y, 9)
      }
   })
})

// #################
// # ALIGNMENT SNAP #
// #################

function box(over: Partial<NodeBox> = {}): NodeBox {
   return { x: 0, y: 0, width: 100, height: 60, ...over }
}

describe('computeAlignmentSnaps', () => {
   it('snaps the left edge onto another node left within threshold and reports snapX', () => {
      const dragged = box({ x: 203, y: 300, width: 100, height: 60 })
      const other = box({ x: 200, y: 0, width: 100, height: 60 })
      const result = computeAlignmentSnaps(dragged, [other], 6)
      expect(result.snapX).toBe(200) // left 203 → 200 (offset -3)
      expect(result.snapY).toBeUndefined()
   })

   it('does not snap when every candidate line is beyond the threshold', () => {
      const dragged = box({ x: 260, y: 300 })
      const other = box({ x: 200, y: 0 })
      const result = computeAlignmentSnaps(dragged, [other], 6)
      expect(result.snapX).toBeUndefined()
      expect(result.snapY).toBeUndefined()
      expect(result.guides).toEqual([])
   })

   it('picks the nearest of several candidate lines', () => {
      // dragged left = 205; other-A right = 210 (dist 5), other-B left = 203 (dist 2) → snap to 203
      const dragged = box({ x: 205, y: 400, width: 100, height: 60 })
      const otherA = box({ x: 110, y: 0, width: 100, height: 60 }) // right edge = 210
      const otherB = box({ x: 203, y: 0, width: 100, height: 60 }) // left edge = 203
      const result = computeAlignmentSnaps(dragged, [otherA, otherB], 6)
      expect(result.snapX).toBe(203)
   })

   it('snaps horizontal-center to horizontal-center and independently on both axes', () => {
      // dragged center x = 251 → snaps to other center x = 250 (offset -1); left/top also probed
      const dragged = box({ x: 201, y: 121, width: 100, height: 60 }) // centerX 251, centerY 151
      const other = box({ x: 200, y: 120, width: 100, height: 60 })    // centerX 250, centerY 150
      const result = computeAlignmentSnaps(dragged, [other], 6)
      // nearest x pair: left 201↔200 (dist1) vs centerX 251↔250 (dist1) — first (left) wins the tie
      expect(result.snapX).toBe(200)
      expect(result.snapY).toBe(120)
   })

   it('emits a vertical guide spanning both nodes when the x edges align', () => {
      const dragged = box({ x: 200, y: 300, width: 100, height: 60 }) // exact left align
      const other = box({ x: 200, y: 0, width: 100, height: 60 })
      const result = computeAlignmentSnaps(dragged, [other], 6)
      const vertical = result.guides.find(guide => guide.orientation === 'vertical')
      expect(vertical).toBeDefined()
      expect(vertical!.position).toBe(200)
      // spans from the topmost involved top (0) to the bottommost involved bottom (360)
      expect(vertical!.from).toBe(0)
      expect(vertical!.to).toBe(360)
   })

   it('returns no snap and no guides when there are no other nodes', () => {
      const result = computeAlignmentSnaps(box({ x: 10, y: 10 }), [], 6)
      expect(result).toEqual({ snapX: undefined, snapY: undefined, guides: [] })
   })
})

// #####################
// # RESIZE SNAP        #
// #####################

describe('resizeHandleEdges', () => {
   it('maps a side handle to its one moving edge', () => {
      expect(resizeHandleEdges('e')).toEqual({ left: false, right: true, top: false, bottom: false })
      expect(resizeHandleEdges('w')).toEqual({ left: true, right: false, top: false, bottom: false })
      expect(resizeHandleEdges('n')).toEqual({ left: false, right: false, top: true, bottom: false })
      expect(resizeHandleEdges('s')).toEqual({ left: false, right: false, top: false, bottom: true })
   })

   it('maps a corner handle to the two edges meeting at it', () => {
      expect(resizeHandleEdges('se')).toEqual({ left: false, right: true, top: false, bottom: true })
      expect(resizeHandleEdges('nw')).toEqual({ left: true, right: false, top: true, bottom: false })
      expect(resizeHandleEdges('ne')).toEqual({ left: false, right: true, top: true, bottom: false })
      expect(resizeHandleEdges('sw')).toEqual({ left: true, right: false, top: false, bottom: true })
   })
})

describe('computeResizeSnaps', () => {
   it('snaps a right (e) handle onto a neighbor left edge, keeping the pinned left edge fixed', () => {
      const rect = box({ x: 0, y: 0, width: 97, height: 60 })       // right edge = 97
      const other = box({ x: 100, y: 0, width: 100, height: 60 })   // left edge = 100
      const result = computeResizeSnaps(rect, 'e', [other], 6)
      expect(result.rect).toMatchObject({ x: 0, y: 0, width: 100, height: 60 }) // right 97 → 100
      const guide = result.guides.find(single => single.orientation === 'vertical')
      expect(guide?.position).toBe(100)
   })

   it('snaps a bottom (s) handle onto a neighbor top edge, keeping the pinned top edge fixed', () => {
      const rect = box({ x: 0, y: 0, width: 100, height: 57 })      // bottom edge = 57
      const other = box({ x: 0, y: 60, width: 100, height: 60 })    // top edge = 60
      const result = computeResizeSnaps(rect, 's', [other], 6)
      expect(result.rect).toMatchObject({ x: 0, y: 0, width: 100, height: 60 }) // bottom 57 → 60
      const guide = result.guides.find(single => single.orientation === 'horizontal')
      expect(guide?.position).toBe(60)
   })

   it('snaps BOTH edges of a corner (se) handle to a neighbor corner', () => {
      const rect = box({ x: 0, y: 0, width: 97, height: 57 })       // right 97, bottom 57
      const other = box({ x: 100, y: 60, width: 80, height: 80 })   // left 100, top 60
      const result = computeResizeSnaps(rect, 'se', [other], 6)
      expect(result.rect).toMatchObject({ x: 0, y: 0, width: 100, height: 60 })
      expect(result.guides.some(single => single.orientation === 'vertical' && single.position === 100)).toBe(true)
      expect(result.guides.some(single => single.orientation === 'horizontal' && single.position === 60)).toBe(true)
   })

   it('snaps a moving edge to a neighbor CENTER line, not only its edges', () => {
      const rect = box({ x: 0, y: 0, width: 97, height: 60 })       // right edge = 97
      const other = box({ x: 50, y: 0, width: 100, height: 60 })    // centerX = 100
      const result = computeResizeSnaps(rect, 'e', [other], 6)
      expect(result.rect.width).toBe(100)                            // right 97 → center 100
   })

   it('leaves the rect untouched (no guides) when the moving edge is beyond the threshold', () => {
      const rect = box({ x: 0, y: 0, width: 90, height: 60 })       // right edge = 90
      const other = box({ x: 100, y: 0, width: 100, height: 60 })   // nearest line 100 (dist 10 > 6)
      const result = computeResizeSnaps(rect, 'e', [other], 6)
      expect(result.rect).toEqual({ x: 0, y: 0, width: 90, height: 60 })
      expect(result.guides).toEqual([])
   })

   it('floors the width when a snapped moving edge would collapse the box past the minimum', () => {
      const rect = box({ x: 0, y: 0, width: 26, height: 60 })       // right edge = 26 (pinned)
      const other = box({ x: 4, y: 0, width: 50, height: 60 })      // left line = 4, within 6 of left 0
      const result = computeResizeSnaps(rect, 'w', [other], 6)
      // left snap to 4 would give width 22 < min; floored to the minimum with the right edge pinned.
      expect(result.rect.width).toBe(NODE_MIN_WIDTH)
      expect(result.rect.x).toBe(26 - NODE_MIN_WIDTH)
   })
})

// #################
// # EDGE CRUD      #
// #################

describe('createEdge + addEdge', () => {
   it('creates a lean straight edge (id/from/to only, no default fields)', () => {
      const edge = createEdge('a', 'b', 'e1')
      expect(edge).toEqual({ id: 'e1', from: 'a', to: 'b' })
      // no redundant arrow/routing/dashed on a fresh edge (they render at their defaults)
      expect('arrow' in edge).toBe(false)
      expect('routing' in edge).toBe(false)
   })

   it('appends to the end of the edge list (top of the z-order), input untouched', () => {
      const base = spec([node('a'), node('b')], [{ id: 'e1', from: 'a', to: 'b' }])
      const next = addEdge(base, createEdge('b', 'a', 'e2'))
      expect((next.edges ?? []).map(edge => edge.id)).toEqual(['e1', 'e2'])
      expect(base.edges).toHaveLength(1)
   })

   it('addEdge tolerates a spec with no edges array', () => {
      const base: DiagramSpec = { nodes: [node('a'), node('b')], edges: undefined as unknown as DiagramSpec['edges'], options: {} }
      const next = addEdge(base, createEdge('a', 'b', 'e1'))
      expect((next.edges ?? []).map(edge => edge.id)).toEqual(['e1'])
   })
})

describe('deleteEdge + findEdge + setEdge', () => {
   const base = spec([node('a'), node('b')], [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'a' }])

   it('deletes the edge by id, leaving nodes + other edges intact', () => {
      const next = deleteEdge(base, 'e1')
      expect((next.edges ?? []).map(edge => edge.id)).toEqual(['e2'])
      expect(next.nodes).toBe(base.nodes) // nodes untouched
   })

   it('deleteEdge is a no-op for an absent id but returns a fresh spec', () => {
      const next = deleteEdge(base, 'nope')
      expect((next.edges ?? []).map(edge => edge.id)).toEqual(['e1', 'e2'])
      expect(next).not.toBe(base)
   })

   it('findEdge returns the edge or null', () => {
      expect(findEdge(base, 'e2')).toMatchObject({ from: 'b', to: 'a' })
      expect(findEdge(base, 'ghost')).toBeNull()
   })

   it('setEdge replaces by id, preserving order, and no-ops an absent id', () => {
      const next = setEdge(base, { id: 'e1', from: 'a', to: 'b', label: 'yes' })
      expect(findEdge(next, 'e1')).toMatchObject({ label: 'yes' })
      expect((next.edges ?? []).map(edge => edge.id)).toEqual(['e1', 'e2'])
      expect(setEdge(base, { id: 'ghost', from: 'a', to: 'b' })).toEqual(base)
   })
})

// #################
// # EDGE LABEL/STYLE #
// #################

describe('updateEdgeLabel', () => {
   const base = spec([node('a'), node('b')], [{ id: 'e1', from: 'a', to: 'b' }])

   it('sets the label', () => {
      expect(findEdge(updateEdgeLabel(base, 'e1', 'yes'), 'e1')).toMatchObject({ label: 'yes' })
   })

   it('DROPS the field for an empty / whitespace-only label (lean serialization)', () => {
      const labelled = updateEdgeLabel(base, 'e1', 'yes')
      const cleared = updateEdgeLabel(labelled, 'e1', '   ')
      expect('label' in findEdge(cleared, 'e1')!).toBe(false)
   })

   it('no-ops an absent id', () => {
      expect(updateEdgeLabel(base, 'ghost', 'x')).toEqual(base)
   })
})

describe('updateEdgeStyle', () => {
   const base = spec([node('a'), node('b')], [{ id: 'e1', from: 'a', to: 'b' }])

   it('sets non-default arrow / routing / dashed and a stroke override', () => {
      const next = updateEdgeStyle(base, 'e1', { arrow: 'both', routing: 'orthogonal', dashed: true, stroke: '#ff0000' })
      expect(findEdge(next, 'e1')).toMatchObject({ arrow: 'both', routing: 'orthogonal', dashed: true, stroke: '#ff0000' })
   })

   it('DROPS a field set to its render default (no redundant arrow:end / routing:straight / dashed:false)', () => {
      const styled = updateEdgeStyle(base, 'e1', { arrow: 'both', routing: 'orthogonal', dashed: true })
      const reset = updateEdgeStyle(styled, 'e1', { arrow: 'end', routing: 'straight', dashed: false })
      const edge = findEdge(reset, 'e1')!
      expect('arrow' in edge).toBe(false)
      expect('routing' in edge).toBe(false)
      expect('dashed' in edge).toBe(false)
   })

   it('clears a stroke override via a present-undefined key, leaving untouched keys alone', () => {
      const styled = updateEdgeStyle(base, 'e1', { stroke: '#123456', arrow: 'both' })
      const cleared = updateEdgeStyle(styled, 'e1', { stroke: undefined })
      const edge = findEdge(cleared, 'e1')!
      expect('stroke' in edge).toBe(false)
      expect(edge.arrow).toBe('both') // arrow untouched by a stroke-only patch
   })

   it('no-ops an absent id', () => {
      expect(updateEdgeStyle(base, 'ghost', { dashed: true })).toEqual(base)
   })
})

// #################
// # PORT GEOMETRY  #
// #################

describe('nodePorts', () => {
   it('returns the four mid-edge ports offset OUTSIDE the border by PORT_GAP', () => {
      const single = node('a', { x: 0, y: 0, width: 100, height: 60 }) // center (50,30)
      const ports = nodePorts(single)
      const byName = Object.fromEntries(ports.map(port => [port.port, port.point]))
      expect(byName.n).toEqual({ x: 50, y: -PORT_GAP })
      expect(byName.e).toEqual({ x: 100 + PORT_GAP, y: 30 })
      expect(byName.s).toEqual({ x: 50, y: 60 + PORT_GAP })
      expect(byName.w).toEqual({ x: -PORT_GAP, y: 30 })
   })
})

describe('hitTestPort', () => {
   const single = node('a', { x: 0, y: 0, width: 100, height: 60 })

   it('grabs the nearest port within tolerance', () => {
      // right port sits at (110, 30); a press 2 units away hits it
      expect(hitTestPort(single, { x: 108, y: 30 }, PORT_HIT_TOLERANCE)).toBe('e')
   })

   it('returns null when the pointer is beyond tolerance of every port', () => {
      expect(hitTestPort(single, { x: 50, y: 30 }, PORT_HIT_TOLERANCE)).toBeNull() // node center, far from all ports
   })

   it('does NOT grab a port from a press on the mid-edge (border), so a body move is not shadowed', () => {
      // top border midpoint (50, 0) is PORT_GAP away from the north port (50, -PORT_GAP);
      // with PORT_GAP (10) > PORT_HIT_TOLERANCE (8) that border press is NOT a port grab.
      expect(hitTestPort(single, { x: 50, y: 0 }, PORT_HIT_TOLERANCE)).toBeNull()
   })
})

// #################
// # EDGE HIT TEST  #
// #################

describe('distancePointToSegment + distanceToPolyline', () => {
   it('measures the perpendicular distance to a segment, clamped to its extent', () => {
      expect(distancePointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 9)
      // beyond the segment end → distance to the endpoint
      expect(distancePointToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(10, 9)
   })

   it('a zero-length segment measures to the point', () => {
      expect(distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 9)
   })

   it('distanceToPolyline takes the minimum over all segments', () => {
      const polyline = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
      // point near the vertical second segment
      expect(distanceToPolyline({ x: 96, y: 50 }, polyline)).toBeCloseTo(4, 9)
   })
})

describe('hitTestEdge', () => {
   // two nodes side by side; a straight edge a→b runs horizontally between their facing borders.
   const nodeA = node('a', { x: 0, y: 0, width: 100, height: 60 })   // right border x=100, midY=30
   const nodeB = node('b', { x: 200, y: 0, width: 100, height: 60 }) // left border x=200, midY=30
   const base = spec([nodeA, nodeB], [{ id: 'e1', from: 'a', to: 'b' }])

   it('selects an edge when the click is within the tolerance band of its line', () => {
      // straight edge runs along y=30 between x=100 and x=200; a click at y=33 is 3 units off
      expect(hitTestEdge(base, { x: 150, y: 33 }, 5)?.id).toBe('e1')
   })

   it('misses when the click is beyond the tolerance band', () => {
      expect(hitTestEdge(base, { x: 150, y: 45 }, 5)).toBeNull()
   })

   it('honors the distance threshold (a wider tolerance catches a farther click)', () => {
      expect(hitTestEdge(base, { x: 150, y: 45 }, 5)).toBeNull()
      expect(hitTestEdge(base, { x: 150, y: 45 }, 20)?.id).toBe('e1')
   })

   it('honors waypoints (hit-tests the drawn polyline, not the straight center line)', () => {
      // route the edge down through a waypoint far below the straight path
      const routed = spec([nodeA, nodeB], [{ id: 'e1', from: 'a', to: 'b', waypoints: [{ x: 150, y: 200 }] }])
      // the straight center line at y=30 is now EMPTY there (the drawn path bends to y≈200)
      expect(hitTestEdge(routed, { x: 150, y: 33 }, 6)).toBeNull()
      // near the waypoint the drawn polyline IS present → hit
      expect(hitTestEdge(routed, { x: 150, y: 200 }, 6)?.id).toBe('e1')
   })

   it('skips a dangling edge (missing endpoint node) rather than throwing', () => {
      const dangling = spec([nodeA], [{ id: 'e1', from: 'a', to: 'ghost' }])
      expect(hitTestEdge(dangling, { x: 150, y: 30 }, 50)).toBeNull()
   })

   it('returns the topmost (later-drawn) edge on a tie', () => {
      // two identical a→b edges; the later one (e2) wins
      const overlapping = spec([nodeA, nodeB], [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'a', to: 'b' }])
      expect(hitTestEdge(overlapping, { x: 150, y: 30 }, 6)?.id).toBe('e2')
   })
})

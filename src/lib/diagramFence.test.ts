import { describe, it, expect } from 'vitest'
import { diagramSpecToFence, fenceToDiagramSpec } from './diagramFence'
import type { DiagramSpec } from './diagram/types'

/** Round-trip a spec through the fence and back. */
function roundTrip(spec: DiagramSpec): DiagramSpec {
   const { info, body } = diagramSpecToFence(spec)
   return fenceToDiagramSpec(info, body)
}

// ##################
// # BASIC SHAPE    #
// ##################

describe('diagramSpecToFence', () => {
   it('leads the info with the `diagram` tag and emits two pipe tables in the body', () => {
      const { info, body } = diagramSpecToFence({
         nodes: [{ id: 'a', x: 0, y: 0, width: 100, height: 60, shape: 'rectangle', label: 'A' }],
         edges: [{ id: 'e', from: 'a', to: 'a' }],
         options: {},
      })
      expect(info.startsWith('diagram')).toBe(true)
      // Nodes table header, a blank line, then the edges table header.
      expect(body).toContain('| id | shape | label | x | y | w | h | fill | stroke | text |')
      expect(body).toContain('| id | from | to | label | arrow | routing | dashed | stroke | waypoints |')
      expect(body).toContain('\n\n')
   })

   it('emits the title and canvas on the info string only when set', () => {
      expect(diagramSpecToFence({ nodes: [], edges: [], options: {} }).info).toBe('diagram')
      const withOpts = diagramSpecToFence({
         nodes: [], edges: [],
         options: { title: 'Login flow', canvas: { width: 400, height: 300 } },
      }).info
      expect(withOpts).toContain('title="Login flow"')
      expect(withOpts).toContain('canvas=400x300')
   })
})

// ##################
// # ROUND TRIP     #
// ##################

describe('fence round-trip', () => {
   it('is lossless for a fully-populated spec (all node + edge fields, options)', () => {
      const spec: DiagramSpec = {
         nodes: [
            { id: 'start', x: 40, y: 20, width: 120, height: 44, shape: 'pill', label: 'Start' },
            { id: 'check', x: 60, y: 120, width: 120, height: 80, shape: 'diamond', label: 'Valid?' },
            { id: 'deny',  x: 40, y: 260, width: 120, height: 48, shape: 'rounded', label: 'Reject',
              fill: '#e34948', stroke: '#111111', textColor: '#ffffff' },
         ],
         edges: [
            { id: 'e1', from: 'start', to: 'check' },
            { id: 'e2', from: 'check', to: 'deny', label: 'no', arrow: 'both', routing: 'orthogonal',
              dashed: true, stroke: '#888888', waypoints: [{ x: 200, y: 150 }, { x: 220, y: 230 }] },
         ],
         options: { title: 'Login flow', canvas: { width: 400, height: 340 } },
      }
      expect(roundTrip(spec)).toEqual(spec)
   })

   it('round-trips the two heading shapes (banner/chevron)', () => {
      const spec: DiagramSpec = {
         nodes: [
            { id: 'phase1', x: 40, y: 20, width: 220, height: 44, shape: 'banner', label: 'Phase 1' },
            { id: 'phase2', x: 280, y: 20, width: 220, height: 44, shape: 'chevron', label: 'Phase 2',
              fill: '#dbeafe', stroke: '#1d4ed8' },
         ],
         edges: [],
         options: {},
      }
      expect(roundTrip(spec)).toEqual(spec)
   })

   it('round-trips a bare edge with no spurious default fields', () => {
      const spec: DiagramSpec = {
         nodes: [
            { id: 'a', x: 0, y: 0, width: 100, height: 60, shape: 'rectangle', label: 'A' },
            { id: 'b', x: 0, y: 200, width: 100, height: 60, shape: 'rectangle', label: 'B' },
         ],
         edges: [{ id: 'e', from: 'a', to: 'b' }],
         options: {},
      }
      const back = roundTrip(spec)
      expect(back.edges[0]).toEqual({ id: 'e', from: 'a', to: 'b' })
      expect(back).toEqual(spec)
   })

   it('preserves a multi-line label and a label with pipes / XML characters', () => {
      const spec: DiagramSpec = {
         nodes: [{ id: 'a', x: 0, y: 0, width: 200, height: 80, shape: 'rectangle', label: 'line one\nline | two <b>' }],
         edges: [],
         options: {},
      }
      const back = roundTrip(spec)
      expect(back.nodes[0].label).toBe('line one\nline | two <b>')
   })

   it('preserves a backslash in a label', () => {
      const spec: DiagramSpec = {
         nodes: [{ id: 'a', x: 0, y: 0, width: 200, height: 40, shape: 'rectangle', label: 'a\\b\\nc' }],
         edges: [],
         options: {},
      }
      expect(roundTrip(spec).nodes[0].label).toBe('a\\b\\nc')
   })
})

// ##################
// # TOLERANT PARSE #
// ##################

describe('fenceToDiagramSpec, tolerant', () => {
   it('never throws on empty / garbage input and yields empty nodes/edges', () => {
      expect(fenceToDiagramSpec('diagram', '')).toEqual({ nodes: [], edges: [], options: {} })
      expect(fenceToDiagramSpec('diagram', 'not a table at all')).toEqual({ nodes: [], edges: [], options: {} })
   })

   it('falls back to rectangle for an unknown shape and defaults for a bad coordinate', () => {
      const body = [
         '| id | shape | label | x | y | w | h |',
         '| --- | --- | --- | - | - | - | - |',
         '| a | hexagon | A | oops | 10 |  |  |',
      ].join('\n')
      const spec = fenceToDiagramSpec('diagram', body)
      expect(spec.nodes).toHaveLength(1)
      expect(spec.nodes[0].shape).toBe('rectangle')
      expect(spec.nodes[0].x).toBe(0)          // 'oops' -> default 0
      expect(spec.nodes[0].y).toBe(10)
      expect(spec.nodes[0].width).toBe(120)    // blank -> default width
      expect(spec.nodes[0].height).toBe(56)    // blank -> default height
   })

   it('keeps an edge referencing a missing node (the renderer skips it, the parser does not)', () => {
      const body = [
         '| id | shape | label | x | y | w | h |',
         '| --- | --- | --- | - | - | - | - |',
         '| a | rectangle | A | 0 | 0 | 80 | 40 |',
         '',
         '| id | from | to |',
         '| -- | ---- | -- |',
         '| e | a | ghost |',
      ].join('\n')
      const spec = fenceToDiagramSpec('diagram', body)
      expect(spec.edges).toEqual([{ id: 'e', from: 'a', to: 'ghost' }])
   })

   it('classifies tables by header regardless of their order', () => {
      const body = [
         '| id | from | to |',
         '| -- | ---- | -- |',
         '| e | a | b |',
         '',
         '| id | shape | label | x | y | w | h |',
         '| --- | --- | --- | - | - | - | - |',
         '| a | rectangle | A | 0 | 0 | 80 | 40 |',
         '| b | rectangle | B | 0 | 100 | 80 | 40 |',
      ].join('\n')
      const spec = fenceToDiagramSpec('diagram', body)
      expect(spec.nodes.map(node => node.id)).toEqual(['a', 'b'])
      expect(spec.edges.map(edge => edge.id)).toEqual(['e'])
   })

   it('synthesizes a stable id for an edge row that omits the id column', () => {
      const body = [
         '| from | to |',
         '| ---- | -- |',
         '| a | b |',
      ].join('\n')
      const spec = fenceToDiagramSpec('diagram', body)
      expect(spec.edges[0].from).toBe('a')
      expect(spec.edges[0].to).toBe('b')
      expect(typeof spec.edges[0].id).toBe('string')
      expect(spec.edges[0].id.length).toBeGreaterThan(0)
   })
})

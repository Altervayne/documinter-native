import { describe, it, expect } from 'vitest'
import { renderDiagramToSvg, LIGHT_DIAGRAM_THEME, DARK_DIAGRAM_THEME } from './index'
import { chevronPointDepth } from './shapes'
import type { DiagramSpec, DiagramNode } from './types'

function spec(partial: Partial<DiagramSpec> = {}): DiagramSpec {
   return { nodes: [], edges: [], options: {}, ...partial }
}

// ####################
// # SELF-CONTAINED   #
// ####################

describe('renderDiagramToSvg, envelope', () => {
   it('emits one self-contained, responsive <svg> with no script or external asset', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 0, y: 0, width: 100, height: 60, shape: 'rectangle', label: 'A' }],
      }), LIGHT_DIAGRAM_THEME)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('role="img"')
      expect(svg).toContain('width:100%;height:auto')
      expect(svg).not.toContain('<script')
      expect(svg).not.toContain('http://fonts')
      expect(svg).not.toContain('<marker')  // arrowheads are inline polygons, not shared marker defs
   })

   it('renders an empty-state placeholder for a diagram with no nodes', () => {
      const svg = renderDiagramToSvg(spec(), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('<svg')
      expect(svg).toContain('Empty diagram')
      expect(svg).toContain('Empty diagram with no nodes.')
   })

   it('sets an accessible title and node/link summary desc', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [
            { id: 'a', x: 0, y: 0, width: 80, height: 40, shape: 'rectangle', label: 'A' },
            { id: 'b', x: 0, y: 120, width: 80, height: 40, shape: 'rectangle', label: 'B' },
         ],
         edges: [{ id: 'e', from: 'a', to: 'b' }],
         options: { title: 'Flow' },
      }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('<title>Flow</title>')
      expect(svg).toContain('<desc>Diagram with 2 nodes and 1 link.</desc>')
   })

   it('uses the explicit canvas as the viewBox when present', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 10, y: 10, width: 40, height: 20, shape: 'rectangle', label: '' }],
         options: { canvas: { width: 300, height: 200 } },
      }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('viewBox="0 0 300 200"')
   })
})

// ####################
// # NODE SHAPES      #
// ####################

describe('renderDiagramToSvg, node shapes', () => {
   function shapeSvg(shape: DiagramSpec['nodes'][number]['shape']): string {
      return renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 0, y: 0, width: 100, height: 60, shape, label: '' }],
      }), LIGHT_DIAGRAM_THEME)
   }

   it('draws a rectangle as a <rect> with no corner radius', () => {
      const svg = shapeSvg('rectangle')
      expect(svg).toContain('<rect')
      expect(svg).not.toContain('rx=')
   })

   it('draws a rounded rect with a corner radius', () => {
      const svg = shapeSvg('rounded')
      expect(svg).toContain('<rect')
      expect(svg).toContain('rx="8"')
   })

   it('draws a pill with a half-height corner radius', () => {
      const svg = shapeSvg('pill')
      expect(svg).toContain('rx="30"')  // min(100,60)/2
   })

   it('draws an ellipse', () => {
      const svg = shapeSvg('ellipse')
      expect(svg).toContain('<ellipse')
      expect(svg).toContain('cx="50"')
      expect(svg).toContain('cy="30"')
   })

   it('draws a diamond as a polygon through the mid-edge vertices', () => {
      const svg = shapeSvg('diamond')
      expect(svg).toContain('<polygon')
      expect(svg).toContain('points="50,0 100,30 50,60 0,30"')
   })

   it('draws a banner as a lightly-rounded rect plus a bottom accent bar', () => {
      const svg = shapeSvg('banner')
      // Two rects: the lightly-rounded body (rx=4, the spec's banner corner radius) and the accent bar.
      expect(svg).toContain('rx="4"')
      const rectCount = (svg.match(/<rect/g) ?? []).length
      expect(rectCount).toBe(2)
   })

   it('draws a chevron as a six-vertex pentagon with a right point and a left notch', () => {
      const svg = shapeSvg('chevron')
      expect(svg).toContain('<polygon')
      // 100x60 node: depth = (60/2)*0.6 = 18, capped at 100*0.45=45 → 18. right=100, centerY=30.
      expect(svg).toContain('points="0,0 82,0 100,30 82,60 0,60 18,30"')
   })

   it('bakes a per-node fill/stroke override as literal hex', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 0, y: 0, width: 80, height: 40, shape: 'rectangle', label: '', fill: '#abcdef', stroke: '#123' }],
      }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('fill="#abcdef"')
      expect(svg).toContain('stroke="#123"')
   })

   it('caps the chevron point/notch depth so a narrow node never self-intersects', () => {
      function headingNode(over: Partial<DiagramNode>): DiagramNode {
         return { id: 'a', x: 0, y: 0, width: 100, height: 60, shape: 'chevron', label: '', ...over }
      }
      // Tall + narrow: the height-derived depth (60*0.6=36) would exceed half the width; the cap
      // (width * 0.45) keeps the notch/point from crossing the center.
      const narrow = headingNode({ width: 40, height: 120 })
      expect(chevronPointDepth(narrow)).toBeCloseTo(40 * 0.45)
      // Wide + short: the height-derived depth stays comfortably under the width cap.
      const wide = headingNode({ width: 220, height: 44 })
      expect(chevronPointDepth(wide)).toBeCloseTo((44 / 2) * 0.6)
      expect(chevronPointDepth(wide)).toBeLessThan(wide.width / 2)
   })

   it('bakes different theme hex for light vs dark', () => {
      const spc = spec({ nodes: [{ id: 'a', x: 0, y: 0, width: 80, height: 40, shape: 'rectangle', label: '' }] })
      expect(renderDiagramToSvg(spc, LIGHT_DIAGRAM_THEME)).toContain(LIGHT_DIAGRAM_THEME.nodeFill)
      expect(renderDiagramToSvg(spc, DARK_DIAGRAM_THEME)).toContain(DARK_DIAGRAM_THEME.nodeFill)
   })
})

// ####################
// # LABELS (ESCAPE)  #
// ####################

describe('renderDiagramToSvg, labels', () => {
   it('escapes a node label with XML-significant characters', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 0, y: 0, width: 400, height: 40, shape: 'rectangle', label: 'A & <B>' }],
      }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('A &amp; &lt;B&gt;')
      expect(svg).not.toContain('A & <B>')
   })

   it('renders a multi-line label as multiple centered tspans', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 0, y: 0, width: 300, height: 80, shape: 'rectangle', label: 'line one\nline two' }],
      }), LIGHT_DIAGRAM_THEME)
      const tspanCount = (svg.match(/<tspan/g) ?? []).length
      expect(tspanCount).toBe(2)
      expect(svg).toContain('line one')
      expect(svg).toContain('line two')
   })

   it('escapes a node label inside its <title> tooltip', () => {
      const svg = renderDiagramToSvg(spec({
         nodes: [{ id: 'a', x: 0, y: 0, width: 80, height: 40, shape: 'rectangle', label: '<x>' }],
      }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('<title>&lt;x&gt;</title>')
   })
})

// ####################
// # EDGES            #
// ####################

describe('renderDiagramToSvg, edges', () => {
   const twoNodes = [
      { id: 'a', x: 0, y: 0, width: 100, height: 60, shape: 'rectangle' as const, label: 'A' },
      { id: 'b', x: 0, y: 200, width: 100, height: 60, shape: 'rectangle' as const, label: 'B' },
   ]

   it('clips a straight edge to both node borders (not their centers)', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'b', arrow: 'none' }] }), LIGHT_DIAGRAM_THEME)
      // Nodes stacked vertically: A center (50,30), bottom wall y=60; B center (50,230), top wall y=200.
      // The path leaves A's bottom (y=60) and reaches B's top (y=200), never touching either center.
      expect(svg).toContain('M50,60 L50,200')
   })

   it('draws an arrowhead polygon at the target end by default', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'b' }] }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('<polygon')
   })

   it('omits the arrowhead for arrow=none', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'b', arrow: 'none' }] }), LIGHT_DIAGRAM_THEME)
      expect(svg).not.toContain('<polygon')
   })

   it('skips an edge that references a missing node without throwing', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'ghost' }] }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('<svg')
      expect(svg).not.toContain('<path')  // the only edge was dangling → no path drawn
   })

   it('draws a dashed edge with a stroke-dasharray', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'b', dashed: true }] }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('stroke-dasharray')
   })

   it('renders an orthogonal edge as a multi-segment elbow path', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'b', routing: 'orthogonal', arrow: 'none' }] }), LIGHT_DIAGRAM_THEME)
      const path = svg.match(/<path d="([^"]+)"/)?.[1] ?? ''
      // Vertical-dominant elbow → a mid-bend, so at least three L commands (four points).
      expect((path.match(/L/g) ?? []).length).toBeGreaterThanOrEqual(3)
   })

   it('escapes an edge label and puts it in a halo rect', () => {
      const svg = renderDiagramToSvg(spec({ nodes: twoNodes, edges: [{ id: 'e', from: 'a', to: 'b', label: 'yes & <no>' }] }), LIGHT_DIAGRAM_THEME)
      expect(svg).toContain('yes &amp; &lt;no&gt;')
   })
})

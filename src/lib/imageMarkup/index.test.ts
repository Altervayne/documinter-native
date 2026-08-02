import { describe, it, expect } from 'vitest'
import { renderImageMarkupToSvg } from './index'
import type { ImageMarkupSpec, MarkupElement } from './types'

function specWith(elements: MarkupElement[], overrides: Partial<ImageMarkupSpec> = {}): ImageMarkupSpec {
   return { src: '', width: 800, height: 600, elements, ...overrides }
}

describe('renderImageMarkupToSvg, envelope', () => {
   it('wraps in a self-contained, responsive <svg> with an accessible title/desc', () => {
      const svg = renderImageMarkupToSvg(specWith([]))
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" role="img"')
      expect(svg).toContain('viewBox="0 0 1000 750"') // 800x600 -> longest edge (800) normalized to 1000
      expect(svg).toContain('<title>Annotated image</title>')
      expect(svg).toContain('<desc>')
      expect(svg).not.toContain('<script')
      expect(svg).not.toContain('<defs')
   })

   it('uses the alt text as the accessible title when present', () => {
      const svg = renderImageMarkupToSvg(specWith([], { alt: 'Login screen' }))
      expect(svg).toContain('<title>Login screen</title>')
   })

   it('escapes a hostile alt/text value rather than breaking the markup', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'text', x: 0.1, y: 0.1, text: '<script>alert(1)</script>' },
      ], { alt: '"><script>' }))
      expect(svg).not.toContain('<script>alert(1)</script>')
      expect(svg).toContain('&lt;script&gt;')
   })
})

describe('renderImageMarkupToSvg, empty src placeholder', () => {
   it('renders a neutral placeholder ground instead of <image> when src is empty', () => {
      const svg = renderImageMarkupToSvg(specWith([]))
      expect(svg).not.toContain('<image')
      expect(svg).toContain('<rect x="0" y="0" width="1000" height="750" fill="#e2e8f0"/>')
   })

   it('never throws and still renders overlay elements over the placeholder', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      ]))
      expect(svg).toContain('<rect x="0" y="0" width="1000" height="750" fill="#e2e8f0"/>')
      expect(svg).toContain('<rect x="100" y="75" width="200" height="150"')
   })
})

describe('renderImageMarkupToSvg, base image', () => {
   it('inlines a provided data URI as the bottom <image> layer, no placeholder', () => {
      const svg = renderImageMarkupToSvg(specWith([], { src: 'data:image/webp;base64,AAAA' }))
      expect(svg).toContain('<image href="data:image/webp;base64,AAAA" x="0" y="0" width="1000" height="750" preserveAspectRatio="none"/>')
      expect(svg).not.toContain('#e2e8f0')
   })
})

describe('renderImageMarkupToSvg, each element kind', () => {
   it('rect: draws a <rect> with stroke + optional fill', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.1, stroke: '#111111', fill: '#ff0000', fillOpacity: 0.5 },
      ]))
      expect(svg).toContain('<rect x="100" y="150" width="300" height="75" stroke="#111111" stroke-width="4" fill="#ff0000" fill-opacity="0.5"/>')
   })

   it('rect: defaults to no-fill outline when fill is unset', () => {
      const svg = renderImageMarkupToSvg(specWith([{ id: '1', kind: 'rect', x: 0, y: 0, w: 0.1, h: 0.1 }]))
      expect(svg).toContain('fill="none"')
      expect(svg).not.toContain('fill-opacity')
   })

   it('ellipse: draws an <ellipse> from its bounding box', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'ellipse', x: 0, y: 0, w: 0.2, h: 0.2 },
      ]))
      expect(svg).toContain('<ellipse cx="100" cy="75" rx="100" ry="75"')
   })

   it('line: draws a <line> between the two endpoints', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
      ]))
      expect(svg).toContain('<line x1="0" y1="0" x2="1000" y2="750"')
   })

   it('arrow: draws a <line> plus an explicit <polygon> arrowhead (no <marker>)', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'arrow', x1: 0, y1: 0, x2: 0.5, y2: 0 },
      ]))
      expect(svg).toContain('<line x1="0" y1="0" x2="500" y2="0"')
      expect(svg).toContain('<polygon points="500,0')
      expect(svg).not.toContain('<marker')
      expect(svg).not.toContain('url(#')
   })

   it('text: draws a <text> element with the escaped label', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'text', x: 0.1, y: 0.1, text: 'Click here', fontSize: 30 },
      ]))
      expect(svg).toContain('<text x="100" y="75" font-size="30"')
      expect(svg).toContain('>Click here</text>')
   })

   it('text: draws an optional background rect behind the label when set', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'text', x: 0.1, y: 0.1, text: 'Hi', background: '#ffff00' },
      ]))
      expect(svg).toContain('fill="#ffff00"')
   })

   it('callout: draws a tail polygon, a box, and the label text', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'callout', x: 0.1, y: 0.1, w: 0.3, h: 0.15, tipX: 0.05, tipY: 0.4, text: 'Note' },
      ]))
      expect(svg).toContain('<polygon points=')
      expect(svg).toContain('<rect x="100" y="75" width="300" height="112.5"')
      expect(svg).toContain('>Note</text>')
   })

   it('freehand: draws a smoothed <path> with no fill', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'freehand', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.1 }] },
      ]))
      expect(svg).toContain('<path d="M 100,75')
      expect(svg).toContain('fill="none"')
   })

   it('freehand: an empty point list renders nothing rather than a broken path', () => {
      const svg = renderImageMarkupToSvg(specWith([{ id: '1', kind: 'freehand', points: [] }]))
      expect(svg).not.toContain('<path')
   })

   it('stacks elements in array order (z-order), first = bottom, last = top', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'rect', x: 0, y: 0, w: 0.1, h: 0.1, stroke: '#111111' },
         { id: '2', kind: 'ellipse', x: 0, y: 0, w: 0.1, h: 0.1, stroke: '#222222' },
      ]))
      expect(svg.indexOf('#111111')).toBeLessThan(svg.indexOf('#222222'))
   })
})

describe('renderImageMarkupToSvg, never throws on bad data', () => {
   it('clamps non-finite coordinates to 0 rather than emitting NaN/Infinity', () => {
      const svg = renderImageMarkupToSvg(specWith([
         { id: '1', kind: 'rect', x: Number.NaN, y: Number.POSITIVE_INFINITY, w: 0.1, h: 0.1 },
      ]))
      expect(svg).not.toContain('NaN')
      expect(svg).not.toContain('Infinity')
   })
})

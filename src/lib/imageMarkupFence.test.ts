import { describe, it, expect } from 'vitest'
import { imageMarkupSpecToFence, fenceToImageMarkupSpec } from './imageMarkupFence'
import type { ImageMarkupSpec, MarkupElement } from './imageMarkup'

/** Strip the `id` field (freshly minted on every parse, never serialized) before comparing. */
function withoutIds(elements: MarkupElement[]): unknown[] {
   return elements.map(({ id: _id, ...rest }) => rest)
}

describe('imageMarkupSpecToFence, no base64, ever', () => {
   it('never emits the base64 src in the info string or the body', () => {
      const spec: ImageMarkupSpec = {
         src: 'data:image/webp;base64,SGVsbG8gV29ybGQ=',
         width: 1600, height: 900,
         elements: [{ id: '1', kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      }
      const { info, body } = imageMarkupSpecToFence(spec)
      expect(info).not.toContain('base64')
      expect(info).not.toContain('SGVsbG8')
      expect(body).not.toContain('base64')
      expect(body).not.toContain('SGVsbG8')
   })

   it('carries the base pixel dimensions and alt/caption on the info string', () => {
      const spec: ImageMarkupSpec = {
         src: '', width: 1600, height: 900, elements: [],
         alt: 'Login screen', caption: 'Figure 1',
      }
      const { info } = imageMarkupSpecToFence(spec)
      expect(info).toBe('imagemarkup w=1600 h=900 alt="Login screen" caption="Figure 1"')
   })

   it('omits w=/h=/alt=/caption= tokens entirely when unset (lean serialization)', () => {
      const spec: ImageMarkupSpec = { src: '', width: 0, height: 0, elements: [] }
      const { info, body } = imageMarkupSpecToFence(spec)
      expect(info).toBe('imagemarkup')
      expect(body).toBe('')
   })
})

describe('imageMarkupSpecToFence <-> fenceToImageMarkupSpec, round trip', () => {
   it('round-trips metadata (dims + alt + caption)', () => {
      const spec: ImageMarkupSpec = {
         src: 'data:image/webp;base64,AAAA', width: 1920, height: 1080, elements: [],
         alt: 'Dashboard', caption: 'Fig 2',
      }
      const { info, body } = imageMarkupSpecToFence(spec)
      const reparsed = fenceToImageMarkupSpec(info, body)
      expect(reparsed.width).toBe(1920)
      expect(reparsed.height).toBe(1080)
      expect(reparsed.alt).toBe('Dashboard')
      expect(reparsed.caption).toBe('Fig 2')
      // The ratified rule: src NEVER comes back from a fence, regardless of what went in.
      expect(reparsed.src).toBe('')
   })

   it('round-trips every element kind (geometry + style), src stripped', () => {
      const elements: MarkupElement[] = [
         { id: 'a', kind: 'rect', x: 0.1234, y: 0.2, w: 0.3, h: 0.15, radius: 0.02, stroke: '#e5484d', strokeWidth: 5, fill: '#ffffff', fillOpacity: 0.4 },
         { id: 'b', kind: 'ellipse', x: 0.4, y: 0.1, w: 0.2, h: 0.1, stroke: '#123456' },
         { id: 'c', kind: 'line', x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
         { id: 'd', kind: 'arrow', x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.6, stroke: '#00ff00', strokeWidth: 3 },
         { id: 'e', kind: 'text', x: 0.5, y: 0.5, text: 'Click here', fontSize: 30, textColor: '#000000', background: '#ffff00' },
         { id: 'f', kind: 'callout', x: 0.1, y: 0.1, w: 0.3, h: 0.15, tipX: 0.05, tipY: 0.4, text: 'A note, with a comma', fontSize: 22 },
         { id: 'g', kind: 'freehand', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.1 }], stroke: '#2a78d6', strokeWidth: 3 },
      ]
      const spec: ImageMarkupSpec = { src: 'data:image/png;base64,ZZZZ', width: 1000, height: 1000, elements }
      const { info, body } = imageMarkupSpecToFence(spec)
      const reparsed = fenceToImageMarkupSpec(info, body)

      expect(reparsed.src).toBe('')
      expect(withoutIds(reparsed.elements)).toEqual(withoutIds(elements))
   })

   it('rounds normalized coordinates to 4 decimal places', () => {
      const elements: MarkupElement[] = [
         { id: 'a', kind: 'rect', x: 0.123456789, y: 0, w: 0.1, h: 0.1 },
      ]
      const spec: ImageMarkupSpec = { src: '', width: 100, height: 100, elements }
      const { body } = imageMarkupSpecToFence(spec)
      expect(body).toContain('x=0.1235') // rounded to 4dp
      expect(body).not.toContain('0.123456789')
   })

   it('a text/callout label containing spaces and quotes round-trips losslessly', () => {
      const elements: MarkupElement[] = [
         { id: 'a', kind: 'text', x: 0.1, y: 0.1, text: 'Say "hello" to the user' },
      ]
      const spec: ImageMarkupSpec = { src: '', width: 100, height: 100, elements }
      const { info, body } = imageMarkupSpecToFence(spec)
      const reparsed = fenceToImageMarkupSpec(info, body)
      const reparsedText = reparsed.elements[0]
      expect(reparsedText.kind).toBe('text')
      if (reparsedText.kind === 'text') expect(reparsedText.text).toBe('Say "hello" to the user')
   })
})

describe('fenceToImageMarkupSpec, totality (never throws)', () => {
   it('skips an unknown element kind line, keeping the rest', () => {
      const info = 'imagemarkup w=100 h=100'
      const body = 'rect x=0.1 y=0.1 w=0.2 h=0.2\nsparkle x=1 y=1\nline x1=0 y1=0 x2=1 y2=1'
      const spec = fenceToImageMarkupSpec(info, body)
      expect(spec.elements.map(oneElement => oneElement.kind)).toEqual(['rect', 'line'])
   })

   it('falls back malformed numeric fields to 0 rather than throwing', () => {
      const spec = fenceToImageMarkupSpec('imagemarkup', 'rect x=notanumber y=0.2 w=0.1 h=0.1')
      const rect = spec.elements[0]
      expect(rect.kind).toBe('rect')
      if (rect.kind === 'rect') expect(rect.x).toBe(0)
   })

   it('an empty body yields an empty element list, not a throw', () => {
      const spec = fenceToImageMarkupSpec('imagemarkup w=10 h=10', '')
      expect(spec.elements).toEqual([])
      expect(spec.width).toBe(10)
      expect(spec.height).toBe(10)
   })

   it('a missing w=/h=/alt=/caption= leaves those fields at their defaults', () => {
      const spec = fenceToImageMarkupSpec('imagemarkup', '')
      expect(spec.width).toBe(0)
      expect(spec.height).toBe(0)
      expect(spec.alt).toBeUndefined()
      expect(spec.caption).toBeUndefined()
      expect(spec.src).toBe('')
   })

   it('never emits NaN/undefined literals into the fence for a partial spec', () => {
      const spec: ImageMarkupSpec = { src: '', width: 0, height: 0, elements: [{ id: 'a', kind: 'freehand', points: [] }] }
      const { body } = imageMarkupSpecToFence(spec)
      expect(body).not.toContain('NaN')
      expect(body).not.toContain('undefined')
   })
})

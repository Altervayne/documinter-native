import { describe, it, expect } from 'vitest'
import { documentToMintdown, mintdownToDocument } from './mintdown'
import { buildFixtureDocument } from '../test/fixtures'
import { normalizeIds } from '../test/normalizeIds'
import type { Section } from '../types'

// Mintdown is the lossless format: every construct, including containers with their ratio, must
// survive serialize -> parse -> serialize unchanged. The string round-trip is the workhorse; a few
// targeted parse checks pin the trickiest markers.

describe('Mintdown round-trip', () => {
   it('is identical after serialize → parse → serialize for the full fixture', () => {
      const fixture  = buildFixtureDocument()
      const text1    = documentToMintdown(fixture.sections, fixture.meta)
      const reparsed = mintdownToDocument(text1)
      const text2    = documentToMintdown(reparsed.sections, reparsed.meta)
      expect(text2).toBe(text1)
   })
})

// A minimal Mintdown document wrapping a single block body, so targeted parse checks read like the
// real serializer output (front matter + one section) without depending on the full fixture.
function mintdownDocument(...bodyLines: string[]): string {
   return [
      '---',
      'title: T',
      'Module: M',
      '---',
      '',
      '## Section',
      ...bodyLines,
   ].join('\n')
}

describe('Mintdown freeform metadata', () => {
   it('round-trips the title plus custom fields, preserving order and values', () => {
      const source = [
         '---',
         'title: My Doc',
         'Module: Billing',
         'Reviewed by: Alice Smith',
         'Notes: "see: the appendix"',
         '---',
         '',
         '## Section',
         '',
         'body',
      ].join('\n')
      const meta = mintdownToDocument(source).meta
      expect(meta.title).toBe('My Doc')
      expect(meta.fields.map(field => [field.label, field.value])).toEqual([
         ['Module', 'Billing'],
         ['Reviewed by', 'Alice Smith'],
         ['Notes', 'see: the appendix'],
      ])
   })

   it('round-trips field position + color: an above accent field and a plain below field', () => {
      const meta = {
         title: 'Doc',
         fields: [
            { id: 'a', label: 'Module', value: 'Billing', position: 'above' as const, color: 'accent' },
            { id: 'b', label: 'Owner',  value: 'Dana',    position: 'below' as const, color: '#ff0000' },
            { id: 'c', label: 'Date',   value: '2026-01-01', position: 'below' as const },
         ],
      }
      const serialized = documentToMintdown([], meta)
      // The above/accent and hex fields emit as inline mappings; the plain field stays a scalar.
      expect(serialized).toContain('Module: { value: Billing, position: above, color: accent }')
      expect(serialized).toContain('Owner: { value: Dana, color: "#ff0000" }')
      expect(serialized).toContain('Date: 2026-01-01')

      const parsed = mintdownToDocument(serialized).meta
      expect(parsed.fields.map(field => ({ label: field.label, value: field.value, position: field.position, color: field.color }))).toEqual([
         { label: 'Module', value: 'Billing',    position: 'above', color: 'accent' },
         { label: 'Owner',  value: 'Dana',       position: 'below', color: '#ff0000' },
         { label: 'Date',   value: '2026-01-01', position: 'below', color: undefined },
      ])
   })

   it('round-trips a hidden-label field (showLabel: false), leaving default fields as scalars', () => {
      const meta = {
         title: 'Doc',
         fields: [
            { id: 'a', label: 'Version', value: '1.2.0', position: 'below' as const, showLabel: false },
            { id: 'b', label: 'Date',    value: '2026-01-01', position: 'below' as const },
         ],
      }
      const serialized = documentToMintdown([], meta)
      expect(serialized).toContain('Version: { value: 1.2.0, showLabel: false }')
      expect(serialized).toContain('Date: 2026-01-01')

      const parsed = mintdownToDocument(serialized).meta
      expect(parsed.fields.map(field => ({ label: field.label, value: field.value, showLabel: field.showLabel }))).toEqual([
         { label: 'Version', value: '1.2.0',      showLabel: false },
         { label: 'Date',    value: '2026-01-01', showLabel: undefined },
      ])
   })
})

describe('Mintdown targeted parse', () => {
   it('parses checklist [x]/[ ] markers into checked, preserving nesting', () => {
      const source   = mintdownDocument('', '- [x] done', '  - [ ] sub open')
      const parsed   = mintdownToDocument(source)
      const block    = normalizeIds(parsed).sections[0].blocks[0]
      expect(block).toEqual({
         id: '',
         type: 'checklist',
         items: [
            {
               id: '', checked: true, richText: [{ text: 'done' }], children: [
                  { id: '', checked: false, richText: [{ text: 'sub open' }], children: [] },
               ],
            },
         ],
      })
   })

   it('parses a container ratio token into ratio', () => {
      const source    = mintdownDocument('', '{25|75', '', 'left', '', '---', '', 'right', '', '}')
      const container = mintdownToDocument(source).sections[0].blocks[0]
      expect(container.type).toBe('container')
      expect(container.ratio).toBe(0.25)
   })

   it('parses a callout [style] marker into style', () => {
      const source  = mintdownDocument('', '> [warning] heads up')
      const callout = mintdownToDocument(source).sections[0].blocks[0]
      expect(callout.type).toBe('callout')
      expect(callout.style).toBe('warning')
   })

   it('round-trips a callout custom hex color through parse -> serialize -> parse', () => {
      const source = mintdownDocument('', '> [#ff8800] heads up')
      const parsed = mintdownToDocument(source)
      const callout = parsed.sections[0].blocks[0]
      expect(callout.type).toBe('callout')
      expect(callout.style).toBe('info')          // default style, unaffected by the hex
      expect(callout.calloutColor).toBe('#ff8800')

      const reserialized = documentToMintdown(parsed.sections, parsed.meta)
      expect(reserialized).toContain('> [#ff8800] heads up')

      const reparsed = mintdownToDocument(reserialized).sections[0].blocks[0]
      expect(reparsed.calloutColor).toBe('#ff8800')
      expect(reparsed.style).toBe('info')
   })

   it('falls back to the info preset for a malformed callout hex tag (wrong digit count)', () => {
      const source  = mintdownDocument('', '> [#ff88] heads up')
      const callout = mintdownToDocument(source).sections[0].blocks[0]
      expect(callout.type).toBe('callout')
      expect(callout.style).toBe('info')
      expect(callout.calloutColor).toBeUndefined()
      // The malformed tag is still consumed, not left in the content.
      expect(callout.richText).toEqual([{ text: 'heads up' }])
   })

   it('parses a ```math fence into a math block, keeping the raw LaTeX', () => {
      const source = mintdownDocument('', '```math', 'E = mc^2', '```')
      const block  = mintdownToDocument(source).sections[0].blocks[0]
      expect(block.type).toBe('math')
      expect(block.latex).toBe('E = mc^2')
   })

   it('round-trips a math block through serialize -> parse -> serialize with LaTeX intact', () => {
      const latex = '\\int_0^\\infty e^{-x^2}\\,dx = \\tfrac{\\sqrt{\\pi}}{2}'
      const meta  = { title: 'Doc', fields: [] }
      const sections = [{
         id: '00000000-0000-4000-8000-000000000009', title: 'Math', collapsed: false,
         blocks: [{ id: 'm', type: 'math' as const, latex }],
      }]
      const text1    = documentToMintdown(sections, meta)
      expect(text1).toContain('```math')
      const reparsed = mintdownToDocument(text1)
      expect(reparsed.sections[0].blocks[0]).toMatchObject({ type: 'math', latex })
      expect(documentToMintdown(reparsed.sections, reparsed.meta)).toBe(text1)
   })
})

// The math block's display scale rides the Mintdown fence info string as `math scale=1.5`, and
// only when it is a non-default step; a bare ```math means the default (no mathScale field).
describe('Mintdown math block scale', () => {
   function mathScaleSection(mathScale?: number) {
      return [{
         id: '00000000-0000-4000-8000-00000000000a', title: 'Math', collapsed: false,
         blocks: [{ id: 'm', type: 'math' as const, latex: 'E = mc^2', ...(mathScale !== undefined ? { mathScale } : {}) }],
      }]
   }

   it('round-trips a non-default mathScale through serialize -> parse -> serialize', () => {
      const meta     = { title: 'Doc', fields: [] }
      const sections = mathScaleSection(1.5)
      const text1    = documentToMintdown(sections, meta)
      expect(text1).toContain('```math scale=1.5')
      const reparsed = mintdownToDocument(text1)
      expect(reparsed.sections[0].blocks[0]).toMatchObject({ type: 'math', latex: 'E = mc^2', mathScale: 1.5 })
      expect(documentToMintdown(reparsed.sections, reparsed.meta)).toBe(text1)
   })

   it('emits a bare ```math fence for a default-scale (unset) math block', () => {
      const text = documentToMintdown(mathScaleSection(), { title: 'Doc', fields: [] })
      expect(text).toContain('```math\n')
      expect(text).not.toContain('scale=')
   })

   it('emits a bare ```math fence when mathScale is explicitly the default 1', () => {
      const text = documentToMintdown(mathScaleSection(1), { title: 'Doc', fields: [] })
      expect(text).not.toContain('scale=')
   })

   it('parses a `math scale=1.5` fence into a mathScale field', () => {
      const source = mintdownDocument('', '```math scale=1.5', 'E = mc^2', '```')
      const block  = mintdownToDocument(source).sections[0].blocks[0]
      expect(block).toMatchObject({ type: 'math', latex: 'E = mc^2', mathScale: 1.5 })
   })

   it('parses a bare ```math fence with no mathScale field', () => {
      const source = mintdownDocument('', '```math', 'E = mc^2', '```')
      const block  = mintdownToDocument(source).sections[0].blocks[0]
      expect(block.type).toBe('math')
      expect(block.mathScale).toBeUndefined()
   })

   it('ignores an out-of-range or junk scale token, leaving mathScale unset', () => {
      const junk = mintdownToDocument(mintdownDocument('', '```math scale=9', 'x', '```')).sections[0].blocks[0]
      expect(junk.mathScale).toBeUndefined()
      const nan = mintdownToDocument(mintdownDocument('', '```math scale=abc', 'x', '```')).sections[0].blocks[0]
      expect(nan.mathScale).toBeUndefined()
   })
})

// The image-markup capability lives inside the image block: a marked-up image serializes as the
// ```imagemarkup fence (dims + alt/caption on the info string, one overlay element per body line,
// NEVER any base64), while a plain image keeps its own convention byte-identical. Legacy standalone
// `image-markup` fences still parse back into an `image` block carrying the overlay.
describe('Mintdown, keep-together is layout chrome', () => {
   // keepTogether is a paged-layout flag read only by the paginator, so it must never reach the
   // content-only Mintdown text (exactly as format / presentation never do).
   it('never emits a block keepTogether flag', () => {
      const sections = [{
         id: 's', title: 'Section', collapsed: false, blocks: [
            { id: 'p1', type: 'p' as const, richText: [{ text: 'held whole' }], keepTogether: true as const },
            { id: 'l1', type: 'list' as const, keepTogether: true as const,
               items: [{ id: 'i1', richText: [{ text: 'one' }], children: [] }] },
         ],
      }]
      const text = documentToMintdown(sections, { title: 'Doc', fields: [] })
      expect(text).not.toContain('keepTogether')
      // The content itself still serializes, so the flag is dropped, not the whole block.
      expect(text).toContain('held whole')
   })

   // keepWithNext is the sibling keep-with-next flag: also paged-layout chrome the paginator reads, so it
   // must never reach the Mintdown text either (same reasoning as keepTogether above).
   it('never emits a block keepWithNext flag', () => {
      const sections = [{
         id: 's', title: 'Section', collapsed: false, blocks: [
            { id: 'p1', type: 'p' as const, richText: [{ text: 'pinned caption' }], keepWithNext: true as const },
            { id: 'p2', type: 'p' as const, richText: [{ text: 'the companion' }] },
         ],
      }]
      const text = documentToMintdown(sections, { title: 'Doc', fields: [] })
      expect(text).not.toContain('keepWithNext')
      expect(text).toContain('pinned caption')
   })
})

describe('Mintdown, image block with markup overlay', () => {
   const meta = { title: 'Doc', fields: [] }

   function markupSection() {
      const sections = [{
         id: 's', title: 'Section', collapsed: false, blocks: [{
            id: 'img', type: 'image' as const,
            src: 'data:image/webp;base64,SHOULDNOTLEAK',
            alt: 'Login screen', caption: 'Figure 1',
            imageMarkup: {
               width: 1600, height: 900,
               elements: [
                  { id: 'a', kind: 'rect' as const, x: 0.1, y: 0.1, w: 0.2, h: 0.2, stroke: '#e5484d' },
                  { id: 'b', kind: 'arrow' as const, x1: 0.3, y1: 0.3, x2: 0.6, y2: 0.7 },
               ],
            },
         }],
      }]
      return sections
   }

   it('serializes a marked-up image as an imagemarkup fence with NO base64', () => {
      const text = documentToMintdown(markupSection(), meta)
      expect(text).toContain('```imagemarkup w=1600 h=900 alt="Login screen" caption="Figure 1"')
      expect(text).toContain('rect x=0.1 y=0.1 w=0.2 h=0.2 stroke=#e5484d')
      expect(text).not.toContain('base64')
      expect(text).not.toContain('SHOULDNOTLEAK')
   })

   it('parses an imagemarkup fence back into an image block with the overlay, src empty', () => {
      const text  = documentToMintdown(markupSection(), meta)
      const block = mintdownToDocument(text).sections[0].blocks[0]
      expect(block.type).toBe('image')
      expect(block.src).toBe('')                 // base64 never survives the text format
      expect(block.alt).toBe('Login screen')
      expect(block.caption).toBe('Figure 1')
      expect(block.imageMarkup?.width).toBe(1600)
      expect(block.imageMarkup?.height).toBe(900)
      expect(block.imageMarkup?.elements.map(element => element.kind)).toEqual(['rect', 'arrow'])
   })

   it('round-trips a marked-up image (serialize → parse → serialize), overlay preserved', () => {
      const text1    = documentToMintdown(markupSection(), meta)
      const reparsed = mintdownToDocument(text1)
      const text2    = documentToMintdown(reparsed.sections, reparsed.meta)
      expect(text2).toBe(text1)
   })

   it('a plain image (no overlay) serializes on its own convention, never as a fence', () => {
      const sections = [{
         id: 's', title: 'Section', collapsed: false, blocks: [{
            id: 'img', type: 'image' as const, src: 'data:image/png;base64,PLAIN', alt: 'Plain', caption: 'Cap',
         }],
      }]
      const text = documentToMintdown(sections, meta)
      expect(text).not.toContain('imagemarkup')
      expect(text).toContain('<!-- image:')
   })
})

describe('Mintdown, custom list markers', () => {
   const meta = { title: 'Doc', fields: [] }

   // A 5-item root list (decimal). Item 2 owns a lower-alpha child sub-list, item 4 owns a dash
   // child sub-list: two SIBLING sub-lists at the same nesting, with DIFFERENT markers. The old
   // per-depth model forced them to share one setting; the per-sub-list model keeps them independent.
   function siblingSubListSection(): Section[] {
      return [{
         id: 's', title: 'Section', collapsed: false, blocks: [{
            id: 'list', type: 'list',
            listMarker: 'decimal',
            items: [
               { id: 'i1', richText: [{ text: 'one' }], children: [] },
               { id: 'i2', richText: [{ text: 'two' }], childMarker: 'lower-alpha', children: [
                  { id: 'i2a', richText: [{ text: 'alpha child' }], children: [] },
               ] },
               { id: 'i3', richText: [{ text: 'three' }], children: [] },
               { id: 'i4', richText: [{ text: 'four' }], childMarker: 'dash', children: [
                  { id: 'i4a', richText: [{ text: 'dash child' }], children: [] },
               ] },
               { id: 'i5', richText: [{ text: 'five' }], children: [] },
            ],
         }],
      }]
   }

   it('emits a per-sub-list <!-- list-marker --> comment at each sub-list indent', () => {
      const text = documentToMintdown(siblingSubListSection(), meta)
      expect(text).toContain('<!-- list-marker: decimal -->')      // root, column 0
      expect(text).toContain('  <!-- list-marker: lower-alpha -->') // item 2's child sub-list, indented
      expect(text).toContain('  <!-- list-marker: dash -->')        // item 4's child sub-list, indented
      expect(text).toContain('1. one')
      expect(text).toContain('  1. alpha child')  // ordered child emits digits
      expect(text).toContain('  - dash child')    // unordered child emits a dash
   })

   it('restores each sub-list marker independently on parse (siblings do not share)', () => {
      const text  = documentToMintdown(siblingSubListSection(), meta)
      const block = mintdownToDocument(text).sections[0].blocks[0]
      expect(block.type).toBe('list')
      expect(block.listMarker).toBe('decimal')
      const items = block.items ?? []
      expect(items.map(item => item.richText?.[0]?.text)).toEqual(['one', 'two', 'three', 'four', 'five'])
      expect(items[1].childMarker).toBe('lower-alpha')
      expect(items[3].childMarker).toBe('dash')
      // Untouched siblings carry no marker.
      expect(items[0].childMarker).toBeUndefined()
      expect(items[2].childMarker).toBeUndefined()
   })

   it('round-trips the sibling sub-lists (serialize → parse → serialize) unchanged', () => {
      const text1    = documentToMintdown(siblingSubListSection(), meta)
      const reparsed = mintdownToDocument(text1)
      const text2    = documentToMintdown(reparsed.sections, reparsed.meta)
      expect(text2).toBe(text1)
      const items = reparsed.sections[0].blocks[0].items ?? []
      expect(items[1].childMarker).toBe('lower-alpha')
      expect(items[3].childMarker).toBe('dash')
   })

   // Byte-identical invariant: a plain dot list carries no comment and no numbering, and an explicit
   // all-`dot` configuration serializes to the very same bytes (and normalises back to absent fields).
   it('keeps a plain (dot) list byte-identical, with and without explicit dot markers', () => {
      const plainItems = [
         { id: 'a', richText: [{ text: 'one' }], children: [
            { id: 'a1', richText: [{ text: 'child' }], children: [] },
         ] },
         { id: 'b', richText: [{ text: 'two' }], children: [] },
      ]
      const dotItems = [
         { id: 'a', richText: [{ text: 'one' }], childMarker: 'dot' as const, children: [
            { id: 'a1', richText: [{ text: 'child' }], children: [] },
         ] },
         { id: 'b', richText: [{ text: 'two' }], children: [] },
      ]
      const withoutMarkers: Section[] = [{ id: 's', title: 'Section', collapsed: false, blocks: [{ id: 'list', type: 'list', items: plainItems }] }]
      const withDotMarkers: Section[] = [{ id: 's', title: 'Section', collapsed: false, blocks: [{ id: 'list', type: 'list', listMarker: 'dot', items: dotItems }] }]

      const textPlain = documentToMintdown(withoutMarkers, meta)
      const textDot   = documentToMintdown(withDotMarkers, meta)
      expect(textDot).toBe(textPlain)
      expect(textPlain).not.toContain('list-marker')
      expect(textPlain).toContain('- one')

      const reparsed = mintdownToDocument(textPlain)
      const block = reparsed.sections[0].blocks[0]
      expect(block.listMarker).toBeUndefined()
      expect(block.items?.[0].childMarker).toBeUndefined()
   })
})

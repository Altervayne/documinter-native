import { describe, it, expect } from 'vitest'
import { documentToMarkdown, markdownToDocument } from './markdown'
import { buildFixtureDocument, buildFixtureWithoutContainers } from '../test/fixtures'
import type { DocMeta, Section } from '../types'

describe('Markdown freeform metadata', () => {
   it('parses the title plus bold-colon fields, keeping labels with spaces and colons', () => {
      const source = [
         '# My Doc',
         '**Module:** Billing',
         '**Reviewed by:** Alice Smith',
         '**Notes:** see: the appendix',
         '---',
         '',
         '## Section',
         '',
         'body',
      ].join('\n')
      const meta = markdownToDocument(source).meta
      expect(meta.title).toBe('My Doc')
      expect(meta.fields.map(field => [field.label, field.value])).toEqual([
         ['Module', 'Billing'],
         ['Reviewed by', 'Alice Smith'],
         ['Notes', 'see: the appendix'],
      ])
   })
})

// Markdown round-trips the lossless subset (everything except containers). Image src/alt and
// caption/align/height all survive, verified against the serializer's comment-based attribute
// emission, so the fixture keeps the image; only containers are excluded.

describe('Markdown round-trip (lossless subset)', () => {
   it('is identical after serialize → parse → serialize for the container-free fixture', () => {
      const fixture  = buildFixtureWithoutContainers()
      const text1    = documentToMarkdown(fixture.sections, fixture.meta)
      const reparsed = markdownToDocument(text1)
      const text2    = documentToMarkdown(reparsed.sections, reparsed.meta)
      expect(text2).toBe(text1)
   })
})

// A minimal Markdown document wrapping a single block body, so targeted parse checks read like
// the real serializer output (title + one section) without depending on the full fixture.
function markdownDocument(...bodyLines: string[]): string {
   return [
      '# Doc',
      '---',
      '',
      '## Section',
      ...bodyLines,
   ].join('\n')
}

describe('Markdown targeted parse', () => {
   it('parses a callout [!style] marker into style', () => {
      const source  = markdownDocument('', '> [!warning]', '> heads up')
      const callout = markdownToDocument(source).sections[0].blocks[0]
      expect(callout.type).toBe('callout')
      expect(callout.style).toBe('warning')
   })

   it('round-trips a callout custom hex color through parse -> serialize -> parse', () => {
      const source = markdownDocument('', '> [!#ff8800]', '> heads up')
      const parsed  = markdownToDocument(source)
      const callout = parsed.sections[0].blocks[0]
      expect(callout.type).toBe('callout')
      expect(callout.style).toBe('info')          // default style, unaffected by the hex
      expect(callout.calloutColor).toBe('#ff8800')

      const reserialized = documentToMarkdown(parsed.sections, parsed.meta)
      expect(reserialized).toContain('> [!#ff8800]')

      const reparsed = markdownToDocument(reserialized).sections[0].blocks[0]
      expect(reparsed.calloutColor).toBe('#ff8800')
      expect(reparsed.style).toBe('info')
   })

   it('falls back to the info preset for a malformed callout hex tag (wrong digit count)', () => {
      const source  = markdownDocument('', '> [!#ff88]', '> heads up')
      const callout = markdownToDocument(source).sections[0].blocks[0]
      expect(callout.type).toBe('callout')
      expect(callout.style).toBe('info')
      expect(callout.calloutColor).toBeUndefined()
      // The tag line is still consumed as a callout directive, not left as literal content.
      expect(callout.richText).toEqual([{ text: 'heads up' }])
   })
})

// Containers have no Markdown representation, so they flatten by design : the
// wrapper is dropped, inner blocks are promoted to top level, and the ratio is lost. This is a
// stable contract, not a bug, the lossless JSON backup remains the format that preserves containers.
describe('Markdown container flattening (by design)', () => {
   it('promotes a container\'s inner blocks to top level and drops the wrapper + ratio', () => {
      const fixture  = buildFixtureDocument()   // includes the two containers
      const reparsed = markdownToDocument(documentToMarkdown(fixture.sections, fixture.meta))
      const blocks   = reparsed.sections.flatMap(section => section.blocks)

      // No container wrapper survives, and no block carries a ratio.
      expect(blocks.some(block => block.type === 'container')).toBe(false)
      expect(blocks.every(block => block.ratio === undefined)).toBe(true)

      // The inner paragraphs now sit at top level.
      const paragraphTexts = blocks
         .filter(block => block.type === 'p')
         .map(block => (block.richText ?? []).map(run => run.text).join(''))
      expect(paragraphTexts).toContain('container left one')
      expect(paragraphTexts).toContain('container right one')
      expect(paragraphTexts).toContain('container left two')
      expect(paragraphTexts).toContain('container right two')
   })
})

// A math block serializes as a ```math fence carrying the raw LaTeX, exactly like a code fence.
// The rendered MathML is never serialized; it is re-derived from the LaTeX on load.
describe('Markdown math block', () => {
   it('parses a ```math fence into a math block, keeping the raw LaTeX', () => {
      const source = ['# Doc', '---', '', '## Section', '', '```math', 'E = mc^2', '```'].join('\n')
      const block  = markdownToDocument(source).sections[0].blocks[0]
      expect(block.type).toBe('math')
      expect(block.latex).toBe('E = mc^2')
   })

   it('round-trips a math block through serialize -> parse -> serialize with LaTeX intact', () => {
      const latex = '\\int_0^\\infty e^{-x^2}\\,dx = \\tfrac{\\sqrt{\\pi}}{2}'
      const meta: DocMeta = { title: 'Doc', fields: [] }
      const sections: Section[] = [{
         id: '00000000-0000-4000-8000-000000000009', title: 'Math', collapsed: false,
         blocks: [{ id: 'm', type: 'math', latex }],
      }]
      const text1    = documentToMarkdown(sections, meta)
      expect(text1).toContain('```math')
      const reparsed = markdownToDocument(text1)
      expect(reparsed.sections[0].blocks[0]).toMatchObject({ type: 'math', latex })
      expect(documentToMarkdown(reparsed.sections, reparsed.meta)).toBe(text1)
   })

   // Markdown is the lossy portable format: the display scale is intentionally dropped so the
   // `math` info string stays bare (GitHub disables native math rendering on any info suffix).
   it('never emits scale= even when the block carries a mathScale', () => {
      const meta: DocMeta = { title: 'Doc', fields: [] }
      const sections: Section[] = [{
         id: '00000000-0000-4000-8000-00000000000a', title: 'Math', collapsed: false,
         blocks: [{ id: 'm', type: 'math', latex: 'E = mc^2', mathScale: 1.5 }],
      }]
      const text = documentToMarkdown(sections, meta)
      expect(text).toContain('```math\n')
      expect(text).not.toContain('scale=')
   })

   it('parses a bare ```math fence with no mathScale field', () => {
      const source = ['# Doc', '---', '', '## Section', '', '```math', 'E = mc^2', '```'].join('\n')
      const block  = markdownToDocument(source).sections[0].blocks[0]
      expect(block.type).toBe('math')
      expect(block.mathScale).toBeUndefined()
   })
})

describe('Markdown, custom list markers degrade', () => {
   const meta: DocMeta = { title: 'Doc', fields: [] }

   // Root decimal; item 2 owns a lower-alpha child sub-list, item 4 owns a dash child sub-list.
   // The two sibling child sub-lists carry INDEPENDENT markers (childMarker per item).
   function markedListSection(): Section[] {
      return [{
         id: '00000000-0000-4000-8000-00000000000b', title: 'Section', collapsed: false,
         blocks: [{
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

   it('emits native numbering per sub-list but NO list-marker token in portable Markdown', () => {
      const text = documentToMarkdown(markedListSection(), meta)
      expect(text).not.toContain('list-marker')
      expect(text).toContain('1. one')
      expect(text).toContain('2. two')
      expect(text).toContain('  1. alpha child')  // ordered child sub-list keeps its digits
      expect(text).toContain('  - dash child')    // unordered child sub-list keeps its dash
   })

   it('re-imports keeping each sub-list ordered-ness, degrading style to decimal/dot', () => {
      const text  = documentToMarkdown(markedListSection(), meta)
      const block = markdownToDocument(text).sections[0].blocks[0]
      expect(block.type).toBe('list')
      // Root was ordered -> decimal; item 2's ordered child -> decimal; item 4's dash child -> dot.
      expect(block.listMarker).toBe('decimal')
      const items = block.items ?? []
      expect(items[1].childMarker).toBe('decimal')
      expect(items[3].childMarker).toBeUndefined()
   })

   it('keeps a plain (dot) list free of numbering and tokens', () => {
      const sections: Section[] = [{
         id: '00000000-0000-4000-8000-00000000000c', title: 'Section', collapsed: false,
         blocks: [{ id: 'list', type: 'list', items: [
            { id: 'a', richText: [{ text: 'one' }], children: [] },
            { id: 'b', richText: [{ text: 'two' }], children: [] },
         ] }],
      }]
      const text = documentToMarkdown(sections, meta)
      expect(text).not.toContain('list-marker')
      expect(text).toContain('- one')
      expect(markdownToDocument(text).sections[0].blocks[0].listMarker).toBeUndefined()
   })
})

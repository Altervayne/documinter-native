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
// caption/align/height all survive — verified against the serializer's comment-based attribute
// emission — so the fixture keeps the image; only containers are excluded.

describe('Markdown round-trip (lossless subset)', () => {
   it('is identical after serialize → parse → serialize for the container-free fixture', () => {
      const fixture  = buildFixtureWithoutContainers()
      const text1    = documentToMarkdown(fixture.sections, fixture.meta)
      const reparsed = markdownToDocument(text1)
      const text2    = documentToMarkdown(reparsed.sections, reparsed.meta)
      expect(text2).toBe(text1)
   })
})

// Containers have no Markdown representation, so they flatten by design (TESTING_STUDY §2.5): the
// wrapper is dropped, inner blocks are promoted to top level, and the ratio is lost. This is a
// stable contract, not a bug — Mintdown remains the format that preserves containers.
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

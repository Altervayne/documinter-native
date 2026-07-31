import { describe, it, expect } from 'vitest'
import { documentToMarkdown, markdownToDocument } from './markdown'
import { buildFixtureDocument, buildFixtureWithoutContainers } from '../test/fixtures'

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

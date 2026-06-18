import { describe, it, expect } from 'vitest'
import { documentToMintdown, mintdownToDocument } from './mintdown'
import { buildFixtureDocument } from '../test/fixtures'
import { normalizeIds } from '../test/normalizeIds'

// Mintdown is the lossless format: every construct, including containers with their ratio, must
// survive serialize → parse → serialize unchanged. The string round-trip is the workhorse; a few
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
      'module: M',
      'environment: E',
      'date: D',
      'author: A',
      '---',
      '',
      '## Section',
      ...bodyLines,
   ].join('\n')
}

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
})

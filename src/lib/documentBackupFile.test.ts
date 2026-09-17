import { describe, it, expect } from 'vitest'
import { parseDocumentBackup } from './documentBackupFile'
import { INFINITE_WIDTH_WIDE_PX, resolveInfiniteWidthPx } from './format'

// parseDocumentBackup is the pure half of the document-file round-trip (downloadMint's counterpart is
// I/O only, a save dialog); these tests pin how a stored `format` field is restored on import,
// mirroring the presentation round-trip already covered elsewhere.
describe('parseDocumentBackup, format persistence', () => {
   const baseBackup = { meta: { title: 'Doc', fields: [] }, sections: [] }

   it('normalizes an absent format to the default (infinite/normal)', () => {
      const parsed = parseDocumentBackup(JSON.stringify(baseBackup))
      expect(parsed).not.toBeNull()
      expect(parsed!.presentation.format).toEqual({ kind: 'infinite' })
   })

   it('round-trips a stored custom-width format', () => {
      const stored = { ...baseBackup, format: { kind: 'infinite', width: 'wide' } }
      const parsed = parseDocumentBackup(JSON.stringify(stored))
      expect(parsed).not.toBeNull()
      expect(parsed!.presentation.format).toEqual({ kind: 'infinite', width: 'wide' })
      expect(resolveInfiniteWidthPx(parsed!.presentation.format!.width)).toBe(INFINITE_WIDTH_WIDE_PX)
   })

   it('round-trips a custom numeric width, clamped defensively', () => {
      const stored = { ...baseBackup, format: { kind: 'infinite', width: { custom: 950 } } }
      const parsed = parseDocumentBackup(JSON.stringify(stored))
      expect(parsed!.presentation.format).toEqual({ kind: 'infinite', width: { custom: 950 } })
   })

   it('drops a malformed format down to the default rather than throwing', () => {
      const stored = { ...baseBackup, format: { kind: 'not-a-real-kind', width: 'nonsense' } }
      const parsed = parseDocumentBackup(JSON.stringify(stored))
      expect(parsed!.presentation.format).toEqual({ kind: 'infinite' })
   })

   it('tolerates a legacy backup with no format key at all (older-than-this-feature file)', () => {
      const legacyText = JSON.stringify({ meta: { title: 'Legacy', fields: [] }, sections: [], docTheme: 'dark', docAccent: '#123456' })
      const parsed = parseDocumentBackup(legacyText)
      expect(parsed).not.toBeNull()
      expect(parsed!.presentation.docTheme).toBe('dark')
      expect(parsed!.presentation.format).toEqual({ kind: 'infinite' })
   })
})

// keepTogether is JSON-only layout chrome: the full-fidelity backup carries it (unlike .mint / .md), and
// an untouched block never grows the field. These pin that the parse preserves the flag by position, so a
// re-import restores it, while a block without it stays clean.
describe('parseDocumentBackup, keepTogether persistence', () => {
   it('round-trips a block keepTogether flag and leaves an unflagged block clean', () => {
      const stored = {
         meta: { title: 'Doc', fields: [] },
         sections: [{
            id: 's1', title: 'S', collapsed: false, blocks: [
               { id: 'b1', type: 'p', richText: [{ text: 'held' }], keepTogether: true },
               { id: 'b2', type: 'p', richText: [{ text: 'free' }] },
            ],
         }],
      }
      const parsed = parseDocumentBackup(JSON.stringify(stored))
      expect(parsed).not.toBeNull()
      const blocks = parsed!.state.sections[0].blocks
      expect(blocks[0].keepTogether).toBe(true)
      expect(blocks[1].keepTogether).toBeUndefined()
   })
})

import { describe, it, expect } from 'vitest'
import { serializeMint, parseMint, buildMintFile, type MintFile } from './mintFile'
import { RECORD_SCHEMA_VERSION } from '../documentRecord'
import type { DocMeta, Section } from '../../types'
import type { DocFormat } from '../format'
import { normalizePresentation, type DocPresentationExtras } from '../presentation'

const meta: DocMeta = { title: 'Field Guide', fields: [] }

const sections: Section[] = [
   {
      id: 's1', title: 'Alpha', collapsed: false,
      blocks: [
         { id: 'b1', type: 'p', richText: [{ text: 'hello world' }] },
         { id: 'b2', type: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==', alt: 'a pixel' },
      ],
   },
   {
      id: 's2', title: 'Beta', collapsed: false,
      blocks: [{ id: 'b3', type: 'p', richText: [{ text: 'second body' }] }],
   },
]

const presentation: DocPresentationExtras = {
   watermark: {
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==',
      opacity: 0.2, fit: 'cover', tile: false, position: 'center', rotation: 0,
      tileSize: 200, spacingX: 0, spacingY: 0, aspectRatio: 1, offsetX: 0, offsetY: 0,
   },
}

const pagedFormat: DocFormat = { kind: 'a4-portrait' }

describe('serializeMint / parseMint round-trip', () => {
   it('preserves id, meta, sections (inline base64 image kept), theme, accent, presentation, format, timestamps', () => {
      const file = buildMintFile({
         id: 'doc-1', meta, sections,
         docTheme: 'dark', docAccent: '#abcdef',
         presentation, format: pagedFormat,
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-02T00:00:00.000Z',
         lastOpenedAt: '2026-01-03T00:00:00.000Z',
      })
      const parsed = parseMint(serializeMint(file))
      expect(parsed).not.toBeNull()
      if (!parsed) return
      expect(parsed.id).toBe('doc-1')
      expect(parsed.loaded.meta).toEqual(meta)
      expect(parsed.loaded.sections).toEqual(sections)
      // The inline base64 image src survives verbatim (self-containment).
      expect(parsed.loaded.sections[0].blocks[1].src).toBe(sections[0].blocks[1].src)
      expect(parsed.loaded.docTheme).toBe('dark')
      expect(parsed.loaded.docAccent).toBe('#abcdef')
      // Compare against the normalized reference: the read pipeline runs normalizePresentation, so
      // the survivor is the normalized watermark, not the raw literal (equal here, robust either way).
      expect(parsed.loaded.presentation).toEqual(normalizePresentation(presentation))
      expect(parsed.loaded.format).toEqual(pagedFormat)
      expect(parsed.createdAt).toBe('2026-01-01T00:00:00.000Z')
      expect(parsed.updatedAt).toBe('2026-01-02T00:00:00.000Z')
      expect(parsed.lastOpenedAt).toBe('2026-01-03T00:00:00.000Z')
      expect(parsed.schemaVersion).toBe(RECORD_SCHEMA_VERSION)
   })
})

describe('serializeMint write-guards', () => {
   it('omits a default format, an absent presentation, and an absent lastOpenedAt from the JSON', () => {
      const file = buildMintFile({
         id: 'doc-2', meta, sections,
         docTheme: 'light', docAccent: '#2dcea8',
         format: { kind: 'infinite' },   // the default, must not be written
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-01T00:00:00.000Z',
      })
      const text = serializeMint(file)
      expect(text).not.toContain('"format"')
      expect(text).not.toContain('"presentation"')
      expect(text).not.toContain('"lastOpenedAt"')
      // Two-space pretty JSON, like downloadMint.
      expect(text).toContain('\n  "id": "doc-2"')
   })

   it('writes format only when it diverges from the default', () => {
      const file = buildMintFile({
         id: 'doc-3', meta, sections,
         docTheme: 'light', docAccent: '#2dcea8',
         format: pagedFormat,
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-01T00:00:00.000Z',
      })
      expect(serializeMint(file)).toContain('"format"')
   })
})

describe('parseMint on a legacy .documinter.json shape', () => {
   it('returns non-null with id and timestamps null and a valid migrated loaded document', () => {
      // No id, no createdAt/updatedAt/lastOpenedAt/schemaVersion, like a .documinter.json backup.
      const legacy = JSON.stringify({ meta, sections, docTheme: 'light', docAccent: '#2dcea8' })
      const parsed = parseMint(legacy)
      expect(parsed).not.toBeNull()
      if (!parsed) return
      expect(parsed.id).toBeNull()
      expect(parsed.createdAt).toBeNull()
      expect(parsed.updatedAt).toBeNull()
      expect(parsed.lastOpenedAt).toBeNull()
      expect(parsed.schemaVersion).toBeNull()
      expect(parsed.loaded.sections.map(section => section.title)).toEqual(['Alpha', 'Beta'])
      // An absent format still normalizes to the concrete infinite default.
      expect(parsed.loaded.format).toEqual({ kind: 'infinite' })
   })

   it('applies documentBackupFile theme/accent defaults when they are missing', () => {
      const parsed = parseMint(JSON.stringify({ meta, sections }))
      expect(parsed).not.toBeNull()
      if (!parsed) return
      expect(parsed.loaded.docTheme).toBe('light')
      expect(parsed.loaded.docAccent).toBe('#2dcea8')
   })
})

describe('parseMint rejects non-documents', () => {
   it('returns null on garbage JSON', () => {
      expect(parseMint('not json at all {')).toBeNull()
   })

   it('returns null when meta is missing', () => {
      expect(parseMint(JSON.stringify({ sections }))).toBeNull()
   })

   it('returns null when sections is not an array', () => {
      expect(parseMint(JSON.stringify({ meta, sections: 'nope' }))).toBeNull()
   })

   it('returns null on a JSON null literal (no throw)', () => {
      expect(parseMint('null')).toBeNull()
   })
})

describe('buildMintFile', () => {
   it('drops absent presentation / format / lastOpenedAt and defaults schemaVersion', () => {
      const file: MintFile = buildMintFile({
         id: 'doc-4', meta, sections,
         docTheme: 'light', docAccent: '#2dcea8',
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-01T00:00:00.000Z',
      })
      expect('presentation' in file).toBe(false)
      expect('format' in file).toBe(false)
      expect('lastOpenedAt' in file).toBe(false)
      expect(file.schemaVersion).toBe(RECORD_SCHEMA_VERSION)
   })
})

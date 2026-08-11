import { describe, it, expect } from 'vitest'
import {
   TIN_SCHEMA_VERSION,
   serializeTin, parseTin, gzipString, gunzipToString,
   type TinFile,
} from './tinFile'
import type { Section } from '../types'

// A minimal-but-real manifest: one folder, one document with a section, one template.
function makeTin(overrides: Partial<TinFile> = {}): TinFile {
   const sections: Section[] = [
      { id: 'section-1', title: 'Intro', collapsed: false, blocks: [
         { id: 'block-1', type: 'p', richText: [{ text: 'Hello' }] },
      ] },
   ]
   return {
      documinterTin: true,
      schemaVersion: TIN_SCHEMA_VERSION,
      exportedAt:    '2026-08-11T00:00:00.000Z',
      templates: [
         { name: 'Report', meta: { title: '', fields: [] }, docTheme: 'light', docAccent: '#2dcea8' },
      ],
      folders: [
         { id: 'folder-1', name: 'Notes', parentId: '0', sortOrder: 0, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z' },
      ],
      documents: [
         {
            id: 'doc-1', meta: { title: 'Doc', fields: [] }, folderId: 'folder-1', sortOrder: 0,
            createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
            docTheme: 'dark', docAccent: '#2dcea8', sections,
         },
      ],
      ...overrides,
   }
}

describe('serializeTin / parseTin', () => {
   it('round-trips a manifest through serialize -> parse', () => {
      const tin    = makeTin()
      const parsed = parseTin(serializeTin(tin))
      expect(parsed).toEqual(tin)
   })

   it('serializes compact (no pretty-print newlines)', () => {
      expect(serializeTin(makeTin())).not.toContain('\n')
   })

   it('rejects non-JSON text', () => {
      expect(parseTin('not json at all {')).toBeNull()
   })

   it('rejects JSON without the marker', () => {
      expect(parseTin(JSON.stringify({ schemaVersion: 1, templates: [], folders: [], documents: [] }))).toBeNull()
   })

   it('rejects a marker that is not exactly true', () => {
      const bad = JSON.stringify({ documinterTin: 'yes', schemaVersion: 1, templates: [], folders: [], documents: [] })
      expect(parseTin(bad)).toBeNull()
   })

   it('rejects a schemaVersion above what this build knows', () => {
      expect(parseTin(serializeTin(makeTin({ schemaVersion: TIN_SCHEMA_VERSION + 1 })))).toBeNull()
   })

   it('rejects a non-finite schemaVersion', () => {
      const bad = JSON.stringify({ documinterTin: true, schemaVersion: 'one', templates: [], folders: [], documents: [] })
      expect(parseTin(bad)).toBeNull()
   })

   it('accepts a schemaVersion below the current one (older export heals on import)', () => {
      const older = makeTin({ schemaVersion: 0 })
      expect(parseTin(serializeTin(older))).toEqual(older)
   })

   it('rejects a manifest whose collections are not arrays', () => {
      const badTemplates = JSON.stringify({ documinterTin: true, schemaVersion: 1, templates: {}, folders: [], documents: [] })
      const badFolders   = JSON.stringify({ documinterTin: true, schemaVersion: 1, templates: [], folders: null, documents: [] })
      const badDocuments = JSON.stringify({ documinterTin: true, schemaVersion: 1, templates: [], folders: [], documents: 3 })
      expect(parseTin(badTemplates)).toBeNull()
      expect(parseTin(badFolders)).toBeNull()
      expect(parseTin(badDocuments)).toBeNull()
   })
})

// The gzip helpers lean on the Web Streams codec globals. They are expected in the Node 22 runner;
// if a stripped environment lacks them, skip only these cases (never delete them) with a clear note.
const hasCompression = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
const gzipDescribe = hasCompression ? describe : describe.skip
if (!hasCompression) {
   console.warn('tinFile.test: CompressionStream unavailable in this environment, gzip cases skipped.')
}

gzipDescribe('gzipString / gunzipToString', () => {
   it('round-trips ASCII', async () => {
      const text = 'The quick brown fox jumps over the lazy dog.'
      expect(await gunzipToString(await gzipString(text))).toBe(text)
   })

   it('round-trips unicode + accents', async () => {
      const text = 'e-acute cafe resume, accents preserved via UTF-8, plus a snowman and a heart.'
      expect(await gunzipToString(await gzipString(text))).toBe(text)
   })

   it('round-trips a large base64-like blob', async () => {
      const blob = 'data:image/png;base64,' + 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5'.repeat(4000)
      expect(await gunzipToString(await gzipString(blob))).toBe(blob)
   })

   it('compresses repetitive content well below its raw byte length', async () => {
      const text       = 'A'.repeat(10000)
      const compressed = await gzipString(text)
      expect(compressed.length).toBeLessThan(text.length)
   })

   it('rejects a corrupt gzip stream', async () => {
      await expect(gunzipToString(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toBeDefined()
   })

   it('runs the full pipeline: tin -> serialize -> gzip -> gunzip -> parse deep-equals the original', async () => {
      const tin        = makeTin()
      const compressed = await gzipString(serializeTin(tin))
      const parsed     = parseTin(await gunzipToString(compressed))
      expect(parsed).toEqual(tin)
   })
})

import { describe, it, expect } from 'vitest'
import { serializeTemplateFile, parseTemplateFile, TEMPLATE_FILE_SCHEMA_VERSION } from './templateFile'
import type { DocumentTemplate } from '../documentTemplate'
import { normalizePresentation, type DocPresentationExtras } from '../presentation'
import type { DocFormat } from '../format'
import type { DocMeta } from '../../types'

const meta: DocMeta = {
   title: '',
   fields: [
      { id: 'field-module', label: 'Module', value: '', position: 'above', color: 'accent' },
      { id: 'field-author', label: 'Author', value: '', position: 'below' },
   ],
}

const presentation: DocPresentationExtras = {
   watermark: {
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==',
      opacity: 0.2, fit: 'cover', tile: false, position: 'center', rotation: 0,
      tileSize: 200, spacingX: 0, spacingY: 0, aspectRatio: 1, offsetX: 0, offsetY: 0,
   },
}

const pagedFormat: DocFormat = { kind: 'a4-portrait' }

const template: DocumentTemplate = {
   id:        'template-1',
   name:      'Field Report',
   createdAt: 1_700_000_000_000,
   updatedAt: 1_700_000_500_000,
   meta,
   docTheme:  'dark',
   docAccent: '#abcdef',
   presentation,
   format:    pagedFormat,
}

describe('serializeTemplateFile / parseTemplateFile round-trip', () => {
   it('preserves id, name, timestamps, meta scaffold, theme, accent, presentation, format', () => {
      const parsed = parseTemplateFile(serializeTemplateFile(template))
      expect(parsed).not.toBeNull()
      if (!parsed) return
      expect(parsed.id).toBe('template-1')
      expect(parsed.name).toBe('Field Report')
      expect(parsed.createdAt).toBe(1_700_000_000_000)
      expect(parsed.updatedAt).toBe(1_700_000_500_000)
      expect(parsed.meta).toEqual(meta)
      expect(parsed.docTheme).toBe('dark')
      expect(parsed.docAccent).toBe('#abcdef')
      expect(parsed.presentation).toEqual(normalizePresentation(presentation))
      expect(parsed.format).toEqual(pagedFormat)
   })

   it('writes a marker + schema version and pretty two-space JSON', () => {
      const text = serializeTemplateFile(template)
      expect(text).toContain('"documinterTemplate": true')
      expect(text).toContain(`"schemaVersion": ${TEMPLATE_FILE_SCHEMA_VERSION}`)
      expect(text).toContain('\n  "id": "template-1"')
   })
})

describe('serializeTemplateFile write-guards', () => {
   it('omits an absent presentation and a default format', () => {
      const bare: DocumentTemplate = {
         id: 'template-2', name: 'Bare', createdAt: 1, updatedAt: 1,
         meta, docTheme: 'light', docAccent: '#2dcea8',
         format: { kind: 'infinite' },   // the default, must not be written
      }
      const text = serializeTemplateFile(bare)
      expect(text).not.toContain('"presentation"')
      expect(text).not.toContain('"format"')
   })
})

describe('parseTemplateFile rejects non-templates', () => {
   it('returns null on garbage JSON', () => {
      expect(parseTemplateFile('not json {')).toBeNull()
   })

   it('returns null without the documinterTemplate marker', () => {
      expect(parseTemplateFile(JSON.stringify({ id: 'x', meta, docTheme: 'light', docAccent: '#000' }))).toBeNull()
   })

   it('returns null when the id is missing or blank', () => {
      expect(parseTemplateFile(JSON.stringify({ documinterTemplate: true, meta, docTheme: 'light', docAccent: '#000' }))).toBeNull()
      expect(parseTemplateFile(JSON.stringify({ documinterTemplate: true, id: '  ', meta, docTheme: 'light', docAccent: '#000' }))).toBeNull()
   })

   it('returns null when meta or its fields are missing', () => {
      expect(parseTemplateFile(JSON.stringify({ documinterTemplate: true, id: 'x', docTheme: 'light', docAccent: '#000' }))).toBeNull()
   })

   it('returns null on a schemaVersion above this build', () => {
      const text = JSON.stringify({
         documinterTemplate: true, schemaVersion: TEMPLATE_FILE_SCHEMA_VERSION + 1,
         id: 'x', name: 'X', createdAt: 0, updatedAt: 0, meta, docTheme: 'light', docAccent: '#000',
      })
      expect(parseTemplateFile(text)).toBeNull()
   })
})

describe('parseTemplateFile defaults', () => {
   it('fills a blank name and missing timestamps', () => {
      const text = JSON.stringify({
         documinterTemplate: true, id: 'template-3', meta, docTheme: 'light', docAccent: '#2dcea8',
      })
      const parsed = parseTemplateFile(text)
      expect(parsed).not.toBeNull()
      if (!parsed) return
      expect(parsed.name).toBe('Untitled template')
      expect(parsed.createdAt).toBe(0)
      expect(parsed.updatedAt).toBe(0)
   })
})

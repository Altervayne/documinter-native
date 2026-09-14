import { describe, it, expect } from 'vitest'
import {
   RECORD_SCHEMA_VERSION,
   buildDocumentRecord, buildDocumentContent, cloneSectionsWithFreshIds,
   assembleLoadedDocument, migrateListRecord,
} from './documentRecord'
import type { BinderDocumentRecord, DocMeta, Section } from '../types'

const meta: DocMeta = { title: 'Doc', fields: [] }

const sections: Section[] = [
   {
      id: 's1', title: 'Alpha', collapsed: false,
      blocks: [{ id: 'b1', type: 'p', richText: [{ text: 'hello world' }] }],
   },
   {
      id: 's2', title: 'Beta', collapsed: false,
      blocks: [{ id: 'b2', type: 'p', richText: [{ text: 'second body' }] }],
   },
]

describe('buildDocumentRecord', () => {
   it('derives the light-record shape from sections and passes the rest through', () => {
      const record = buildDocumentRecord({
         id: 'doc-1',
         meta,
         sections,
         docTheme: 'dark',
         docAccent: '#abcdef',
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-02T00:00:00.000Z',
         lastOpenedAt: undefined,
         folderId: '0',
         sortOrder: 3,
      })
      expect(record.id).toBe('doc-1')
      expect(record.meta).toBe(meta)
      expect(record.createdAt).toBe('2026-01-01T00:00:00.000Z')
      expect(record.updatedAt).toBe('2026-01-02T00:00:00.000Z')
      expect(record.lastOpenedAt).toBeUndefined()
      expect(record.folderId).toBe('0')
      expect(record.sortOrder).toBe(3)
      expect(record.sectionTitles).toEqual(['Alpha', 'Beta'])
      expect(record.contentText).toContain('hello world')
      expect(record.contentText).toContain('second body')
      expect(record.previewSections.map(section => section.title)).toEqual(['Alpha', 'Beta'])
      expect(record.docTheme).toBe('dark')
      expect(record.docAccent).toBe('#abcdef')
      expect(record.schemaVersion).toBe(RECORD_SCHEMA_VERSION)
   })
})

describe('buildDocumentContent', () => {
   it('omits presentation and format when absent, so an untouched document stays byte-clean', () => {
      const content = buildDocumentContent('doc-1', sections, {})
      expect(content).toEqual({ id: 'doc-1', sections })
      expect('presentation' in content).toBe(false)
      expect('format' in content).toBe(false)
   })

   it('spreads presentation and format only when truthy', () => {
      const format = { kind: 'a4-portrait' as const }
      const content = buildDocumentContent('doc-1', sections, { format })
      expect(content.format).toBe(format)
      expect('presentation' in content).toBe(false)
   })
})

describe('cloneSectionsWithFreshIds', () => {
   it('mints fresh section + block ids without aliasing the source', () => {
      let counter = 0
      const cloned = cloneSectionsWithFreshIds(sections, () => `fresh-${counter++}`)
      expect(cloned.map(section => section.id)).toEqual(['fresh-0', 'fresh-1'])
      expect(cloned[0].blocks[0].id).not.toBe(sections[0].blocks[0].id)
      expect(cloned[0].title).toBe('Alpha')
      // The source sections keep their original ids (no in-place mutation).
      expect(sections[0].id).toBe('s1')
   })
})

describe('assembleLoadedDocument', () => {
   it('migrates ids, normalizes presentation to undefined when absent, and format to a concrete default', () => {
      const loaded = assembleLoadedDocument({
         meta,
         sections,
         docTheme: 'light',
         docAccent: '#123456',
      })
      expect(loaded.docTheme).toBe('light')
      expect(loaded.docAccent).toBe('#123456')
      expect(loaded.presentation).toBeUndefined()
      // format normalizes to a concrete DocFormat even when absent (infinite default).
      expect(loaded.format).toEqual({ kind: 'infinite' })
      expect(loaded.sections.map(section => section.title)).toEqual(['Alpha', 'Beta'])
   })
})

describe('migrateListRecord', () => {
   it('normalizes a legacy flat meta up to the freeform { title, fields } shape', () => {
      const legacy = {
         id: 'doc-1', createdAt: '', updatedAt: '', lastOpenedAt: undefined,
         folderId: '0', sortOrder: 0, sectionTitles: [], contentText: '',
         previewSections: [], docTheme: 'light', docAccent: '#000',
         schemaVersion: 1,
         meta: { title: 'Legacy', module: 'Ops' },
      } as unknown as BinderDocumentRecord
      const migrated = migrateListRecord(legacy)
      expect(migrated.meta.title).toBe('Legacy')
      expect(Array.isArray(migrated.meta.fields)).toBe(true)
      expect(migrated.meta.fields.some(field => field.value === 'Ops')).toBe(true)
   })
})

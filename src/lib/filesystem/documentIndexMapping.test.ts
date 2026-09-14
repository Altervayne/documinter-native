import { describe, it, expect } from 'vitest'
import {
   INDEX_SCHEMA_VERSION,
   SCHEMA_STATEMENTS,
   buildDocumentSearchText,
   documentRecordToRow,
   rowToDocumentRecord,
   folderRecordToRow,
   rowToFolderRecord,
   escapeFtsQuery,
} from './documentIndexMapping'
import type { BinderDocumentRecord, BinderFolderRecord } from '../../types'

const record: BinderDocumentRecord = {
   id:           'doc-1',
   meta:         {
      title:  'Release Notes',
      fields: [
         { id: 'f1', label: 'Author', value: 'Florian',  position: 'above' },
         { id: 'f2', label: 'Status', value: 'Draft',    position: 'below' },
      ],
   },
   createdAt:    '2026-01-01T00:00:00.000Z',
   updatedAt:    '2026-02-02T00:00:00.000Z',
   lastOpenedAt: '2026-03-03T00:00:00.000Z',
   folderId:     '0',
   sortOrder:    5,
   sectionTitles:   ['Overview', 'Details'],
   contentText:     'first body second body',
   previewSections: [{ title: 'Overview', blocks: [{ id: 'b1', type: 'p', richText: [{ text: 'first body' }] }] }],
   docTheme:     'dark',
   docAccent:    '#abcdef',
   schemaVersion: 4,
}

describe('SCHEMA_STATEMENTS', () => {
   it('declares the four tables, an FTS5 virtual table, and a stable schema version', () => {
      const joined = SCHEMA_STATEMENTS.join('\n')
      expect(joined).toContain('CREATE TABLE IF NOT EXISTS documents')
      expect(joined).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(search_text)')
      expect(joined).toContain('CREATE TABLE IF NOT EXISTS folders')
      expect(joined).toContain('CREATE TABLE IF NOT EXISTS meta')
      expect(INDEX_SCHEMA_VERSION).toBe(1)
   })
})

describe('buildDocumentSearchText', () => {
   it('replicates the matchesText haystack: title + field label/value + section titles + contentText', () => {
      const text = buildDocumentSearchText(record)
      expect(text).toBe('release notes author florian status draft overview details first body second body')
   })

   it('handles empty meta fields, empty section titles, and empty contentText', () => {
      const empty: BinderDocumentRecord = {
         ...record,
         meta:          { title: 'Only Title', fields: [] },
         sectionTitles: [],
         contentText:   '',
      }
      // Empty field list -> empty fieldText; empty sectionTitles -> empty join; trailing empty contentText.
      // The join preserves the (now blank) slots exactly as matchesText does.
      expect(buildDocumentSearchText(empty)).toBe('only title   ')
   })

   it('tolerates a nullish contentText the same way matchesText does', () => {
      const missing = { ...record, sectionTitles: ['Overview'], contentText: undefined } as unknown as BinderDocumentRecord
      expect(buildDocumentSearchText(missing)).toBe('release notes author florian status draft overview ')
   })
})

describe('document row round-trip', () => {
   it('is lossless across every persisted field (contentText excluded by design, it lives in FTS)', () => {
      const row = documentRecordToRow(record, 'folder/release-notes.mint')
      expect(row.path).toBe('folder/release-notes.mint')
      expect(row.title).toBe('Release Notes')
      expect(row.lastOpenedAt).toBe('2026-03-03T00:00:00.000Z')

      const restored = rowToDocumentRecord(row)
      // contentText is intentionally not stored on the documents row (FTS-only); everything else survives.
      expect(restored).toEqual({ ...record, contentText: '' })
   })

   it('coerces a never-opened document lastOpenedAt through null and back to undefined', () => {
      const neverOpened: BinderDocumentRecord = { ...record, lastOpenedAt: undefined }
      const row = documentRecordToRow(neverOpened, 'a.mint')
      expect(row.lastOpenedAt).toBeNull()

      const restored = rowToDocumentRecord(row)
      expect(restored.lastOpenedAt).toBeUndefined()
      expect('lastOpenedAt' in restored).toBe(true)
   })
})

describe('folder row round-trip', () => {
   it('maps id <-> path and is lossless across every folder field', () => {
      const folder: BinderFolderRecord = {
         id:        'work/reports',
         name:      'Reports',
         parentId:  'work',
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-02T00:00:00.000Z',
         sortOrder: 2,
      }
      const row = folderRecordToRow(folder)
      expect(row.path).toBe('work/reports')
      expect(rowToFolderRecord(row)).toEqual(folder)
   })
})

describe('escapeFtsQuery', () => {
   it('quotes each token and appends a prefix star', () => {
      expect(escapeFtsQuery('release notes')).toBe('"release"* "notes"*')
   })

   it('returns empty for empty, whitespace, and all-punctuation input', () => {
      expect(escapeFtsQuery('')).toBe('')
      expect(escapeFtsQuery('   ')).toBe('')
      expect(escapeFtsQuery('*** --- (((')).toBe('')
   })

   it('neutralizes embedded double-quotes, stars, parens, and dashes without leaking FTS5 syntax', () => {
      expect(escapeFtsQuery('foo"bar')).toBe('"foobar"*')
      expect(escapeFtsQuery('foo*')).toBe('"foo*"*')
      expect(escapeFtsQuery('(foo)')).toBe('"(foo)"*')
      expect(escapeFtsQuery('-foo')).toBe('"-foo"*')
   })

   it('keeps FTS5 operator words as literal quoted terms, not operators', () => {
      expect(escapeFtsQuery('cats AND dogs')).toBe('"cats"* "AND"* "dogs"*')
   })

   it('keeps alphanumeric-bearing tokens and drops pure-punctuation ones in a mixed query', () => {
      expect(escapeFtsQuery('doc - v2')).toBe('"doc"* "v2"*')
   })
})

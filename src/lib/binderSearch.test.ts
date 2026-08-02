import { describe, it, expect } from 'vitest'
import { matchesCriteria, documentComparator } from './binderSearch'
import type { BinderDocumentRecord } from '../types'

// Binder records carry ~13 mandatory fields; this factory supplies sane defaults so each test only
// states the fields it cares about. These are binder records, NOT the DocState round-trip fixture.
function makeRecord(overrides: Partial<BinderDocumentRecord> = {}): BinderDocumentRecord {
   return {
      id:    'doc',
      meta:  { title: 'Title', fields: [{ id: 'f', label: 'Module', value: 'Module', position: 'below' }] },
      createdAt:       '2026-01-01T00:00:00.000Z',
      updatedAt:       '2026-01-01T00:00:00.000Z',
      lastOpenedAt:    undefined,
      folderId:        '0',
      sortOrder:       0,
      sectionTitles:   [],
      contentText:     '',
      previewSections: [],
      docTheme:        'light',
      docAccent:       '#000000',
      schemaVersion:   1,
      ...overrides,
   }
}

describe('matchesCriteria, free-text over title, fields, sections, content', () => {
   it('matches across title, freeform field labels + values, section titles, and content', () => {
      const record = makeRecord({
         meta: {
            title:  'Auth Guide',
            fields: [{ id: 'f', label: 'Reviewed by', value: 'Alice Smith', position: 'below' }],
         },
         sectionTitles: ['Introduction'],
         contentText: 'a special phrase',
      })
      expect(matchesCriteria(record, { text: 'auth' })).toBe(true)         // title
      expect(matchesCriteria(record, { text: 'reviewed' })).toBe(true)     // field label
      expect(matchesCriteria(record, { text: 'alice' })).toBe(true)        // field value
      expect(matchesCriteria(record, { text: 'introduction' })).toBe(true) // section title
      expect(matchesCriteria(record, { text: 'SPECIAL' })).toBe(true)      // content, case-insensitive
   })

   it('rejects a record that contains none of the needle', () => {
      expect(matchesCriteria(makeRecord(), { text: 'nonexistent' })).toBe(false)
   })
})

describe('matchesCriteria, hasNeverOpened', () => {
   it('keeps a record that was never opened', () => {
      expect(matchesCriteria(makeRecord({ lastOpenedAt: undefined }), { hasNeverOpened: true })).toBe(true)
   })

   it('rejects a record that has been opened', () => {
      const record = makeRecord({ lastOpenedAt: '2026-02-02T00:00:00.000Z' })
      expect(matchesCriteria(record, { hasNeverOpened: true })).toBe(false)
   })
})

describe('matchesCriteria, date ranges', () => {
   it('applies after (from) and before (to) bounds on the day portion', () => {
      const record = makeRecord({ updatedAt: '2026-06-15T12:00:00.000Z' })
      expect(matchesCriteria(record, { dates: { updatedAt: { from: '2026-06-01' } } })).toBe(true)
      expect(matchesCriteria(record, { dates: { updatedAt: { to: '2026-06-10' } } })).toBe(false)
      expect(matchesCriteria(record, { dates: { updatedAt: { from: '2026-06-01', to: '2026-06-30' } } })).toBe(true)
   })

   it('constrains the three date fields independently and ANDs them', () => {
      const record = makeRecord({
         createdAt:    '2026-01-10T00:00:00.000Z',
         lastOpenedAt: '2026-05-20T00:00:00.000Z',
      })
      expect(matchesCriteria(record, {
         dates: {
            createdAt:    { from: '2026-01-01', to: '2026-01-31' },
            lastOpenedAt: { from: '2026-05-01' },
         },
      })).toBe(true)
   })

   it('rejects a never-opened record under any lastOpenedAt date constraint', () => {
      const record = makeRecord({ lastOpenedAt: undefined })
      expect(matchesCriteria(record, { dates: { lastOpenedAt: { from: '2026-01-01' } } })).toBe(false)
   })

   it('rejects when one criterion in a combined object fails', () => {
      const record = makeRecord({ meta: { title: 'Match', fields: [] }, updatedAt: '2026-06-15T00:00:00.000Z' })
      // Text matches, but the updatedAt range excludes the record.
      expect(matchesCriteria(record, { text: 'match', dates: { updatedAt: { to: '2026-01-01' } } })).toBe(false)
   })
})

describe('documentComparator', () => {
   it('sorts manual by sortOrder ascending, ignoring direction', () => {
      const earlier = makeRecord({ id: 'a', sortOrder: 1 })
      const later   = makeRecord({ id: 'b', sortOrder: 2 })
      expect(documentComparator('manual', 'desc')(earlier, later)).toBeLessThan(0)
      expect(documentComparator('manual', 'asc')(earlier, later)).toBeLessThan(0)
   })

   it('sorts title ascending and descending', () => {
      const apple  = makeRecord({ meta: { title: 'Apple',  fields: [] } })
      const banana = makeRecord({ meta: { title: 'Banana', fields: [] } })
      expect(documentComparator('title', 'asc')(apple, banana)).toBeLessThan(0)
      expect(documentComparator('title', 'desc')(apple, banana)).toBeGreaterThan(0)
   })

   it('sorts updatedAt and createdAt by timestamp', () => {
      const older = makeRecord({ updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' })
      const newer = makeRecord({ updatedAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-02-01T00:00:00.000Z' })
      expect(documentComparator('updatedAt', 'asc')(older, newer)).toBeLessThan(0)
      expect(documentComparator('createdAt', 'desc')(older, newer)).toBeGreaterThan(0)
   })

   it('always sorts never-opened records last, regardless of direction', () => {
      const openedEarly = makeRecord({ id: 'early', lastOpenedAt: '2026-01-01T00:00:00.000Z' })
      const openedLate  = makeRecord({ id: 'late',  lastOpenedAt: '2026-02-01T00:00:00.000Z' })
      const neverOpened = makeRecord({ id: 'never', lastOpenedAt: undefined })

      const descending = [openedEarly, neverOpened, openedLate].sort(documentComparator('lastOpenedAt', 'desc'))
      expect(descending.map(record => record.id)).toEqual(['late', 'early', 'never'])

      const ascending = [openedLate, neverOpened, openedEarly].sort(documentComparator('lastOpenedAt', 'asc'))
      expect(ascending.map(record => record.id)).toEqual(['early', 'late', 'never'])
   })
})

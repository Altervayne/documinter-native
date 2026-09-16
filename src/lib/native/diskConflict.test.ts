import { describe, it, expect } from 'vitest'
import { classifyDiskChange } from './diskConflict'
import type { BinderDocumentRecord, SaveStatus } from '../../types'

// A minimal light record; only updatedAt is read by the classifier.
function record(updatedAt: string): BinderDocumentRecord {
   return {
      id: 'doc-1', meta: { title: 'Doc', fields: [] },
      createdAt: '', updatedAt, lastOpenedAt: undefined,
      folderId: '0', sortOrder: 0, sectionTitles: [], contentText: '',
      previewSections: [], docTheme: 'light', docAccent: '#000', schemaVersion: 4,
   }
}

function tab(documentId: string | null, syncedUpdatedAt: string | null, saveStatus: SaveStatus) {
   return { documentId, syncedUpdatedAt, saveStatus }
}

describe('classifyDiskChange', () => {
   it('a scratch tab (no binding) is never in conflict with disk', () => {
      expect(classifyDiskChange(tab(null, null, 'clean'), null)).toBe('none')
      expect(classifyDiskChange(tab(null, null, 'dirty'), record('2026-02-01T00:00:00.000Z'))).toBe('none')
   })

   it('a bound tab whose file is gone is deleted, whatever its dirty state', () => {
      expect(classifyDiskChange(tab('doc-1', '2026-01-01T00:00:00.000Z', 'clean'), null)).toBe('deleted')
      expect(classifyDiskChange(tab('doc-1', '2026-01-01T00:00:00.000Z', 'dirty'), null)).toBe('deleted')
   })

   it('an equal disk timestamp is in sync (no external change)', () => {
      const stamp = '2026-01-01T00:00:00.000Z'
      expect(classifyDiskChange(tab('doc-1', stamp, 'clean'), record(stamp))).toBe('none')
      expect(classifyDiskChange(tab('doc-1', stamp, 'dirty'), record(stamp))).toBe('none')
   })

   it('an older disk timestamp is in sync (the tab is ahead)', () => {
      expect(classifyDiskChange(
         tab('doc-1', '2026-02-01T00:00:00.000Z', 'clean'),
         record('2026-01-01T00:00:00.000Z'),
      )).toBe('none')
   })

   it('a newer disk timestamp on a clean tab reloads', () => {
      expect(classifyDiskChange(
         tab('doc-1', '2026-01-01T00:00:00.000Z', 'clean'),
         record('2026-02-01T00:00:00.000Z'),
      )).toBe('reload')
      // A faded-out "saved" tab is clean too.
      expect(classifyDiskChange(
         tab('doc-1', '2026-01-01T00:00:00.000Z', 'saved'),
         record('2026-02-01T00:00:00.000Z'),
      )).toBe('reload')
   })

   it('a newer disk timestamp on a dirty tab conflicts', () => {
      expect(classifyDiskChange(
         tab('doc-1', '2026-01-01T00:00:00.000Z', 'dirty'),
         record('2026-02-01T00:00:00.000Z'),
      )).toBe('conflict')
      // A save in flight counts as unsaved edits too.
      expect(classifyDiskChange(
         tab('doc-1', '2026-01-01T00:00:00.000Z', 'saving'),
         record('2026-02-01T00:00:00.000Z'),
      )).toBe('conflict')
   })

   it('a bound tab with no synced stamp treats a present disk record as authoritative', () => {
      expect(classifyDiskChange(tab('doc-1', null, 'clean'), record('2026-01-01T00:00:00.000Z'))).toBe('reload')
      expect(classifyDiskChange(tab('doc-1', null, 'dirty'), record('2026-01-01T00:00:00.000Z'))).toBe('conflict')
   })
})

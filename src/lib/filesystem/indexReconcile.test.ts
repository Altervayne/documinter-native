import { describe, it, expect } from 'vitest'
import {
   reconcileDocuments, planFolderDeletes, nextSortOrder,
   type ExistingDocumentRow, type ScannedDocument,
} from './indexReconcile'

// ====
// nextSortOrder
// ====

describe('nextSortOrder', () => {
   it('is 0 for an empty folder and one past the max otherwise', () => {
      expect(nextSortOrder([])).toBe(0)
      expect(nextSortOrder([0, 1, 2])).toBe(3)
      expect(nextSortOrder([5, 2, 4])).toBe(6)
   })
})

// ====
// reconcileDocuments
// ====

describe('reconcileDocuments', () => {
   it('mints an id for a brand-new file that carries none', () => {
      const existing: ExistingDocumentRow[] = []
      const scanned: ScannedDocument[] = [{ idInFile: null, path: 'notes.mint', folderId: '0', lastOpenedAt: undefined }]

      const plan = reconcileDocuments(existing, scanned)

      expect(plan.reId).toEqual([{ idInFile: null, path: 'notes.mint', folderId: '0', lastOpenedAt: undefined }])
      expect(plan.deleteIds).toEqual([])
      // Its upsert entry carries a null idHint (backend mints), appended at 0 in root.
      expect(plan.upsert).toEqual([{ path: 'notes.mint', folderId: '0', sortOrder: 0, lastOpenedAt: undefined, idHint: null }])
   })

   it('preserves the sortOrder of an already-indexed, unchanged file', () => {
      const existing: ExistingDocumentRow[] = [{ id: 'X', path: 'notes.mint', folderId: '0', sortOrder: 5, lastOpenedAt: undefined }]
      const scanned: ScannedDocument[] = [{ idInFile: 'X', path: 'notes.mint', folderId: '0', lastOpenedAt: undefined }]

      const plan = reconcileDocuments(existing, scanned)

      expect(plan.reId).toEqual([])
      expect(plan.deleteIds).toEqual([])
      expect(plan.upsert).toEqual([{ path: 'notes.mint', folderId: '0', sortOrder: 5, lastOpenedAt: undefined, idHint: 'X' }])
   })

   it('follows a moved file to its new path and folder while keeping its id and sortOrder', () => {
      const existing: ExistingDocumentRow[] = [{ id: 'X', path: 'notes.mint', folderId: '0', sortOrder: 3, lastOpenedAt: undefined }]
      const scanned: ScannedDocument[] = [{ idInFile: 'X', path: 'work/notes.mint', folderId: 'work', lastOpenedAt: undefined }]

      const plan = reconcileDocuments(existing, scanned)

      expect(plan.reId).toEqual([])
      // X still exists on disk, so its index row is not stale.
      expect(plan.deleteIds).toEqual([])
      // Same id, new path + folder, original sortOrder reused (id was already indexed).
      expect(plan.upsert).toEqual([{ path: 'work/notes.mint', folderId: 'work', sortOrder: 3, lastOpenedAt: undefined, idHint: 'X' }])
   })

   it('deletes an index row whose file is gone from disk', () => {
      const existing: ExistingDocumentRow[] = [{ id: 'X', path: 'notes.mint', folderId: '0', sortOrder: 0, lastOpenedAt: undefined }]
      const scanned: ScannedDocument[] = []

      const plan = reconcileDocuments(existing, scanned)

      expect(plan.reId).toEqual([])
      expect(plan.upsert).toEqual([])
      expect(plan.deleteIds).toEqual(['X'])
   })

   it('re-ids every copy of a shared id but the first, keeping the first', () => {
      // Two files carry the same id X (a copied .mint), neither indexed yet (fresh Binder).
      const existing: ExistingDocumentRow[] = []
      const scanned: ScannedDocument[] = [
         { idInFile: 'X', path: 'copy.mint', folderId: '0', lastOpenedAt: undefined },
         { idInFile: 'X', path: 'alpha.mint', folderId: '0', lastOpenedAt: undefined },
      ]

      const plan = reconcileDocuments(existing, scanned)

      // Path order puts alpha.mint first, so it keeps X; copy.mint is re-id'd.
      expect(plan.reId).toEqual([{ idInFile: 'X', path: 'copy.mint', folderId: '0', lastOpenedAt: undefined }])
      expect(plan.deleteIds).toEqual([])
      expect(plan.upsert).toEqual([
         { path: 'alpha.mint', folderId: '0', sortOrder: 0, lastOpenedAt: undefined, idHint: 'X' },
         { path: 'copy.mint',  folderId: '0', sortOrder: 1, lastOpenedAt: undefined, idHint: null },
      ])
   })

   it('lets the already-indexed original keep the id when a copy shares it', () => {
      // notes.mint is the indexed original at X; someone copied it to aaa-copy.mint (also X).
      const existing: ExistingDocumentRow[] = [{ id: 'X', path: 'notes.mint', folderId: '0', sortOrder: 2, lastOpenedAt: undefined }]
      const scanned: ScannedDocument[] = [
         { idInFile: 'X', path: 'aaa-copy.mint', folderId: '0', lastOpenedAt: undefined },
         { idInFile: 'X', path: 'notes.mint', folderId: '0', lastOpenedAt: undefined },
      ]

      const plan = reconcileDocuments(existing, scanned)

      // Despite aaa-copy.mint sorting first, the indexed original (notes.mint) keeps X.
      expect(plan.reId).toEqual([{ idInFile: 'X', path: 'aaa-copy.mint', folderId: '0', lastOpenedAt: undefined }])
      expect(plan.deleteIds).toEqual([])
      expect(plan.upsert).toEqual([
         { path: 'aaa-copy.mint', folderId: '0', sortOrder: 3, lastOpenedAt: undefined, idHint: null },
         { path: 'notes.mint',    folderId: '0', sortOrder: 2, lastOpenedAt: undefined, idHint: 'X' },
      ])
   })

   it('appends new files after the folder max, one distinct slot each', () => {
      const existing: ExistingDocumentRow[] = [{ id: 'X', path: 'a.mint', folderId: '0', sortOrder: 4, lastOpenedAt: undefined }]
      const scanned: ScannedDocument[] = [
         { idInFile: 'X', path: 'a.mint', folderId: '0', lastOpenedAt: undefined },
         { idInFile: null, path: 'b.mint', folderId: '0', lastOpenedAt: undefined },
         { idInFile: null, path: 'c.mint', folderId: '0', lastOpenedAt: undefined },
      ]

      const plan = reconcileDocuments(existing, scanned)

      expect(plan.upsert).toEqual([
         { path: 'a.mint', folderId: '0', sortOrder: 4, lastOpenedAt: undefined, idHint: 'X' },
         { path: 'b.mint', folderId: '0', sortOrder: 5, lastOpenedAt: undefined, idHint: null },
         { path: 'c.mint', folderId: '0', sortOrder: 6, lastOpenedAt: undefined, idHint: null },
      ])
      expect(plan.reId.map(file => file.path)).toEqual(['b.mint', 'c.mint'])
   })

   // ====
   // lastOpenedAt preservation (FIX 2): the per-machine open stamp lives in the index, never in the file,
   // so reconcile must carry the existing row's value across an open instead of resetting it from disk.
   // ====

   it('preserves the index row lastOpenedAt for an already-indexed file even when the file carries none', () => {
      // loadDocument stamped lastOpenedAt into the index only; the .mint on disk still has none.
      const existing: ExistingDocumentRow[] = [
         { id: 'X', path: 'notes.mint', folderId: '0', sortOrder: 0, lastOpenedAt: '2026-09-14T10:00:00.000Z' },
      ]
      const scanned: ScannedDocument[] = [{ idInFile: 'X', path: 'notes.mint', folderId: '0', lastOpenedAt: undefined }]

      const plan = reconcileDocuments(existing, scanned)

      // The touch survives: the plan emits the preserved index value, not the file's (absent) one.
      expect(plan.upsert).toEqual([
         { path: 'notes.mint', folderId: '0', sortOrder: 0, lastOpenedAt: '2026-09-14T10:00:00.000Z', idHint: 'X' },
      ])
   })

   it('takes the file lastOpenedAt for a brand-new (first-seen) id', () => {
      // A file dropped in by Explorer that already carries a lastOpenedAt: no index row yet, so the file
      // is the only source. A file with none yields undefined.
      const existing: ExistingDocumentRow[] = []
      const scanned: ScannedDocument[] = [
         { idInFile: 'X', path: 'seen.mint', folderId: '0', lastOpenedAt: '2026-01-02T03:04:05.000Z' },
         { idInFile: null, path: 'fresh.mint', folderId: '0', lastOpenedAt: undefined },
      ]

      const plan = reconcileDocuments(existing, scanned)

      expect(plan.upsert).toEqual([
         { path: 'fresh.mint', folderId: '0', sortOrder: 0, lastOpenedAt: undefined, idHint: null },
         { path: 'seen.mint',  folderId: '0', sortOrder: 1, lastOpenedAt: '2026-01-02T03:04:05.000Z', idHint: 'X' },
      ])
   })
})

// ====
// planFolderDeletes
// ====

describe('planFolderDeletes', () => {
   it('returns only the index folders no longer on disk', () => {
      expect(planFolderDeletes(['work', 'work/old', 'refs'], ['work', 'refs'])).toEqual(['work/old'])
      expect(planFolderDeletes([], ['work'])).toEqual([])
      expect(planFolderDeletes(['gone'], [])).toEqual(['gone'])
   })
})

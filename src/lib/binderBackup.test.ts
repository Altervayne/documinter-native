import { describe, it, expect } from 'vitest'
import { remapTinForMerge } from './binderBackup'
import { TIN_SCHEMA_VERSION, type TinFile } from './tinFile'

// A sequential id generator so the remap is deterministic: folder ids become 'new-1', 'new-2', ...
// in the order remapTinForMerge visits tin.folders.
function sequentialIds(): () => string {
   let counter = 0
   return () => `new-${++counter}`
}

// A binder-shaped Tin: root-level folder 'a' with a child 'b', a root-level document, a document in
// 'a', and a document in 'b'. Root parent / folder is the sentinel '0'.
function makeBinderTin(): TinFile {
   return {
      documinterTin: true,
      schemaVersion: TIN_SCHEMA_VERSION,
      exportedAt:    '2026-08-11T00:00:00.000Z',
      templates:     [],
      folders: [
         { id: 'a', name: 'Alpha', parentId: '0', sortOrder: 0, createdAt: 't', updatedAt: 't' },
         { id: 'b', name: 'Beta',  parentId: 'a', sortOrder: 0, createdAt: 't', updatedAt: 't' },
      ],
      documents: [
         makeDocument('doc-root', '0', 3),
         makeDocument('doc-a',    'a', 0),
         makeDocument('doc-b',    'b', 0),
      ],
   }
}

function makeDocument(id: string, folderId: string, sortOrder: number): TinFile['documents'][number] {
   return {
      id, folderId, sortOrder,
      meta: { title: id, fields: [] },
      createdAt: 't', updatedAt: 't',
      docTheme: 'light', docAccent: '#2dcea8',
      sections: [],
   }
}

describe('remapTinForMerge', () => {
   it('mints a fresh id for every folder', () => {
      const { folders } = remapTinForMerge(makeBinderTin(), '0', 0, sequentialIds())
      expect(folders.map(folder => folder.id)).toEqual(['new-1', 'new-2'])
   })

   it('keeps parent pointers internally consistent (a child still points at its remapped parent)', () => {
      const { folders } = remapTinForMerge(makeBinderTin(), 'target', 0, sequentialIds())
      const alpha = folders.find(folder => folder.name === 'Alpha')!
      const beta  = folders.find(folder => folder.name === 'Beta')!
      expect(alpha.id).toBe('new-1')
      expect(beta.parentId).toBe(alpha.id)
   })

   it('maps the root sentinel to the target: top-level folders re-home under it', () => {
      const { folders } = remapTinForMerge(makeBinderTin(), 'target', 0, sequentialIds())
      const alpha = folders.find(folder => folder.name === 'Alpha')!
      expect(alpha.parentId).toBe('target')
   })

   it('re-homes root-level documents under the target and rewrites nested document folderId', () => {
      const { folders, documents } = remapTinForMerge(makeBinderTin(), 'target', 0, sequentialIds())
      const alpha  = folders.find(folder => folder.name === 'Alpha')!
      const beta   = folders.find(folder => folder.name === 'Beta')!
      const atRoot = documents.find(document => document.id === 'doc-root')!
      const inAlpha = documents.find(document => document.id === 'doc-a')!
      const inBeta  = documents.find(document => document.id === 'doc-b')!
      expect(atRoot.folderId).toBe('target')
      expect(inAlpha.folderId).toBe(alpha.id)
      expect(inBeta.folderId).toBe(beta.id)
   })

   it('offsets sortOrder for top-level records only, never nested ones', () => {
      const { folders, documents } = remapTinForMerge(makeBinderTin(), 'target', 10, sequentialIds())
      const alpha = folders.find(folder => folder.name === 'Alpha')!
      const beta  = folders.find(folder => folder.name === 'Beta')!
      const atRoot  = documents.find(document => document.id === 'doc-root')!
      const inAlpha = documents.find(document => document.id === 'doc-a')!
      const inBeta  = documents.find(document => document.id === 'doc-b')!
      // Top-level: folder Alpha (0 -> 10) and doc-root (3 -> 13) both re-home under the target.
      expect(alpha.sortOrder).toBe(10)
      expect(atRoot.sortOrder).toBe(13)
      // Nested: Beta under Alpha, doc-a under Alpha, doc-b under Beta keep their original order.
      expect(beta.sortOrder).toBe(0)
      expect(inAlpha.sortOrder).toBe(0)
      expect(inBeta.sortOrder).toBe(0)
   })

   it('does not mutate document ids (freshness is a write-layer concern)', () => {
      const { documents } = remapTinForMerge(makeBinderTin(), 'target', 0, sequentialIds())
      expect(documents.map(document => document.id).sort()).toEqual(['doc-a', 'doc-b', 'doc-root'])
   })

   it('re-homes a subtree export under the target: the subtree root parent leaves the bundle', () => {
      // A subtree Tin: root folder 'sub' whose parent 'outside' is NOT in the bundle, with a child.
      const subtree: TinFile = {
         documinterTin: true,
         schemaVersion: TIN_SCHEMA_VERSION,
         exportedAt:    '2026-08-11T00:00:00.000Z',
         templates:     [],
         folders: [
            { id: 'sub',   name: 'Sub',   parentId: 'outside', sortOrder: 5, createdAt: 't', updatedAt: 't' },
            { id: 'child', name: 'Child', parentId: 'sub',     sortOrder: 0, createdAt: 't', updatedAt: 't' },
         ],
         documents: [makeDocument('doc-sub', 'sub', 0)],
      }
      const { folders, documents } = remapTinForMerge(subtree, 'here', 2, sequentialIds())
      const sub   = folders.find(folder => folder.name === 'Sub')!
      const child = folders.find(folder => folder.name === 'Child')!
      // The subtree root re-homes under the target (its outside parent is treated as top-level).
      expect(sub.parentId).toBe('here')
      expect(sub.sortOrder).toBe(7)            // 5 + offset 2, it is top-level of the graft
      // The child stays under its remapped parent, unshifted.
      expect(child.parentId).toBe(sub.id)
      expect(child.sortOrder).toBe(0)
      // The document stays filed under the remapped subtree root.
      expect(documents[0].folderId).toBe(sub.id)
   })

   it('is deterministic given an injected id generator', () => {
      const first  = remapTinForMerge(makeBinderTin(), 'target', 0, sequentialIds())
      const second = remapTinForMerge(makeBinderTin(), 'target', 0, sequentialIds())
      expect(first).toEqual(second)
   })
})

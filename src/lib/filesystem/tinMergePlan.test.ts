import { describe, it, expect } from 'vitest'
import { planTinMerge } from './tinMergePlan'
import { ROOT_FOLDER_ID } from '../binderDatabase'
import type { TinFolder, TinDocument } from '../tinFile'
import type { DocMeta } from '../../types'

const meta: DocMeta = { title: 'Doc', fields: [] }

function folder(id: string, name: string, parentId: string, sortOrder = 0): TinFolder {
   return { id, name, parentId, sortOrder, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
}

function document(id: string, folderId: string, sortOrder = 0): TinDocument {
   return {
      id, meta, folderId, sortOrder,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      docTheme: 'light', docAccent: '#2dcea8', sections: [],
   }
}

describe('planTinMerge, whole-tree rebuild at the root (replace)', () => {
   // An IndexedDB-style export: folder ids are opaque UUIDs, resolved to path ids by name.
   const folders = [
      folder('fa', 'Work', ROOT_FOLDER_ID),
      folder('fb', '2026', 'fa'),
      folder('fc', 'Personal', ROOT_FOLDER_ID),
   ]
   const documents = [
      document('d1', 'fa'),
      document('d2', 'fb'),
      document('d3', ROOT_FOLDER_ID),
   ]

   it('turns each folder into its name-based path id under the root', () => {
      const plan = planTinMerge({ folders, documents }, ROOT_FOLDER_ID)
      const byName = new Map(plan.folders.map(entry => [entry.name, entry]))
      expect(byName.get('Work')!.pathId).toBe('Work')
      expect(byName.get('Work')!.parentPathId).toBe(ROOT_FOLDER_ID)
      expect(byName.get('2026')!.pathId).toBe('Work/2026')
      expect(byName.get('2026')!.parentPathId).toBe('Work')
      expect(byName.get('Personal')!.pathId).toBe('Personal')
   })

   it('lands documents in the resolved folder path id, root documents at the target', () => {
      const plan = planTinMerge({ folders, documents }, ROOT_FOLDER_ID)
      const folderById = new Map(plan.documents.map(entry => [entry.document.id, entry.folderPathId]))
      expect(folderById.get('d1')).toBe('Work')
      expect(folderById.get('d2')).toBe('Work/2026')
      expect(folderById.get('d3')).toBe(ROOT_FOLDER_ID)
   })

   it('orders folders parent-before-child so mkdir can run top-down', () => {
      const plan = planTinMerge({ folders, documents }, ROOT_FOLDER_ID)
      const workIndex = plan.folders.findIndex(entry => entry.pathId === 'Work')
      const childIndex = plan.folders.findIndex(entry => entry.pathId === 'Work/2026')
      expect(workIndex).toBeGreaterThanOrEqual(0)
      expect(childIndex).toBeGreaterThan(workIndex)
   })

   it('carries sortOrder and timestamps through unchanged', () => {
      const plan = planTinMerge({ folders: [folder('fa', 'Work', ROOT_FOLDER_ID, 7)], documents: [] }, ROOT_FOLDER_ID)
      expect(plan.folders[0].sortOrder).toBe(7)
      expect(plan.folders[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
   })
})

describe('planTinMerge, graft under an existing folder (merge)', () => {
   // A remapTinForMerge-style input: top-level items already point at the target folder's path id.
   const target = 'Existing'
   const folders = [
      folder('g1', 'Imported', target),
      folder('g2', 'Sub', 'g1'),
   ]
   const documents = [document('d', 'g1')]

   it('re-homes the graft under the target folder path', () => {
      const plan = planTinMerge({ folders, documents }, target)
      const byName = new Map(plan.folders.map(entry => [entry.name, entry]))
      expect(byName.get('Imported')!.pathId).toBe('Existing/Imported')
      expect(byName.get('Imported')!.parentPathId).toBe('Existing')
      expect(byName.get('Sub')!.pathId).toBe('Existing/Imported/Sub')
      expect(plan.documents[0].folderPathId).toBe('Existing/Imported')
   })
})

describe('planTinMerge, defensive fallbacks', () => {
   it('drops folders unreachable from the target and sends their documents to the target', () => {
      // 'ghost' is never a folder in the bundle, so a document pointing at it cannot resolve.
      const plan = planTinMerge({ folders: [], documents: [document('d', 'ghost')] }, ROOT_FOLDER_ID)
      expect(plan.folders).toHaveLength(0)
      expect(plan.documents[0].folderPathId).toBe(ROOT_FOLDER_ID)
   })

   it('returns an empty plan for an empty bundle', () => {
      const plan = planTinMerge({ folders: [], documents: [] }, ROOT_FOLDER_ID)
      expect(plan.folders).toHaveLength(0)
      expect(plan.documents).toHaveLength(0)
   })
})

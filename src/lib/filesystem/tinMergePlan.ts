/**
 * tinMergePlan.ts, the PURE "Tin folder graph -> filesystem paths" planner.
 *
 * A Tin carries folders as an abstract graph: each folder has an id and a parentId, and those ids may be
 * anything (UUIDs from an IndexedDB export, relative paths from a filesystem export, or the fresh UUIDs
 * remapTinForMerge mints for a merge). The filesystem backend cannot store that directly: on disk a
 * folder's id IS its relative path, built from its parent's path plus its own name. This module walks the
 * graph down from a real target path id and resolves every folder to its concrete path id (mkdir target),
 * and every document to the path id of the folder it lands in.
 *
 * Both import modes feed this the SAME way. Merge passes the output of remapTinForMerge (fresh ids +
 * folders re-homed under the drop target) with the target's path id. Replace passes the raw Tin folders /
 * documents with ROOT_FOLDER_ID as the target, rebuilding the whole tree at the Binder root. The write
 * layer (filesystemBackend) picks the document id policy: a fresh UUID for merge, the Tin's own id for a
 * verbatim replace. That id choice is a write concern, so it is deliberately NOT made here.
 *
 * Pure: no plugin-fs, no plugin-sql, no crypto. Folders come back in parent-before-child order (a
 * breadth-first walk from the target), so the write layer can mkdir them top-down as given.
 */

import { folderIdForRelativePath, relativeDirForFolderId, joinRelative } from './binderPaths'
import type { TinFolder, TinDocument } from '../tinFile'

/** One folder resolved to its on-disk identity: the path id to mkdir + index, its parent's path id, and
 *  the sortOrder / timestamps carried through from the Tin (a directory holds no such metadata itself). */
export interface PlannedTinFolder {
   pathId:       string
   name:         string
   parentPathId: string
   sortOrder:    number
   createdAt:    string
   updatedAt:    string
}

/** One document paired with the path id of the folder it belongs in (its file name + id are the write
 *  layer's to pick). The TinDocument body rides through untouched. */
export interface PlannedTinDocument {
   document:     TinDocument
   folderPathId: string
}

/** The write plan: folders in mkdir order (parents first) plus each document's destination folder. */
export interface TinMergePlan {
   folders:   PlannedTinFolder[]
   documents: PlannedTinDocument[]
}

/**
 * Resolve a Tin's folder graph to concrete filesystem path ids under `targetPathId` (an existing folder's
 * path id, or ROOT_FOLDER_ID for a whole-tree rebuild). Breadth-first from the target so a parent's path
 * is known before its children resolve against it; a folder whose parentId does not reach the target (a
 * malformed graph with a cycle or a dangling parent) is simply not reached, and any document under it
 * falls back to the target, so a broken Tin still imports without throwing.
 */
export function planTinMerge(
   input: { folders: TinFolder[]; documents: TinDocument[] },
   targetPathId: string,
): TinMergePlan {
   // Group folders by their (graph) parentId so the walk can pull a parent's children in one step.
   const childrenByParent = new Map<string, TinFolder[]>()
   for (const folder of input.folders) {
      const siblings = childrenByParent.get(folder.parentId) ?? []
      siblings.push(folder)
      childrenByParent.set(folder.parentId, siblings)
   }

   // Map each graph id to the real path id it resolves to; seed the target as its own path id.
   const pathIdByGraphId = new Map<string, string>()
   pathIdByGraphId.set(targetPathId, targetPathId)

   const folders: PlannedTinFolder[] = []
   const queue = [targetPathId]
   for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const parentGraphId = queue[queueIndex]
      const parentPathId  = pathIdByGraphId.get(parentGraphId) as string   // set before every enqueue
      for (const folder of childrenByParent.get(parentGraphId) ?? []) {
         const relativePath = joinRelative(relativeDirForFolderId(parentPathId), folder.name)
         const pathId = folderIdForRelativePath(relativePath)
         folders.push({
            pathId,
            name:         folder.name,
            parentPathId,
            sortOrder:    folder.sortOrder,
            createdAt:    folder.createdAt,
            updatedAt:    folder.updatedAt,
         })
         pathIdByGraphId.set(folder.id, pathId)
         queue.push(folder.id)
      }
   }

   const documents: PlannedTinDocument[] = input.documents.map(document => ({
      document,
      folderPathId: pathIdByGraphId.get(document.folderId) ?? targetPathId,
   }))

   return { folders, documents }
}

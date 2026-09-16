// ###############################################################################################
// # TIN MAPPING                                                                                 #
// #                                                                                             #
// # Pure record <-> Tin shape mapping plus the merge remap, shared by every backend so an        #
// # exported `.tin` is byte-identical whatever wrote it. No storage access lives here; the       #
// # backends own the read / write around these transforms.                                       #
// ###############################################################################################

// -- Lib Imports --
import { isDefaultFormat } from './format'
import { ROOT_FOLDER_ID } from './binderConstants'

// -- Type Imports --
import type { LoadedDocument } from './documentRecord'
import type { TemplateChrome } from './documentTemplate'
import type { TinFile, TinFolder, TinDocument, TinTemplate } from './tinFile'
import type { BinderDocumentRecord, BinderFolderRecord } from '../types'

/** How many records of each kind an import wrote, for the caller's confirmation message. */
export interface TinImportSummary {
   templates: number
   folders:   number
   documents: number
}

/** Mints ids for the merge remap. Injected in tests as a sequential counter; defaults to UUIDs. */
export type TinIdFactory = () => string

// ###################
// # RECORD MAPPING  #
// ###################

/** Fields picked explicitly to drop stray props, so the Tin folder shape stays canonical. */
export function toTinFolder(folder: BinderFolderRecord): TinFolder {
   return {
      id:        folder.id,
      name:      folder.name,
      parentId:  folder.parentId,
      sortOrder: folder.sortOrder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
   }
}

/** Light placement + heavy body -> TinDocument. Drops a default format so a document that never
 *  touched Page Setup stays byte-clean. */
export function toTinDocument(record: BinderDocumentRecord, loaded: LoadedDocument): TinDocument {
   return {
      id:        record.id,
      meta:      loaded.meta,
      folderId:  record.folderId,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      docTheme:  loaded.docTheme,
      docAccent: loaded.docAccent,
      sections:  loaded.sections,
      ...(loaded.presentation ? { presentation: loaded.presentation } : {}),
      ...(loaded.format && !isDefaultFormat(loaded.format) ? { format: loaded.format } : {}),
   }
}

/** Built-ins are code, never exported; a user template maps to this chrome-only Tin shape. */
export function toTinTemplate(template: { name: string } & TemplateChrome): TinTemplate {
   return {
      name:      template.name,
      meta:      template.meta,
      docTheme:  template.docTheme,
      docAccent: template.docAccent,
      ...(template.presentation ? { presentation: template.presentation } : {}),
      ...(template.format       ? { format: template.format }             : {}),
   }
}

// ###################
// # MERGE REMAP     #
// ###################

/**
 * Re-id a Tin for a non-destructive graft under `targetFolderId`. Pure and deterministic given
 * `makeId`. Every folder gets a fresh id; an id map carries each old folder id to its new one, plus
 * the root sentinel '0' to `targetFolderId`. Pointers resolve through the map with a fallback to the
 * target, so a parentId pointing OUTSIDE the bundle (a subtree export's root) re-homes under it.
 * A record landing at the target is top-level, so its sortOrder is offset to land after existing
 * content instead of interleaving. Document ids are untouched here; importTin mints them at write.
 */
export function remapTinForMerge(
   tin: TinFile,
   targetFolderId: string,
   sortOrderOffset: number,
   makeId: TinIdFactory = () => crypto.randomUUID(),
): { folders: TinFolder[]; documents: TinDocument[] } {
   const idMap = new Map<string, string>()
   idMap.set(ROOT_FOLDER_ID, targetFolderId)
   for (const folder of tin.folders) idMap.set(folder.id, makeId())

   const resolveParent = (parentId: string): string => idMap.get(parentId) ?? targetFolderId

   const folders: TinFolder[] = tin.folders.map(folder => {
      const parentId = resolveParent(folder.parentId)
      return {
         ...folder,
         id:        idMap.get(folder.id)!,
         parentId,
         sortOrder: parentId === targetFolderId ? folder.sortOrder + sortOrderOffset : folder.sortOrder,
      }
   })

   const documents: TinDocument[] = tin.documents.map(document => {
      const folderId = resolveParent(document.folderId)
      return {
         ...document,
         folderId,
         sortOrder: folderId === targetFolderId ? document.sortOrder + sortOrderOffset : document.sortOrder,
      }
   })

   return { folders, documents }
}

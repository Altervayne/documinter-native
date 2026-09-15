/**
 * filesystemBackend.ts, the native (Tauri) BinderBackend over a real Binder working folder.
 *
 * Files are the truth: every document is a self-contained `.mint` under the Binder root, every folder is a
 * real directory (its relative path IS its id, see binderPaths), and `.documinter/index.sqlite` is a
 * rebuildable list/search/sort cache the DocumentIndex owns. On open the backend reconciles the index to
 * the files (adopting anything Explorer added, following moves, re-id'ing copies, dropping stale rows), so
 * the index always mirrors the disk without a blind clear-and-rebuild (manual sort survives).
 *
 * This is native-only I/O (plugin-fs + plugin-sql), so it cannot run under vitest; the tested safety net is
 * the pure reconcile planner (indexReconcile.ts) plus the pure envelope/path helpers. Everything that can
 * be pure was pushed into those modules; this file is the thin I/O shell that drives them.
 *
 * TEMPLATES and Tin (bulk) methods are STUBBED here and filled in arc A1.3c. backfillSearchText no-ops (the
 * FS index is built fresh, always current), subscribe is inert until the arc-B watcher, dispose closes the
 * index.
 */

import {
   mkdir, readDir, readTextFile, writeTextFile, remove, rename, exists, watch,
   type WatchEvent,
} from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'

import { DocumentIndex } from './documentIndex'
import { serializeMint, parseMint, buildMintFile, type ParsedMint, type MintFile } from './mintFile'
import { serializeTemplateFile, parseTemplateFile } from './templateFile'
import { planTinMerge } from './tinMergePlan'
import {
   reconcileDocuments, nextSortOrder,
   type ExistingDocumentRow, type ScannedDocument,
} from './indexReconcile'
import {
   DOCUMINTER_DIR, TEMPLATES_DIR, INDEX_FILE, MINT_EXTENSION, MINTPLATE_EXTENSION,
   isSystemFolderName, folderIdForRelativePath, relativeDirForFolderId,
   parentFolderId, folderName, joinRelative, relativePathForDocument,
   sanitizeForFilename, mintFileName, nextAvailableTitle, mintplateFileName,
   dedupeFolderName,
} from './binderPaths'
import { buildDocumentRecord, cloneSectionsWithFreshIds, assembleLoadedDocument } from '../documentRecord'
import { migrateMeta } from '../documentMigration'
import { matchesCriteria, documentComparator } from '../binderSearch'
import { captureTemplate } from '../documentTemplate'
import { remapTinForMerge, toTinFolder, toTinDocument, toTinTemplate } from '../binderBackup'
import { TIN_SCHEMA_VERSION } from '../tinFile'
import { ROOT_FOLDER_ID } from '../binderDatabase'

import type { BinderBackend, BinderChange } from '../binderBackend'
import type { DocState, BinderDocumentRecord, BinderFolderRecord } from '../../types'
import type { DocPresentation, LoadedDocument } from '../binderDocuments'
import type { DocumentListFilter } from '../binderSearch'
import type { DocumentTemplate } from '../documentTemplate'
import type { TinImportSummary } from '../binderBackup'
import type { TinFile, TinDocument } from '../tinFile'

/**
 * A rename was rejected because the new title's sanitized stem is already taken by a SIBLING document in
 * the same folder. Thrown by saveDocument's update path (never the create paths, which bump silently) so
 * the UI can catch it by instanceof and revert the title field with a "name already taken" message.
 */
export class NameTakenError extends Error {
   constructor(message = 'A document with this name already exists in this folder') {
      super(message)
      this.name = 'NameTakenError'
   }
}

/**
 * Open (or create) the filesystem backend rooted at an absolute Binder path. Creates `.documinter/`, opens
 * the index inside it, reconciles the index to the files, then returns the ready backend.
 */
export async function createFilesystemBackend(binderRoot: string): Promise<BinderBackend> {
   // Absolute-path helper. All internal paths are POSIX (forward slashes, see binderPaths); we normalize
   // the root's separators to match and join with '/'. Rust's std::fs accepts forward slashes on Windows,
   // so the OS side is fine (the user confirms this at `tauri dev`). If plugin-fs ever needs OS separators
   // instead, it is a one-line change localized to this function.
   const rootPosix = binderRoot.replace(/\\/g, '/').replace(/\/+$/, '')
   const absolutePath = (relativePosix: string): string => {
      const clean = relativePosix.replace(/^\/+/, '')
      return clean === '' ? rootPosix : `${rootPosix}/${clean}`
   }

   // The Binder root must already exist (create is the caller's job, via the Rust create command). Guard
   // it before the recursive mkdir below, which would otherwise resurrect a folder deleted since it was
   // last opened, masking the missing-folder fallback on launch-restore.
   if (!(await exists(rootPosix))) throw new Error(`Binder folder not found: ${binderRoot}`)

   await mkdir(absolutePath(DOCUMINTER_DIR), { recursive: true })
   // Hide the cache folder on Windows (dot-prefix already hides it elsewhere). Fire-and-forget: a failure
   // just leaves it visible, it does not block opening the Binder.
   void invoke('set_path_hidden', { path: absolutePath(DOCUMINTER_DIR) }).catch(() => {})
   const index = await DocumentIndex.open(absolutePath(joinRelative(DOCUMINTER_DIR, INDEX_FILE)))

   // ====
   // Shared helpers
   // ====

   /** The last path segment of a relative posix path (a `.mint` file name). */
   const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

   /** The entry names already present at an ABSOLUTE directory. Missing directory reads as empty. */
   const takenNamesAt = async (absoluteDir: string): Promise<Set<string>> => {
      try {
         const entries = await readDir(absoluteDir)
         return new Set(entries.map(entry => entry.name))
      } catch {
         return new Set()
      }
   }

   /** The sanitized `.mint` stems already present at an ABSOLUTE directory: each basename minus the
    *  extension IS a sanitized stem, by the filename-policy invariant (stem === sanitizeForFilename(title)),
    *  so the on-disk names are the source of truth for what a new/renamed title must clear. One stem may be
    *  excluded (a rename excludes the document's own current file). Missing directory reads as empty. */
   const takenStemsAt = async (absoluteDir: string, excludeStem?: string): Promise<Set<string>> => {
      const names = await takenNamesAt(absoluteDir)
      const stems = new Set<string>()
      const excludeLower = excludeStem?.toLowerCase()
      for (const name of names) {
         if (!name.endsWith(MINT_EXTENSION)) continue
         const stem = name.slice(0, -MINT_EXTENSION.length)
         if (excludeLower !== undefined && stem.toLowerCase() === excludeLower) continue
         stems.add(stem)
      }
      return stems
   }

   /** The sanitized `.mint` stems present in a Binder-relative directory (see takenStemsAt). */
   const takenStems = (relativeDir: string, excludeStem?: string): Promise<Set<string>> =>
      takenStemsAt(absolutePath(relativeDir), excludeStem)

   /** The `.mint` stem of a relative document path (its basename minus the extension), the on-disk half
    *  of the filename-policy invariant. */
   const stemOfPath = (path: string): string => {
      const name = baseName(path)
      return name.endsWith(MINT_EXTENSION) ? name.slice(0, -MINT_EXTENSION.length) : name
   }

   /** Rewrite a relocated document's file so its stored title matches a uniqueness bump, keeping identity,
    *  timestamps, theme, accent, presentation and format. Used by move / orphan-reflow when a collision in
    *  the destination bumps the title, so the invariant stem === sanitizeForFilename(title) holds on disk
    *  before the index is rebuilt from the file. */
   const rewriteDocumentTitle = async (path: string, existing: BinderDocumentRecord, title: string): Promise<void> => {
      const parsed = parseMint(await readTextFile(absolutePath(path)))
      if (!parsed) return
      const mint = buildMintFile({
         id:           existing.id,
         meta:         { ...migrateMeta(parsed.loaded.meta), title },
         sections:     parsed.loaded.sections,
         docTheme:     parsed.loaded.docTheme,
         docAccent:    parsed.loaded.docAccent,
         presentation: parsed.loaded.presentation,
         format:       parsed.loaded.format,
         createdAt:    existing.createdAt,
         updatedAt:    existing.updatedAt,
         lastOpenedAt: existing.lastOpenedAt,
      })
      await writeTextFile(absolutePath(path), serializeMint(mint))
   }

   /** The next append sortOrder in a folder, optionally excluding one document (a same-folder move). */
   const appendDocumentSort = async (folderId: string, excludeId?: string): Promise<number> => {
      const siblings = await index.queryDocuments({ folderId })
      return nextSortOrder(siblings.filter(sibling => sibling.id !== excludeId).map(sibling => sibling.sortOrder))
   }

   /** The next append sortOrder among a folder's child folders. */
   const appendFolderSort = async (parentId: string): Promise<number> => {
      const children = await index.getFolderChildren(parentId)
      return nextSortOrder(children.map(child => child.sortOrder))
   }

   /**
    * Re-index a document at a (possibly new) path/folder/sortOrder by reading its file. Reading the full
    * body is deliberate: the index's own light records carry an EMPTY contentText (search text lives only
    * in the FTS table), so rebuilding a record from the file is the only way to keep the searchable text
    * intact across a move / reorder. Timestamps + presentation come from the existing index record so a
    * structural move never bumps updatedAt (mirrors the IndexedDB move, which leaves updatedAt alone).
    */
   const reindexDocumentFromFile = async (
      existing: BinderDocumentRecord, path: string, folderId: string, sortOrder: number,
   ): Promise<void> => {
      const parsed = parseMint(await readTextFile(absolutePath(path)))
      if (!parsed) return
      const record = buildDocumentRecord({
         id:           existing.id,
         meta:         migrateMeta(parsed.loaded.meta),
         sections:     parsed.loaded.sections,
         docTheme:     existing.docTheme,
         docAccent:    existing.docAccent,
         createdAt:    existing.createdAt,
         updatedAt:    existing.updatedAt,
         lastOpenedAt: existing.lastOpenedAt,
         folderId,
         sortOrder,
      })
      await index.upsertDocument(record, path)
   }

   /** The existing document rows in the shape the reconcile planner wants (its light query lacks `path`,
    *  so pair each id with its stored path). lastOpenedAt rides along so reconcile preserves the per-machine
    *  open stamp instead of resetting it from the file, which never carries it. */
   const existingDocumentRows = async (): Promise<ExistingDocumentRow[]> => {
      const records = await index.queryDocuments({})
      const rows: ExistingDocumentRow[] = []
      for (const record of records) {
         const path = await index.getPathById(record.id)
         if (path !== null) {
            rows.push({
               id: record.id, path, folderId: record.folderId,
               sortOrder: record.sortOrder, lastOpenedAt: record.lastOpenedAt,
            })
         }
      }
      return rows
   }

   /** The sibling folder (subdirectory) names already present in a Binder-relative parent directory, for
    *  the Explorer-style dedupe. System folders are excluded (they never enter the tree) and one name may
    *  be excluded (the folder being renamed / moved within its current parent, so it does not collide with
    *  itself). Missing directory reads as empty. */
   const siblingFolderNames = async (relativeParentDir: string, excludeName?: string): Promise<Set<string>> => {
      let entries
      try {
         entries = await readDir(absolutePath(relativeParentDir))
      } catch {
         return new Set()
      }
      const names = new Set<string>()
      const excludeLower = excludeName?.toLowerCase()
      for (const entry of entries) {
         if (!entry.isDirectory || isSystemFolderName(entry.name)) continue
         if (excludeLower !== undefined && entry.name.toLowerCase() === excludeLower) continue
         names.add(entry.name)
      }
      return names
   }

   // ====
   // Reconcile (open-time)
   // ====

   /**
    * Walk the Binder (skipping every dot-prefixed system folder) and make the index mirror it. Collects
    * every `.mint` (with the id parsed from inside it) and every real subdirectory, feeds the pure planner
    * the index's current rows plus the scan, then mints + writes ids for copies/new files, deletes stale
    * rows, and upserts every survivor. Folder rows are rebuilt too, reusing an indexed folder's sortOrder /
    * createdAt so a manual folder order survives across sessions.
    */
   const reconcile = async (): Promise<void> => {
      const scannedDocuments: ScannedDocument[] = []
      const scannedDirectories: string[] = []
      const parsedByPath = new Map<string, ParsedMint>()

      const walk = async (relativeDir: string): Promise<void> => {
         let entries
         try {
            entries = await readDir(absolutePath(relativeDir))
         } catch {
            return
         }
         for (const entry of entries) {
            if (entry.isDirectory) {
               if (isSystemFolderName(entry.name)) continue
               const childDir = joinRelative(relativeDir, entry.name)
               scannedDirectories.push(childDir)
               await walk(childDir)
            } else if (entry.isFile && entry.name.endsWith(MINT_EXTENSION)) {
               const path = joinRelative(relativeDir, entry.name)
               const parsed = parseMint(await readTextFile(absolutePath(path)))
               if (!parsed) continue
               parsedByPath.set(path, parsed)
               scannedDocuments.push({
                  idInFile:     parsed.id,
                  path,
                  folderId:     folderIdForRelativePath(relativeDir),
                  lastOpenedAt: parsed.lastOpenedAt ?? undefined,
               })
            }
         }
      }
      await walk('')

      // -- Documents --
      // Snapshot the index rows BEFORE any clear: the planner preserves each survivor's sortOrder +
      // lastOpenedAt from these, and the folder rebuild below reuses their sortOrder / createdAt.
      const existingRows    = await existingDocumentRows()
      const existingFolders = await index.getAllFolders()
      const plan = reconcileDocuments(existingRows, scannedDocuments)

      // Re-id: mint a fresh id and rewrite the file so the id persists inside it. Mutate the cached parse
      // so the record build below reads the consistent id + timestamps. This runs BEFORE record-building,
      // so every rebuilt record already carries its final id.
      for (const file of plan.reId) {
         const parsed = parsedByPath.get(file.path)
         if (!parsed) continue
         const newId = crypto.randomUUID()
         const now = new Date().toISOString()
         const createdAt = parsed.createdAt ?? now
         const updatedAt = parsed.updatedAt ?? now
         const lastOpenedAt = parsed.lastOpenedAt ?? undefined
         const mint = buildMintFile({
            id:           newId,
            meta:         parsed.loaded.meta,
            sections:     parsed.loaded.sections,
            docTheme:     parsed.loaded.docTheme,
            docAccent:    parsed.loaded.docAccent,
            presentation: parsed.loaded.presentation,
            format:       parsed.loaded.format,
            createdAt, updatedAt, lastOpenedAt,
         })
         await writeTextFile(absolutePath(file.path), serializeMint(mint))
         parsed.id = newId
         parsed.createdAt = createdAt
         parsed.updatedAt = updatedAt
         parsed.lastOpenedAt = lastOpenedAt ?? null
      }

      // Build every survivor's record. lastOpenedAt comes from the PLAN (the preserved index value for an
      // already-indexed id, the file's value for a brand-new one), never straight from the file, so an
      // open-only touch is not reset on the next open.
      const documentRecords: Array<{ record: BinderDocumentRecord; path: string }> = []
      for (const entry of plan.upsert) {
         const parsed = parsedByPath.get(entry.path)
         if (!parsed) continue
         const id = entry.idHint ?? parsed.id
         if (id === null) continue
         const now = new Date().toISOString()

         // Filename-wins reconcile: an Explorer rename made the on-disk stem diverge from the title's
         // projection, so the FILENAME is the human intent. Adopt the basename as the title and rewrite the
         // file so it is consistent again. Idempotent: a Documinter-written basename is itself a sanitized
         // stem, so once title === basename the next pass finds sanitizeForFilename(title) === basename and
         // does nothing. A raw hand-edit of meta.title with no matching rename is thus reverted here, which
         // is the documented rule (rename the file, do not edit the JSON's title). Compare is case-sensitive
         // so a case-only rename ("Report" -> "report") is adopted too.
         const stem = stemOfPath(entry.path)
         // Adopt-the-basename only when the basename is itself a valid sanitized stem. On a case-sensitive
         // filesystem that allows characters we sanitize away (a colon on macOS / Linux), sanitize(stem)
         // would never equal stem, so the mismatch could never be resolved and this would rewrite the file
         // on every reconcile in a loop. Windows filenames are always already-sanitized, so this is a no-op
         // there; on the other platforms it just leaves such a file's title untouched rather than looping.
         if (sanitizeForFilename(parsed.loaded.meta.title) !== stem && sanitizeForFilename(stem) === stem) {
            parsed.loaded.meta = { ...parsed.loaded.meta, title: stem }
            await writeTextFile(absolutePath(entry.path), serializeMint(buildMintFile({
               id,
               meta:         parsed.loaded.meta,
               sections:     parsed.loaded.sections,
               docTheme:     parsed.loaded.docTheme,
               docAccent:    parsed.loaded.docAccent,
               presentation: parsed.loaded.presentation,
               format:       parsed.loaded.format,
               createdAt:    parsed.createdAt ?? now,
               updatedAt:    parsed.updatedAt ?? now,
               lastOpenedAt: parsed.lastOpenedAt ?? undefined,
            })))
         }

         documentRecords.push({
            record: buildDocumentRecord({
               id,
               meta:         migrateMeta(parsed.loaded.meta),
               sections:     parsed.loaded.sections,
               docTheme:     parsed.loaded.docTheme,
               docAccent:    parsed.loaded.docAccent,
               createdAt:    parsed.createdAt ?? now,
               updatedAt:    parsed.updatedAt ?? now,
               lastOpenedAt: entry.lastOpenedAt,
               folderId:     entry.folderId,
               sortOrder:    entry.sortOrder,
            }),
            path: entry.path,
         })
      }

      // -- Folders --
      // Reuse an indexed folder's sortOrder / createdAt (a directory carries no such metadata on disk, so
      // the index is its only home), else append per parent in a stable path order.
      const existingFolderById = new Map(existingFolders.map(folder => [folder.id, folder]))
      const nextFolderSortByParent = new Map<string, number>()
      for (const folder of existingFolders) {
         const current = nextFolderSortByParent.get(folder.parentId) ?? 0
         nextFolderSortByParent.set(folder.parentId, Math.max(current, folder.sortOrder + 1))
      }
      const now = new Date().toISOString()
      const folderRecords: BinderFolderRecord[] = []
      for (const folderId of [...scannedDirectories].sort((first, second) => first.localeCompare(second))) {
         const parentId = parentFolderId(folderId)
         const priorFolder = existingFolderById.get(folderId)
         let sortOrder: number
         if (priorFolder) {
            sortOrder = priorFolder.sortOrder
         } else {
            sortOrder = nextFolderSortByParent.get(parentId) ?? 0
            nextFolderSortByParent.set(parentId, sortOrder + 1)
         }
         folderRecords.push({
            id:        folderId,
            name:      folderName(folderId),
            parentId,
            createdAt: priorFolder?.createdAt ?? now,
            updatedAt: priorFolder?.updatedAt ?? now,
            sortOrder,
         })
      }

      // -- Clear-then-rebuild --
      // The reconcile holds the complete target state (every survivor + every folder computed above), so
      // wipe the tables and re-insert into them empty. Inserting into an empty `documents` table cannot hit
      // the UNIQUE(path) constraint no matter how survivors permuted their on-disk paths (an out-of-band
      // Explorer rename cycle, A<->B), which a per-row UPDATE loop against UNIQUE(path) could not survive.
      // The clear also subsumes stale-row deletion: nothing stale survives it.
      await index.clear()
      for (const folder of folderRecords) await index.upsertFolder(folder)
      for (const item of documentRecords) await index.upsertDocument(item.record, item.path)
   }

   // ====
   // Documents
   // ====

   const saveDocument = async (
      state: DocState, presentation: DocPresentation, existingId?: string, targetFolderId?: string,
   ): Promise<string> => {
      const now = new Date().toISOString()

      // Update: the id already lives in the index. The title projects to the filename, so recompute the
      // stem and compare it to the current on-disk one. Same stem -> rewrite the body in place (the title
      // may still differ in ways the stem cannot carry, e.g. a colon). Different stem -> it is a rename:
      // reject if the new stem collides with a SIBLING, else rename the file to the new stem.
      if (existingId) {
         const existingPath = await index.getPathById(existingId)
         const existingRecord = await index.getDocumentById(existingId)
         if (existingPath && existingRecord) {
            const currentStem = stemOfPath(existingPath)
            const newStem = sanitizeForFilename(state.meta.title)
            // Case-sensitive on purpose (matches the reconcile rule): a case-only title edit ("Report" ->
            // "report") renames the file too, so the invariant stem === sanitizeForFilename(title) stays exact.
            const renaming = newStem !== currentStem

            if (renaming) {
               // Block the rename when a SIBLING already holds the target stem (the user is actively naming,
               // so a clear "name taken" beats a silent bump). The compare is case-insensitive (the on-disk
               // filesystem's own rule); the doc's own current file is excluded. Nothing is written yet here.
               const siblingStems = await takenStems(relativeDirForFolderId(existingRecord.folderId), currentStem)
               const collides = [...siblingStems].some(stem => stem.toLowerCase() === newStem.toLowerCase())
               if (collides) throw new NameTakenError()
            }

            const path = renaming
               ? relativePathForDocument(existingRecord.folderId, mintFileName(state.meta.title))
               : existingPath

            const mint = buildMintFile({
               id:           existingId,
               meta:         state.meta,
               sections:     state.sections,
               docTheme:     presentation.docTheme,
               docAccent:    presentation.docAccent,
               presentation: presentation.presentation,
               format:       presentation.format,
               createdAt:    existingRecord.createdAt,
               updatedAt:    now,
               lastOpenedAt: existingRecord.lastOpenedAt,
            })
            if (renaming) await rename(absolutePath(existingPath), absolutePath(path))
            await writeTextFile(absolutePath(path), serializeMint(mint))
            const record = buildDocumentRecord({
               id:           existingId,
               meta:         state.meta,
               sections:     state.sections,
               docTheme:     presentation.docTheme,
               docAccent:    presentation.docAccent,
               createdAt:    existingRecord.createdAt,
               updatedAt:    now,
               lastOpenedAt: existingRecord.lastOpenedAt,
               folderId:     existingRecord.folderId,
               sortOrder:    existingRecord.sortOrder,
            })
            await index.upsertDocument(record, path)
            return existingId
         }
         // existingId passed but gone from the index: fall through to create, reusing the id (upsert).
      }

      const id = existingId ?? crypto.randomUUID()
      const folderId = targetFolderId ?? ROOT_FOLDER_ID
      const directory = relativeDirForFolderId(folderId)
      // Create bumps the title (never blocks): a new document landing on a taken stem takes the next free
      // title ("Report" -> "Report 1"), which is then written into the file AND the record so the stored
      // title matches the filename. A unique title passes through unchanged.
      const title = nextAvailableTitle(state.meta.title, await takenStems(directory))
      const meta = title === state.meta.title ? state.meta : { ...state.meta, title }
      const fileName = mintFileName(meta.title)
      const path = relativePathForDocument(folderId, fileName)
      const sortOrder = await appendDocumentSort(folderId)

      const mint = buildMintFile({
         id,
         meta,
         sections:     state.sections,
         docTheme:     presentation.docTheme,
         docAccent:    presentation.docAccent,
         presentation: presentation.presentation,
         format:       presentation.format,
         createdAt:    now,
         updatedAt:    now,
      })
      await writeTextFile(absolutePath(path), serializeMint(mint))
      const record = buildDocumentRecord({
         id,
         meta,
         sections:     state.sections,
         docTheme:     presentation.docTheme,
         docAccent:    presentation.docAccent,
         createdAt:    now,
         updatedAt:    now,
         lastOpenedAt: undefined,
         folderId,
         sortOrder,
      })
      await index.upsertDocument(record, path)
      return id
   }

   const loadDocument = async (id: string, options?: { touch?: boolean }): Promise<LoadedDocument | null> => {
      const path = await index.getPathById(id)
      if (path === null) return null
      let text: string
      try {
         text = await readTextFile(absolutePath(path))
      } catch {
         return null
      }
      const parsed = parseMint(text)
      if (!parsed) return null
      if (options?.touch !== false) await index.touchLastOpened(id, new Date().toISOString())
      return parsed.loaded
   }

   const listDocuments = async (filter?: DocumentListFilter): Promise<BinderDocumentRecord[]> => {
      // The SQL side applies the folder scope + the free-text FTS match. The returned light records carry
      // an EMPTY contentText, so re-running the text match in JS would wrongly drop everything; clear the
      // text field and apply only the date / never-opened predicates here, then sort for IDB parity.
      const records = await index.queryDocuments({ folderId: filter?.folderId, text: filter?.criteria?.text })
      let result = records
      if (filter?.criteria) {
         const nonTextCriteria = { ...filter.criteria, text: undefined }
         result = result.filter(record => matchesCriteria(record, nonTextCriteria))
      }
      result.sort(documentComparator(filter?.sortBy ?? 'updatedAt', filter?.sortDir ?? 'desc'))
      return result
   }

   const getDocumentFolderId = async (id: string): Promise<string | null> => {
      const record = await index.getDocumentById(id)
      return record ? record.folderId : null
   }

   const deleteDocument = async (id: string): Promise<void> => {
      const path = await index.getPathById(id)
      if (path !== null) {
         try { await remove(absolutePath(path)) } catch { /* already gone on disk, keep the index cleanup */ }
      }
      await index.deleteDocument(id)
   }

   const duplicateDocument = async (id: string): Promise<string> => {
      const sourcePath = await index.getPathById(id)
      const sourceRecord = await index.getDocumentById(id)
      if (sourcePath === null || sourceRecord === null) throw new Error('Cannot duplicate: document not found')
      const parsed = parseMint(await readTextFile(absolutePath(sourcePath)))
      if (!parsed) throw new Error('Cannot duplicate: document not found')

      const newId = crypto.randomUUID()
      const now = new Date().toISOString()
      const clonedSections = cloneSectionsWithFreshIds(parsed.loaded.sections)
      const sourceMeta = migrateMeta(parsed.loaded.meta)
      const folderId = sourceRecord.folderId
      const directory = relativeDirForFolderId(folderId)
      // The source is a sibling, so its stem is taken: the copy always bumps ("Report" -> "Report 1").
      const title = nextAvailableTitle(sourceMeta.title, await takenStems(directory))
      const meta = title === sourceMeta.title ? sourceMeta : { ...sourceMeta, title }
      const fileName = mintFileName(meta.title)
      const newPath = relativePathForDocument(folderId, fileName)
      const sortOrder = await appendDocumentSort(folderId)

      const mint = buildMintFile({
         id:           newId,
         meta,
         sections:     clonedSections,
         docTheme:     parsed.loaded.docTheme,
         docAccent:    parsed.loaded.docAccent,
         presentation: parsed.loaded.presentation,
         format:       parsed.loaded.format,
         createdAt:    now,
         updatedAt:    now,
      })
      await writeTextFile(absolutePath(newPath), serializeMint(mint))
      const record = buildDocumentRecord({
         id:           newId,
         meta,
         sections:     clonedSections,
         docTheme:     parsed.loaded.docTheme,
         docAccent:    parsed.loaded.docAccent,
         createdAt:    now,
         updatedAt:    now,
         lastOpenedAt: undefined,
         folderId,
         sortOrder,
      })
      await index.upsertDocument(record, newPath)
      return newId
   }

   const moveDocument = async (id: string, targetFolderId: string): Promise<void> => {
      const existing = await index.getDocumentById(id)
      const oldPath = await index.getPathById(id)
      if (!existing || oldPath === null) return

      // Same folder: only the append sortOrder changes (mirrors the IndexedDB move to the end).
      if (targetFolderId === existing.folderId) {
         await reindexDocumentFromFile(existing, oldPath, targetFolderId, await appendDocumentSort(targetFolderId, id))
         return
      }

      // Cross-folder move: the file keeps its stem unless a sibling in the destination already holds it,
      // in which case the title bumps ("Report" -> "Report 1") and the file is rewritten so the invariant
      // stem === sanitizeForFilename(title) survives the move. reindexDocumentFromFile then reads the file
      // back, so the record picks up the bumped title.
      const targetDirectory = relativeDirForFolderId(targetFolderId)
      const title = nextAvailableTitle(existing.meta.title, await takenStems(targetDirectory))
      const newPath = relativePathForDocument(targetFolderId, mintFileName(title))
      const sortOrder = await appendDocumentSort(targetFolderId)

      await rename(absolutePath(oldPath), absolutePath(newPath))
      if (title !== existing.meta.title) await rewriteDocumentTitle(newPath, existing, title)
      await reindexDocumentFromFile(existing, newPath, targetFolderId, sortOrder)
   }

   const reorderDocuments = async (orderedIds: string[]): Promise<void> => {
      if (orderedIds.length === 0) return
      const records = await Promise.all(orderedIds.map(id => index.getDocumentById(id)))
      const present = records.filter((record): record is BinderDocumentRecord => record !== null)
      const folderId = present[0]?.folderId
      if (present.length !== orderedIds.length || present.some(record => record.folderId !== folderId)) {
         throw new Error('reorderDocuments: all ids must belong to the same folder')
      }
      // Index-only: assign sortOrder by position. The path does not change; each record is rebuilt from its
      // file so the FTS search text is preserved (a light record's contentText is empty, see the helper).
      for (let position = 0; position < present.length; position++) {
         const record = present[position]
         const path = await index.getPathById(record.id)
         if (path !== null) await reindexDocumentFromFile(record, path, record.folderId, position)
      }
   }

   // ====
   // Folders
   // ====

   /**
    * Rebase an entire folder subtree from oldPrefix to newPrefix in the index, after the directory itself
    * has been renamed/moved on disk. A folder's id IS its path, so every descendant folder AND every
    * document under the prefix gets a new id/path/folderId; the folder PK is the path, so each affected
    * folder row is deleted and re-inserted at its rebased id. The top folder alone takes the new sortOrder
    * (a move appends it under its new parent; a rename keeps its slot) and a bumped updatedAt.
    */
   const rebaseSubtree = async (oldPrefix: string, newPrefix: string, topSortOrder: number): Promise<void> => {
      const now = new Date().toISOString()
      const isUnder = (candidate: string): boolean => candidate === oldPrefix || candidate.startsWith(oldPrefix + '/')
      const rebase = (candidate: string): string => newPrefix + candidate.slice(oldPrefix.length)

      const folders = (await index.getAllFolders()).filter(folder => isUnder(folder.id))
      for (const folder of folders) {
         const rebasedId = rebase(folder.id)
         await index.deleteFolder(folder.id)
         const isTop = folder.id === oldPrefix
         await index.upsertFolder({
            id:        rebasedId,
            name:      folderName(rebasedId),
            parentId:  parentFolderId(rebasedId),
            createdAt: folder.createdAt,
            updatedAt: isTop ? now : folder.updatedAt,
            sortOrder: isTop ? topSortOrder : folder.sortOrder,
         })
      }

      // A rebase only shifts the path prefix; the file's content (and so its search text) is unchanged and
      // the file already moved on disk, so relocate the index row directly instead of reading the file.
      // setDocumentLocation cannot desync on a corrupt / missing descendant the way a file re-read could,
      // and it leaves the FTS row (keyed on the stable rowid) untouched.
      const documents = await index.queryDocuments({})
      for (const document of documents) {
         const path = await index.getPathById(document.id)
         if (path === null || !isUnder(path)) continue
         const rebasedPath = rebase(path)
         const slash = rebasedPath.lastIndexOf('/')
         const folderId = folderIdForRelativePath(slash === -1 ? '' : rebasedPath.slice(0, slash))
         await index.setDocumentLocation(document.id, rebasedPath, folderId)
      }
   }

   const getFolder = async (id: string): Promise<BinderFolderRecord | null> => index.getFolderByPath(id)

   const createFolder = async (parentId: string, name: string): Promise<string> => {
      const parentDir = relativeDirForFolderId(parentId)
      // Native-canonical: dedupe the sibling folder name Explorer-style ("Drafts" -> "Drafts 2") so two
      // same-name siblings never collapse onto one directory. A folder's id IS its path, so a clash cannot
      // be two identities; this is a DELIBERATE divergence from the IndexedDB backend (which allowed
      // same-name siblings). IDB is deleted in arc D, so this becomes the only behaviour.
      const uniqueName = dedupeFolderName(name, await siblingFolderNames(parentDir))
      const relativePath = joinRelative(parentDir, uniqueName)
      const folderId = folderIdForRelativePath(relativePath)
      const now = new Date().toISOString()
      await mkdir(absolutePath(relativePath), { recursive: true })
      const sortOrder = await appendFolderSort(parentId)
      await index.upsertFolder({ id: folderId, name: uniqueName, parentId, createdAt: now, updatedAt: now, sortOrder })
      return folderId
   }

   const renameFolder = async (id: string, name: string): Promise<void> => {
      const existing = await index.getFolderByPath(id)
      if (!existing) return
      const parentDir = relativeDirForFolderId(parentFolderId(id))
      // Dedupe against the target siblings, excluding this folder itself so a no-op rename (or a case-only
      // change) is not pushed onto a " 2" suffix. Native-canonical, no uncaught rename-onto-existing throw.
      const uniqueName = dedupeFolderName(name, await siblingFolderNames(parentDir, folderName(id)))
      const newId = folderIdForRelativePath(joinRelative(parentDir, uniqueName))
      if (newId === id) return
      await rename(absolutePath(id), absolutePath(newId))
      await rebaseSubtree(id, newId, existing.sortOrder)
   }

   const deleteFolder = async (id: string, options?: { recursive?: boolean }): Promise<string[]> => {
      const recursive = options?.recursive ?? false
      const allFolders = await index.getAllFolders()
      const subtree = new Set(allFolders.map(folder => folder.id).filter(folderId => folderId === id || folderId.startsWith(id + '/')))
      subtree.add(id)

      const affected = (await index.queryDocuments({})).filter(document => subtree.has(document.folderId))
      const deletedDocumentIds: string[] = []

      if (recursive) {
         for (const document of affected) {
            const path = await index.getPathById(document.id)
            if (path !== null) { try { await remove(absolutePath(path)) } catch { /* file already gone */ } }
            await index.deleteDocument(document.id)
            deletedDocumentIds.push(document.id)
         }
      } else {
         // Reflow the contained documents to root, appended in discovered order (mirror of the IndexedDB
         // orphan reflow). A title bumps when its stem is already taken at root ("Report" -> "Report 1"),
         // and the moved file is rewritten so the invariant holds; rootStems accumulates each write so two
         // same-titled orphans land as distinct stems.
         let nextRootSort = await appendDocumentSort(ROOT_FOLDER_ID)
         const rootStems = await takenStems('')
         for (const document of affected) {
            const oldPath = await index.getPathById(document.id)
            if (oldPath === null) continue
            const title = nextAvailableTitle(document.meta.title, rootStems)
            const fileName = mintFileName(title)
            rootStems.add(sanitizeForFilename(title))
            await rename(absolutePath(oldPath), absolutePath(fileName))
            if (title !== document.meta.title) await rewriteDocumentTitle(fileName, document, title)
            await reindexDocumentFromFile(document, fileName, ROOT_FOLDER_ID, nextRootSort++)
         }
      }

      try { await remove(absolutePath(id), { recursive: true }) } catch { /* directory already gone */ }
      for (const folderId of subtree) await index.deleteFolder(folderId)
      return deletedDocumentIds
   }

   const listAllFolders = async (): Promise<BinderFolderRecord[]> => index.getAllFolders()

   const getFolderChildren = async (parentId: string): Promise<BinderFolderRecord[]> => {
      const children = await index.getFolderChildren(parentId)
      return children.sort((first, second) => first.sortOrder - second.sortOrder)
   }

   const getFolderAncestors = async (id: string): Promise<BinderFolderRecord[]> => {
      const chain: BinderFolderRecord[] = []
      const self = await index.getFolderByPath(id)
      if (!self) return chain
      let parentId = self.parentId
      while (parentId !== ROOT_FOLDER_ID) {
         const parent = await index.getFolderByPath(parentId)
         if (!parent) break
         chain.unshift(parent)
         parentId = parent.parentId
      }
      return chain
   }

   const moveFolder = async (id: string, targetParentId: string): Promise<void> => {
      const existing = await index.getFolderByPath(id)
      if (!existing) return
      const targetDir = relativeDirForFolderId(targetParentId)
      // Dedupe against the destination siblings (native-canonical), so moving "Drafts" into a folder that
      // already holds a "Drafts" lands as "Drafts 2" rather than throwing on rename-onto-existing. Exclude
      // this folder itself only when it is already in the target parent (a same-parent move is a no-op).
      const excludeName = targetParentId === parentFolderId(id) ? folderName(id) : undefined
      const uniqueName = dedupeFolderName(folderName(id), await siblingFolderNames(targetDir, excludeName))
      const newId = folderIdForRelativePath(joinRelative(targetDir, uniqueName))
      if (newId === id) return
      await rename(absolutePath(id), absolutePath(newId))
      await rebaseSubtree(id, newId, await appendFolderSort(targetParentId))
   }

   const reorderFolders = async (orderedIds: string[]): Promise<void> => {
      if (orderedIds.length === 0) return
      const folders = await Promise.all(orderedIds.map(folderId => index.getFolderByPath(folderId)))
      const present = folders.filter((folder): folder is BinderFolderRecord => folder !== null)
      const parentId = present[0]?.parentId
      if (present.length !== orderedIds.length || present.some(folder => folder.parentId !== parentId)) {
         throw new Error('reorderFolders: all ids must be siblings')
      }
      for (let position = 0; position < present.length; position++) {
         await index.upsertFolder({ ...present[position], sortOrder: position })
      }
   }

   // ####################
   // # TEMPLATES        #
   // ####################
   // Templates are source files under `.templates/*.mintplate`, NOT rows in the SQLite index: they are
   // few, listed by reading the directory, and each file carries its own id (the identity saveTemplate
   // upserts by). Built-in templates live in code and are never written here.

   /** Read every `.mintplate` under `.templates`, parsed, paired with its file name. Missing directory
    *  reads as empty; an unparseable file is skipped, never fatal. */
   const readTemplateEntries = async (): Promise<Array<{ template: DocumentTemplate; fileName: string }>> => {
      let entries
      try {
         entries = await readDir(absolutePath(TEMPLATES_DIR))
      } catch {
         return []
      }
      const result: Array<{ template: DocumentTemplate; fileName: string }> = []
      for (const entry of entries) {
         if (!entry.isFile || !entry.name.endsWith(MINTPLATE_EXTENSION)) continue
         let text: string
         try {
            text = await readTextFile(absolutePath(joinRelative(TEMPLATES_DIR, entry.name)))
         } catch {
            continue
         }
         const template = parseTemplateFile(text)
         if (template) result.push({ template, fileName: entry.name })
      }
      return result
   }

   const saveTemplate = async (template: DocumentTemplate): Promise<void> => {
      await mkdir(absolutePath(TEMPLATES_DIR), { recursive: true })
      const entries  = await readTemplateEntries()
      const existing = entries.find(entry => entry.template.id === template.id)

      // Upsert by id: overwrite the file that already holds this id. When the display name changed, move
      // the file to the fresh slug so the folder stays human-readable (the id inside the file, not the
      // name, is the identity, so a rename never loses it). `taken` excludes the file being replaced.
      if (existing) {
         const taken = new Set(
            entries.map(entry => entry.fileName).filter(name => name.toLowerCase() !== existing.fileName.toLowerCase()),
         )
         const nextFileName = mintplateFileName(template.name, taken)
         if (nextFileName.toLowerCase() !== existing.fileName.toLowerCase()) {
            await rename(
               absolutePath(joinRelative(TEMPLATES_DIR, existing.fileName)),
               absolutePath(joinRelative(TEMPLATES_DIR, nextFileName)),
            )
         }
         await writeTextFile(absolutePath(joinRelative(TEMPLATES_DIR, nextFileName)), serializeTemplateFile(template))
         return
      }

      const fileName = mintplateFileName(template.name, new Set(entries.map(entry => entry.fileName)))
      await writeTextFile(absolutePath(joinRelative(TEMPLATES_DIR, fileName)), serializeTemplateFile(template))
   }

   /** All stored templates, newest-updated first (mirrors templateStore.listTemplates ordering). */
   const listTemplates = async (): Promise<DocumentTemplate[]> => {
      const entries = await readTemplateEntries()
      return entries.map(entry => entry.template).sort((first, second) => second.updatedAt - first.updatedAt)
   }

   /** Rename a template (touches updatedAt); no-op when the id is absent. Routes through saveTemplate so
    *  the file is re-slugged the same way a name change on save is. Mirrors templateStore.renameTemplate. */
   const renameTemplate = async (id: string, name: string, now: number): Promise<void> => {
      const entries = await readTemplateEntries()
      const target  = entries.find(entry => entry.template.id === id)
      if (!target) return
      await saveTemplate({ ...target.template, name, updatedAt: now })
   }

   /** Delete a template by id. Idempotent: a missing id is a no-op. */
   const deleteTemplate = async (id: string): Promise<void> => {
      const entries = await readTemplateEntries()
      const target  = entries.find(entry => entry.template.id === id)
      if (!target) return
      try {
         await remove(absolutePath(joinRelative(TEMPLATES_DIR, target.fileName)))
      } catch { /* already gone on disk */ }
   }

   // ####################
   // # TIN (BULK)       #
   // ####################

   /** Staging + backup scaffolding for an atomic Replace, under `.documinter/` so they are on the same
    *  filesystem as the Binder root (rename between them is a cheap metadata move) and excluded from every
    *  tree scan (dot-prefixed). See replaceFromTin for the exact crash guarantee. */
   const IMPORT_STAGING_DIR = joinRelative(DOCUMINTER_DIR, 'import-staging')
   const IMPORT_BACKUP_DIR  = joinRelative(DOCUMINTER_DIR, 'import-backup')

   /** Heal one Tin document through the shared read pipeline (id / meta / page-break / band migrators +
    *  presentation / format normalization), exactly as the IndexedDB Tin import does, then build the
    *  on-disk envelope under `id`. Returns the migrated body too, so the caller can build the matching
    *  index record without migrating twice. */
   const prepareTinDocument = (document: TinDocument, id: string): { loaded: LoadedDocument; mint: MintFile } => {
      const loaded = assembleLoadedDocument({
         meta:         document.meta,
         sections:     document.sections,
         docTheme:     document.docTheme,
         docAccent:    document.docAccent,
         presentation: document.presentation,
         format:       document.format,
      })
      const mint = buildMintFile({
         id,
         meta:         loaded.meta,
         sections:     loaded.sections,
         docTheme:     loaded.docTheme,
         docAccent:    loaded.docAccent,
         presentation: loaded.presentation,
         format:       loaded.format,
         createdAt:    document.createdAt,
         updatedAt:    document.updatedAt,
      })
      return { loaded, mint }
   }

   /** Read one indexed document's file back into a TinDocument (full body, base64 kept). Reuses the
    *  IndexedDB backend's toTinDocument so both backends emit byte-identical record shape. */
   const readTinDocument = async (record: BinderDocumentRecord): Promise<TinDocument | null> => {
      const path = await index.getPathById(record.id)
      if (path === null) return null
      let text: string
      try {
         text = await readTextFile(absolutePath(path))
      } catch {
         return null
      }
      const parsed = parseMint(text)
      return parsed ? toTinDocument(record, parsed.loaded) : null
   }

   const collectBinderForTin = async (): Promise<TinFile> => {
      const folderRecords   = await index.getAllFolders()
      const documentRecords = await index.queryDocuments({})
      const templates       = await listTemplates()

      const documents: TinDocument[] = []
      for (const record of documentRecords) {
         const tinDocument = await readTinDocument(record)
         if (tinDocument) documents.push(tinDocument)
      }

      return {
         documinterTin: true,
         schemaVersion: TIN_SCHEMA_VERSION,
         exportedAt:    new Date().toISOString(),
         templates:     templates.filter(template => !template.builtIn).map(toTinTemplate),
         // A system-named folder never reaches the tree scan, so the index never holds one; filter anyway
         // so a system name can never leak into a Tin regardless of how the index was built.
         folders:       folderRecords.filter(folder => !isSystemFolderName(folder.name)).map(toTinFolder),
         documents,
      }
   }

   const collectFolderSubtreeForTin = async (rootFolderId: string): Promise<TinFile> => {
      // Same breadth-first descendant walk as binderBackup's subtree collect, over the in-memory folders.
      const allFolders = await index.getAllFolders()
      const childrenByParent = new Map<string, BinderFolderRecord[]>()
      for (const folder of allFolders) {
         const siblings = childrenByParent.get(folder.parentId) ?? []
         siblings.push(folder)
         childrenByParent.set(folder.parentId, siblings)
      }

      const subtree:   BinderFolderRecord[] = []
      const folderIds: Set<string>          = new Set()
      const root = allFolders.find(folder => folder.id === rootFolderId)
      if (root) {
         subtree.push(root)
         folderIds.add(root.id)
      }
      const frontier = [rootFolderId]
      for (let frontierIndex = 0; frontierIndex < frontier.length; frontierIndex++) {
         for (const child of childrenByParent.get(frontier[frontierIndex]) ?? []) {
            subtree.push(child)
            folderIds.add(child.id)
            frontier.push(child.id)
         }
      }

      const documentRecords = await index.queryDocuments({})
      const documents: TinDocument[] = []
      for (const record of documentRecords) {
         if (!folderIds.has(record.folderId)) continue
         const tinDocument = await readTinDocument(record)
         if (tinDocument) documents.push(tinDocument)
      }

      // A subtree Tin carries structure + documents only, never the app-wide templates (matches IDB).
      return {
         documinterTin: true,
         schemaVersion: TIN_SCHEMA_VERSION,
         exportedAt:    new Date().toISOString(),
         templates:     [],
         // Guard against a system-named folder leaking into a Tin (see collectBinderForTin).
         folders:       subtree.filter(folder => !isSystemFolderName(folder.name)).map(toTinFolder),
         documents,
      }
   }

   /** The next free top-level sort position under a folder, across both its child folders and its
    *  documents, so a graft's top-level items clear whichever is higher (mirror of binderBackup). */
   const nextTopLevelSort = async (targetFolderId: string): Promise<number> => {
      const folders   = await index.getAllFolders()
      const documents = await index.queryDocuments({ folderId: targetFolderId })
      const folderMax = folders
         .filter(folder => folder.parentId === targetFolderId)
         .reduce((max, folder) => Math.max(max, folder.sortOrder), -1)
      const documentMax = documents.reduce((max, document) => Math.max(max, document.sortOrder), -1)
      return Math.max(folderMax, documentMax) + 1
   }

   /** Drop any folder whose name is a Documinter system name (`.documinter`, `.templates`, any dot-folder)
    *  from a Tin before import: such a folder must never enter the tree (its directory would be written
    *  and then hidden by the tree scan, and a staged `.documinter` would collide with the preserved live
    *  one mid Replace-swap). Only a hand-crafted Tin can carry one (collect excludes them); a document
    *  filed under a dropped folder rehomes to the import target via the planner's dangling-parent
    *  fallback, so no document is lost. */
   const withoutSystemFolders = (tin: TinFile): TinFile => ({
      ...tin,
      folders: tin.folders.filter(folder => !isSystemFolderName(folder.name)),
   })

   /**
    * Graft a Tin into the LIVE Binder under `targetFolderId`, non-destructively. remapTinForMerge (pure,
    * reused verbatim) mints fresh ids + re-homes every folder under the target with a sortOrder offset;
    * planTinMerge (pure) then turns that graph into concrete directory path ids (parents first). Folders
    * are mkdir'd + indexed, documents written as fresh-id `.mint` files + indexed, templates written as
    * `.mintplate` files. Nothing already in the Binder is touched.
    */
   const mergeTin = async (rawTin: TinFile, targetFolderId: string): Promise<TinImportSummary> => {
      const tin      = withoutSystemFolders(rawTin)
      const offset   = await nextTopLevelSort(targetFolderId)
      const remapped = remapTinForMerge(tin, targetFolderId, offset)
      const plan     = planTinMerge(remapped, targetFolderId)

      for (const folder of plan.folders) {
         await mkdir(absolutePath(relativeDirForFolderId(folder.pathId)), { recursive: true })
         await index.upsertFolder({
            id:        folder.pathId,
            name:      folder.name,
            parentId:  folder.parentPathId,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
            sortOrder: folder.sortOrder,
         })
      }

      for (const { document, folderPathId } of plan.documents) {
         const id        = crypto.randomUUID()
         const directory = relativeDirForFolderId(folderPathId)
         // Bump the title on a stem collision in the target folder (a graft may land beside a same-named
         // document); the bumped title is what the file + record store, keeping the invariant exact. The
         // directory is re-read each iteration, so an earlier graft in the same folder counts as taken.
         const title     = nextAvailableTitle(document.meta.title, await takenStems(directory))
         const graft     = title === document.meta.title ? document : { ...document, meta: { ...document.meta, title } }
         const fileName  = mintFileName(title)
         const path      = relativePathForDocument(folderPathId, fileName)
         const { loaded, mint } = prepareTinDocument(graft, id)
         await writeTextFile(absolutePath(path), serializeMint(mint))
         await index.upsertDocument(buildDocumentRecord({
            id,
            meta:         loaded.meta,
            sections:     loaded.sections,
            docTheme:     loaded.docTheme,
            docAccent:    loaded.docAccent,
            createdAt:    document.createdAt,
            updatedAt:    document.updatedAt,
            lastOpenedAt: undefined,
            folderId:     folderPathId,
            sortOrder:    document.sortOrder,
         }), path)
      }

      // Each Tin template is re-captured as a fresh stored template (new id + timestamps); the format
      // carries only name + chrome, so it is always re-captured, never written verbatim (matches IDB).
      for (const template of tin.templates) {
         await saveTemplate(captureTemplate(template.name, template, crypto.randomUUID(), Date.now()))
      }

      return { templates: tin.templates.length, folders: remapped.folders.length, documents: remapped.documents.length }
   }

   /**
    * Wipe the Binder and restore a Tin verbatim, as crash-safely as plugin-fs primitives allow.
    *
    * The IndexedDB backend does this in one transaction that rolls back on failure. A filesystem has no
    * such transaction, so this uses a build-then-swap: the ENTIRE new tree is materialized in a staging
    * area first (folders, verbatim-id `.mint` documents, `.mintplate` templates), touching nothing live,
    * then the swap moves the existing Binder content ASIDE into a backup area (rename, not delete) and
    * moves the staged tree into place.
    *
    * GUARANTEE: no Replace can permanently destroy Binder data. Until the new tree is fully staged the
    * live Binder is untouched, and during the swap the old content is moved aside rather than deleted, so
    * a crash at any point leaves BOTH the old content (under `.documinter/import-backup/`) and the new
    * content (under `.documinter/import-staging/`) recoverable. Each individual `rename` is atomic on one
    * filesystem, so no single entry is ever half-moved.
    *
    * RESIDUAL RISK: the swap (move-aside then move-in) is a sequence of renames, NOT one all-or-nothing
    * operation, because the Binder root interleaves user content with the preserved `.documinter/` cache
    * and cannot be swapped as a single directory. A crash mid-swap can therefore leave the VISIBLE root
    * with a partial mix (or momentarily empty). Recovery from the backup / staging areas is manual in
    * this arc; a later import clears leftover scaffolding. The index is rebuilt from the swapped-in files,
    * and even if a crash skips that rebuild the open-time reconcile heals it (the index is disposable).
    */
   const replaceFromTin = async (rawTin: TinFile): Promise<TinImportSummary> => {
      // Drop any system-named folder up front: a staged `.documinter` / `.templates` would rename onto the
      // preserved live cache mid-swap and throw. Their documents rehome to root via the planner fallback.
      const tin = withoutSystemFolders(rawTin)
      const stagingPath = (relative: string): string => absolutePath(joinRelative(IMPORT_STAGING_DIR, relative))

      // -- 1. Clear crash debris from any aborted prior import, then open a clean staging root. --
      try { await remove(absolutePath(IMPORT_STAGING_DIR), { recursive: true }) } catch { /* absent */ }
      try { await remove(absolutePath(IMPORT_BACKUP_DIR),  { recursive: true }) } catch { /* absent */ }
      await mkdir(absolutePath(IMPORT_STAGING_DIR), { recursive: true })

      // -- 2. Build the full new tree in staging. No live file is touched here. planTinMerge rebuilds the
      //       whole tree at the root (verbatim ids: no remap, no offset). Index rows are collected as we
      //       go, keyed by the SAME Binder-relative path the files will have after the swap, so the index
      //       is rebuilt without a rescan. --
      const plan = planTinMerge({ folders: tin.folders, documents: tin.documents }, ROOT_FOLDER_ID)
      const folderUpserts:   BinderFolderRecord[]                          = []
      const documentUpserts: Array<{ record: BinderDocumentRecord; path: string }> = []

      for (const folder of plan.folders) {
         await mkdir(stagingPath(relativeDirForFolderId(folder.pathId)), { recursive: true })
         folderUpserts.push({
            id:        folder.pathId,
            name:      folder.name,
            parentId:  folder.parentPathId,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
            sortOrder: folder.sortOrder,
         })
      }

      for (const { document, folderPathId } of plan.documents) {
         const directory = relativeDirForFolderId(folderPathId)
         // Bump on a stem collision within the staged folder (the index is not live yet, so the staging
         // directory itself is the source of taken stems). Verbatim id restore (a Replace matches the
         // exported state), still healed through the migrators; the bumped title is what gets written.
         const title     = nextAvailableTitle(document.meta.title, await takenStemsAt(stagingPath(directory)))
         const restore   = title === document.meta.title ? document : { ...document, meta: { ...document.meta, title } }
         const fileName  = mintFileName(title)
         const path      = relativePathForDocument(folderPathId, fileName)
         const { loaded, mint } = prepareTinDocument(restore, document.id)
         await writeTextFile(stagingPath(path), serializeMint(mint))
         documentUpserts.push({
            record: buildDocumentRecord({
               id:           document.id,
               meta:         loaded.meta,
               sections:     loaded.sections,
               docTheme:     loaded.docTheme,
               docAccent:    loaded.docAccent,
               createdAt:    document.createdAt,
               updatedAt:    document.updatedAt,
               lastOpenedAt: undefined,
               folderId:     folderPathId,
               sortOrder:    document.sortOrder,
            }),
            path,
         })
      }

      if (tin.templates.length > 0) {
         await mkdir(stagingPath(TEMPLATES_DIR), { recursive: true })
         const takenTemplates = new Set<string>()
         for (const template of tin.templates) {
            const captured = captureTemplate(template.name, template, crypto.randomUUID(), Date.now())
            const fileName = mintplateFileName(captured.name, takenTemplates)
            takenTemplates.add(fileName)
            await writeTextFile(stagingPath(joinRelative(TEMPLATES_DIR, fileName)), serializeTemplateFile(captured))
         }
      }

      // -- 3. Swap. Move every current root entry aside into the backup (everything but the preserved
      //       `.documinter/` cache, which also hosts the staging + backup dirs), then move each staged
      //       top-level entry into the root. --
      await mkdir(absolutePath(IMPORT_BACKUP_DIR), { recursive: true })
      for (const entry of await readDir(rootPosix)) {
         if (entry.name === DOCUMINTER_DIR) continue
         try {
            await rename(absolutePath(entry.name), absolutePath(joinRelative(IMPORT_BACKUP_DIR, entry.name)))
         } catch { /* entry vanished under us, keep going */ }
      }
      for (const entry of await readDir(absolutePath(IMPORT_STAGING_DIR))) {
         await rename(stagingPath(entry.name), absolutePath(entry.name))
      }

      // -- 4. Drop the scaffolding, then rebuild the index from the collected rows (verbatim ids +
      //       sortOrders, no rescan). A crash before this leaves a stale index that the open-time
      //       reconcile repairs. --
      try { await remove(absolutePath(IMPORT_BACKUP_DIR),  { recursive: true }) } catch { /* absent */ }
      try { await remove(absolutePath(IMPORT_STAGING_DIR), { recursive: true }) } catch { /* absent */ }
      await index.clear()
      for (const folder of folderUpserts) await index.upsertFolder(folder)
      for (const item of documentUpserts) await index.upsertDocument(item.record, item.path)

      return { templates: tin.templates.length, folders: tin.folders.length, documents: tin.documents.length }
   }

   const importTin = async (
      tin: TinFile, mode: 'merge' | 'replace', targetFolderId?: string,
   ): Promise<TinImportSummary> => {
      if (mode === 'replace') return replaceFromTin(tin)
      return mergeTin(tin, targetFolderId ?? ROOT_FOLDER_ID)
   }

   // ####################
   // # THE FILESYSTEM WATCHER (arc B)
   // ####################
   // External edits (Explorer add / rename / move / delete of a `.mint`, folder, or template) are
   // reconciled live: a recursive plugin-fs watch on the Binder root coalesces raw events, we drop the ones
   // we caused, and a short settle later we re-run the (idempotent) reconcile and notify subscribers so the
   // binder view re-queries. Two drops keep the loop out: events during an in-app mute window (an ordinary
   // save already updated the index, nothing to rescan) and events that are only our own `.documinter/`
   // cache writes. The reconcile runs even with the binder view closed, so opening it later shows a folder
   // that was edited in the meantime; the notify is simply a no-op while nobody is subscribed.

   const WATCH_DEBOUNCE_MS = 400   // plugin-fs coalesces raw OS events over this window
   const MUTE_MS           = 900   // ignore-our-own-writes window opened by each in-app mutation
   const COALESCE_MS       = 150   // extra settle before reconciling, past any still-active mute

   const listeners = new Set<(change: BinderChange) => void>()
   let unwatch: (() => void) | null = null
   let muteUntil = 0
   let reconcileTimer: ReturnType<typeof setTimeout> | null = null
   let reconciling = false
   let pendingReconcile = false

   // Every in-app write opens a mute window so a save / move / mkdir is not mistaken for an external edit.
   const mute = (): void => { muteUntil = Date.now() + MUTE_MS }
   const muteThen = <Args extends unknown[], Result>(operation: (...args: Args) => Result) =>
      (...args: Args): Result => { mute(); return operation(...args) }

   const notifyListeners = (): void => {
      // Coarse on purpose: the binder view just re-runs its list reads. Snapshot first so a listener that
      // unsubscribes during the loop cannot mutate the set mid-iteration.
      for (const listener of [...listeners]) listener({ kind: 'all' })
   }

   const runReconcile = async (): Promise<void> => {
      if (reconciling) { pendingReconcile = true; return }
      reconciling = true
      try {
         await reconcile()
      } catch (error) {
         console.error('[binder] watcher reconcile failed:', error)
      } finally {
         reconciling = false
      }
      console.info('[binder][watch] reconciled, notifying', listeners.size, 'listener(s)')
      notifyListeners()
      // A change that arrived mid-reconcile (our own re-id file rewrites included) gets one more pass.
      if (pendingReconcile) { pendingReconcile = false; void runReconcile() }
   }

   const scheduleReconcile = (): void => {
      if (reconcileTimer !== null) clearTimeout(reconcileTimer)
      reconcileTimer = setTimeout(() => { reconcileTimer = null; void runReconcile() }, COALESCE_MS)
   }

   const handleWatchEvent = (event: WatchEvent): void => {
      const paths = Array.isArray(event.paths) ? event.paths : []
      const muted = Date.now() < muteUntil
      // Diagnostic (arc B bring-up): shows every raw event + why it was or was not acted on. Trim once stable.
      console.info('[binder][watch] event', JSON.stringify(event.type), paths, '| muted:', muted, '| listeners:', listeners.size)
      // Our own recent write: the in-app op already updated the index, so its file events are noise. This is
      // what keeps an ordinary save from triggering a rescan (and why the binder view need not be open, the
      // index stays fresh for external edits regardless). A rare external edit inside the window is caught by
      // the next event or the next Binder open.
      if (muted) { console.info('[binder][watch] ignored (self-write / muted)'); return }
      // Loop guard: skip events that are ONLY our own cache writes. Reconcile constantly writes
      // `.documinter/index.sqlite`, so if those reached scheduleReconcile they would reconcile forever. We
      // match the `.documinter/` path SEGMENT (not a root prefix), so it holds regardless of how the OS
      // normalizes the event path vs the Binder root (drive-letter case, short paths, and so on).
      const isCachePath = (path: string): boolean => {
         const normalized = path.replace(/\\/g, '/').toLowerCase()
         return normalized.includes(`/${DOCUMINTER_DIR.toLowerCase()}/`) || normalized.endsWith(`/${DOCUMINTER_DIR.toLowerCase()}`)
      }
      if (paths.length > 0 && paths.every(isCachePath)) { console.info('[binder][watch] ignored (cache-only)'); return }
      console.info('[binder][watch] scheduling reconcile')
      scheduleReconcile()
   }

   // ====
   // Assemble + reconcile, then hand back the backend
   // ====

   const backend: BinderBackend = {
      // Documents (mutations wrapped so their own file writes do not wake the watcher).
      saveDocument: muteThen(saveDocument),
      loadDocument, listDocuments, getDocumentFolderId,
      deleteDocument:    muteThen(deleteDocument),
      duplicateDocument: muteThen(duplicateDocument),
      moveDocument:      muteThen(moveDocument),
      reorderDocuments,   // index-only (sortOrder): its writes live under `.documinter`, already ignored

      // Folders
      getFolder,
      createFolder: muteThen(createFolder),
      renameFolder: muteThen(renameFolder),
      deleteFolder: muteThen(deleteFolder),
      listAllFolders, getFolderChildren, getFolderAncestors,
      moveFolder:   muteThen(moveFolder),
      reorderFolders,     // index-only, same as reorderDocuments

      // Templates
      saveTemplate:   muteThen(saveTemplate),
      listTemplates,
      renameTemplate: muteThen(renameTemplate),
      deleteTemplate: muteThen(deleteTemplate),

      // Bulk / Tin
      collectBinderForTin, collectFolderSubtreeForTin,
      importTin: muteThen(importTin),

      // The FS index is built fresh from the files (always current), so there is nothing to backfill.
      backfillSearchText: () => Promise.resolve(0),

      // Live external-change subscription (arc B). Returns an unsubscribe; the watch itself runs for the
      // whole Binder session and stops in dispose.
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },

      dispose: async () => {
         if (reconcileTimer !== null) clearTimeout(reconcileTimer)
         if (unwatch) { try { unwatch() } catch { /* the watch is already gone */ } }
         await index.close()
      },
   }

   await reconcile()

   // Start the live watcher now the index is in sync. Fire-and-forget: watch() is async but the backend
   // is usable at once; if it fails the app just runs without live external-edit reconciliation.
   void watch(rootPosix, handleWatchEvent, { recursive: true, delayMs: WATCH_DEBOUNCE_MS })
      .then(stop => { unwatch = stop; console.info('[binder][watch] started on', rootPosix) })
      .catch(error => console.error('[binder][watch] FAILED to start the filesystem watcher:', error))

   return backend
}

/**
 * indexReconcile.ts, the PURE classification that makes the index mirror the files on disk.
 *
 * The filesystem backend is the truth on disk; the SQLite index is a rebuildable cache. On open the
 * backend walks the Binder, then hands the index's current rows plus what the walk found to the pure
 * planner here, which decides three things without touching plugin-fs or plugin-sql (so vitest exercises
 * it under jsdom):
 *
 *   reId       , files whose on-disk id must be replaced: a file that carries NO id (freshly dropped in
 *                by Explorer, or a hand-authored .mint), OR a DUPLICATE id shared by two+ files (a copied
 *                .mint). The first occurrence of a shared id keeps it, the rest are re-id'd so no two
 *                files ever claim one identity. The backend mints a fresh UUID and rewrites each of these
 *                so the id persists inside the file.
 *   upsert     , every surviving file with its resolved sortOrder and an idHint. idHint is the id already
 *                inside the file when it keeps it, or null when the file is being re-id'd (the backend
 *                mints it). sortOrder is REUSED from the matching index row when the surviving id was
 *                already indexed (a normal re-scan, or an Explorer move: same id, new path), otherwise
 *                appended after the folder's current max. A reconcile, not a clear-and-rebuild, so a
 *                user's manual document order survives across sessions.
 *   deleteIds  , index rows whose id is no longer backed by any surviving file on disk (the file was
 *                deleted or moved out of the Binder), to be removed from the index.
 *
 * Determinism: scanned files are processed in path order, so the "first occurrence" of a duplicate id and
 * every appended sortOrder are stable regardless of the walk order the filesystem returns. That keeps the
 * unit tests simple and the on-disk result reproducible.
 */

// ####################
// # DOCUMENT RECONCILE #
// ####################

/** One document row as the index currently holds it (the fields reconcile needs, not the whole record).
 *  lastOpenedAt is the per-machine "opened" stamp the index owns, preserved across a reconcile like
 *  sortOrder (the file never carries it for an already-indexed id, see the planner). */
export interface ExistingDocumentRow {
   id:           string
   path:         string
   folderId:     string
   sortOrder:    number
   lastOpenedAt: string | undefined
}

/** One `.mint` found on disk. idInFile is the id parsed from the file, or null when it carries none.
 *  lastOpenedAt is the file's own value (a fallback used only for a brand-new id; a re-scan preserves
 *  the index row's value instead). */
export interface ScannedDocument {
   idInFile:     string | null
   path:         string
   folderId:     string
   lastOpenedAt: string | undefined
}

/** One survivor to write into the index. idHint is the id already inside the file (reuse it), or null
 *  when the file is in `reId` and the backend mints the id. sortOrder + lastOpenedAt are already resolved
 *  (the preserved index value for an already-indexed id, the file's value for a brand-new one). */
export interface DocumentUpsertPlan {
   path:         string
   folderId:     string
   sortOrder:    number
   lastOpenedAt: string | undefined
   idHint:       string | null
}

/** The full document plan (see the module header for the semantics of each field). */
export interface ReconcilePlan {
   reId:      ScannedDocument[]
   upsert:    DocumentUpsertPlan[]
   deleteIds: string[]
}

/** Next append position for a folder: one past the current max, or 0 when the folder is empty. */
export function nextSortOrder(existingOrders: number[]): number {
   return existingOrders.reduce((max, order) => Math.max(max, order), -1) + 1
}

/**
 * Classify a filesystem walk against the index's current document rows (see the module header). Pure and
 * deterministic: no I/O, no id minting (the backend mints for every `reId` entry), stable path ordering.
 */
export function reconcileDocuments(
   existing: ExistingDocumentRow[],
   scanned:  ScannedDocument[],
): ReconcilePlan {
   // Stable order by path makes the duplicate keeper and every appended sortOrder reproducible.
   const ordered = [...scanned].sort((first, second) => first.path.localeCompare(second.path))

   const existingById = new Map<string, ExistingDocumentRow>()
   for (const row of existing) existingById.set(row.id, row)

   // Group files by their on-disk id (null ids never collide, they are always re-id'd).
   const filesById = new Map<string, ScannedDocument[]>()
   for (const file of ordered) {
      if (file.idInFile === null) continue
      const group = filesById.get(file.idInFile) ?? []
      group.push(file)
      filesById.set(file.idInFile, group)
   }

   // Per id, exactly one file keeps it. Prefer the file whose path matches that id's existing index row,
   // so an already-indexed original outranks a fresh copy; otherwise the first file by path order.
   const keeperPathById = new Map<string, string>()
   for (const [id, group] of filesById) {
      const existingRow = existingById.get(id)
      const indexedMatch = existingRow ? group.find(file => file.path === existingRow.path) : undefined
      keeperPathById.set(id, (indexedMatch ?? group[0]).path)
   }

   const keepsItsId = (file: ScannedDocument): boolean =>
      file.idInFile !== null && keeperPathById.get(file.idInFile) === file.path

   const reId: ScannedDocument[] = []
   const survivingIds = new Set<string>()
   for (const file of ordered) {
      if (keepsItsId(file)) survivingIds.add(file.idInFile as string)
      else reId.push(file)
   }

   // Append counters per folder start one past the folder's current max index sortOrder.
   const nextByFolder = new Map<string, number>()
   for (const row of existing) {
      const current = nextByFolder.get(row.folderId) ?? 0
      nextByFolder.set(row.folderId, Math.max(current, row.sortOrder + 1))
   }
   const appendSort = (folderId: string): number => {
      const next = nextByFolder.get(folderId) ?? 0
      nextByFolder.set(folderId, next + 1)
      return next
   }

   const upsert: DocumentUpsertPlan[] = ordered.map(file => {
      const idHint = keepsItsId(file) ? file.idInFile : null
      // Reuse the sortOrder AND the lastOpenedAt from the matching index row only when the surviving id
      // is already indexed (a re-scan or a move). A re-id'd or brand-new id appends to the end of its
      // folder and takes the file's lastOpenedAt (the file is the only source for a first-seen id).
      // lastOpenedAt is preserved here, not read back from the file, because loadDocument stamps it into
      // the index alone (per-machine state, never written into the `.mint`), so the file's value would
      // otherwise silently reset the touch on every open.
      const indexedRow = idHint !== null ? existingById.get(idHint) : undefined
      const sortOrder = indexedRow ? indexedRow.sortOrder : appendSort(file.folderId)
      const lastOpenedAt = indexedRow ? indexedRow.lastOpenedAt : file.lastOpenedAt
      return { path: file.path, folderId: file.folderId, sortOrder, lastOpenedAt, idHint }
   })

   const deleteIds = existing.filter(row => !survivingIds.has(row.id)).map(row => row.id)

   return { reId, upsert, deleteIds }
}

// ##################
// # FOLDER RECONCILE #
// ##################

/** The index folder ids no longer backed by a scanned directory (removed out of band in Explorer). The
 *  backend upserts every scanned directory (upsertFolder is idempotent) and deletes these. Trivial by
 *  design: a folder's id IS its path, so folders never collide the way copied documents do. */
export function planFolderDeletes(existingFolderIds: string[], scannedFolderIds: string[]): string[] {
   const scanned = new Set(scannedFolderIds)
   return existingFolderIds.filter(id => !scanned.has(id))
}

/**
 * documentIndex.ts, The native `.documinter/index.sqlite` wrapper (plugin-sql).
 *
 * A thin class over a plugin-sql Database: parameter-binding + delegating ALL shaping/parsing to the
 * pure documentIndexMapping module. This is the rebuildable search/list/sort cache for the filesystem
 * backend. Files are the truth, this index is disposable, losing it costs a rescan.
 *
 * FTS sync (see SCHEMA_STATEMENTS): `documents_fts` is a standalone fts5 table this class keeps in
 * lockstep with `documents` by hand, keyed on `documents.rowid`. Upsert uses ON CONFLICT(id) DO UPDATE
 * so the rowid stays stable across edits, then rewrites the FTS row for that rowid; delete removes both.
 * The text MATCH runs in SQL here; the caller composes the pure `documentComparator` + the NON
 * text parts of `matchesCriteria` (dates, never-opened) on the returned records, so ordering matches the
 * IndexedDB backend exactly.
 *
 * Every value is bound (never string-interpolated) and every call runs a single statement (plugin-sql
 * executes one statement per execute/select).
 */

import Database from '@tauri-apps/plugin-sql'
import type { BinderDocumentRecord, BinderFolderRecord } from '../../types'
import {
   SCHEMA_STATEMENTS,
   INDEX_SCHEMA_VERSION,
   INDEX_SCHEMA_VERSION_KEY,
   documentRecordToRow,
   rowToDocumentRecord,
   folderRecordToRow,
   rowToFolderRecord,
   buildDocumentSearchText,
   escapeFtsQuery,
   type DocumentRow,
   type FolderRow,
} from './documentIndexMapping'

/** The `documents` columns a light record is rebuilt from, in a fixed order (kept off `SELECT *` so the
 *  returned object keys are deterministic and match DocumentRow). rowid is deliberately absent, the
 *  mappers never need it. */
const DOCUMENT_COLUMNS =
   'id, path, folderId, sortOrder, createdAt, updatedAt, lastOpenedAt, title, docTheme, docAccent, schemaVersion, meta_json, sectionTitles_json, preview_json'

/** The `folders` columns, same rationale as DOCUMENT_COLUMNS. */
const FOLDER_COLUMNS = 'path, parentId, name, sortOrder, createdAt, updatedAt'

/** Optional folder scope + free-text search for a card-list query. Sort + date/never-opened criteria are
 *  the caller's to apply (see the class doc-comment), so they are absent here on purpose. */
export interface DocumentIndexQuery {
   folderId?: string
   text?:     string
}

export class DocumentIndex {
   private readonly database: Database

   private constructor(database: Database) {
      this.database = database
   }

   // ====
   // Lifecycle
   // ====

   /**
    * Open (creating if absent) the index at an ABSOLUTE sqlite path. `sqlitePath` is a full path inside
    * the user's Binder, `<binder>/.documinter/index.sqlite`, NOT under appDataDir. plugin-sql's Rust side
    * does `app_config_dir.push(<tail after "sqlite:">)`, and Rust's PathBuf::push REPLACES the base when
    * the pushed component is itself absolute, so prefixing an absolute path with `sqlite:` resolves to
    * that exact file. The caller MUST mkdir the `.documinter/` directory first, plugin-sql creates the DB
    * file but not its parent folder.
    */
   static async open(sqlitePath: string): Promise<DocumentIndex> {
      const database = await Database.load(`sqlite:${sqlitePath}`)
      for (const statement of SCHEMA_STATEMENTS) {
         await database.execute(statement)
      }
      await database.execute(
         `INSERT OR IGNORE INTO meta (key, value) VALUES ($1, $2)`,
         [INDEX_SCHEMA_VERSION_KEY, String(INDEX_SCHEMA_VERSION)],
      )
      return new DocumentIndex(database)
   }

   /** Close the underlying connection pool. */
   async close(): Promise<void> {
      await this.database.close()
   }

   /** Wipe the cached data (documents + their FTS rows + folders) for a full rebuild from the files. The
    *  `meta` schema-version row is kept, the schema itself is unchanged, only the contents are dropped. */
   async clear(): Promise<void> {
      await this.database.execute(`DELETE FROM documents_fts`)
      await this.database.execute(`DELETE FROM documents`)
      await this.database.execute(`DELETE FROM folders`)
   }

   // ====
   // Documents
   // ====

   /** Insert or update one document + its FTS row in lockstep. ON CONFLICT(id) keeps the rowid stable, so
    *  the FTS row for that rowid is rewritten (delete then insert) against the fresh search text. */
   async upsertDocument(record: BinderDocumentRecord, path: string): Promise<void> {
      const row = documentRecordToRow(record, path)
      await this.database.execute(
         `INSERT INTO documents (
            id, path, folderId, sortOrder, createdAt, updatedAt, lastOpenedAt,
            title, docTheme, docAccent, schemaVersion, meta_json, sectionTitles_json, preview_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT(id) DO UPDATE SET
            path = excluded.path,
            folderId = excluded.folderId,
            sortOrder = excluded.sortOrder,
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt,
            lastOpenedAt = excluded.lastOpenedAt,
            title = excluded.title,
            docTheme = excluded.docTheme,
            docAccent = excluded.docAccent,
            schemaVersion = excluded.schemaVersion,
            meta_json = excluded.meta_json,
            sectionTitles_json = excluded.sectionTitles_json,
            preview_json = excluded.preview_json`,
         [
            row.id, row.path, row.folderId, row.sortOrder, row.createdAt, row.updatedAt, row.lastOpenedAt,
            row.title, row.docTheme, row.docAccent, row.schemaVersion, row.meta_json, row.sectionTitles_json, row.preview_json,
         ],
      )
      const rowid = await this.documentRowid(record.id)
      if (rowid === null) return
      await this.database.execute(`DELETE FROM documents_fts WHERE rowid = $1`, [rowid])
      await this.database.execute(
         `INSERT INTO documents_fts (rowid, search_text) VALUES ($1, $2)`,
         [rowid, buildDocumentSearchText(record)],
      )
   }

   /** Remove a document + its FTS row. No-op if the id is absent. */
   async deleteDocument(id: string): Promise<void> {
      const rowid = await this.documentRowid(id)
      if (rowid === null) return
      await this.database.execute(`DELETE FROM documents_fts WHERE rowid = $1`, [rowid])
      await this.database.execute(`DELETE FROM documents WHERE id = $1`, [id])
   }

   /** One light record by id, or null. */
   async getDocumentById(id: string): Promise<BinderDocumentRecord | null> {
      const rows = await this.database.select<DocumentRow[]>(
         `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = $1`,
         [id],
      )
      const row = rows[0]
      return row ? rowToDocumentRecord(row) : null
   }

   /** The current relative path for an id, or null. */
   async getPathById(id: string): Promise<string | null> {
      const rows = await this.database.select<Array<{ path: string }>>(
         `SELECT path FROM documents WHERE id = $1`,
         [id],
      )
      return rows[0]?.path ?? null
   }

   /** The id currently stored at a relative path, or null. */
   async getIdByPath(path: string): Promise<string | null> {
      const rows = await this.database.select<Array<{ id: string }>>(
         `SELECT id FROM documents WHERE path = $1`,
         [path],
      )
      return rows[0]?.id ?? null
   }

   /** Repoint a document at a new relative path (a move / rename). The search text does not include the
    *  path, so no FTS write is needed; the stable rowid is untouched. */
   async setDocumentPath(id: string, newPath: string): Promise<void> {
      await this.database.execute(`UPDATE documents SET path = $1 WHERE id = $2`, [newPath, id])
   }

   /** Relocate a document: its path AND its containing folder in one statement, for a pure move where the
    *  content did not change (a folder rename/move cascade). No file read, no FTS write (the search text
    *  keys on the stable rowid and does not include the path/folder), so a corrupt or missing descendant
    *  file can never desync the index off the already-moved directory. */
   async setDocumentLocation(id: string, newPath: string, newFolderId: string): Promise<void> {
      await this.database.execute(
         `UPDATE documents SET path = $1, folderId = $2 WHERE id = $3`,
         [newPath, newFolderId, id],
      )
   }

   /** Stamp lastOpenedAt (an ISO string). The search text does not include timestamps, no FTS write. */
   async touchLastOpened(id: string, iso: string): Promise<void> {
      await this.database.execute(`UPDATE documents SET lastOpenedAt = $1 WHERE id = $2`, [iso, id])
   }

   /**
    * List light records within an optional folder scope + optional free-text FTS match. Applies ONLY the
    * folder scope and the text MATCH in SQL; sort and the date / never-opened criteria are the caller's
    * to compose (documentComparator + the non-text matchesCriteria), so the result order equals the
    * IndexedDB backend's. An empty / all-punctuation `text` (escapeFtsQuery -> '') skips the MATCH.
    */
   async queryDocuments(filter: DocumentIndexQuery): Promise<BinderDocumentRecord[]> {
      const matchExpression = filter.text ? escapeFtsQuery(filter.text) : ''

      if (matchExpression) {
         const conditions = ['documents_fts MATCH $1']
         const binds: unknown[] = [matchExpression]
         if (filter.folderId !== undefined) {
            conditions.push(`documents.folderId = $${binds.length + 1}`)
            binds.push(filter.folderId)
         }
         const rows = await this.database.select<DocumentRow[]>(
            `SELECT ${DOCUMENT_COLUMNS.split(', ').map(column => `documents.${column}`).join(', ')}
             FROM documents
             JOIN documents_fts ON documents_fts.rowid = documents.rowid
             WHERE ${conditions.join(' AND ')}`,
            binds,
         )
         return rows.map(rowToDocumentRecord)
      }

      if (filter.folderId !== undefined) {
         const rows = await this.database.select<DocumentRow[]>(
            `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE folderId = $1`,
            [filter.folderId],
         )
         return rows.map(rowToDocumentRecord)
      }

      const rows = await this.database.select<DocumentRow[]>(`SELECT ${DOCUMENT_COLUMNS} FROM documents`)
      return rows.map(rowToDocumentRecord)
   }

   // ====
   // Folders
   // ====

   /** Insert or update one folder row (keyed by its path id). */
   async upsertFolder(folder: BinderFolderRecord): Promise<void> {
      const row = folderRecordToRow(folder)
      await this.database.execute(
         `INSERT INTO folders (path, parentId, name, sortOrder, createdAt, updatedAt)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT(path) DO UPDATE SET
             parentId = excluded.parentId,
             name = excluded.name,
             sortOrder = excluded.sortOrder,
             createdAt = excluded.createdAt,
             updatedAt = excluded.updatedAt`,
         [row.path, row.parentId, row.name, row.sortOrder, row.createdAt, row.updatedAt],
      )
   }

   /** Remove one folder row (by path id). Descendant reflow is the caller's job. */
   async deleteFolder(path: string): Promise<void> {
      await this.database.execute(`DELETE FROM folders WHERE path = $1`, [path])
   }

   /** Every folder record in the index. */
   async getAllFolders(): Promise<BinderFolderRecord[]> {
      const rows = await this.database.select<FolderRow[]>(`SELECT ${FOLDER_COLUMNS} FROM folders`)
      return rows.map(rowToFolderRecord)
   }

   /** The direct children of a folder (by parent id). */
   async getFolderChildren(parentId: string): Promise<BinderFolderRecord[]> {
      const rows = await this.database.select<FolderRow[]>(
         `SELECT ${FOLDER_COLUMNS} FROM folders WHERE parentId = $1`,
         [parentId],
      )
      return rows.map(rowToFolderRecord)
   }

   /** One folder record by path id, or null. */
   async getFolderByPath(path: string): Promise<BinderFolderRecord | null> {
      const rows = await this.database.select<FolderRow[]>(
         `SELECT ${FOLDER_COLUMNS} FROM folders WHERE path = $1`,
         [path],
      )
      const row = rows[0]
      return row ? rowToFolderRecord(row) : null
   }

   // ====
   // Internal
   // ====

   /** The implicit rowid backing a document id (the FTS join key), or null when the id is absent. */
   private async documentRowid(id: string): Promise<number | null> {
      const rows = await this.database.select<Array<{ rowid: number }>>(
         `SELECT rowid FROM documents WHERE id = $1`,
         [id],
      )
      return rows[0]?.rowid ?? null
   }
}

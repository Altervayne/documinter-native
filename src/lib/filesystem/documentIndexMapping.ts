/**
 * documentIndexMapping.ts, Pure schema + row/record mappers for the native `.documinter/index.sqlite`.
 *
 * The testable core of the filesystem index: the DDL strings, the flat-row <-> BinderDocumentRecord /
 * BinderFolderRecord mappers, the single-source-of-truth FTS haystack builder, and the user-query
 * escaper. NOTHING here touches @tauri-apps/plugin-sql or async, so vitest imports it under jsdom with
 * no Tauri runtime; documentIndex.ts (the native class) is the only place the plugin appears. The index
 * mirrors the LIGHT record only (no base64, no heavy sections), so the binder card grid stays cheap.
 */

import type { BinderDocumentRecord, BinderFolderRecord } from '../../types'

/** Bumped when the on-disk index shape changes; stored in the `meta` table so a future rebuild can
 *  detect a stale cache and regenerate from the files (the files are the truth, this is a cache). */
export const INDEX_SCHEMA_VERSION = 1

/** The `meta` key holding INDEX_SCHEMA_VERSION. */
export const INDEX_SCHEMA_VERSION_KEY = 'indexSchemaVersion'

// #############
// # SCHEMA DDL #
// #############

/**
 * The full index schema, one CREATE statement per array entry (plugin-sql runs one statement per
 * execute call). All IF NOT EXISTS so open() is idempotent on an existing Binder cache.
 *
 * FTS5 sync approach: `documents_fts` is a STANDALONE fts5 table (NOT external-content), holding one
 * `search_text` column. This module's DocumentIndex is the SOLE writer, so it keeps the FTS row in
 * lockstep with the `documents` row by hand: on upsert it (re)writes `documents_fts(rowid, search_text)`
 * against the document's own `documents.rowid`, on delete it removes both. Standalone was chosen over
 * external-content because it needs no content_rowid triggers or `rebuild` dance, the rowid alignment is
 * explicit and easy to reason about, and a full rebuild from the files is cheap anyway. contentText is
 * NOT a `documents` column: the searchable text lives ONLY inside `documents_fts.search_text` (search is
 * done in SQL, so a reconstructed light record never needs it back), keeping the biggest field unstored
 * on the row.
 */
export const SCHEMA_STATEMENTS: string[] = [
   `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE,
      folderId TEXT,
      sortOrder INTEGER,
      createdAt TEXT,
      updatedAt TEXT,
      lastOpenedAt TEXT,
      title TEXT,
      docTheme TEXT,
      docAccent TEXT,
      schemaVersion INTEGER,
      meta_json TEXT,
      sectionTitles_json TEXT,
      preview_json TEXT
   )`,
   `CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(search_text)`,
   `CREATE TABLE IF NOT EXISTS folders (
      path TEXT PRIMARY KEY,
      parentId TEXT,
      name TEXT,
      sortOrder INTEGER,
      createdAt TEXT,
      updatedAt TEXT
   )`,
   `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
   )`,
]

// ##################
// # DOCUMENT MAPPERS #
// ##################

/** The flat `documents` row shape, as bound on write and returned by plugin-sql on read. Column names
 *  match the DDL verbatim; `sortOrder` / `schemaVersion` are INTEGER, `lastOpenedAt` is nullable. The
 *  three `*_json` columns hold JSON.stringify of meta / sectionTitles / previewSections. */
export interface DocumentRow {
   id:                 string
   path:               string
   folderId:           string
   sortOrder:          number
   createdAt:          string
   updatedAt:          string
   lastOpenedAt:       string | null
   title:              string
   docTheme:           string
   docAccent:          string
   schemaVersion:      number
   meta_json:          string
   sectionTitles_json: string
   preview_json:       string
}

/** Flatten a light record + its relative path into a `documents` row. `title` is denormalized out of
 *  meta for cheap SQL sorting; the full meta rides in `meta_json`. `previewSections` is already image-src
 *  stripped by buildPreviewSections (no base64 in `preview_json`). `lastOpenedAt` maps undefined -> null.
 *  contentText is intentionally NOT part of the row (it lives in documents_fts, see SCHEMA_STATEMENTS). */
export function documentRecordToRow(record: BinderDocumentRecord, path: string): DocumentRow {
   return {
      id:                 record.id,
      path,
      folderId:           record.folderId,
      sortOrder:          record.sortOrder,
      createdAt:          record.createdAt,
      updatedAt:          record.updatedAt,
      lastOpenedAt:       record.lastOpenedAt ?? null,
      title:              record.meta.title,
      docTheme:           record.docTheme,
      docAccent:          record.docAccent,
      schemaVersion:      record.schemaVersion,
      meta_json:          JSON.stringify(record.meta),
      sectionTitles_json: JSON.stringify(record.sectionTitles),
      preview_json:       JSON.stringify(record.previewSections),
   }
}

/** Rebuild a light record from a `documents` row: JSON.parse the three json columns, coerce the nullable
 *  lastOpenedAt back to undefined. contentText comes back EMPTY by design, the searchable text is not
 *  stored on the row (it lives in documents_fts) and the query path never reads it back (text matching
 *  runs in SQL via FTS; the caller composes documentComparator + the non-text matchesCriteria on top).
 *  So the round-trip is lossless across every PERSISTED field; contentText is the one deliberate omission. */
export function rowToDocumentRecord(row: DocumentRow): BinderDocumentRecord {
   return {
      id:              row.id,
      meta:            JSON.parse(row.meta_json),
      createdAt:       row.createdAt,
      updatedAt:       row.updatedAt,
      lastOpenedAt:    row.lastOpenedAt ?? undefined,
      folderId:        row.folderId,
      sortOrder:       row.sortOrder,
      sectionTitles:   JSON.parse(row.sectionTitles_json),
      contentText:     '',
      previewSections: JSON.parse(row.preview_json),
      docTheme:        row.docTheme === 'light' ? 'light' : 'dark',
      docAccent:       row.docAccent,
      schemaVersion:   row.schemaVersion,
   }
}

// ################
// # FOLDER MAPPERS #
// ################

/** The flat `folders` row shape. `path` IS the folder id (a directory carries no UUID, so its relative
 *  path is its identity). */
export interface FolderRow {
   path:      string
   parentId:  string
   name:      string
   sortOrder: number
   createdAt: string
   updatedAt: string
}

/** Flatten a folder record into a `folders` row. The record's `id` maps to the `path` primary key. */
export function folderRecordToRow(folder: BinderFolderRecord): FolderRow {
   return {
      path:      folder.id,
      parentId:  folder.parentId,
      name:      folder.name,
      sortOrder: folder.sortOrder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
   }
}

/** Rebuild a folder record from a `folders` row (`path` -> `id`). Lossless round-trip: every folder
 *  field is a stored column. */
export function rowToFolderRecord(row: FolderRow): BinderFolderRecord {
   return {
      id:        row.path,
      name:      row.name,
      parentId:  row.parentId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sortOrder: row.sortOrder,
   }
}

// ##############
// # FTS HAYSTACK #
// ##############

/**
 * Build the single searchable text blob fed into documents_fts.search_text. This MUST equal the exact
 * text `matchesText` in binderSearch.ts searches, so the SQL FTS match sees the same haystack the
 * IndexedDB backend does: title + every meta field's "label value" + every section title + contentText.
 * Mirrors matchesText field-for-field (same order, same join spacing, same lowercase), so the two
 * backends index identical content. This is the ONE source of truth for what goes into the FTS column.
 */
export function buildDocumentSearchText(record: BinderDocumentRecord): string {
   const fieldText = record.meta.fields.map(field => `${field.label} ${field.value}`).join(' ')
   return [
      record.meta.title,
      fieldText,
      record.sectionTitles.join(' '),
      record.contentText ?? '',
   ].join(' ').toLowerCase()
}

// ###############
// # FTS QUERY ESC #
// ###############

/** Any character carrying FTS5 MATCH syntax meaning outside a quoted string (operators, grouping,
 *  column filters, prefix, near). A user typing these must never trigger an FTS5 syntax error. */
const FTS_TOKEN_SEPARATORS = /\s+/
/** A token is only usable once it carries at least one letter or number; a pure-punctuation token
 *  (e.g. "-", "(", "***") tokenizes to an empty phrase, which FTS5 rejects, so it is dropped. */
const HAS_ALPHANUMERIC = /[\p{L}\p{N}]/u

/**
 * Turn a raw user search string into a safe FTS5 MATCH expression. Every whitespace-separated token is
 * emitted as a double-quoted FTS5 string literal with a trailing `*` for prefix matching, so `doc`
 * matches `documinter`. Quoting neutralizes ALL FTS5 syntax punctuation (parens, `-`, `:`, `^`, `*`,
 * `AND`/`OR`/`NEAR`): inside the quotes those are literal characters the tokenizer simply strips.
 * Embedded double-quotes are removed from each token (a search term, not a phrase delimiter), and tokens
 * with no letter/number are dropped so we never emit an empty `""` phrase. Multiple tokens are joined by
 * a space, which FTS5 reads as an implicit AND (every term must match), matching the substring-AND feel
 * of the old free-text filter closely enough for the card list. An empty / whitespace / all-punctuation
 * query returns '' so the caller can skip the MATCH entirely (no text constraint).
 */
export function escapeFtsQuery(userQuery: string): string {
   if (!userQuery) return ''
   const tokens = userQuery.split(FTS_TOKEN_SEPARATORS)
   const terms: string[] = []
   for (const rawToken of tokens) {
      const cleaned = rawToken.replace(/"/g, '')
      if (!cleaned || !HAS_ALPHANUMERIC.test(cleaned)) continue
      terms.push(`"${cleaned}"*`)
   }
   return terms.join(' ')
}

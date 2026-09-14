/**
 * mintFile.ts, the on-disk `.mint` document envelope: serialize + parse + construct.
 *
 * A `.mint` file is the full-fidelity document JSON (the same payload the .documinter.json backup
 * carries, see documentBackupFile.ts) PLUS the native identity + timestamps: a top-level `id` (the
 * stable document UUID that rides INSIDE the file so it survives an Explorer move/rename) and the
 * createdAt / updatedAt / lastOpenedAt / schemaVersion fields the index mirrors. Self-contained: the
 * `sections` array is kept verbatim, inline base64 assets and all, never stripped, that is the whole
 * portability promise (drop one file on another machine and it just works).
 *
 * This is the SINGLE source of truth for turning a document into on-disk bytes and back. It is pure:
 * no plugin-fs, no async, no crypto. Migration goes through assembleLoadedDocument (documentRecord.ts),
 * never reimplemented here, so a `.mint` and a legacy `.documinter.json` run the identical read
 * pipeline. The filesystem backend (a later step) owns the actual file I/O and calls into here.
 */

import { assembleLoadedDocument, RECORD_SCHEMA_VERSION, type LoadedDocument } from '../documentRecord'
import { isDefaultFormat, type DocFormat } from '../format'
import type { DocPresentationExtras } from '../presentation'
import type { DocMeta, Section } from '../../types'

/**
 * The `.mint` envelope in memory. Extends the .documinter.json backup shape (meta + sections +
 * docTheme + docAccent + optional presentation/format) with the native-only identity + lifecycle
 * fields. presentation / format / lastOpenedAt are optional so an untouched, never-opened document
 * stays byte-clean once serialized (see serializeMint's write-guards).
 */
export interface MintFile {
   id:            string
   meta:          DocMeta
   sections:      Section[]
   docTheme:      'light' | 'dark'
   docAccent:     string
   presentation?: DocPresentationExtras
   format?:       DocFormat
   createdAt:     string             // ISO 8601, set once at first save
   updatedAt:     string             // ISO 8601, rewritten on every save
   lastOpenedAt?: string             // ISO 8601, absent until first open
   schemaVersion: number
}

/**
 * The result of parsing on-disk bytes. `loaded` is the migrated, editable document (through the
 * shared read pipeline). The identity + timestamp fields come back null when absent, which is the
 * normal case for a legacy `.documinter.json` or a hand-authored file carrying no native fields: the
 * scanner then mints a fresh id and stamps timestamps. schemaVersion is the file's own, not the
 * migrated record's (that is RECORD_SCHEMA_VERSION on the LoadedDocument side).
 */
export interface ParsedMint {
   id:            string | null
   loaded:        LoadedDocument
   createdAt:     string | null
   updatedAt:     string | null
   lastOpenedAt:  string | null
   schemaVersion: number | null
}

/** The identity + state fields a caller assembles a MintFile from. schemaVersion defaults to
 *  RECORD_SCHEMA_VERSION so the backend never hand-picks it. presentation / format / lastOpenedAt are
 *  carried verbatim; the default-format write-guard is applied at serialize time, not here (mirrors how
 *  downloadJSON guards format at the serialize call site, not in the record builder). */
export interface BuildMintFileParams {
   id:            string
   meta:          DocMeta
   sections:      Section[]
   docTheme:      'light' | 'dark'
   docAccent:     string
   presentation?: DocPresentationExtras
   format?:       DocFormat
   createdAt:     string
   updatedAt:     string
   lastOpenedAt?: string
   schemaVersion?: number
}

/**
 * Serialize a MintFile to pretty (2-space) JSON, the on-disk text. Same conditional write-guards as
 * downloadJSON so an untouched document stays byte-clean: `presentation` is written only when present,
 * `format` only when present AND diverging from the default (isDefaultFormat), and `lastOpenedAt` only
 * when set. So a never-Page-Setup, never-opened document carries neither presentation, format, nor
 * lastOpenedAt.
 */
export function serializeMint(file: MintFile): string {
   const serialized = {
      id:        file.id,
      meta:      file.meta,
      sections:  file.sections,
      docTheme:  file.docTheme,
      docAccent: file.docAccent,
      ...(file.presentation ? { presentation: file.presentation } : {}),
      ...(file.format && !isDefaultFormat(file.format) ? { format: file.format } : {}),
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      ...(file.lastOpenedAt !== undefined ? { lastOpenedAt: file.lastOpenedAt } : {}),
      schemaVersion: file.schemaVersion,
   }
   return JSON.stringify(serialized, null, 2)
}

/**
 * Parse on-disk `.mint` text into a migrated document plus its identity + timestamps, or null when the
 * text is not a Documinter document (bad JSON, missing meta, or a non-array sections). The read pipeline
 * is assembleLoadedDocument (id migration, presentation/format normalization), never reimplemented, so a
 * legacy `.documinter.json` object (no id, no timestamps) parses fine, the identity fields simply come
 * back null. Theme / accent defaults mirror documentBackupFile.ts exactly ('light' / '#2dcea8').
 */
export function parseMint(text: string): ParsedMint | null {
   try {
      const raw = JSON.parse(text) as Partial<MintFile>
      if (!raw || !raw.meta || !Array.isArray(raw.sections)) return null
      const loaded = assembleLoadedDocument({
         meta:      raw.meta,
         sections:  raw.sections,
         docTheme:  raw.docTheme  ?? 'light',
         docAccent: raw.docAccent ?? '#2dcea8',
         presentation: raw.presentation,
         format:    raw.format,
      })
      return {
         id:            typeof raw.id === 'string' ? raw.id : null,
         loaded,
         createdAt:     typeof raw.createdAt === 'string' ? raw.createdAt : null,
         updatedAt:     typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
         lastOpenedAt:  typeof raw.lastOpenedAt === 'string' ? raw.lastOpenedAt : null,
         schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null,
      }
   } catch {
      return null
   }
}

/** Assemble a MintFile from an id + document state + timestamps. A thin constructor so the backend
 *  never hand-builds the envelope: presentation / format / lastOpenedAt are dropped when absent (kept
 *  off the object entirely rather than written as undefined), and schemaVersion defaults to the current
 *  RECORD_SCHEMA_VERSION. The default-format guard is deferred to serializeMint (a stored format rides
 *  verbatim on the in-memory envelope). */
export function buildMintFile(params: BuildMintFileParams): MintFile {
   return {
      id:        params.id,
      meta:      params.meta,
      sections:  params.sections,
      docTheme:  params.docTheme,
      docAccent: params.docAccent,
      ...(params.presentation ? { presentation: params.presentation } : {}),
      ...(params.format ? { format: params.format } : {}),
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      ...(params.lastOpenedAt !== undefined ? { lastOpenedAt: params.lastOpenedAt } : {}),
      schemaVersion: params.schemaVersion ?? RECORD_SCHEMA_VERSION,
   }
}

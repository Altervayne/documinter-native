/*
 * The `.tin` format: a gzip-compressed UTF-8 JSON manifest capturing a full binder (or one folder
 * subtree) as one portable file: user templates, every folder (flat, tree rebuilt from parentId), and
 * every self-contained document (images are already inline base64, so no side asset bundle). This is
 * the PURE format layer (manifest shape, marker + version envelope, gzip helpers); the collect / import
 * glue lives in binderBackup.ts.
 */

// -- Lib Imports --
import { slugify } from './text'

// -- Type Imports --
import type { DocMeta, Section } from '../types'
import type { TemplateChrome } from './documentTemplate'
import type { DocPresentationExtras } from './presentation'
import type { DocFormat } from './format'

// #########
// # TYPES #
// #########

/** Current on-disk format version. A file whose schemaVersion is higher than this is refused
 *  rather than mis-parsed; read-time record migrators heal anything at or below it on import. */
export const TIN_SCHEMA_VERSION = 1

/** A user template inside a Tin: the portable chrome plus its display name. No id / timestamps,
 *  those are per-install and re-minted on import (like the single-template `.template` file). */
export type TinTemplate = { name: string } & TemplateChrome

/** A folder inside a Tin: the BinderFolderRecord fields, flat. The tree is rebuilt from parentId
 *  on import ('0' = the root sentinel, which is never itself a record). */
export interface TinFolder {
   id:        string
   name:      string
   parentId:  string
   sortOrder: number
   createdAt: string
   updatedAt: string
}

/** A document inside a Tin: its binder placement (folderId / sortOrder / timestamps) plus the full
 *  self-contained body. Every image, watermark and band logo is already inline base64 in `sections`
 *  / `presentation`, so a document needs no separate asset payload. */
export interface TinDocument {
   id:        string
   meta:      DocMeta
   folderId:  string
   sortOrder: number
   createdAt: string
   updatedAt: string
   docTheme:  'light' | 'dark'
   docAccent: string
   sections:  Section[]
   presentation?: DocPresentationExtras
   format?:       DocFormat
}

/** The whole manifest, before gzip. `templates` is empty for a folder-subtree export (a subtree
 *  Tin carries structure + documents, never the app-wide templates). */
export interface TinFile {
   documinterTin: true
   schemaVersion: number
   exportedAt:    string
   templates:     TinTemplate[]
   folders:       TinFolder[]
   documents:     TinDocument[]
}

// #####################
// # SERIALIZE / PARSE #
// #####################

/** Serialize a manifest to compact JSON. No pretty-print: gzip handles the size, and a Tin is
 *  never hand-read. */
export function serializeTin(tin: TinFile): string {
   return JSON.stringify(tin)
}

/**
 * Parse a manifest string, or null if it is not a valid Tin (never throws). Rejects non-JSON, a missing
 * `documinterTin` marker, a schemaVersion above what this build knows, and a non-array templates /
 * folders / documents. Per-record healing happens later on import.
 */
export function parseTin(text: string): TinFile | null {
   try {
      const raw = JSON.parse(text) as Partial<TinFile>
      if (raw.documinterTin !== true) return null
      if (typeof raw.schemaVersion !== 'number' || !Number.isFinite(raw.schemaVersion)) return null
      if (raw.schemaVersion > TIN_SCHEMA_VERSION) return null
      if (!Array.isArray(raw.templates) || !Array.isArray(raw.folders) || !Array.isArray(raw.documents)) return null
      return raw as TinFile
   } catch {
      return null
   }
}

// ###############
// # COMPRESSION #
// ###############
// Native gzip via the Web Streams CompressionStream / DecompressionStream globals (present in the Node
// test runner and every browser the PWA targets). A corrupt gzip stream rejects the returned promise,
// so the caller catches it rather than a partial result leaking through.

/** Gzip a UTF-8 string to its compressed bytes. */
export async function gzipString(text: string): Promise<Uint8Array> {
   const source     = new Blob([text]).stream()
   const compressed = source.pipeThrough(new CompressionStream('gzip'))
   const collected  = await new Response(compressed).arrayBuffer()
   return new Uint8Array(collected)
}

/** Gunzip compressed bytes back to a UTF-8 string. Rejects on a genuinely corrupt gzip stream
 *  (the caller catches and reports it), never on valid input. */
export async function gunzipToString(data: ArrayBuffer | Uint8Array): Promise<string> {
   // Copy into a fresh ArrayBuffer-backed view: an incoming Uint8Array may sit on a SharedArrayBuffer,
   // which BlobPart rejects, and the copy is negligible next to the decompression itself.
   const view     = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)
   const source   = new Blob([view]).stream()
   const inflated = source.pipeThrough(new DecompressionStream('gzip'))
   const collected = await new Response(inflated).arrayBuffer()
   return new TextDecoder().decode(collected)
}

// ############
// # DOWNLOAD #
// ############

/** The download filename for a Tin: a slug + the export date, `.tin`. Whole-binder exports pass
 *  'documinter-binder', a folder subtree passes the folder name. The date comes from the manifest's
 *  own exportedAt so the file is stamped with the moment it was collected. */
export function tinDownloadName(baseName: string, exportedAt: string): string {
   const date = exportedAt.slice(0, 10)   // the YYYY-MM-DD head of the ISO 8601 timestamp
   return `${slugify(baseName)}-${date}.tin`
}

/** Serialize + gzip a manifest and hand it to the browser as a download. The Blob + anchor idiom
 *  mirrors downloadJSON in documentBackupFile. Scratch tabs never saved to the binder are not stored
 *  records, so they are never in a Tin: save open documents first to include them. */
export async function downloadTin(tin: TinFile, fileName: string): Promise<void> {
   const bytes  = await gzipString(serializeTin(tin))
   // Copy into a fresh ArrayBuffer-backed view: the gzip bytes are typed over ArrayBufferLike, which
   // may be a SharedArrayBuffer, and BlobPart rejects that. The copy is negligible next to the gzip.
   const blob   = new Blob([new Uint8Array(bytes)], { type: 'application/gzip' })
   const url    = URL.createObjectURL(blob)
   const anchor = document.createElement('a')
   anchor.href     = url
   anchor.download = fileName
   anchor.click()
   URL.revokeObjectURL(url)
}

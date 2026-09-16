/*
 * Storage-agnostic document record logic shared by every binder backend: the pure record-building and
 * read-time migration bodies, no transaction plumbing. Both backends import the SAME builders and
 * migrators, so they emit byte-identical light records and run the identical read-time pipeline.
 */

import { buildPreviewSections, extractDocumentText } from './documentPreview'
import { migrateIds, migrateMeta, migrateFormatPageBreaks, migrateFormatBands } from './documentMigration'
import { normalizePresentation, type DocPresentationExtras } from './presentation'
import { normalizeFormat, type DocFormat } from './format'
import { cloneBlock } from './document'
import type {
   DocMeta, Section,
   BinderDocumentRecord, BinderDocumentContent,
} from '../types'

export const RECORD_SCHEMA_VERSION = 4   // v4: field zones (position) + color on freeform meta

/** Full editable document returned by loadDocument, DocState plus presentation. `updatedAt` is the disk
 *  version this read reflects, so a tab can record which version it is in sync with in one round trip. */
export interface LoadedDocument {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
   format?: DocFormat
   updatedAt: string
}

/** Persisted per-document alongside the DocState. `presentation` carries the image-bearing export /
 *  editor extras (watermark, ...); `format` rides the same bundle, absent means infinite / normal
 *  behavior. Storage-agnostic, so both backends bundle the same shape. */
export interface DocPresentation {
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
   format?: DocFormat
}

// ####################
// # LIGHT RECORD BUILD #
// ####################

/** The caller-supplied identity + placement + presentation fields. Everything derived (sectionTitles,
 *  contentText, previewSections, schemaVersion) comes from `sections`, so save and duplicate can never
 *  drift there. `meta` is taken verbatim; the caller chooses live-state vs migrated. */
export interface DocumentRecordParams {
   id:           string
   meta:         DocMeta
   sections:     Section[]
   docTheme:     'light' | 'dark'
   docAccent:    string
   createdAt:    string
   updatedAt:    string
   lastOpenedAt: string | undefined
   folderId:     string
   sortOrder:    number
}

/** The light card record (no sections, no base64). Derived fields come from `sections`. */
export function buildDocumentRecord(params: DocumentRecordParams): BinderDocumentRecord {
   return {
      id:            params.id,
      meta:          params.meta,
      createdAt:     params.createdAt,
      updatedAt:     params.updatedAt,
      lastOpenedAt:  params.lastOpenedAt,
      folderId:      params.folderId,
      sortOrder:     params.sortOrder,
      sectionTitles: params.sections.map(section => section.title),
      contentText:   extractDocumentText(params.sections),
      previewSections: buildPreviewSections(params.sections),
      docTheme:      params.docTheme,
      docAccent:     params.docAccent,
      schemaVersion: RECORD_SCHEMA_VERSION,
   }
}

// #####################
// # HEAVY CONTENT BUILD #
// #####################

/** Spread onto a heavy content record. An absent field is omitted, never written as `undefined`, so
 *  an untouched document stays byte-clean. */
export interface DocumentContentExtras {
   presentation?: DocPresentationExtras
   format?: DocFormat
}

/** The heavy content record (full sections, base64 retained). Presentation and format spread in only
 *  when present. The default-format guard is NOT here: it is save-specific and stays at the save call
 *  site; duplicate passes source.format verbatim. */
export function buildDocumentContent(id: string, sections: Section[], extras: DocumentContentExtras): BinderDocumentContent {
   return {
      id,
      sections,
      ...(extras.presentation ? { presentation: extras.presentation } : {}),
      ...(extras.format ? { format: extras.format } : {}),
   }
}

/** Deep-clone sections with fresh section + block ids, so no aliasing between copies. The id factory
 *  is injectable, so the function stays testable without stubbing global crypto. */
export function cloneSectionsWithFreshIds(sections: Section[], newId: () => string = () => crypto.randomUUID()): Section[] {
   return sections.map(section => ({
      ...section,
      id:     newId(),
      blocks: section.blocks.map(cloneBlock),
   }))
}

// ####################
// # READ-TIME ASSEMBLY #
// ####################

/** The raw stored halves fed into assembleLoadedDocument: the light record's meta + presentation
 *  fields plus the heavy record's sections + format. */
export interface LoadedDocumentInput {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
   format?: DocFormat
   // The disk version this document reflects. Absent for a builder with no timestamp on hand (a Tin
   // record, a bare-meta assemble); each loadDocument site fills it from the record / parsed file.
   updatedAt?: string
}

/** The read-time pipeline: migrate ids first (so page-break anchors resolve against the migrated block
 *  ids), then normalize presentation and format after their own legacy migrations. Absent presentation
 *  collapses to undefined; absent format becomes DEFAULT_FORMAT. */
export function assembleLoadedDocument(input: LoadedDocumentInput): LoadedDocument {
   const migrated = migrateIds({ meta: input.meta, sections: input.sections })
   return {
      meta: migrated.meta,
      sections: migrated.sections,
      docTheme: input.docTheme,
      docAccent: input.docAccent,
      // Normalize defensively on read: clamp opacity, drop an empty-src watermark.
      presentation: normalizePresentation(input.presentation),
      format: normalizeFormat(migrateFormatBands(migrateFormatPageBreaks(input.format, migrated.sections))),
      updatedAt: input.updatedAt ?? '',
   }
}

/** Normalize a light record's legacy flat meta up to the freeform { title, fields } shape on read.
 *  Shared by every backend's list reader. */
export function migrateListRecord(record: BinderDocumentRecord): BinderDocumentRecord {
   return { ...record, meta: migrateMeta(record.meta) }
}

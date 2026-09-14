/**
 * documentRecord.ts, Storage-agnostic document record logic shared by every binder backend.
 *
 * The pure record-building and read-time migration bodies that used to live inline in the IndexedDB
 * functions of binderDocuments. They carry no transaction plumbing, so a future filesystem backend
 * imports the SAME builders and migrators, and both backends emit byte-identical light records and
 * run the identical read-time pipeline. No IndexedDB, no async, no crypto side effects beyond the
 * injectable id factory in cloneSectionsWithFreshIds.
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

export const RECORD_SCHEMA_VERSION = 4   // v4 adds field zones (position) + color to freeform meta
                                  // (v3 moved meta to the freeform { title, fields } shape;
                                  //  v2 added contentText, the flattened block text for full-text search)

/** Full editable document returned by loadDocument, DocState plus presentation. */
export interface LoadedDocument {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
   format?: DocFormat
}

// ####################
// # LIGHT RECORD BUILD #
// ####################

/** The caller-supplied identity + placement + presentation fields for one light record. Everything
 *  else (sectionTitles, contentText, previewSections, schemaVersion) derives from `sections` here, so
 *  save and duplicate can never drift on the derived shape. `meta` is taken verbatim: save passes the
 *  live state meta, duplicate passes a migrated copy, and that difference is the caller's to make. */
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

/** Build the light card record (no sections, no base64) exactly as saveDocument and duplicateDocument
 *  did inline. The derived fields (sectionTitles / contentText / previewSections) come from `sections`,
 *  the rest passes through from the caller. */
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

/** The optional presentation bundle spread onto a heavy content record. Both fields are conditional:
 *  an absent one is omitted, never written as `undefined`, so an untouched document stays byte-clean. */
export interface DocumentContentExtras {
   presentation?: DocPresentationExtras
   format?: DocFormat
}

/** Build the heavy content record (full sections, base64 retained). The presentation and format
 *  spreads are conditional exactly as the two inline call sites were: absent stays absent. The
 *  default-format guard is NOT here, it is save-specific intent and stays at the save call site (it
 *  passes format only when it diverges from the default); duplicate passes source.format verbatim. */
export function buildDocumentContent(id: string, sections: Section[], extras: DocumentContentExtras): BinderDocumentContent {
   return {
      id,
      sections,
      ...(extras.presentation ? { presentation: extras.presentation } : {}),
      ...(extras.format ? { format: extras.format } : {}),
   }
}

/** Deep-clone sections with fresh section + block ids (no aliasing between copies), used by duplicate.
 *  The id factory is injectable (defaulting to crypto.randomUUID) so the function stays pure-ish and
 *  testable without stubbing global crypto. */
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
 *  fields plus the heavy record's sections + presentation + format. */
export interface LoadedDocumentInput {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   presentation?: DocPresentationExtras
   format?: DocFormat
}

/** Run the read-time pipeline that turns a stored record + content into an editable LoadedDocument:
 *  migrate ids first (so page-break anchors resolve against the migrated block ids), normalize the
 *  presentation extras defensively (mirror of migrateMeta), and normalize the format after its own
 *  legacy migrations. Absent presentation collapses to undefined; absent format becomes DEFAULT_FORMAT
 *  (see normalizeFormat). */
export function assembleLoadedDocument(input: LoadedDocumentInput): LoadedDocument {
   const migrated = migrateIds({ meta: input.meta, sections: input.sections })
   return {
      meta: migrated.meta,
      sections: migrated.sections,
      docTheme: input.docTheme,
      docAccent: input.docAccent,
      // Presentation extras ride on the heavy content record; normalize defensively on read
      // (clamp opacity, drop an empty-src watermark), the mirror of migrateMeta for metadata.
      presentation: normalizePresentation(input.presentation),
      // format normalizes to a concrete DocFormat even when absent (unlike presentation, which
      // collapses to undefined), see normalizeFormat: absent -> DEFAULT_FORMAT (infinite/normal).
      format: normalizeFormat(migrateFormatBands(migrateFormatPageBreaks(input.format, migrated.sections))),
   }
}

/** Normalize a stored light record's legacy flat meta up to the freeform { title, fields } shape on
 *  read, so the cards + free-text search always see the current shape. One source of truth shared by
 *  the IndexedDB list reader and any future filesystem index reader. */
export function migrateListRecord(record: BinderDocumentRecord): BinderDocumentRecord {
   return { ...record, meta: migrateMeta(record.meta) }
}

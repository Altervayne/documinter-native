/**
 * storage.ts — Saving and loading documents.
 *
 * Exports: readAutosave, writeAutosave, downloadJSON, loadJSONFile,
 *          AutosaveData
 *
 * Covers three persistence mechanisms:
 *   1. Autosave  — debounced writes to localStorage, read on startup
 *   2. JSON file — manual download/load of .documinter.json backups
 */

import { slugify } from './text'
import { parseInlineContent, stripTrailingNewlines } from './inline'
import { cloneBlock } from './document'
import type {
   Block, DocMeta, DocState, InlineContent, ListItem, Section,
   BinderDocumentRecord, BinderDocumentContent, BinderFolderRecord, PreviewSection,
} from '../types'

// Fields present in JSON files saved before the InlineContent migration.
// Not part of the canonical types, kept here only for migration reads.
type LegacyRawBlock = Block & { text?: string; headers?: string[]; rows?: string[][] }

/**
 * Normalize a raw list item from any historical format to the current ListItem shape.
 * Handles: plain strings (very old), objects without id, objects with string[] children.
 * Also populates richText from the legacy text field if richText is absent.
 */
function migrateListItem(raw: unknown): ListItem {
   if (typeof raw === 'string') {
      return { id: crypto.randomUUID(), richText: parseInlineContent(raw), children: [] }
   }
   const obj        = raw as Record<string, unknown>
   const id         = typeof obj.id === 'string'   ? obj.id       : crypto.randomUUID()
   const legacyText = typeof obj.text === 'string' ? obj.text     : ''
   const children   = Array.isArray(obj.children)  ? obj.children : []
   const richText   = Array.isArray(obj.richText)
      ? stripTrailingNewlines(obj.richText as InlineContent)
      : parseInlineContent(legacyText)
   return { id, richText, children: children.map(migrateListItem) }
}

/**
 * Convert any legacy numeric IDs to strings, normalize list items, and populate the
 * new InlineContent fields (richText, richHeaders, richRows) from legacy string fields
 * if they are absent.
 */
function migrateBlock(rawBlock: LegacyRawBlock): Block {
   const base: LegacyRawBlock = { ...rawBlock, id: String(rawBlock.id) }

   if (base.type === 'container') {
      return {
         ...base,
         left:  (base.left  ?? []).map(block => migrateBlock(block as LegacyRawBlock)),
         right: (base.right ?? []).map(block => migrateBlock(block as LegacyRawBlock)),
      }
   }

   if (base.type === 'list' && Array.isArray(base.items)) {
      return { ...base, items: base.items.map(migrateListItem) }
   }

   // Paragraph / heading / callout — populate richText from legacy text if absent
   if (base.type === 'p' || base.type === 'h3' || base.type === 'h4' || base.type === 'callout') {
      if (!Array.isArray(base.richText)) {
         const { text: _text, ...clean } = base
         return { ...clean, richText: parseInlineContent(_text ?? '') }
      }
      // richText is already an array — strip any trailing newline runs that may
      // have been saved before stripTrailingNewlines was added to domToInlineContent.
      // Without this, a stored [{ text: '\n' }] renders to '<br>' and the element
      // matches the :has(> br:only-child) placeholder CSS rule, showing the
      // placeholder on a block the user considers to have content.
      const { text: _text, ...clean } = base
      return { ...clean, richText: stripTrailingNewlines(base.richText) }
   }

   // Table — populate richHeaders and richRows from legacy string fields if absent
   if (base.type === 'table') {
      const richHeaders = Array.isArray(base.richHeaders)
         ? base.richHeaders
         : Array.isArray(base.headers)
            ? base.headers.map(header => parseInlineContent(header))
            : undefined
      const richRows = Array.isArray(base.richRows)
         ? base.richRows
         : Array.isArray(base.rows)
            ? base.rows.map(row => row.map(cell => parseInlineContent(cell)))
            : undefined
      const { headers: _h, rows: _r, text: _t, ...clean } = base
      return { ...clean, ...(richHeaders ? { richHeaders } : {}), ...(richRows ? { richRows } : {}) }
   }

   // All other block types: strip any stray legacy fields
   const { text: _text, headers: _h, rows: _r, ...clean } = base
   return clean
}

function migrateIds(state: DocState): DocState {
   return {
      ...state,
      sections: state.sections.map((sec: Section) => ({
         ...sec,
         id: String(sec.id),
         blocks: sec.blocks.map(migrateBlock),
      })),
   }
}

// ############
// # AUTOSAVE #
// ############

const AUTOSAVE_KEY = 'documinter-autosave'

export interface AutosaveData {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
}

/** Read the autosaved document from localStorage. Returns null if absent or malformed. */
export function readAutosave(): AutosaveData | null {
   try {
      const raw = localStorage.getItem(AUTOSAVE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw) as Partial<AutosaveData>
      if (!data.meta || !Array.isArray(data.sections)) return null
      const migrated = migrateIds({ meta: data.meta, sections: data.sections })
      return {
         meta:      migrated.meta,
         sections:  migrated.sections,
         docTheme:  data.docTheme  ?? 'light',
         docAccent: data.docAccent ?? '#2dcea8',
      }
   } catch {
      return null
   }
}

/** Write the current document state to localStorage. Called on a debounce in App.tsx. */
export function writeAutosave(data: AutosaveData): void {
   localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data))
}

/** Remove the legacy localStorage autosave key (after a successful IndexedDB migration). */
export function clearLegacyAutosave(): void {
   localStorage.removeItem(AUTOSAVE_KEY)
}

// #############################
// # JSON FILE (MANUAL BACKUP) #
// #############################

/** Trigger a browser download of the document as a .documinter.json file. */
export function downloadJSON(meta: DocMeta, sections: Section[]): void {
   const state: DocState = { meta, sections }
   const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' })
   const url = URL.createObjectURL(blob)
   const anchor = document.createElement('a')
   anchor.href = url
   anchor.download = slugify(meta.title) + '.documinter.json'
   anchor.click()
   URL.revokeObjectURL(url)
}

/** Open a file picker for .json files and parse the selected file as a DocState. */
export function loadJSONFile(
   onLoad: (state: DocState) => void,
   onError: (msg: string) => void,
): void {
   const input = document.createElement('input')
   input.type = 'file'
   input.accept = '.json'
   input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (event) => {
         try {
            const raw = JSON.parse(event.target?.result as string) as DocState
            if (!raw.meta || !Array.isArray(raw.sections)) {
               onError('Invalid Documinter JSON file.')
               return
            }
            onLoad(migrateIds(raw))
         } catch {
            onError('Could not parse JSON file.')
         }
      }
      reader.readAsText(file)
   }
   input.click()
}

// ############################################################
// IndexedDB — binder document library
//
// Two stores keyed by the same id:
//   documents        — lightweight BinderDocumentRecord (meta, timestamps, preview)
//   documentContent  — heavy BinderDocumentContent (full sections, base64 images)
// Splitting them lets listDocuments() read only the light store, never
// deserializing base64, so the binder card grid stays cheap.
// ############################################################

const DATABASE_NAME          = 'documinter'
const DOCUMENTS_STORE        = 'documents'
const DOCUMENT_CONTENT_STORE = 'documentContent'
const FOLDERS_STORE          = 'folders'
const UPDATED_AT_INDEX       = 'by_updatedAt'
const FOLDER_ID_INDEX        = 'by_folderId'
const SORT_ORDER_INDEX       = 'by_sortOrder'
const PARENT_ID_INDEX        = 'by_parentId'
const ROOT_FOLDER_ID         = '0'
const PREVIEW_BLOCK_COUNT    = 8
const RECORD_SCHEMA_VERSION  = 2   // v2 adds contentText (flattened block text for full-text search)

/** Presentation settings persisted per-document alongside the DocState. */
export interface DocPresentation {
   docTheme:  'light' | 'dark'
   docAccent: string
}

/** Full editable document returned by loadDocument — DocState plus presentation. */
export interface LoadedDocument {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
}

export type DocumentSortBy = 'updatedAt' | 'createdAt' | 'lastOpenedAt' | 'title' | 'manual'

/** Per-field targeted text queries (each an independent case-insensitive substring, all ANDed). */
export interface FieldQuery {
   title?:         string
   module?:        string
   env?:           string
   author?:        string
   date?:          string
   sectionTitles?: string
   content?:       string
}

/** The three timestamps a search can constrain. */
export type DocumentDateField = 'updatedAt' | 'createdAt' | 'lastOpenedAt'

/** The three date fields in display order — also drives matching iteration. */
export const DOCUMENT_DATE_FIELDS: DocumentDateField[] = ['updatedAt', 'createdAt', 'lastOpenedAt']

/**
 * A single date-field constraint. An inclusive lower bound (from) expresses "after", an
 * inclusive upper bound (to) expresses "before", and both together express a "between" range.
 * Bounds are 'YYYY-MM-DD' calendar days compared against the day portion of the ISO timestamp.
 */
export interface DateFilter {
   from?: string
   to?:   string
}

/**
 * Multi-criteria search. Every present criterion is ANDed together. Each of the three date
 * fields may carry its own independent constraint simultaneously. hasNeverOpened keeps only
 * documents that have no lastOpenedAt. Folder scoping is handled by DocumentListFilter.folderId,
 * not here.
 */
export interface SearchCriteria {
   text?:           string                                   // global full-text: meta + section titles + contents
   fields?:         FieldQuery                               // targeted per-field substrings
   dates?:          Partial<Record<DocumentDateField, DateFilter>>
   hasNeverOpened?: boolean
}

/** Filter/sort/search options for listDocuments. */
export interface DocumentListFilter {
   folderId?: string                  // folder scope (undefined = all folders)
   sortBy?:   DocumentSortBy          // default 'updatedAt'
   sortDir?:  'asc' | 'desc'          // default 'desc'; ignored for 'manual'
   criteria?: SearchCriteria          // multi-criteria search (all ANDed; within folderId scope)
}

// ========================================
//  Internal: connection + promise wrappers
// ========================================

let databasePromise: Promise<IDBDatabase> | null = null

/**
 * Create any missing store/index (idempotent). Called from onupgradeneeded — safe to run
 * from any prior version; repairs partial schemas and handles fresh installs identically.
 */
function ensureSchema(database: IDBDatabase, transaction: IDBTransaction): void {
   if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
      database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' })
   }
   if (!database.objectStoreNames.contains(DOCUMENT_CONTENT_STORE)) {
      database.createObjectStore(DOCUMENT_CONTENT_STORE, { keyPath: 'id' })
   }
   if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
      database.createObjectStore(FOLDERS_STORE, { keyPath: 'id' })
   }

   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   if (!documentsStore.indexNames.contains(UPDATED_AT_INDEX)) documentsStore.createIndex(UPDATED_AT_INDEX, 'updatedAt', { unique: false })
   if (!documentsStore.indexNames.contains(FOLDER_ID_INDEX))  documentsStore.createIndex(FOLDER_ID_INDEX, 'folderId', { unique: false })
   if (!documentsStore.indexNames.contains(SORT_ORDER_INDEX)) documentsStore.createIndex(SORT_ORDER_INDEX, 'sortOrder', { unique: false })

   const foldersStore = transaction.objectStore(FOLDERS_STORE)
   if (!foldersStore.indexNames.contains(PARENT_ID_INDEX)) foldersStore.createIndex(PARENT_ID_INDEX, 'parentId', { unique: false })

   // Backfill folderId / sortOrder / lastOpenedAt on any documents that predate them.
   const cursorRequest = documentsStore.openCursor()
   cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const record = cursor.value as Partial<BinderDocumentRecord>
      let changed = false
      if (record.folderId === undefined)  { record.folderId = ROOT_FOLDER_ID; changed = true }
      if (record.sortOrder === undefined) { record.sortOrder = 0;             changed = true }
      if (!('lastOpenedAt' in record))    { record.lastOpenedAt = undefined;  changed = true }
      if (changed) cursor.update(record)
      cursor.continue()
   }
}

/** True when every required store + index exists in the live database. */
function hasCompleteSchema(database: IDBDatabase): boolean {
   if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) return false
   if (!database.objectStoreNames.contains(DOCUMENT_CONTENT_STORE)) return false
   if (!database.objectStoreNames.contains(FOLDERS_STORE)) return false
   try {
      const transaction     = database.transaction([DOCUMENTS_STORE, FOLDERS_STORE], 'readonly')
      const documentIndexes = transaction.objectStore(DOCUMENTS_STORE).indexNames
      const folderIndexes   = transaction.objectStore(FOLDERS_STORE).indexNames
      return documentIndexes.contains(UPDATED_AT_INDEX)
          && documentIndexes.contains(FOLDER_ID_INDEX)
          && documentIndexes.contains(SORT_ORDER_INDEX)
          && folderIndexes.contains(PARENT_ID_INDEX)
   } catch {
      return false
   }
}

/** Open the database at a specific version, or (version omitted) at its current version. */
function openAtVersion(version?: number): Promise<IDBDatabase> {
   return new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
         request = version === undefined ? indexedDB.open(DATABASE_NAME) : indexedDB.open(DATABASE_NAME, version)
      } catch (error) {
         reject(error instanceof Error ? error : new Error('IndexedDB is unavailable'))
         return
      }
      request.onupgradeneeded = () => {
         const transaction = request.transaction
         if (transaction) ensureSchema(request.result, transaction)
      }
      request.onsuccess = () => {
         const database = request.result
         // If another tab requests a version upgrade, close so it isn't blocked.
         database.onversionchange = () => { database.close(); databasePromise = null }
         resolve(database)
      }
      request.onerror   = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab'))
   })
}

/**
 * Open the binder database, self-healing a partial/old schema. Opens at the current version
 * first; if any required store/index is missing (e.g. a database left at a version without
 * the folders store), reopens one version higher to force onupgradeneeded to repair it —
 * independent of the version number, so it works even when the DB is already "current".
 * Cached singleton; consumers never call this directly.
 */
function openDatabase(): Promise<IDBDatabase> {
   if (databasePromise) return databasePromise
   databasePromise = (async () => {
      try {
         let database = await openAtVersion()
         if (!hasCompleteSchema(database)) {
            const repairVersion = database.version + 1
            database.close()
            database = await openAtVersion(repairVersion)
         }
         return database
      } catch (error) {
         databasePromise = null
         throw error instanceof Error ? error : new Error('Failed to open IndexedDB')
      }
   })()
   return databasePromise
}

/** Resolve when an IDBRequest succeeds, reject on error. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
   return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror   = () => reject(request.error ?? new Error('IndexedDB request failed'))
   })
}

/** Resolve when a transaction commits, reject on error/abort. */
function transactionDone(transaction: IDBTransaction): Promise<void> {
   return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror    = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
      transaction.onabort    = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
   })
}

// ===========================================
//  Internal: preview snapshot builders (pure)
// ===========================================

/** Structural copy of a block with image src removed (recurses into containers). */
function stripImageSource(block: Block): Block {
   if (block.type === 'image') return { ...block, src: '' }
   if (block.type === 'container') {
      return {
         ...block,
         left:  (block.left  ?? []).map(stripImageSource),
         right: (block.right ?? []).map(stripImageSource),
      }
   }
   return block
}

/**
 * Section-grouped snapshot of the first N blocks (document order), image src stripped.
 * Preserves section titles so the card preview can render recognizable section headings.
 */
function buildPreviewSections(sections: Section[]): PreviewSection[] {
   const result: PreviewSection[] = []
   let count = 0
   for (const section of sections) {
      if (count >= PREVIEW_BLOCK_COUNT) break
      const blocks: Block[] = []
      for (const block of section.blocks) {
         if (count >= PREVIEW_BLOCK_COUNT) break
         blocks.push(stripImageSource(block))
         count++
      }
      result.push({ title: section.title, blocks })
   }
   return result
}

// ======================================
//  Internal: full-text extraction (pure)
// ======================================

/** Concatenate an InlineContent array's run text (formatting dropped). */
function inlineText(content?: InlineContent): string {
   return content ? content.map(run => run.text).join('') : ''
}

/** All searchable plain text within a single block (recurses lists + container columns). */
function blockText(block: Block): string {
   const parts: string[] = []
   if (block.richText) parts.push(inlineText(block.richText))
   if (block.code)     parts.push(block.code)
   if (block.alt)      parts.push(block.alt)
   if (block.caption)  parts.push(block.caption)
   if (block.items) {
      const walkItems = (items: ListItem[]) => {
         for (const item of items) {
            parts.push(inlineText(item.richText))
            if (item.children.length > 0) walkItems(item.children)
         }
      }
      walkItems(block.items)
   }
   if (block.richHeaders) for (const header of block.richHeaders) parts.push(inlineText(header))
   if (block.richRows)    for (const row of block.richRows) for (const cell of row) parts.push(inlineText(cell))
   if (block.left)  for (const inner of block.left)  parts.push(blockText(inner))
   if (block.right) for (const inner of block.right) parts.push(blockText(inner))
   return parts.filter(Boolean).join(' ')
}

/** Flattened plain text of every block across every section (section titles excluded — stored separately). */
function extractDocumentText(sections: Section[]): string {
   const parts: string[] = []
   for (const section of sections) for (const block of section.blocks) parts.push(blockText(block))
   return parts.filter(Boolean).join(' ')
}

// ==============================================
//  Internal: ordering, folder fetch, search/sort
// ==============================================

/** Next manual sort position for a new document appended to the end of a folder. */
async function nextDocumentSortOrder(documentsStore: IDBObjectStore, folderId: string): Promise<number> {
   const siblings = await requestToPromise<BinderDocumentRecord[]>(documentsStore.index(FOLDER_ID_INDEX).getAll(folderId))
   return siblings.reduce((max, sibling) => Math.max(max, sibling.sortOrder), -1) + 1
}

/** Read a single folder record by id (its own readonly transaction). */
async function getFolder(id: string): Promise<BinderFolderRecord | undefined> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readonly')
   return requestToPromise<BinderFolderRecord | undefined>(transaction.objectStore(FOLDERS_STORE).get(id))
}

/** Global full-text match: all metadata fields + section titles + flattened block contents. */
function matchesText(record: BinderDocumentRecord, needle: string): boolean {
   const haystack = [
      record.meta.title, record.meta.module, record.meta.env, record.meta.author, record.meta.date,
      record.sectionTitles.join(' '),
      record.contentText ?? '',
   ].join(' ').toLowerCase()
   return haystack.includes(needle)
}

/** True when needle is empty/whitespace, or is a case-insensitive substring of haystack. */
function fieldMatches(needle: string | undefined, haystack: string): boolean {
   const trimmed = needle?.trim().toLowerCase()
   return !trimmed || haystack.toLowerCase().includes(trimmed)
}

/** The day portion (YYYY-MM-DD) of the record's chosen date field, or undefined if unset. */
function recordDateDay(record: BinderDocumentRecord, field: DocumentDateField): string | undefined {
   const value = field === 'createdAt' ? record.createdAt
      : field === 'lastOpenedAt'        ? record.lastOpenedAt
      :                                   record.updatedAt
   return value ? value.slice(0, 10) : undefined
}

/** True when the record satisfies every present criterion (all ANDed). */
function matchesCriteria(record: BinderDocumentRecord, criteria: SearchCriteria): boolean {
   const text = criteria.text?.trim().toLowerCase()
   if (text && !matchesText(record, text)) return false

   if (criteria.fields) {
      const fields = criteria.fields
      if (!fieldMatches(fields.title,         record.meta.title))            return false
      if (!fieldMatches(fields.module,        record.meta.module))           return false
      if (!fieldMatches(fields.env,           record.meta.env))              return false
      if (!fieldMatches(fields.author,        record.meta.author))           return false
      if (!fieldMatches(fields.date,          record.meta.date))             return false
      if (!fieldMatches(fields.sectionTitles, record.sectionTitles.join(' '))) return false
      if (!fieldMatches(fields.content,       record.contentText ?? ''))     return false
   }

   if (criteria.hasNeverOpened && record.lastOpenedAt !== undefined) return false

   if (criteria.dates) {
      for (const field of DOCUMENT_DATE_FIELDS) {
         const dateFilter = criteria.dates[field]
         if (!dateFilter) continue
         const day = recordDateDay(record, field)
         // A never-opened document has no lastOpenedAt day, so any constraint on it excludes it.
         if (!day) return false
         if (dateFilter.from && day < dateFilter.from) return false
         if (dateFilter.to   && day > dateFilter.to)   return false
      }
   }

   return true
}

/** Comparator for the in-memory document sort. 'manual' ignores direction (always ascending). */
function documentComparator(sortBy: DocumentSortBy, sortDir: 'asc' | 'desc'): (a: BinderDocumentRecord, b: BinderDocumentRecord) => number {
   const direction = sortDir === 'asc' ? 1 : -1
   return (a, b) => {
      switch (sortBy) {
         case 'manual':    return a.sortOrder - b.sortOrder
         case 'title':     return direction * a.meta.title.localeCompare(b.meta.title)
         case 'createdAt': return direction * a.createdAt.localeCompare(b.createdAt)
         case 'lastOpenedAt': {
            // Never-opened documents always sort last, regardless of direction.
            if (!a.lastOpenedAt && !b.lastOpenedAt) return 0
            if (!a.lastOpenedAt) return 1
            if (!b.lastOpenedAt) return -1
            return direction * a.lastOpenedAt.localeCompare(b.lastOpenedAt)
         }
         case 'updatedAt':
         default:          return direction * a.updatedAt.localeCompare(b.updatedAt)
      }
   }
}

// ===========
//  Public API
// ===========

/**
 * Save a document to IndexedDB. With existingId, updates that record (preserving
 * createdAt); otherwise creates a new one. Regenerates previewSections and updatedAt
 * every call. Returns the document id.
 */
export async function saveDocument(
   state: DocState,
   presentation: DocPresentation,
   existingId?: string,
   targetFolderId?: string,
): Promise<string> {
   const database = await openDatabase()
   const id  = existingId ?? crypto.randomUUID()
   const now = new Date().toISOString()

   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)

   // Preserve createdAt / folder placement / lastOpenedAt across updates. Upsert if existingId
   // was passed but is gone. A new record lands in targetFolderId (defaulting to root), appended.
   const existing = existingId
      ? await requestToPromise<BinderDocumentRecord | undefined>(documentsStore.get(existingId))
      : undefined
   const createdAt    = existing?.createdAt ?? now
   const folderId     = existing?.folderId ?? targetFolderId ?? ROOT_FOLDER_ID
   const lastOpenedAt = existing?.lastOpenedAt
   const sortOrder    = existing?.sortOrder ?? await nextDocumentSortOrder(documentsStore, folderId)

   const record: BinderDocumentRecord = {
      id,
      meta:          state.meta,
      createdAt,
      updatedAt:     now,
      lastOpenedAt,
      folderId,
      sortOrder,
      sectionTitles: state.sections.map(section => section.title),
      contentText:   extractDocumentText(state.sections),
      previewSections: buildPreviewSections(state.sections),
      docTheme:      presentation.docTheme,
      docAccent:     presentation.docAccent,
      schemaVersion: RECORD_SCHEMA_VERSION,
   }
   const content: BinderDocumentContent = { id, sections: state.sections }

   documentsStore.put(record)
   contentStore.put(content)
   await transactionDone(transaction)
   return id
}

/** Read the full editable document without side effects. Internal — loadDocument wraps it. */
async function readDocument(id: string): Promise<LoadedDocument | null> {
   const database = await openDatabase()
   const transaction = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readonly')
   const recordRequest  = transaction.objectStore(DOCUMENTS_STORE).get(id)
   const contentRequest = transaction.objectStore(DOCUMENT_CONTENT_STORE).get(id)
   const record  = await requestToPromise<BinderDocumentRecord | undefined>(recordRequest)
   const content = await requestToPromise<BinderDocumentContent | undefined>(contentRequest)
   if (!record || !content) return null
   const migrated = migrateIds({ meta: record.meta, sections: content.sections })
   return { meta: migrated.meta, sections: migrated.sections, docTheme: record.docTheme, docAccent: record.docAccent }
}

/**
 * Load the full editable document (DocState + presentation) by id, or null if absent.
 * Records the open in lastOpenedAt by default; pass { touch: false } for non-open reads
 * (e.g. exporting a document from the binder, which shouldn't count as opening it).
 */
export async function loadDocument(id: string, options?: { touch?: boolean }): Promise<LoadedDocument | null> {
   const document = await readDocument(id)
   if (document && options?.touch !== false) await touchDocument(id)
   return document
}

/** Set lastOpenedAt to now. Called by loadDocument automatically (unless touch:false). */
export async function touchDocument(id: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
   const store = transaction.objectStore(DOCUMENTS_STORE)
   const record = await requestToPromise<BinderDocumentRecord | undefined>(store.get(id))
   if (record) {
      record.lastOpenedAt = new Date().toISOString()
      store.put(record)
   }
   await transactionDone(transaction)
}

/**
 * List document records (light store only — no sections/base64), filtered by folder,
 * searched in-memory, and sorted. Defaults to all folders, updatedAt descending.
 */
export async function listDocuments(filter?: DocumentListFilter): Promise<BinderDocumentRecord[]> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const store = transaction.objectStore(DOCUMENTS_STORE)

   const sourceRequest = filter?.folderId !== undefined
      ? store.index(FOLDER_ID_INDEX).getAll(filter.folderId)
      : store.getAll()
   let records = await requestToPromise<BinderDocumentRecord[]>(sourceRequest)

   if (filter?.criteria) records = records.filter(record => matchesCriteria(record, filter.criteria!))

   records.sort(documentComparator(filter?.sortBy ?? 'updatedAt', filter?.sortDir ?? 'desc'))
   return records
}

/** Permanently delete a document from both stores. Idempotent (absent id is a no-op). */
export async function deleteDocument(id: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   transaction.objectStore(DOCUMENTS_STORE).delete(id)
   transaction.objectStore(DOCUMENT_CONTENT_STORE).delete(id)
   await transactionDone(transaction)
}

/** Copy a document with a fresh id, createdAt, and updatedAt. Returns the new id. */
export async function duplicateDocument(id: string): Promise<string> {
   const database = await openDatabase()
   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)

   const recordRequest  = documentsStore.get(id)
   const contentRequest = contentStore.get(id)
   const sourceRecord  = await requestToPromise<BinderDocumentRecord | undefined>(recordRequest)
   const sourceContent = await requestToPromise<BinderDocumentContent | undefined>(contentRequest)
   if (!sourceRecord || !sourceContent) throw new Error('Cannot duplicate: document not found')

   const newId = crypto.randomUUID()
   const now   = new Date().toISOString()
   // Deep-clone sections with fresh section + block ids (no aliasing between copies).
   const clonedSections: Section[] = sourceContent.sections.map(section => ({
      ...section,
      id:     crypto.randomUUID(),
      blocks: section.blocks.map(cloneBlock),
   }))
   // The copy lands in the same folder, appended to the end, never-opened.
   const sortOrder = await nextDocumentSortOrder(documentsStore, sourceRecord.folderId)

   const newRecord: BinderDocumentRecord = {
      id:            newId,
      meta:          sourceRecord.meta,
      createdAt:     now,
      updatedAt:     now,
      lastOpenedAt:  undefined,
      folderId:      sourceRecord.folderId,
      sortOrder,
      sectionTitles: clonedSections.map(section => section.title),
      contentText:   extractDocumentText(clonedSections),
      previewSections: buildPreviewSections(clonedSections),
      docTheme:      sourceRecord.docTheme,
      docAccent:     sourceRecord.docAccent,
      schemaVersion: RECORD_SCHEMA_VERSION,
   }
   const newContent: BinderDocumentContent = { id: newId, sections: clonedSections }

   documentsStore.put(newRecord)
   contentStore.put(newContent)
   await transactionDone(transaction)
   return newId
}

/**
 * Populate contentText on any pre-v2 records that lack it (one-time, idempotent). Reads each
 * stale document's content to flatten its block text, then rewrites the light record. Returns
 * how many records were updated so the caller can refresh the view. A no-op once all records
 * carry contentText, so it is cheap to call on every binder open.
 */
export async function backfillSearchText(): Promise<number> {
   const database = await openDatabase()
   const readTransaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const allRecords = await requestToPromise<BinderDocumentRecord[]>(readTransaction.objectStore(DOCUMENTS_STORE).getAll())
   const staleRecords = allRecords.filter(record => record.contentText === undefined)
   if (staleRecords.length === 0) return 0

   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)
   for (const record of staleRecords) {
      const content = await requestToPromise<BinderDocumentContent | undefined>(contentStore.get(record.id))
      record.contentText   = content ? extractDocumentText(content.sections) : ''
      record.schemaVersion = RECORD_SCHEMA_VERSION
      documentsStore.put(record)
   }
   await transactionDone(transaction)
   return staleRecords.length
}

// ###########
// # FOLDERS #
// ###########

/** Create a folder under parentId ('0' = root), appended after existing siblings. Returns its id. */
export async function createFolder(name: string, parentId: string): Promise<string> {
   const database = await openDatabase()
   const id  = crypto.randomUUID()
   const now = new Date().toISOString()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const siblings = await requestToPromise<BinderFolderRecord[]>(store.index(PARENT_ID_INDEX).getAll(parentId))
   const sortOrder = siblings.reduce((max, folder) => Math.max(max, folder.sortOrder), -1) + 1
   store.put({ id, name, parentId, createdAt: now, updatedAt: now, sortOrder })
   await transactionDone(transaction)
   return id
}

/** Rename a folder. No-op if the folder is gone. */
export async function renameFolder(id: string, name: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const folder = await requestToPromise<BinderFolderRecord | undefined>(store.get(id))
   if (folder) {
      folder.name = name
      folder.updatedAt = new Date().toISOString()
      store.put(folder)
   }
   await transactionDone(transaction)
}

/**
 * Delete a folder and all descendant folders. Documents in any deleted folder are moved
 * to root (folderId '0'), appended to the end of root in their discovered order.
 */
export async function deleteFolder(id: string): Promise<void> {
   const database = await openDatabase()

   // Phase 1 — collect the folder and all descendants (iterative breadth-first).
   const toDelete: string[] = [id]
   for (let index = 0; index < toDelete.length; index++) {
      const children = await getFolderChildren(toDelete[index])
      for (const child of children) toDelete.push(child.id)
   }

   // Phase 2 — move orphaned documents to root, then delete the folders.
   const transaction    = database.transaction([FOLDERS_STORE, DOCUMENTS_STORE], 'readwrite')
   const foldersStore   = transaction.objectStore(FOLDERS_STORE)
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const folderIndex    = documentsStore.index(FOLDER_ID_INDEX)

   let nextRootSort = await nextDocumentSortOrder(documentsStore, ROOT_FOLDER_ID)
   for (const folderId of toDelete) {
      const documents = await requestToPromise<BinderDocumentRecord[]>(folderIndex.getAll(folderId))
      for (const document of documents) {
         document.folderId = ROOT_FOLDER_ID
         document.sortOrder = nextRootSort++
         documentsStore.put(document)
      }
      foldersStore.delete(folderId)
   }
   await transactionDone(transaction)
}

/** Direct children of a folder, sorted by sortOrder ascending. */
export async function getFolderChildren(parentId: string): Promise<BinderFolderRecord[]> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readonly')
   const children = await requestToPromise<BinderFolderRecord[]>(
      transaction.objectStore(FOLDERS_STORE).index(PARENT_ID_INDEX).getAll(parentId),
   )
   return children.sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Folder ancestors from the root-most ancestor down to the immediate parent (excludes
 * the folder itself; empty for a top-level folder). Iterative walk of the parentId chain.
 */
export async function getFolderAncestors(id: string): Promise<BinderFolderRecord[]> {
   const chain: BinderFolderRecord[] = []
   const self = await getFolder(id)
   if (!self) return chain
   let parentId = self.parentId
   while (parentId !== ROOT_FOLDER_ID) {
      const parent = await getFolder(parentId)
      if (!parent) break
      chain.unshift(parent)
      parentId = parent.parentId
   }
   return chain
}

// #############################
// # DOCUMENT MOVES + ORDERING #
// #############################

/** Move a document into targetFolderId, appended to the end of that folder. */
export async function moveDocument(id: string, targetFolderId: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
   const store = transaction.objectStore(DOCUMENTS_STORE)
   const record = await requestToPromise<BinderDocumentRecord | undefined>(store.get(id))
   if (record) {
      const siblings = await requestToPromise<BinderDocumentRecord[]>(store.index(FOLDER_ID_INDEX).getAll(targetFolderId))
      const maxSort  = siblings.reduce((max, sibling) => sibling.id === id ? max : Math.max(max, sibling.sortOrder), -1)
      record.folderId = targetFolderId
      record.sortOrder = maxSort + 1
      store.put(record)
   }
   await transactionDone(transaction)
}

/** Assign sortOrder by array position. All ids must belong to the same folder (validated). */
export async function reorderDocuments(orderedIds: string[]): Promise<void> {
   if (orderedIds.length === 0) return
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite')
   const store = transaction.objectStore(DOCUMENTS_STORE)
   const records = await Promise.all(
      orderedIds.map(id => requestToPromise<BinderDocumentRecord | undefined>(store.get(id))),
   )
   const present = records.filter((record): record is BinderDocumentRecord => record !== undefined)
   const folderId = present[0]?.folderId
   if (present.length !== orderedIds.length || present.some(record => record.folderId !== folderId)) {
      transaction.abort()
      throw new Error('reorderDocuments: all ids must belong to the same folder')
   }
   present.forEach((record, index) => { record.sortOrder = index; store.put(record) })
   await transactionDone(transaction)
}

// #######################
// # FOLDER MOVES + ORDER #
// #######################

/**
 * Move a folder under a new parent, appended to the end of the target parent's children
 * (sortOrder = max sibling sortOrder + 1). Does NOT validate cycles — the caller must ensure
 * targetParentId is not the folder itself or a descendant of it.
 */
export async function moveFolder(id: string, targetParentId: string): Promise<void> {
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const folder = await requestToPromise<BinderFolderRecord | undefined>(store.get(id))
   if (folder) {
      const siblings = await requestToPromise<BinderFolderRecord[]>(store.index(PARENT_ID_INDEX).getAll(targetParentId))
      const maxSort  = siblings.reduce((max, sibling) => sibling.id === id ? max : Math.max(max, sibling.sortOrder), -1)
      folder.parentId  = targetParentId
      folder.sortOrder = maxSort + 1
      folder.updatedAt = new Date().toISOString()
      store.put(folder)
   }
   await transactionDone(transaction)
}

/** Assign sortOrder by array position. All ids must be siblings (same parentId; validated). */
export async function reorderFolders(orderedIds: string[]): Promise<void> {
   if (orderedIds.length === 0) return
   const database = await openDatabase()
   const transaction = database.transaction(FOLDERS_STORE, 'readwrite')
   const store = transaction.objectStore(FOLDERS_STORE)
   const folders = await Promise.all(
      orderedIds.map(id => requestToPromise<BinderFolderRecord | undefined>(store.get(id))),
   )
   const present = folders.filter((folder): folder is BinderFolderRecord => folder !== undefined)
   const parentId = present[0]?.parentId
   if (present.length !== orderedIds.length || present.some(folder => folder.parentId !== parentId)) {
      transaction.abort()
      throw new Error('reorderFolders: all ids must be siblings')
   }
   present.forEach((folder, index) => { folder.sortOrder = index; store.put(folder) })
   await transactionDone(transaction)
}

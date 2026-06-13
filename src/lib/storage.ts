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
   BinderDocumentRecord, BinderDocumentContent, PreviewSection,
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

// ============================================================
// Autosave
// ============================================================

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

// ============================================================
// JSON file (manual backup)
// ============================================================

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

// ============================================================
// IndexedDB — binder document library
//
// Two stores keyed by the same id:
//   documents        — lightweight BinderDocumentRecord (meta, timestamps, preview)
//   documentContent  — heavy BinderDocumentContent (full sections, base64 images)
// Splitting them lets listDocuments() read only the light store, never
// deserializing base64, so the binder card grid stays cheap.
// ============================================================

const DATABASE_NAME         = 'documinter'
const DATABASE_VERSION      = 1
const DOCUMENTS_STORE       = 'documents'
const DOCUMENT_CONTENT_STORE = 'documentContent'
const UPDATED_AT_INDEX      = 'by_updatedAt'
const PREVIEW_BLOCK_COUNT   = 8
const RECORD_SCHEMA_VERSION = 1

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

// ── Internal: connection + promise wrappers ─────────────────

let databasePromise: Promise<IDBDatabase> | null = null

/** Open (or create/upgrade) the binder database. Cached singleton; consumers never call this directly. */
function openDatabase(): Promise<IDBDatabase> {
   if (databasePromise) return databasePromise
   databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
         request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      } catch (error) {
         databasePromise = null
         reject(error instanceof Error ? error : new Error('IndexedDB is unavailable'))
         return
      }
      request.onupgradeneeded = () => {
         const database = request.result
         if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
            const documentsStore = database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' })
            documentsStore.createIndex(UPDATED_AT_INDEX, 'updatedAt', { unique: false })
         }
         if (!database.objectStoreNames.contains(DOCUMENT_CONTENT_STORE)) {
            database.createObjectStore(DOCUMENT_CONTENT_STORE, { keyPath: 'id' })
         }
      }
      request.onsuccess = () => {
         const database = request.result
         // If another tab triggers a version upgrade, close so it isn't blocked.
         database.onversionchange = () => { database.close(); databasePromise = null }
         resolve(database)
      }
      request.onerror = () => {
         databasePromise = null
         reject(request.error ?? new Error('Failed to open IndexedDB'))
      }
      request.onblocked = () => {
         databasePromise = null
         reject(new Error('IndexedDB upgrade blocked by another open tab'))
      }
   })
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

// ── Internal: preview snapshot builders (pure) ──────────────

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

// ── Public API ──────────────────────────────────────────────

/**
 * Save a document to IndexedDB. With existingId, updates that record (preserving
 * createdAt); otherwise creates a new one. Regenerates previewSections and updatedAt
 * every call. Returns the document id.
 */
export async function saveDocument(
   state: DocState,
   presentation: DocPresentation,
   existingId?: string,
): Promise<string> {
   const database = await openDatabase()
   const id  = existingId ?? crypto.randomUUID()
   const now = new Date().toISOString()

   const transaction    = database.transaction([DOCUMENTS_STORE, DOCUMENT_CONTENT_STORE], 'readwrite')
   const documentsStore = transaction.objectStore(DOCUMENTS_STORE)
   const contentStore   = transaction.objectStore(DOCUMENT_CONTENT_STORE)

   // Preserve createdAt across updates. Upsert if existingId was passed but is gone.
   const existing = existingId
      ? await requestToPromise<BinderDocumentRecord | undefined>(documentsStore.get(existingId))
      : undefined
   const createdAt = existing?.createdAt ?? now

   const record: BinderDocumentRecord = {
      id,
      meta:          state.meta,
      createdAt,
      updatedAt:     now,
      sectionTitles: state.sections.map(section => section.title),
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

/** Load the full editable document (DocState + presentation) by id, or null if absent. */
export async function loadDocument(id: string): Promise<LoadedDocument | null> {
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

/** All stored records ordered by updatedAt descending. Light store only — no sections/base64. */
export async function listDocuments(): Promise<BinderDocumentRecord[]> {
   const database = await openDatabase()
   const transaction = database.transaction(DOCUMENTS_STORE, 'readonly')
   const index = transaction.objectStore(DOCUMENTS_STORE).index(UPDATED_AT_INDEX)
   const records: BinderDocumentRecord[] = []
   return new Promise<BinderDocumentRecord[]>((resolve, reject) => {
      const cursorRequest = index.openCursor(null, 'prev')
      cursorRequest.onsuccess = () => {
         const cursor = cursorRequest.result
         if (cursor) {
            records.push(cursor.value as BinderDocumentRecord)
            cursor.continue()
         } else {
            resolve(records)
         }
      }
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to list documents'))
   })
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

   const newRecord: BinderDocumentRecord = {
      id:            newId,
      meta:          sourceRecord.meta,
      createdAt:     now,
      updatedAt:     now,
      sectionTitles: clonedSections.map(section => section.title),
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

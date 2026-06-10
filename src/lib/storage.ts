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
import type { Block, DocMeta, DocState, InlineContent, ListItem, Section } from '../types'

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

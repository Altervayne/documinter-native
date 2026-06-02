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
import type { Block, DocMeta, DocState, ListItem, Section } from '../types'

/**
 * Normalize a raw list item from any historical format to the current ListItem shape.
 * Handles: plain strings (very old), objects without id, objects with string[] children.
 */
function migrateListItem(raw: unknown): ListItem {
   if (typeof raw === 'string') {
      return { id: crypto.randomUUID(), text: raw, children: [] }
   }
   const obj = raw as Record<string, unknown>
   const id       = typeof obj.id === 'string'   ? obj.id       : crypto.randomUUID()
   const text     = typeof obj.text === 'string' ? obj.text     : ''
   const children = Array.isArray(obj.children)  ? obj.children : []
   return { id, text, children: children.map(migrateListItem) }
}

/** Convert any legacy numeric IDs to strings, and normalize list items to the current shape. */
function migrateBlock(block: Block): Block {
   const base = { ...block, id: String(block.id) }
   if (block.type === 'container') {
      return { ...base, left: (block.left ?? []).map(migrateBlock), right: (block.right ?? []).map(migrateBlock) }
   }
   if (block.type === 'list' && Array.isArray(block.items)) {
      return { ...base, items: block.items.map(migrateListItem) }
   }
   return base
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

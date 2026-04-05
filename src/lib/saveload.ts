// -- Lib / Util Imports --
import { slugify } from './helpers'

// -- Type Imports --
import type { Block, DocMeta, DocState, Section } from '../types'

/** Convert any legacy numeric IDs (from pre-UUID saves) to strings, and migrate old string[] list items to ListItem[]. */
function migrateBlock(b: Block): Block {
   const base = { ...b, id: String(b.id) }
   if (b.type === 'container') {
      return { ...base, left: (b.left ?? []).map(migrateBlock), right: (b.right ?? []).map(migrateBlock) }
   }
   if (b.type === 'list' && Array.isArray(b.items) && b.items.length > 0 && typeof b.items[0] === 'string') {
      return { ...base, items: (b.items as unknown as string[]).map(text => ({ text, children: [] })) }
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

// ============ Autosave ============

const AUTOSAVE_KEY = 'documinter-autosave'

export interface AutosaveData {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
}

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

export function writeAutosave(data: AutosaveData): void {
   localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data))
}

export function downloadJSON(meta: DocMeta, sections: Section[]): void {
   const state: DocState = { meta, sections }
   const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' })
   const url = URL.createObjectURL(blob)
   const a = document.createElement('a')
   a.href = url
   a.download = slugify(meta.title) + '.documinter.json'
   a.click()
   URL.revokeObjectURL(url)
}

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
      reader.onload = (e) => {
         try {
            const raw = JSON.parse(e.target?.result as string) as DocState
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

export function loadMintdownFile(
   onLoad: (text: string) => void,
   onError: (msg: string) => void,
): void {
   const input = document.createElement('input')
   input.type = 'file'
   input.accept = '.mint,.md,.txt'
   input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (event) => { onLoad(event.target?.result as string) }
      reader.onerror = () => onError('Could not read file.')
      reader.readAsText(file)
   }
   input.click()
}

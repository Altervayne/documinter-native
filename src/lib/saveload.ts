// -- Lib / Util Imports --
import { slugify } from './helpers'

// -- Type Imports --
import type { Block, DocMeta, DocState, Section } from '../types'

/** Convert any legacy numeric IDs (from pre-UUID saves) to strings. */
function migrateBlock(b: Block): Block {
   const base = { ...b, id: String(b.id) }
   if (b.type === 'container') {
      return { ...base, left: (b.left ?? []).map(migrateBlock), right: (b.right ?? []).map(migrateBlock) }
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

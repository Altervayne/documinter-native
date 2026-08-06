/**
 * autosaveStorage.ts, legacy localStorage autosave (read on startup, migrated to IndexedDB).
 *
 * The current autosave path is IndexedDB-backed; these helpers exist to read and clear the old
 * `documinter-autosave` localStorage key during the one-time migration on mount (see App.tsx
 * hydration).
 */

import { migrateIds } from './documentMigration'
import type { DocMeta, Section } from '../types'

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

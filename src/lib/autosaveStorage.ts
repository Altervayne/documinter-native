/*
 * Legacy localStorage autosave. The live autosave path saves through the binder backend; these
 * helpers only read and clear the old `documinter-autosave` key during the one-time migration on mount.
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

/** Null when the key is absent or malformed. */
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

export function clearLegacyAutosave(): void {
   localStorage.removeItem(AUTOSAVE_KEY)
}

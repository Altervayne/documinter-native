/**
 * documentBackupFile.ts, Manual .documinter.json backup download + load.
 *
 * Relocated verbatim from storage.ts. Pure file I/O over the editable DocState plus per-document
 * presentation; no IndexedDB. parseDocumentBackup runs id migration so older backups still load.
 */

import { slugify } from './text'
import { migrateIds } from './documentMigration'
import { normalizePresentation, type DocPresentationExtras } from './presentation'
import type { DocPresentation } from './binderDocuments'
import type { DocMeta, DocState, Section } from '../types'

/** A serialized document backup: the editable DocState plus the per-document presentation
 *  (theme + accent + export/editor extras), so a re-import restores exactly how the document looked.
 *  Presentation is optional, older backups predate it and fall back to defaults on import. The
 *  .documinter.json backup is the full-fidelity format, so it DOES carry `presentation` (unlike the
 *  content-only .mint / .md serializers). */
export interface DocumentBackup extends DocState {
   docTheme?:  'light' | 'dark'
   docAccent?: string
   presentation?: DocPresentationExtras
}

/**
 * Parse a JSON backup string into editable state + presentation, or null if it isn't a valid
 * Documinter document. Applies id migration and fills missing presentation with the defaults
 * (light theme + mint accent) so backups written before presentation was tracked still load.
 */
export function parseDocumentBackup(text: string): { state: DocState; presentation: DocPresentation } | null {
   try {
      const raw = JSON.parse(text) as Partial<DocumentBackup>
      if (!raw.meta || !Array.isArray(raw.sections)) return null
      const migrated = migrateIds({ meta: raw.meta, sections: raw.sections })
      return {
         state: migrated,
         presentation: {
            docTheme:  raw.docTheme  ?? 'light',
            docAccent: raw.docAccent ?? '#2dcea8',
            presentation: normalizePresentation(raw.presentation),
         },
      }
   } catch {
      return null
   }
}

/** Trigger a browser download of the document as a .documinter.json file (theme + accent included). */
export function downloadJSON(meta: DocMeta, sections: Section[], presentation: DocPresentation): void {
   const backup: DocumentBackup = {
      meta, sections,
      docTheme: presentation.docTheme,
      docAccent: presentation.docAccent,
      ...(presentation.presentation ? { presentation: presentation.presentation } : {}),
   }
   const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
   const url = URL.createObjectURL(blob)
   const anchor = document.createElement('a')
   anchor.href = url
   anchor.download = slugify(meta.title) + '.documinter.json'
   anchor.click()
   URL.revokeObjectURL(url)
}

/** Open a file picker for .json files and parse the selected file as a document backup. */
export function loadJSONFile(
   onLoad: (state: DocState, presentation: DocPresentation) => void,
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
         const parsed = parseDocumentBackup(event.target?.result as string)
         if (!parsed) { onError('Invalid Documinter JSON file.'); return }
         onLoad(parsed.state, parsed.presentation)
      }
      reader.readAsText(file)
   }
   input.click()
}

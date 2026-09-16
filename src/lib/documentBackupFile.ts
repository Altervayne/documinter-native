/*
 * Manual .documinter.json backup download + load. Pure file I/O over the editable DocState plus
 * per-document presentation, no binder store. parseDocumentBackup runs id migration so older backups
 * still load.
 */

import { slugify } from './text'
import { saveTextFile, openTextFile } from './platform/fileTransfer'
import { migrateIds, migrateFormatPageBreaks, migrateFormatBands } from './documentMigration'
import { normalizePresentation, type DocPresentationExtras } from './presentation'
import { normalizeFormat, isDefaultFormat, type DocFormat } from './format'
import type { DocPresentation } from './documentRecord'
import type { DocMeta, DocState, Section } from '../types'

/** DocState plus per-document presentation (theme + accent + extras) and format, so a re-import
 *  restores how the document looked. Both optional; older backups fall back to defaults. This is the
 *  full-fidelity format, so it DOES carry them, unlike the content-only .mint / .md serializers. */
export interface DocumentBackup extends DocState {
   docTheme?:  'light' | 'dark'
   docAccent?: string
   presentation?: DocPresentationExtras
   format?: DocFormat
}

/** State + presentation, or null when the text isn't a valid Documinter document. Applies id
 *  migration and fills missing presentation with the defaults so older backups still load. */
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
            format: normalizeFormat(migrateFormatBands(migrateFormatPageBreaks(raw.format, migrated.sections))),
         },
      }
   } catch {
      return null
   }
}

/** Save the document as a .documinter.json file. `format` is written only when it diverges from the
 *  default, so a document that never touched Page Setup keeps a byte-clean backup. */
export async function downloadJSON(meta: DocMeta, sections: Section[], presentation: DocPresentation): Promise<void> {
   const backup: DocumentBackup = {
      meta, sections,
      docTheme: presentation.docTheme,
      docAccent: presentation.docAccent,
      ...(presentation.presentation ? { presentation: presentation.presentation } : {}),
      ...(presentation.format && !isDefaultFormat(presentation.format) ? { format: presentation.format } : {}),
   }
   await saveTextFile({
      suggestedName: slugify(meta.title) + '.documinter.json',
      contents:      JSON.stringify(backup, null, 2),
      filters:       [{ name: 'Documinter backup', extensions: ['json'] }],
   })
}

/** Pick a .json file and parse it as a document backup. Cancel is a no-op; an invalid file calls onError. */
export async function loadJSONFile(
   onLoad: (state: DocState, presentation: DocPresentation) => void,
   onError: (msg: string) => void,
): Promise<void> {
   const picked = await openTextFile({ filters: [{ name: 'Documinter backup', extensions: ['json'] }] })
   if (!picked) return
   const parsed = parseDocumentBackup(picked.text)
   if (!parsed) { onError('Invalid Documinter JSON file.'); return }
   onLoad(parsed.state, parsed.presentation)
}

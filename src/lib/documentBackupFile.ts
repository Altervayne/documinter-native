/*
 * Standalone document file save + load, outside any binder. downloadMint writes the active document as
 * a `.mint` file the user can drop anywhere; parseDocumentBackup reads one back, and still accepts a
 * legacy `.documinter.json` from the web era (same JSON payload, older extension). Pure file I/O over
 * the editable DocState plus per-document presentation, with id migration so older files still load.
 */

import { slugify } from './text'
import { saveTextFile } from './platform/fileTransfer'
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

/** Save the document as a standalone `.mint` file. This is a content-fidelity copy (no binder identity
 *  or timestamps): a fresh copy dropped into a binder gets its own id on ingest, and opened on its own
 *  it lands as an unsaved document. `format` is written only when it diverges from the default, so a
 *  document that never touched Page Setup stays byte-clean. */
export async function downloadMint(meta: DocMeta, sections: Section[], presentation: DocPresentation): Promise<void> {
   const backup: DocumentBackup = {
      meta, sections,
      docTheme: presentation.docTheme,
      docAccent: presentation.docAccent,
      ...(presentation.presentation ? { presentation: presentation.presentation } : {}),
      ...(presentation.format && !isDefaultFormat(presentation.format) ? { format: presentation.format } : {}),
   }
   await saveTextFile({
      suggestedName: slugify(meta.title) + '.mint',
      contents:      JSON.stringify(backup, null, 2),
      filters:       [{ name: 'Documinter document', extensions: ['mint'] }],
   })
}

/*
 * Portable single-template file: download a DocumentTemplate to a `.documinter-template.json` and read
 * one back, the mirror of documentBackupFile.ts for a template's chrome (no content). On import the id
 * and timestamps are regenerated (via captureTemplate), so an imported template is always a fresh user
 * template, never a built-in and never colliding with a stored id.
 */

// -- Type Imports --
import type { DocMeta } from '../types'
import type { TemplateChrome } from './documentTemplate'
import type { DocPresentationExtras } from './presentation'
import type { DocFormat } from './format'

// -- Lib Imports --
import { slugify } from './text'
import { saveTextFile, openTextFile } from './platform/fileTransfer'
import { normalizePresentation } from './presentation'
import { normalizeFormat } from './format'
import type { DocumentTemplate } from './documentTemplate'

/** The on-disk shape of an exported template: a format marker + name + the chrome. Content, id,
 *  timestamps and the built-in flag are deliberately NOT written (they are runtime / per-install). */
export interface TemplateBackup {
   /** Format marker, lets the importer reject non-template JSON (e.g. a document backup). */
   documinterTemplate: true
   schemaVersion:      number
   name:               string
   meta:               DocMeta
   docTheme:           'light' | 'dark'
   docAccent:          string
   presentation?:      DocPresentationExtras
   format?:            DocFormat
}

const TEMPLATE_SCHEMA_VERSION = 1

/** Serialize a template to the portable JSON string (pretty-printed, like the document backup). */
export function serializeTemplate(template: DocumentTemplate): string {
   const backup: TemplateBackup = {
      documinterTemplate: true,
      schemaVersion:      TEMPLATE_SCHEMA_VERSION,
      name:               template.name,
      meta:               template.meta,
      docTheme:           template.docTheme,
      docAccent:          template.docAccent,
      ...(template.presentation ? { presentation: template.presentation } : {}),
      ...(template.format       ? { format: template.format }             : {}),
   }
   return JSON.stringify(backup, null, 2)
}

/**
 * Parse a template file into a name + chrome, or null if it isn't a valid template export. The
 * caller turns this into a stored template (fresh id + timestamps) via captureTemplate. Presentation
 * and format are normalized so a hand-edited or older file still lands in a clean shape.
 */
export function parseTemplateBackup(text: string): { name: string; chrome: TemplateChrome } | null {
   try {
      const raw = JSON.parse(text) as Partial<TemplateBackup>
      if (raw.documinterTemplate !== true) return null
      if (!raw.meta || !Array.isArray(raw.meta.fields)) return null
      if (raw.docTheme !== 'light' && raw.docTheme !== 'dark') return null
      if (typeof raw.docAccent !== 'string') return null
      return {
         name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Imported template',
         chrome: {
            meta:         raw.meta,
            docTheme:     raw.docTheme,
            docAccent:    raw.docAccent,
            presentation: normalizePresentation(raw.presentation),
            format:       normalizeFormat(raw.format),
         },
      }
   } catch {
      return null
   }
}

/** Save the template as a `<slug>.documinter-template.json` file. */
export async function downloadTemplate(template: DocumentTemplate): Promise<void> {
   await saveTextFile({
      suggestedName: slugify(template.name || 'template') + '.documinter-template.json',
      contents:      serializeTemplate(template),
      filters:       [{ name: 'Documinter template', extensions: ['json'] }],
   })
}

/** Pick a `.json` file and parse it as a template export. Cancel is a no-op; an invalid file calls onError. */
export async function loadTemplateFile(
   onLoad: (parsed: { name: string; chrome: TemplateChrome }) => void,
   onError: () => void,
): Promise<void> {
   const picked = await openTextFile({ filters: [{ name: 'Documinter template', extensions: ['json'] }] })
   if (!picked) return
   const parsed = parseTemplateBackup(picked.text)
   if (!parsed) { onError(); return }
   onLoad(parsed)
}

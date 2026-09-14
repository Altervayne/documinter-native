/**
 * templateFile.ts, the on-disk `.mintplate` template envelope: serialize + parse.
 *
 * A `.mintplate` is one saved DocumentTemplate as a JSON file under the Binder's `.templates` folder,
 * the template-side mirror of mintFile.ts. Unlike the portable single-template export (templateBackupFile
 * .ts), which deliberately DROPS the id + timestamps so an imported template is always fresh, a Binder
 * template file KEEPS them: the id is the template's identity (saveTemplate is an upsert by id) and it
 * rides inside the file, so the store can find and overwrite the right file across a rename. Built-in
 * templates are code, never written here.
 *
 * Pure: no plugin-fs, no async, no crypto. The filesystem backend owns the actual file I/O and calls into
 * here. Same marker + version envelope idea as templateBackupFile / mintFile so a stray file is rejected
 * rather than mis-parsed.
 */

import type { DocMeta } from '../../types'
import type { DocPresentationExtras } from '../presentation'
import type { DocFormat } from '../format'
import type { DocumentTemplate } from '../documentTemplate'

import { normalizePresentation } from '../presentation'
import { normalizeFormat, isDefaultFormat } from '../format'

/** The on-disk `.mintplate` shape: the marker + version, the identity (id + timestamps), the display
 *  name, and the chrome. presentation / format are optional, written only when present, so a template
 *  with neither stays byte-clean. builtIn is never stored (built-ins live in code). */
export interface TemplateFileEnvelope {
   documinterTemplate: true
   schemaVersion:      number
   id:                 string
   name:               string
   createdAt:          number
   updatedAt:          number
   meta:               DocMeta
   docTheme:           'light' | 'dark'
   docAccent:          string
   presentation?:      DocPresentationExtras
   format?:            DocFormat
}

/** Bumped only on an incompatible envelope change; a higher version than this build knows is refused. */
export const TEMPLATE_FILE_SCHEMA_VERSION = 1

/**
 * Serialize a DocumentTemplate to the pretty (2-space) `.mintplate` text. presentation / format are
 * written only when present (an absent one is omitted, never `undefined`); a default format is dropped so
 * a template that never touched Page Setup carries no format at all. builtIn is intentionally not written.
 */
export function serializeTemplateFile(template: DocumentTemplate): string {
   const hasFormat = template.format !== undefined && !isDefaultFormat(template.format)
   const envelope = {
      documinterTemplate: true,
      schemaVersion:      TEMPLATE_FILE_SCHEMA_VERSION,
      id:                 template.id,
      name:               template.name,
      createdAt:          template.createdAt,
      updatedAt:          template.updatedAt,
      meta:               template.meta,
      docTheme:           template.docTheme,
      docAccent:          template.docAccent,
      ...(template.presentation ? { presentation: template.presentation } : {}),
      ...(hasFormat ? { format: template.format } : {}),
   }
   return JSON.stringify(envelope, null, 2)
}

/**
 * Parse `.mintplate` text into a DocumentTemplate, or null when it is not a valid Binder template file
 * (bad JSON, a missing / non-true marker, a schemaVersion above this build, a missing id / meta, or a bad
 * theme / accent). Total: never throws. presentation / format are normalized on read (the mirror of
 * mintFile's read pipeline), a default format collapsing to absent. A missing name falls back to a
 * placeholder; missing timestamps default to 0 (createdAt) and createdAt (updatedAt) so an older or
 * hand-edited file still lands in a clean shape.
 */
export function parseTemplateFile(text: string): DocumentTemplate | null {
   try {
      const raw = JSON.parse(text) as Partial<TemplateFileEnvelope>
      if (raw.documinterTemplate !== true) return null
      if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > TEMPLATE_FILE_SCHEMA_VERSION) return null
      if (typeof raw.id !== 'string' || raw.id.trim() === '') return null
      if (!raw.meta || !Array.isArray(raw.meta.fields)) return null
      if (raw.docTheme !== 'light' && raw.docTheme !== 'dark') return null
      if (typeof raw.docAccent !== 'string') return null

      const createdAt    = typeof raw.createdAt === 'number' ? raw.createdAt : 0
      const updatedAt    = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt
      const presentation = normalizePresentation(raw.presentation)
      const normalizedFormat = normalizeFormat(raw.format)
      const format       = isDefaultFormat(normalizedFormat) ? undefined : normalizedFormat

      return {
         id:        raw.id,
         name:      typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled template',
         createdAt,
         updatedAt,
         meta:      raw.meta,
         docTheme:  raw.docTheme,
         docAccent: raw.docAccent,
         ...(presentation ? { presentation } : {}),
         ...(format       ? { format }       : {}),
      }
   } catch {
      return null
   }
}

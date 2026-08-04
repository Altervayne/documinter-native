// ###############################################################################################
// # DOCUMENT TEMPLATE MODEL                                                                     #
// #                                                                                             #
// # A template captures a document's CHROME (meta scaffold, theme, accent, presentation extras, #
// # page format) so a new document starts pre-styled instead of blank. It never captures        #
// # content (sections/blocks) nor the content-position-dependent `format.pages` array (see       #
// # docs/reference/templates_study.md). Everything here is pure and JSON-serializable, tested in #
// # isolation; the IndexedDB store (lib/templateStore.ts) and the App wiring build on it.        #
// ###############################################################################################

// -- Type Imports --
import type { DocMeta } from '../types'
import type { DocPresentationExtras } from './presentation'
import type { DocFormat } from './format'

// -- Lib Imports --
import { normalizePresentation } from './presentation'
import { normalizeFormat, isDefaultFormat } from './format'

// #########
// # TYPES #
// #########

/** The chrome a template captures / instantiates: everything on a document EXCEPT its content. */
export interface TemplateChrome {
   meta:          DocMeta
   docTheme:      'light' | 'dark'
   docAccent:     string
   presentation?: DocPresentationExtras
   format?:       DocFormat
}

export interface DocumentTemplate extends TemplateChrome {
   id:        string
   name:      string
   createdAt: number
   updatedAt: number
   /** Code-defined built-in: shown in the picker, not editable / deletable (duplicate to customize). */
   builtIn?:  boolean
}

/** A fresh field id per instantiated meta field (App passes crypto.randomUUID; tests pass a counter). */
export type FieldIdFactory = () => string

// ##################
// # PURE HELPERS   #
// ##################

/** The template captures a field's label / position / color / showLabel scaffold, but blanks its value
 *  (a template is a form to fill, not the source document's data). */
function blankMetaValues(meta: DocMeta): DocMeta {
   return {
      title:  '',
      fields: meta.fields.map(field => ({ ...field, value: '' })),
   }
}

/** Captures a format for a template: strips the content-position-dependent `pages` array and drops the
 *  whole thing when it reduces to the default (infinite, no width / margins), so a template carries
 *  only a meaningful kind + width + margins. */
function captureFormat(format: DocFormat | undefined): DocFormat | undefined {
   if (!format) return undefined
   const { pages: _pages, ...withoutPages } = format
   const normalized = normalizeFormat(withoutPages)
   return isDefaultFormat(normalized) ? undefined : normalized
}

// ####################
// # CAPTURE / INSTANTIATE #
// ####################

/**
 * Captures the chrome of a live document into a named template: blanks the meta values (keeps the
 * scaffold), strips `format.pages` and any default format, and normalizes the presentation (absent when
 * empty). `id` + `now` are injected so this stays pure and deterministic.
 */
export function captureTemplate(name: string, source: TemplateChrome, id: string, now: number): DocumentTemplate {
   const presentation = normalizePresentation(source.presentation)
   const format       = captureFormat(source.format)
   return {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      meta:      blankMetaValues(source.meta),
      docTheme:  source.docTheme,
      docAccent: source.docAccent,
      ...(presentation ? { presentation } : {}),
      ...(format       ? { format }       : {}),
   }
}

/**
 * The chrome to seed a fresh document with from a template: fresh meta field ids (values already
 * blank), a deep-cloned presentation, and a format with no `pages` (never captured). App spreads this
 * onto `createBlankDocument`'s output.
 */
export function instantiateTemplate(template: DocumentTemplate, newFieldId: FieldIdFactory): TemplateChrome {
   return {
      meta: {
         title:  template.meta.title,
         fields: template.meta.fields.map(field => ({ ...field, id: newFieldId() })),
      },
      docTheme:  template.docTheme,
      docAccent: template.docAccent,
      presentation: template.presentation ? structuredClone(template.presentation) : undefined,
      format:       template.format ? { ...template.format } : undefined,
   }
}

// ######################
// # BUILT-IN TEMPLATES #
// ######################

// The app's default document accent (App.tsx keeps its own copy for createBlankDocument). Exported
// so the New Document dialog's "Blank" base and this built-in agree on one value.
export const DEFAULT_DOC_ACCENT = '#2dcea8'

/**
 * The one built-in template: the classic "default layout" the app used to seed new documents with, an
 * accent-tinted `Module` field above the title and `Environment` / `Date` / `Author` fields below it
 * (all value-blank), infinite canvas, default theme + accent. Its field ids are placeholders, replaced
 * on instantiation. `name` is English here; the picker localizes built-in names by id.
 */
export const BUILT_IN_TEMPLATES: DocumentTemplate[] = [
   {
      id:        'builtin-default',
      name:      'Default layout',
      createdAt: 0,
      updatedAt: 0,
      builtIn:   true,
      docTheme:  'light',
      docAccent: DEFAULT_DOC_ACCENT,
      meta: {
         title: '',
         fields: [
            { id: 'builtin-field-module',      label: 'Module',      value: '', position: 'above', color: 'accent' },
            { id: 'builtin-field-environment', label: 'Environment', value: '', position: 'below' },
            { id: 'builtin-field-date',        label: 'Date',        value: '', position: 'below' },
            { id: 'builtin-field-author',      label: 'Author',      value: '', position: 'below' },
         ],
      },
      // No `format` field: infinite canvas, no pages.
   },
]

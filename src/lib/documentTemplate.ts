// ###############################################################################################
// # DOCUMENT TEMPLATE MODEL                                                                     #
// #                                                                                             #
// # A template captures a document's CHROME (meta scaffold, theme, accent, presentation extras, #
// # page format with header / footer bands) so a new document starts pre-styled, not blank. It  #
// # never captures content (sections/blocks) nor the content-position-dependent `format.pages`. #
// # All of it is pure and JSON-serializable; the store and App wiring build on it.              #
// ###############################################################################################

// -- Type Imports --
import type { DocMeta } from '../types'
import type { DocPresentationExtras } from './presentation'
import type { DocFormat } from './format'
import type { DocSnapshot } from './undoHistory'

// -- Lib Imports --
import { normalizePresentation } from './presentation'
import { normalizeFormat, isDefaultFormat, DEFAULT_FORMAT } from './format'

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

/** Strips the content-position-dependent `pages` array and drops the whole format when it reduces to
 *  the default, so a template carries only a meaningful kind + width + margins. */
function captureFormat(format: DocFormat | undefined): DocFormat | undefined {
   if (!format) return undefined
   const { pages: _pages, ...withoutPages } = format
   const normalized = normalizeFormat(withoutPages)
   return isDefaultFormat(normalized) ? undefined : normalized
}

// ####################
// # CAPTURE / INSTANTIATE #
// ####################

/** Capture a live document's chrome into a named template: blank the meta values (keep the scaffold),
 *  strip `format.pages` and any default format, normalize presentation. `id` + `now` are injected. */
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

/** The chrome to seed a fresh document from a template: fresh meta field ids (values already blank), a
 *  deep-cloned presentation, and a format with no `pages`. */
export function instantiateTemplate(template: DocumentTemplate, newFieldId: FieldIdFactory): TemplateChrome {
   return {
      meta: {
         title:  template.meta.title,
         fields: template.meta.fields.map(field => ({ ...field, id: newFieldId() })),
      },
      docTheme:  template.docTheme,
      docAccent: template.docAccent,
      presentation: template.presentation ? structuredClone(template.presentation) : undefined,
      // Deep-clone: the format nests bands whose items can hold a base64 logo, so a shallow spread
      // would alias every instantiated document back to the stored template.
      format:       template.format ? structuredClone(template.format) : undefined,
   }
}

// ##########################
// # APPLY TO CURRENT DOC   #
// ##########################

/**
 * Re-style the ACTIVE document with a template's chrome, keeping its content: `meta` and `sections`
 * pass through. Theme / accent / presentation are fully adopted (an absent template presentation
 * clears the document's own; a template is a complete look, not a patch). `format` adopts the
 * template's kind / width / margins / bands, but the document's own `format.pages` always wins: page
 * breaks are content-relative and a template never carries them, so blending must never drop them.
 * Deep-clones presentation / format so the document never aliases the stored template.
 */
export function applyTemplateChrome(current: DocSnapshot, template: DocumentTemplate): DocSnapshot {
   const templateFormat = template.format ? structuredClone(template.format) : { ...DEFAULT_FORMAT }
   const { pages: _templatePages, ...formatWithoutPages } = templateFormat
   const currentPages = current.format?.pages
   const format: DocFormat = currentPages && currentPages.length > 0
      ? { ...formatWithoutPages, pages: structuredClone(currentPages) }
      : formatWithoutPages

   return {
      meta:         current.meta,
      sections:     current.sections,
      docTheme:     template.docTheme,
      docAccent:    template.docAccent,
      presentation: template.presentation ? structuredClone(template.presentation) : undefined,
      format:       isDefaultFormat(format) ? undefined : format,
   }
}

// ######################
// # BUILT-IN TEMPLATES #
// ######################

// The app's default document accent. Exported so the New Document dialog's "Blank" base and this
// built-in agree on one value.
export const DEFAULT_DOC_ACCENT = '#2dcea8'

/** The one built-in template: an accent-tinted `Module` field above the title and `Environment` /
 *  `Date` / `Author` below it (all value-blank), infinite canvas, default theme + accent. Its field
 *  ids are placeholders, replaced on instantiation. `name` is English; the picker localizes by id. */
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

/**
 * Legacy-format upgrade for stored documents.
 *
 * Brings any historical document shape (numeric ids, pre-InlineContent string fields, old
 * list-item formats) up to the current model. Shared by autosaveStorage (localStorage read),
 * documentBackupFile (JSON import), and binderDocuments (IndexedDB read). Pure, no side effects.
 */

import { parseInlineContent, stripTrailingNewlines } from './inline'
import type { MarkupElement } from './imageMarkup'
import type { Block, DocMeta, DocState, InlineContent, ListItem, MetaField, Section } from '../types'

// Fields present in JSON files saved before the InlineContent migration.
// Not part of the canonical types, kept here only for migration reads.
type LegacyRawBlock = Block & { text?: string; headers?: string[]; rows?: string[][] }

/**
 * Normalize a raw list item from any historical format to the current ListItem shape.
 * Handles: plain strings (very old), objects without id, objects with string[] children.
 * Also populates richText from the legacy text field if richText is absent.
 */
function migrateListItem(raw: unknown): ListItem {
   if (typeof raw === 'string') {
      return { id: crypto.randomUUID(), richText: parseInlineContent(raw), children: [] }
   }
   const obj        = raw as Record<string, unknown>
   const id         = typeof obj.id === 'string'   ? obj.id       : crypto.randomUUID()
   const legacyText = typeof obj.text === 'string' ? obj.text     : ''
   const children   = Array.isArray(obj.children)  ? obj.children : []
   const richText   = Array.isArray(obj.richText)
      ? stripTrailingNewlines(obj.richText as InlineContent)
      : parseInlineContent(legacyText)
   return {
      id,
      richText,
      children: children.map(migrateListItem),
      ...(typeof obj.checked === 'boolean' ? { checked: obj.checked } : {}),
   }
}

/**
 * Convert any legacy numeric IDs to strings, normalize list items, and populate the
 * new InlineContent fields (richText, richHeaders, richRows) from legacy string fields
 * if they are absent.
 */
function migrateBlock(rawBlock: LegacyRawBlock): Block {
   const base: LegacyRawBlock = { ...rawBlock, id: String(rawBlock.id) }

   // Legacy standalone `image-markup` block -> an `image` block carrying a markup overlay. The old
   // shape stored an `ImageMarkupSpec` ({ src, width, height, elements, alt?, caption? }) on
   // `imageMarkup`; the new model puts src/alt/caption on the block and only the viewBox dims +
   // element stack on the overlay. Compared as a string since 'image-markup' is no longer a BlockType.
   if ((base.type as string) === 'image-markup') {
      const legacy = (base as unknown as {
         imageMarkup?: { src?: string; width?: number; height?: number; elements?: MarkupElement[]; alt?: string; caption?: string }
      }).imageMarkup
      const image: Block = {
         id:   base.id,
         type: 'image',
         src:  legacy?.src ?? '',
         imageMarkup: { width: legacy?.width ?? 0, height: legacy?.height ?? 0, elements: legacy?.elements ?? [] },
      }
      if (base.handle)     image.handle  = base.handle
      if (legacy?.alt)     image.alt     = legacy.alt
      if (legacy?.caption) image.caption = legacy.caption
      return image
   }

   if (base.type === 'container') {
      return {
         ...base,
         left:  (base.left  ?? []).map(block => migrateBlock(block as LegacyRawBlock)),
         right: (base.right ?? []).map(block => migrateBlock(block as LegacyRawBlock)),
      }
   }

   if ((base.type === 'list' || base.type === 'checklist') && Array.isArray(base.items)) {
      return { ...base, items: base.items.map(migrateListItem) }
   }

   // Paragraph / heading / callout, populate richText from legacy text if absent
   if (base.type === 'p' || base.type === 'h3' || base.type === 'h4' || base.type === 'callout') {
      if (!Array.isArray(base.richText)) {
         const { text: _text, ...clean } = base
         return { ...clean, richText: parseInlineContent(_text ?? '') }
      }
      // richText is already an array, strip any trailing newline runs that may
      // have been saved before stripTrailingNewlines was added to domToInlineContent.
      // Without this, a stored [{ text: '\n' }] renders to '<br>' and the element
      // matches the :has(> br:only-child) placeholder CSS rule, showing the
      // placeholder on a block the user considers to have content.
      const { text: _text, ...clean } = base
      return { ...clean, richText: stripTrailingNewlines(base.richText) }
   }

   // Table, populate richHeaders and richRows from legacy string fields if absent
   if (base.type === 'table') {
      const richHeaders = Array.isArray(base.richHeaders)
         ? base.richHeaders
         : Array.isArray(base.headers)
            ? base.headers.map(header => parseInlineContent(header))
            : undefined
      const richRows = Array.isArray(base.richRows)
         ? base.richRows
         : Array.isArray(base.rows)
            ? base.rows.map(row => row.map(cell => parseInlineContent(cell)))
            : undefined
      const { headers: _h, rows: _r, text: _t, ...clean } = base
      return { ...clean, ...(richHeaders ? { richHeaders } : {}), ...(richRows ? { richRows } : {}) }
   }

   // All other block types: strip any stray legacy fields
   const { text: _text, headers: _h, rows: _r, ...clean } = base
   return clean
}

// ############################
// # DOCUMENT METADATA MIGRATION #
// ############################

/**
 * Bring any historical document-metadata shape up to the current freeform model
 * ({ title, fields }). Idempotent: already-new records are normalized and returned;
 * legacy flat records ({ module, title, author, date, env }) become a title plus an
 * ordered list of { id, label, value, position, color } fields, dropping any that were empty.
 *
 * Zone/color reproduction of the old fixed layout: the module tag sat above the title in the
 * accent color; env / date / author sat below in the default muted gray.
 */
export function migrateMeta(meta: unknown): DocMeta {
   const raw = (meta ?? {}) as Record<string, unknown>

   // Already the new shape: normalize each field, minting an id if one is missing. Records saved
   // by the pre-zone freeform version lack `position`, so backfill it to 'below'; `color` passes
   // through untouched when it is a string, and stays absent otherwise.
   if (Array.isArray(raw.fields)) {
      const title  = typeof raw.title === 'string' ? raw.title : ''
      const fields = raw.fields
         .filter((field): field is Record<string, unknown> => typeof field === 'object' && field !== null)
         .map((field): MetaField => ({
            id:       typeof field.id === 'string'    ? field.id    : crypto.randomUUID(),
            label:    typeof field.label === 'string' ? field.label : '',
            value:    typeof field.value === 'string' ? field.value : '',
            position: field.position === 'above' ? 'above' : 'below',
            ...(typeof field.color === 'string' ? { color: field.color } : {}),
            ...(field.showLabel === false ? { showLabel: false } : {}),
         }))
      return { title, fields }
   }

   // Legacy flat shape: map the four fixed fields to freeform entries, in display order,
   // keeping only those that carried a non-empty value. `module` reproduces the old
   // accent-colored tag above the title; the rest are plain muted fields below it.
   const title  = typeof raw.title === 'string' ? raw.title : ''
   const fields: MetaField[] = []
   const pushIfPresent = (
      value: unknown,
      label: string,
      position: 'above' | 'below',
      color?: string,
   ): void => {
      if (typeof value === 'string' && value.trim() !== '') {
         fields.push({ id: crypto.randomUUID(), label, value, position, ...(color ? { color } : {}) })
      }
   }
   pushIfPresent(raw.module, 'Module',      'above', 'accent')
   pushIfPresent(raw.env,    'Environment', 'below')
   pushIfPresent(raw.date,   'Date',        'below')
   pushIfPresent(raw.author, 'Author',      'below')
   return { title, fields }
}

// ##########################
// # PAGE-BREAK MODEL MIGRATION #
// ##########################

/**
 * Convert legacy `before`-anchored page breaks to the current `after` model, using the block flow to
 * resolve each anchor's predecessor (`before X` == `after X's predecessor`). Runs on a raw stored
 * format before normalizeFormat validates it, so the reader only ever sees the `after` shape.
 * Already-`after` breaks, non-paged formats, and malformed input pass through untouched. Must be given
 * the already-id-migrated sections so anchors resolve against the same block ids.
 */
export function migrateFormatPageBreaks(rawFormat: unknown, sections: Section[]): unknown {
   if (!rawFormat || typeof rawFormat !== 'object') return rawFormat
   const format = rawFormat as Record<string, unknown>
   if (!Array.isArray(format.pages)) return rawFormat

   const flat: { sectionId: string; blockId: string }[] = []
   for (const section of sections)
      for (const block of section.blocks) flat.push({ sectionId: section.id, blockId: String(block.id) })
   const indexByBlockId = new Map(flat.map((entry, index) => [entry.blockId, index]))

   const pages = format.pages.map(raw => {
      if (!raw || typeof raw !== 'object') return raw
      const pageBreak = raw as Record<string, unknown>
      if ('after' in pageBreak) return pageBreak                        // already the new model
      const before = pageBreak.before as Record<string, unknown> | undefined
      const beforeBlockId = before && typeof before.blockId === 'string' ? before.blockId : undefined
      if (beforeBlockId === undefined) return pageBreak
      const index = indexByBlockId.get(beforeBlockId)
      const predecessor = index !== undefined && index > 0 ? flat[index - 1] : null
      const { before: _dropped, ...rest } = pageBreak
      return { ...rest, after: predecessor }
   })
   return { ...format, pages }
}

/**
 * Convert a legacy `pageNumbering` ({ top?, bottom?, style }) into the header / footer band model:
 * the top edge becomes a header page-number item at its align, the bottom edge a footer one, and the
 * credit is placed in a free footer position so a migrated document keeps showing it. Runs on a raw
 * stored format before normalizeFormat (which no longer understands `pageNumbering`, so an unconverted
 * one would silently drop). Documents without `pageNumbering` pass through untouched (an absent footer
 * renders the default credit anyway).
 */
export function migrateFormatBands(rawFormat: unknown): unknown {
   if (!rawFormat || typeof rawFormat !== 'object') return rawFormat
   const format = rawFormat as Record<string, unknown>
   if (!('pageNumbering' in format)) return rawFormat
   const { pageNumbering, ...rest } = format
   if (!pageNumbering || typeof pageNumbering !== 'object') return rest

   const numbering = pageNumbering as Record<string, unknown>
   const style = typeof numbering.style === 'string' ? numbering.style : 'plain'
   const header: Record<string, unknown> = { ...(typeof format.header === 'object' && format.header ? format.header as object : {}) }
   const footer: Record<string, unknown> = { ...(typeof format.footer === 'object' && format.footer ? format.footer as object : {}) }

   // The top edge becomes a header page number; the bottom edge a footer page number. The credit is no
   // longer stored (the footer always shows it, auto-placed), so it is not carried here.
   const top    = numbering.top    as Record<string, unknown> | undefined
   const bottom = numbering.bottom as Record<string, unknown> | undefined
   if (top    && typeof top.align    === 'string') header[top.align]    = { kind: 'pageNumber', style }
   if (bottom && typeof bottom.align === 'string') footer[bottom.align] = { kind: 'pageNumber', style }

   const result: Record<string, unknown> = { ...rest }
   if (Object.keys(header).length > 0) result.header = header
   if (Object.keys(footer).length > 0) result.footer = footer
   return result
}

export function migrateIds(state: DocState): DocState {
   return {
      ...state,
      meta: migrateMeta(state.meta),
      sections: state.sections.map((sec: Section) => ({
         ...sec,
         id: String(sec.id),
         blocks: sec.blocks.map(migrateBlock),
      })),
   }
}

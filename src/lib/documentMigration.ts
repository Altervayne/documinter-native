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

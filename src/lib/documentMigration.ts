/**
 * documentMigration.ts, Legacy-format upgrade for stored documents.
 *
 * Relocated verbatim from storage.ts. Brings any historical document shape (numeric ids,
 * pre-InlineContent string fields, old list-item formats) up to the current model. Shared by
 * autosaveStorage (localStorage read), documentBackupFile (JSON import), and binderDocuments
 * (IndexedDB read). Pure, no side effects.
 */

import { parseInlineContent, stripTrailingNewlines } from './inline'
import type { Block, DocState, InlineContent, ListItem, Section } from '../types'

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
   return { id, richText, children: children.map(migrateListItem) }
}

/**
 * Convert any legacy numeric IDs to strings, normalize list items, and populate the
 * new InlineContent fields (richText, richHeaders, richRows) from legacy string fields
 * if they are absent.
 */
function migrateBlock(rawBlock: LegacyRawBlock): Block {
   const base: LegacyRawBlock = { ...rawBlock, id: String(rawBlock.id) }

   if (base.type === 'container') {
      return {
         ...base,
         left:  (base.left  ?? []).map(block => migrateBlock(block as LegacyRawBlock)),
         right: (base.right ?? []).map(block => migrateBlock(block as LegacyRawBlock)),
      }
   }

   if (base.type === 'list' && Array.isArray(base.items)) {
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

export function migrateIds(state: DocState): DocState {
   return {
      ...state,
      sections: state.sections.map((sec: Section) => ({
         ...sec,
         id: String(sec.id),
         blocks: sec.blocks.map(migrateBlock),
      })),
   }
}

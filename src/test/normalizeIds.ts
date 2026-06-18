import type { DocState, Block, ListItem } from '../types'

// Blanks every id (section, block, container child, list-item tree) to a constant so two DocStates
// can be deep-equal-compared without their random UUIDs causing spurious mismatches. Pure; no DOM.
// Table cells (richHeaders/richRows) carry no ids, so they need no normalization.

const BLANK_ID = ''

function normalizeListItems(items: ListItem[]): ListItem[] {
   return items.map(item => ({ ...item, id: BLANK_ID, children: normalizeListItems(item.children) }))
}

function normalizeBlock(block: Block): Block {
   const normalized: Block = { ...block, id: BLANK_ID }
   if (normalized.items) normalized.items = normalizeListItems(normalized.items)
   if (normalized.left)  normalized.left  = normalized.left.map(normalizeBlock)
   if (normalized.right) normalized.right = normalized.right.map(normalizeBlock)
   return normalized
}

export function normalizeIds(state: DocState): DocState {
   return {
      meta: state.meta,
      sections: state.sections.map(section => ({
         ...section,
         id: BLANK_ID,
         blocks: section.blocks.map(normalizeBlock),
      })),
   }
}

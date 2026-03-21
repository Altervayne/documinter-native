// -- Type Imports --
import type { Block, BlockType, Section } from '../types'

export function mkSection(title = 'New section'): Section {
   return { id: crypto.randomUUID(), title, collapsed: false, blocks: [] }
}

/** Deep-copy a block, assigning fresh IDs to it and any nested blocks. */
export function cloneBlock(block: Block): Block {
   const base = { ...block, id: crypto.randomUUID() }
   if (block.type === 'container') {
      return {
         ...base,
         left:  (block.left  ?? []).map(cloneBlock),
         right: (block.right ?? []).map(cloneBlock),
      }
   }
   return base
}

export function mkBlock(type: BlockType): Block {
   const id = crypto.randomUUID()
   switch (type) {
      case 'p':         return { id, type, text: 'Your paragraph here.' }
      case 'h3':        return { id, type, text: 'Heading H3' }
      case 'h4':        return { id, type, text: 'Heading H4' }
      case 'callout':   return { id, type, style: 'info', text: 'Your note here.' }
      case 'code':      return { id, type, code: '// Code here', lang: 'windev' }
      case 'list':      return { id, type, items: [{ text: 'First item', children: [] }, { text: 'Second item', children: [] }] }
      case 'table':     return { id, type, headers: ['Column 1', 'Column 2'], rows: [['', ''], ['', '']] }
      case 'image':     return { id, type, src: '', alt: '', caption: '' }
      case 'container': return { id, type, ratio: 0.5, left: [], right: [] }
   }
}

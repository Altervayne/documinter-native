import type { Block, BlockType, Section, DocState } from '../types'

let secCounter = 0
let blkCounter = 0

export function resetCounters(state: DocState): DocState {
  secCounter = 0
  blkCounter = 0
  const sections = state.sections.map(sec => ({
    ...sec,
    id: ++secCounter,
    blocks: sec.blocks.map(blk => ({ ...blk, id: ++blkCounter })),
  }))
  return { ...state, sections }
}

export function mkSection(title = 'New section'): Section {
  return { id: ++secCounter, title, collapsed: false, blocks: [] }
}

export function mkBlock(type: BlockType): Block {
  const id = ++blkCounter
  switch (type) {
    case 'p':       return { id, type, text: 'Your paragraph here.' }
    case 'h3':      return { id, type, text: 'Heading H3' }
    case 'h4':      return { id, type, text: 'Heading H4' }
    case 'callout': return { id, type, style: 'info', text: 'Your note here.' }
    case 'code':    return { id, type, code: '// Code here', lang: 'windev' }
    case 'list':    return { id, type, items: ['First item', 'Second item'] }
    case 'table':   return { id, type, headers: ['Column 1', 'Column 2'], rows: [['', ''], ['', '']] }
  }
}

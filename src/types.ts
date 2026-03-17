export type BlockType = 'p' | 'h3' | 'h4' | 'callout' | 'code' | 'list' | 'table'
export type CalloutStyle = 'info' | 'valid' | 'warning' | 'danger'
export type CodeLang = 'windev' | 'js' | 'sql' | 'plain'

export interface Block {
  id: number
  type: BlockType
  text?: string         // p, h3, h4, callout
  style?: CalloutStyle  // callout
  code?: string         // code
  lang?: CodeLang       // code — default 'windev'
  items?: string[]      // list
  headers?: string[]    // table
  rows?: string[][]     // table
}

export interface Section {
  id: number
  title: string
  collapsed: boolean
  blocks: Block[]
}

export interface DocMeta {
  module: string
  title: string
  author: string
  date: string
  env: string
}

export interface DocState {
  meta: DocMeta
  sections: Section[]
}

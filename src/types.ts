export type BlockType = 'p' | 'h3' | 'h4' | 'callout' | 'code' | 'list' | 'table' | 'image' | 'container'
export type Side = 'left' | 'right'
export type CalloutStyle = 'info' | 'valid' | 'warning' | 'danger'
export type CodeLang = 'windev' | 'js' | 'sql' | 'plain'

export interface Block {
   id: string
   type: BlockType
   text?: string         // p, h3, h4, callout
   style?: CalloutStyle  // callout
   code?: string         // code
   lang?: CodeLang       // code — default 'windev'
   items?: string[]      // list
   headers?: string[]    // table
   rows?: string[][]     // table
   src?: string          // image: base64 data URL
   alt?: string          // image: alt text
   caption?: string      // image: optional caption
   ratio?: number        // container: left column width 0.1–0.9, default 0.5
   left?: Block[]        // container: left column blocks (no nested containers)
   right?: Block[]       // container: right column blocks
}

export interface Section {
   id: string
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

export interface ContainerMutations {
   updateBlock:    (secId: string, blkId: string, side: Side, innerBlkId: string, patch: Partial<Block>) => void
   addBlock:       (secId: string, blkId: string, side: Side, type: BlockType) => void
   removeBlock:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   moveBlock:      (secId: string, blkId: string, side: Side, from: number, to: number) => void
   addListItem:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   removeLastItem: (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   addTableRow:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   removeLastRow:  (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   addTableCol:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   updateRatio:    (secId: string, blkId: string, ratio: number) => void
}

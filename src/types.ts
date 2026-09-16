import type { GraphSpec } from './lib/graph'
import type { DiagramSpec } from './lib/diagram/types'
import type { MarkupElement } from './lib/imageMarkup'
import type { DocPresentationExtras } from './lib/presentation'
import type { DocFormat } from './lib/format'

export type BlockType = 'p' | 'h3' | 'h4' | 'callout' | 'code' | 'math' | 'graph' | 'diagram' | 'list' | 'checklist' | 'table' | 'image' | 'container' | 'hr'
export type Side = 'left' | 'right'
export type CalloutStyle = 'info' | 'valid' | 'warning' | 'danger'
export type CodeLang = 'windev' | 'js' | 'sql' | 'python' | 'c' | 'html' | 'css' | 'plain'

/** One list-marker style, per SUB-LIST of a `list` block (never `checklist`). A sub-list is one
 *  `<ul>`/`<ol>`: the root items form one, each item's non-empty `children` another. First five are
 *  unordered, last five ordered; `dash` and `arrow` render via a `::marker` override (lib/listMarkers.ts). */
export type ListMarker =
   | 'dot' | 'circle' | 'square' | 'dash' | 'arrow'
   | 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman'

// ########################
// # INLINE CONTENT MODEL #
// ########################

/** A contiguous run of text with uniform inline formatting. Invariant: text.length > 0 (empty runs are
 *  filtered before storing); '\n' is a line break (rendered as <br>). */
export interface InlineRun {
   text:           string
   bold?:          boolean
   italic?:        boolean
   underline?:     boolean
   strikethrough?: boolean
   color?:         string     // not wired to any UI control
   highlight?:     string     // not wired to any UI control
   link?:          string     // href, combines freely with all other flags
}

export type InlineContent = InlineRun[]

/** A cursor position within an InlineContent array. Canonical at a run boundary: prefer
 *  { runIndex: N+1, offset: 0 } over { runIndex: N, offset: run[N].text.length }. */
export interface CursorPosition {
   runIndex: number
   offset:   number
}

// ###################
// # EDITOR UI STATE #
// ###################

/** Active inline-formatting state for the current selection, shared by the FormatToolbar and the
 *  inline-color picker hook. */
export interface FormatState {
   bold:           boolean
   italic:         boolean
   underline:      boolean
   strikethrough:  boolean
   fontColor:      string | undefined
   highlightColor: string | undefined
}

// ##################
// # DOCUMENT MODEL #
// ##################

export interface ListItem {
   id:        string
   richText?: InlineContent
   children:  ListItem[]
   checked?:  boolean   // checklist items only; absent = unchecked
   /** `list` only: marker style for THIS item's `children` sub-list. Absent renders `dot` and is never
    *  stored as `dot`, so an untouched list stays byte-identical. */
   childMarker?: ListMarker
}

/** Optional annotation overlay on an `image` block. Its PRESENCE switches the image into marked-up mode
 *  (SVG render + `imagemarkup` fence). `width`/`height` are the base image's natural pixel dimensions,
 *  the viewBox aspect for the normalized-0..1 overlay coords, kept even when `src` is empty (a .mint/.md
 *  reopen drops the base64). The base image stays on the block's `src`/`alt`/`caption`, never duplicated
 *  here. `elements` is the overlay stack, array order = z-order. */
export interface ImageMarkupOverlay {
   width:    number
   height:   number
   elements: MarkupElement[]
}

export interface Block {
   id: string
   type: BlockType
   richText?: InlineContent  // p, h3, h4, callout
   style?: CalloutStyle  // callout
   calloutColor?: string // callout: custom hex override of the `style` preset; absent = use the preset
   code?: string         // code
   lang?: CodeLang       // code, default 'windev'
   latex?: string        // math: LaTeX source
   mathScale?: number    // math: display font-size multiplier; undefined/1 = normal (see lib/mathScale.ts)
   graph?: GraphSpec     // graph: chart type + data + options (inline SVG)
   diagram?: DiagramSpec // diagram: nodes + edges + options (inline SVG)
   imageMarkup?: ImageMarkupOverlay // image: annotation overlay; presence = markup mode
   items?: ListItem[]    // list, checklist
   /** `list` only: marker style of the ROOT sub-list. Absent renders `dot` and is never stored as `dot`,
    *  so an untouched document stays byte-identical. Serialized to the JSON backup; Markdown keeps only
    *  the ordered/unordered distinction, though its importer honours an authored `<!-- list-marker -->`. */
   listMarker?: ListMarker
   richHeaders?: InlineContent[]    // table
   richRows?:    InlineContent[][]  // table
   src?: string          // image: base64 data URL
   alt?: string          // image
   caption?: string      // image: caption
   align?: 'left' | 'center' | 'right'  // image: default center
   imageHeight?: number                  // image: constrained display height in px; undefined = unconstrained
   ratio?: number        // container: left column width 0.1-0.9, default 0.5
   left?: Block[]        // container: left column blocks (no nested containers)
   right?: Block[]       // container: right column blocks
   handle?: string       // optional anchor ID for deep-linking (e.g. "my-note" -> href="#my-note")
   /** Paged keep-together: hold this splittable block (`p`/`list`/`checklist`) whole on one page. Only
    *  ever `true` or absent, so an untouched document stays byte-identical. Layout chrome, JSON-only:
    *  read in `paginate`, never emitted to `.mint`/`.md`. */
   keepTogether?: true
   /** Paged keep-with-next: never break AFTER this block, so it stays on the same page as the block that
    *  follows (a caption pinned under its chart). Only ever `true` or absent, like `keepTogether`. Layout
    *  chrome, JSON-only: read in `paginate`, never emitted to `.mint`/`.md`. */
   keepWithNext?: true
   /** RENDER-ONLY, set by the paginator on a shallow-copied `p` fragment split across pages. Holds the
    *  fragment's char range in richText and whether it is the tail (paragraphs carry no item ids to match
    *  on, unlike lists). Transient: never on the model block, never serialized. Absent on a whole block. */
   paragraphFragment?: { charStart: number; charEnd: number; isTail: boolean }
}

export interface Section {
   id: string
   title: string
   collapsed: boolean
   blocks: Block[]
}

/** One user-defined document metadata field: a freeform label paired with a freeform value. */
export interface MetaField {
   id:        string   // stable id, from the same generator as mkBlock/mkSection (crypto.randomUUID)
   label:     string
   value:     string
   position:  'above' | 'below'   // relative to the title
   color?:    string              // undefined = default muted; 'accent' = var(--doc-accent) live; or a hex
   showLabel?: boolean            // undefined/true = show label; false = render value only
}

export interface DocMeta {
   title:  string
   fields: MetaField[]
}

export interface DocState {
   meta: DocMeta
   sections: Section[]
}

/** One open document in the workspace (a tab). Holds the document content plus a stable in-session
 *  key. `tabKey` is a fresh UUID, distinct from any binder id, so a never-saved document still has
 *  identity. */
export interface OpenDocument {
   tabKey:    string
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   /** Export-only / editor-only presentation extras (watermark, ...); absent = default behavior.
    *  Rides on the same seams as docTheme / docAccent; NEVER serialized to Markdown. */
   presentation?: DocPresentationExtras
   /** Page format (infinite width, or paged A4); absent = default infinite. Rides on the same seams as
    *  presentation; NEVER serialized to Markdown (chrome, not content, see lib/format.ts). */
   format?: DocFormat
   documentId:            string | null   // binder record id; null until first save
   saveStatus:            SaveStatus       // per-tab dirty/saving/saved cycle
   pendingNewDocFolderId: string | null    // folder a fresh doc lands in on first save; null = root
   syncedUpdatedAt:       string | null    // disk updatedAt this tab is in sync with; null for a never-saved scratch tab
}

// #######################################
// # BINDER, INDEXEDDB DOCUMENT LIBRARY #
// #######################################

/** A section's title + a slice of its blocks, for the card preview (image src stripped). */
export interface PreviewSection {
   title:  string
   blocks: Block[]
}

/** A binder folder. parentId '0' = root. Folders nest to unlimited depth. */
export interface BinderFolderRecord {
   id:        string    // crypto.randomUUID()
   name:      string
   parentId:  string    // '0' = root
   createdAt: string    // ISO 8601
   updatedAt: string    // ISO 8601
   sortOrder: number    // manual sort position among siblings
}

/** Lightweight binder record (the `documents` store), returned by listDocuments(): everything a card
 *  needs WITHOUT the heavy sections array. lastOpenedAt / folderId / sortOrder are binder-only, never
 *  serialized to any export (exports operate on DocState only). */
export interface BinderDocumentRecord {
   id:              string             // crypto.randomUUID()
   meta:            DocMeta
   createdAt:       string             // ISO 8601, set once
   updatedAt:       string             // ISO 8601, rewritten on every save
   lastOpenedAt:    string | undefined // ISO 8601, undefined until first open
   folderId:        string             // '0' = root (unfiled)
   sortOrder:       number             // manual sort position within folder
   sectionTitles:   string[]           // all section titles (cheap; count = .length)
   contentText:     string             // flattened plain text of every block (for full-text search)
   previewSections: PreviewSection[]   // first N blocks, section-grouped, image src stripped, no base64
   docTheme:        'light' | 'dark'
   docAccent:       string
   schemaVersion:   number
}

/** Heavy binder content (the `documentContent` object store), the full sections
 *  array, base64 image src retained. Read only when a document is opened/exported. */
export interface BinderDocumentContent {
   id:       string
   sections: Section[]
   /** Image-bearing presentation extras (watermark base64, ...) live on the HEAVY store, not the light
    *  card record, so a full-bleed base64 never bloats the card-list query. Absent on older documents. */
   presentation?: DocPresentationExtras
   /** Page format; grouped with presentation on the heavy store for seam consistency though it carries
    *  no base64. Absent on a document that never left the default (see isDefaultFormat). */
   format?: DocFormat
}

export type Mode = 'wysiwyg' | 'preview'

// ######################################
// # PANE TREE, WORKSPACE LAYOUT MODEL #
// ######################################

/** Which content lives in a leaf pane. */
export type PaneId = 'wysiwyg' | 'markdown'

/** A leaf pane, shows one editor surface. */
export interface PaneLeaf {
   kind:   'leaf'
   paneId: PaneId
}

/** A split pane: two children with a resizable divider. `orientation: 'h'` = left/right, `'v'` =
 *  top/bottom. `ratio` is children[0]'s fraction of the axis, clamped [0.15, 0.85]. */
export interface PaneSplit {
   kind:        'split'
   orientation: 'h' | 'v'
   ratio:       number
   children:    [PaneNode, PaneNode]
}

export type PaneNode = PaneLeaf | PaneSplit

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved'

export interface ContainerMutations {
   updateBlock:    (secId: string, blkId: string, side: Side, innerBlkId: string, patch: Partial<Block>) => void
   addBlock:       (secId: string, blkId: string, side: Side, type: BlockType) => void
   insertBlockAt:  (secId: string, blkId: string, side: Side, index: number, type: BlockType) => void
   /** Inserts an already-built block after `innerBlkId`: the caller supplies the full block (no
    *  `mkBlock` default), e.g. the graph<->table extract actions. */
   insertBlockAfter: (secId: string, blkId: string, side: Side, innerBlkId: string, newBlock: Block) => void
   duplicateBlock: (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   removeBlock:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   moveBlock:      (secId: string, blkId: string, side: Side, from: number, to: number) => void
   addListItem:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   removeLastItem: (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   addTableRow:      (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   removeLastRow:    (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   addTableCol:      (secId: string, blkId: string, side: Side, innerBlkId: string) => void
   insertTableRowAt: (secId: string, blkId: string, side: Side, innerBlkId: string, rowIndex: number) => void
   deleteTableRowAt: (secId: string, blkId: string, side: Side, innerBlkId: string, rowIndex: number) => void
   insertTableColAt: (secId: string, blkId: string, side: Side, innerBlkId: string, colIndex: number) => void
   deleteTableColAt: (secId: string, blkId: string, side: Side, innerBlkId: string, colIndex: number) => void
   updateRatio:      (secId: string, blkId: string, ratio: number) => void
   // List-item structural edits (scoped to an inner list block), backed by listItemTree.ts.
   moveListItemUp:              (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string) => void
   moveListItemDown:            (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string) => void
   indentListItem:              (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string) => void
   unindentListItem:            (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string) => void
   removeListItem:              (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string) => void
   insertListItemAfter:         (secId: string, blkId: string, side: Side, innerBlkId: string, afterItemId: string, newItem: ListItem) => void
   updateListItemRichText:      (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string, richText: InlineContent) => void
   reorderListItemsUnderParent: (secId: string, blkId: string, side: Side, innerBlkId: string, parentItemId: string | null, oldIndex: number, newIndex: number) => void
   toggleChecklistItem:         (secId: string, blkId: string, side: Side, innerBlkId: string, itemId: string) => void
}

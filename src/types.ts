export type BlockType = 'p' | 'h3' | 'h4' | 'callout' | 'code' | 'math' | 'list' | 'checklist' | 'table' | 'image' | 'container' | 'hr'
export type Side = 'left' | 'right'
export type CalloutStyle = 'info' | 'valid' | 'warning' | 'danger'
export type CodeLang = 'windev' | 'js' | 'sql' | 'python' | 'c' | 'html' | 'css' | 'plain'

// ########################
// # INLINE CONTENT MODEL #
// ########################

/** A single contiguous run of text with a uniform set of inline formatting flags.
 *  Invariant: text.length > 0, empty runs are always filtered before storing.
 *  '\n' characters in text represent line breaks (rendered as <br>). */
export interface InlineRun {
   text:           string
   bold?:          boolean
   italic?:        boolean
   underline?:     boolean
   strikethrough?: boolean
   color?:         string     // CSS color value, reserved, not yet surfaced in UI
   highlight?:     string     // CSS color value, reserved, not yet surfaced in UI
   link?:          string     // href, combines freely with all other flags
}

/** A paragraph of inline-formatted text: a flat, ordered sequence of runs. */
export type InlineContent = InlineRun[]

/** A cursor (or collapsed selection) position within an InlineContent array.
 *  Canonical form at a run boundary: prefer { runIndex: N+1, offset: 0 }
 *  over { runIndex: N, offset: run[N].text.length }. */
export interface CursorPosition {
   runIndex: number
   offset:   number
}

// ###################
// # EDITOR UI STATE #
// ###################

/** Active inline-formatting state shown by the FormatToolbar for the current selection.
 *  Shared between the toolbar and the inline-color picker hook. */
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
}

export interface Block {
   id: string
   type: BlockType
   richText?: InlineContent  // p, h3, h4, callout
   style?: CalloutStyle  // callout
   code?: string         // code
   lang?: CodeLang       // code, default 'windev'
   latex?: string        // math: LaTeX source (rendered to MathML in-app + on export)
   mathScale?: number    // math: display font-size multiplier; undefined/1 = normal (see lib/mathScale.ts)
   items?: ListItem[]    // list, checklist
   richHeaders?: InlineContent[]    // table
   richRows?:    InlineContent[][]  // table
   src?: string          // image: base64 data URL
   alt?: string          // image: alt text
   caption?: string      // image: optional caption
   align?: 'left' | 'center' | 'right'  // image: horizontal alignment, default center
   imageHeight?: number                  // image: constrained display height in px; undefined = unconstrained
   ratio?: number        // container: left column width 0.1–0.9, default 0.5
   left?: Block[]        // container: left column blocks (no nested containers)
   right?: Block[]       // container: right column blocks
   handle?: string       // optional anchor ID for deep-linking (e.g. "my-note" → href="#my-note")
}

export interface Section {
   id: string
   title: string
   collapsed: boolean
   blocks: Block[]
}

/** One user-defined document metadata field: a freeform label paired with a freeform value.
 *  `position` places the field in the row above or below the title. `color` tints the field
 *  text: undefined = the default muted meta gray, 'accent' = var(--doc-accent) tracked live, or
 *  any literal hex. `showLabel` controls whether the label (and its colon) render in the read
 *  view + export: undefined/true = show (default), false = value-only. */
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
 *  identity. Per-tab save identity/status (documentId, saveStatus) arrive in a later phase. */
export interface OpenDocument {
   tabKey:    string
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   documentId:            string | null   // binder record id; null until first save
   saveStatus:            SaveStatus       // per-tab dirty/saving/saved cycle
   pendingNewDocFolderId: string | null    // folder a fresh doc lands in on first save; null = root
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

/** Lightweight binder record (the `documents` object store). Returned by
 *  listDocuments(): everything a card needs, WITHOUT the heavy sections array.
 *  NOTE: lastOpenedAt / folderId / sortOrder are binder-only and are NEVER serialized
 *  to any export format (HTML/MD/Mintdown/JSON), exports operate on DocState only. */
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
   docTheme:        'light' | 'dark'   // per-document presentation
   docAccent:       string             // per-document presentation
   schemaVersion:   number
}

/** Heavy binder content (the `documentContent` object store), the full sections
 *  array, base64 image src retained. Read only when a document is opened/exported. */
export interface BinderDocumentContent {
   id:       string
   sections: Section[]
}

export type Mode = 'wysiwyg' | 'preview'

// ######################################
// # PANE TREE, WORKSPACE LAYOUT MODEL #
// ######################################

/** Which content lives in a leaf pane. */
export type PaneId = 'wysiwyg' | 'mintdown' | 'markdown'

/** A leaf pane, shows one editor surface. */
export interface PaneLeaf {
   kind:   'leaf'
   paneId: PaneId
}

/**
 * A split pane, two children separated by a resizable divider.
 * `orientation: 'h'` → children sit left / right (horizontal divider)
 * `orientation: 'v'` → children sit top / bottom (vertical divider)
 * `ratio` is children[0]'s fraction of the total axis length, clamped [0.15, 0.85].
 */
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

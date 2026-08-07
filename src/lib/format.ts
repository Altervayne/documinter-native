/**
 * Document-level page format (infinite canvas or paged A4), plus the infinite-canvas width.
 *
 * Pure types, defaults, and normalization for the document `format` field. Rides the same seams as
 * `docTheme` / `docAccent` / `presentation` (see lib/presentation.ts): OpenDocument, the binder's
 * DocPresentation / LoadedDocument / BinderDocumentContent, and the JSON backup. Never inside
 * DocState, and never serialized to `.mint` / `.md` (format is structural chrome, like presentation).
 *
 * `kind` is carried in full so every stored format shape survives normalization, but
 * resolveDocumentSheetWidthPx below only varies the sheet width for the infinite kind: an
 * a4-portrait / a4-landscape document resolves to the same normal width there, because the paged
 * renderer computes its own A4 dimensions independently (see pageModel.ts). `margins` and `pages` are
 * carried on the type so stored data round-trips; this file only normalizes them, it does not
 * consume them.
 *
 * No React, no DOM: pure and unit-testable, mirroring presentation.ts.
 */

// #########
// # TYPES #
// #########

/** Infinite-canvas content width. `normal` reproduces today's 860px sheet exactly. */
export type InfiniteWidth =
   | 'narrow'          // 640px, prose-focused
   | 'normal'          // 860px, the default width
   | 'wide'            // 1080px, wide tables / graphs
   | { custom: number } // explicit max-width in px, clamped to a sane window

export type PageKind = 'infinite' | 'a4-portrait' | 'a4-landscape'

/** Page margins in millimetres, the print-native unit; drives both the editor's page padding and
 *  the exported @page rule. */
export interface PageMargins { top: number; right: number; bottom: number; left: number }

/** How the Page setup window edits the four PageMargins values. Purely a UI concern, never stored:
 *  the model always carries four independent values, this only picks how many inputs the user sees
 *  and which sides move together when one of them changes. */
export type MarginMode = 'allEqual' | 'verticalHorizontal' | 'eachSide'

/**
 * A page is defined by WHERE it starts in the flat block flow (a break marker), plus its own id and
 * optional per-page overrides. Read by `partitionIntoPages` to split the flow into discrete pages.
 */
export interface PageBreak {
   id: string                 // crypto.randomUUID(), stable across reorders, the sorter's key
   /** The boundary sits immediately AFTER this block, the last block of the page before it. null puts
    *  the boundary before all content (a leading blank page). Multiple breaks sharing an anchor stack
    *  as consecutive blank pages. */
   after: { sectionId: string; blockId: string } | null
   /** Optional per-page landscape/portrait override for a mixed-orientation doc. */
   orientationOverride?: 'a4-portrait' | 'a4-landscape'
}

/** Horizontal placement within a header/footer band. The three positions ARE the alignment. */
export type PageNumberAlign = 'left' | 'center' | 'right'
export type BandPosition = PageNumberAlign

/** How a page number reads. `plain` = `1`; `page` = `Page 1`; `slash` = `1 / N`;
 *  `pageOf` = `Page 1 of N`; `dashes` = `- 1 -` (N = total page count). */
export type PageNumberStyle = 'plain' | 'page' | 'slash' | 'pageOf' | 'dashes'

/** A logo image placed in a header/footer slot: a base64 data URI plus its natural dims (for aspect). */
export interface BandImage {
   src:     string
   width?:  number
   height?: number
}

/** One header/footer slot's content. `pageNumber` prints the live page number in the given style;
 *  `credit` is the "Made with Documinter" mark; `content` is custom, a logo image and/or text inline. */
export type BandItem =
   | { kind: 'pageNumber'; style: PageNumberStyle }
   | { kind: 'credit' }
   | { kind: 'content'; text?: string; image?: BandImage }

/** A running header or footer band: up to three positioned items (left / center / right). */
export interface PageBand {
   left?:   BandItem
   center?: BandItem
   right?:  BandItem
}

export interface DocFormat {
   kind: PageKind
   /** infinite only; ignored for a4-*. Absent means 'normal'. */
   width?: InfiniteWidth
   /** a4-* only; ignored for infinite. Absent means DEFAULT_A4_MARGINS. */
   margins?: PageMargins
   /** paged only: the ordered discrete pages (break-marker model). */
   pages?: PageBreak[]
   /** paged only: the running header band (top margin, every page). Absent means no header. */
   header?: PageBand
   /** paged only: the running footer band (bottom margin, every page). Absent means the default
    *  credit; an empty band ({}) is a deliberately cleared footer. */
   footer?: PageBand
}

// #############
// # CONSTANTS #
// #############

export const DEFAULT_FORMAT: DocFormat = { kind: 'infinite' }   // existing docs read as this
export const DEFAULT_A4_MARGINS: PageMargins = { top: 20, right: 20, bottom: 20, left: 20 }

// Infinite-width presets, in px. NORMAL matches both the editor sheet and the export .doc-card
// exactly (WysiwygArea/index.tsx's `max-w-215` Tailwind class = 53.75rem = 860px at the default
// 16px root, and export.ts's `.doc-card { max-width: 860px }`), the default width.
export const INFINITE_WIDTH_NARROW_PX = 640
export const INFINITE_WIDTH_NORMAL_PX = 860
export const INFINITE_WIDTH_WIDE_PX   = 1080

// A custom width is clamped to a sane window: narrow enough to stay a legible document, wide enough
// to cover an ultra-wide monitor without ballooning without bound.
export const INFINITE_WIDTH_CUSTOM_MIN_PX = 480
export const INFINITE_WIDTH_CUSTOM_MAX_PX = 1600

const PAGE_KINDS: ReadonlySet<PageKind> = new Set(['infinite', 'a4-portrait', 'a4-landscape'])
const INFINITE_WIDTH_KEYWORDS: ReadonlySet<string> = new Set(['narrow', 'normal', 'wide'])
const PAGE_NUMBER_STYLES_SET: ReadonlySet<string> = new Set(['plain', 'page', 'slash', 'pageOf', 'dashes'])

// ###########
// # HELPERS #
// ###########

/** Clamp + round a raw custom width into the sane window. */
function clampCustomWidthPx(value: number): number {
   const rounded = Math.round(value)
   return Math.min(INFINITE_WIDTH_CUSTOM_MAX_PX, Math.max(INFINITE_WIDTH_CUSTOM_MIN_PX, rounded))
}

/** Defensive read-time normalization of a stored InfiniteWidth, or undefined when it is unusable
 *  (falls back to 'normal' at the resolve step, mirroring normalizeWatermark's undefined-fallback). */
function normalizeInfiniteWidth(raw: unknown): InfiniteWidth | undefined {
   if (typeof raw === 'string' && INFINITE_WIDTH_KEYWORDS.has(raw)) return raw as InfiniteWidth
   if (raw && typeof raw === 'object' && 'custom' in raw) {
      const custom = (raw as { custom: unknown }).custom
      if (typeof custom === 'number' && Number.isFinite(custom)) return { custom: clampCustomWidthPx(custom) }
   }
   return undefined
}

/** Defensive read-time normalization of stored PageMargins, or undefined when nothing usable
 *  remains. Any present numeric side is kept; a missing side falls back to DEFAULT_A4_MARGINS. */
function normalizeMargins(raw: unknown): PageMargins | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const top    = typeof source.top    === 'number' ? source.top    : undefined
   const right  = typeof source.right  === 'number' ? source.right  : undefined
   const bottom = typeof source.bottom === 'number' ? source.bottom : undefined
   const left   = typeof source.left   === 'number' ? source.left   : undefined
   if (top === undefined && right === undefined && bottom === undefined && left === undefined) return undefined
   return {
      top:    top    ?? DEFAULT_A4_MARGINS.top,
      right:  right  ?? DEFAULT_A4_MARGINS.right,
      bottom: bottom ?? DEFAULT_A4_MARGINS.bottom,
      left:   left   ?? DEFAULT_A4_MARGINS.left,
   }
}

/** A single stored PageBreak, permissively normalized (this does not validate the anchor against
 *  live content); malformed entries (missing id/after) are dropped defensively. A null `after` is a
 *  valid leading blank page. Legacy `before`-anchored breaks are converted to `after` upstream at load
 *  (see migrateFormatPageBreaks), which needs the flow, so this reader only understands `after`. */
function normalizePageBreak(raw: unknown): PageBreak | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const id = typeof source.id === 'string' ? source.id : ''
   if (id.trim() === '') return undefined
   if (!('after' in source)) return undefined
   const rawAfter = source.after
   let after: PageBreak['after']
   if (rawAfter === null) {
      after = null
   } else if (rawAfter && typeof rawAfter === 'object') {
      const anchor = rawAfter as Record<string, unknown>
      const sectionId = typeof anchor.sectionId === 'string' ? anchor.sectionId : ''
      const blockId   = typeof anchor.blockId   === 'string' ? anchor.blockId   : ''
      if (sectionId.trim() === '' || blockId.trim() === '') return undefined
      after = { sectionId, blockId }
   } else {
      return undefined
   }
   const result: PageBreak = { id, after }
   if (source.orientationOverride === 'a4-portrait' || source.orientationOverride === 'a4-landscape') {
      result.orientationOverride = source.orientationOverride
   }
   return result
}

/** A logo image in a band slot, or undefined when its src is missing. */
function normalizeBandImage(raw: unknown): BandImage | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const src = typeof source.src === 'string' ? source.src : ''
   if (src.trim() === '') return undefined
   const result: BandImage = { src }
   if (typeof source.width === 'number'  && source.width  > 0) result.width  = source.width
   if (typeof source.height === 'number' && source.height > 0) result.height = source.height
   return result
}

/** A single header/footer item, or undefined when malformed or empty (an empty content slot is no
 *  item). Page-number style falls back to 'plain' when missing/invalid. */
function normalizeBandItem(raw: unknown): BandItem | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   if (source.kind === 'pageNumber') {
      const style: PageNumberStyle = typeof source.style === 'string' && PAGE_NUMBER_STYLES_SET.has(source.style)
         ? source.style as PageNumberStyle
         : 'plain'
      return { kind: 'pageNumber', style }
   }
   if (source.kind === 'credit') return { kind: 'credit' }
   if (source.kind === 'content') {
      const text  = typeof source.text === 'string' && source.text.trim() !== '' ? source.text : undefined
      const image = normalizeBandImage(source.image)
      if (text === undefined && image === undefined) return undefined
      return { kind: 'content', ...(text !== undefined ? { text } : {}), ...(image !== undefined ? { image } : {}) }
   }
   return undefined
}

/** A header/footer band. Undefined only when the raw is absent; a present-but-empty band normalizes to
 *  {} (a deliberately cleared band, distinct from absent, which shows the default footer credit). */
function normalizeBand(raw: unknown): PageBand | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const result: PageBand = {}
   const left   = normalizeBandItem(source.left)
   const center = normalizeBandItem(source.center)
   const right  = normalizeBandItem(source.right)
   if (left)   result.left = left
   if (center) result.center = center
   if (right)  result.right = right
   return result
}

// ################
// # NORMALIZATION #
// ################

/**
 * Absent-tolerant normalizer (mirrors normalizePresentation): any partial/legacy/malformed value
 * becomes a valid DocFormat, defaulting kind to 'infinite'. Unlike normalizePresentation, this never
 * returns undefined; an absent format IS a well-formed DocFormat (`DEFAULT_FORMAT`), not "no format".
 */
export function normalizeFormat(raw: unknown): DocFormat {
   if (!raw || typeof raw !== 'object') return { ...DEFAULT_FORMAT }
   const source = raw as Record<string, unknown>

   const kind = PAGE_KINDS.has(source.kind as PageKind) ? (source.kind as PageKind) : DEFAULT_FORMAT.kind
   const width    = normalizeInfiniteWidth(source.width)
   const margins  = normalizeMargins(source.margins)
   const pages    = Array.isArray(source.pages)
      ? source.pages.map(normalizePageBreak).filter((page): page is PageBreak => page !== undefined)
      : undefined

   const header = normalizeBand(source.header)
   const footer = normalizeBand(source.footer)

   const result: DocFormat = { kind }
   if (width !== undefined) result.width = width
   if (margins !== undefined) result.margins = margins
   if (pages !== undefined && pages.length > 0) result.pages = pages
   if (header !== undefined) result.header = header
   if (footer !== undefined) result.footer = footer
   return result
}

/**
 * Whether a DocFormat is equivalent to "no format set" (infinite, normal width, no margins, no
 * pages), the state an absent `format` field normalizes to. Used to keep an untouched document's
 * persisted bundle (binder heavy content, JSON backup) byte-clean, mirroring how `presentation` is
 * only ever spread onto storage when it holds something.
 */
export function isDefaultFormat(format: DocFormat): boolean {
   return format.kind === 'infinite'
      && (format.width === undefined || format.width === 'normal')
      && format.margins === undefined
      && (format.pages === undefined || format.pages.length === 0)
      && format.header === undefined
      && format.footer === undefined
}

/** The header band to render: the configured one, or an empty band (no header by default). Header items
 *  are user content (page number, text, logo); the header never carries the credit. */
export function resolveHeader(format: DocFormat | undefined): PageBand {
   return format?.header ?? {}
}

/**
 * The footer band to render, DERIVED. The Documinter credit ALWAYS shows and is never stored; the only
 * user control in the footer is an optional page number (the first `pageNumber` item found in
 * `format.footer`). The credit auto-places to avoid it: bottom-right normally, bottom-left when the page
 * number sits right. Any stray non-page-number footer item is ignored.
 */
export function resolveFooterBand(format: DocFormat | undefined): PageBand {
   const stored = format?.footer ?? {}
   let pageNumberPosition: BandPosition | undefined
   let pageNumberItem: BandItem | undefined
   for (const position of ['left', 'center', 'right'] as const) {
      const item = stored[position]
      if (item && item.kind === 'pageNumber') { pageNumberPosition = position; pageNumberItem = item; break }
   }
   const creditPosition: BandPosition = pageNumberPosition === 'right' ? 'left' : 'right'
   const band: PageBand = {}
   if (pageNumberItem && pageNumberPosition) band[pageNumberPosition] = pageNumberItem
   band[creditPosition] = { kind: 'credit' }
   return band
}

// ############
// # RESOLVERS #
// ############

/** Resolve an InfiniteWidth to a px max-width (narrow 640 / normal 860 / wide 1080 / custom N,
 *  clamped). Absent resolves to 'normal', the exact 860px sheet. */
export function resolveInfiniteWidthPx(width: InfiniteWidth | undefined): number {
   if (width === undefined || width === 'normal') return INFINITE_WIDTH_NORMAL_PX
   if (width === 'narrow') return INFINITE_WIDTH_NARROW_PX
   if (width === 'wide')   return INFINITE_WIDTH_WIDE_PX
   return clampCustomWidthPx(width.custom)
}

/**
 * Resolve the document sheet's max-width in px from a (possibly absent) DocFormat, the single call
 * both the editor sheet (WysiwygArea) and the export `.doc-card` (export.ts) use. Only the infinite
 * kind's width setting matters here: a paged kind (a4-portrait/a4-landscape) resolves to the same
 * normal width, since the paged renderer sizes its own A4 sheet independently (see pageModel.ts).
 * Absent format, or `{ kind: 'infinite' }` with no width, or `{ kind: 'infinite', width: 'normal' }`
 * all resolve to the same 860px.
 */
export function resolveDocumentSheetWidthPx(format: DocFormat | undefined): number {
   if (!format || format.kind === 'infinite') return resolveInfiniteWidthPx(format?.width)
   return INFINITE_WIDTH_NORMAL_PX
}

/** Picks the margin-editing mode that best fits a set of four margin values, so the Page setup
 *  window opens on the simplest view that still reproduces them exactly: all four equal collapses to
 *  a single input, a matching top/bottom and left/right pair (that aren't all four equal) collapses
 *  to the vertical/horizontal pair, anything else needs the four independent inputs. */
export function deriveMarginMode(margins: PageMargins): MarginMode {
   const allEqual = margins.top === margins.right && margins.top === margins.bottom && margins.top === margins.left
   if (allEqual) return 'allEqual'
   const axisPaired = margins.top === margins.bottom && margins.left === margins.right
   if (axisPaired) return 'verticalHorizontal'
   return 'eachSide'
}

/**
 * format.ts, Document-level page format (infinite canvas vs. a future paged A4) + infinite width.
 *
 * Pure types, defaults, and normalization for the document `format` field. Rides the SAME seams as
 * `docTheme` / `docAccent` / `presentation` (see lib/presentation.ts): OpenDocument, the binder's
 * DocPresentation / LoadedDocument / BinderDocumentContent, and the JSON backup. NEVER inside
 * DocState, and NEVER serialized to `.mint` / `.md` (format is structural chrome, like presentation,
 * see docs/reference/document_formats_study.md).
 *
 * PHASE 1 scope: the `format` model + the infinite-canvas width. `kind` is carried in full (so later
 * phases slot in without a shape change) but only 'infinite' actually renders differently this phase;
 * an 'a4-portrait' / 'a4-landscape' document falls back to today's normal-width sheet until the paged
 * renderer (Phase 2) exists. `margins` and `pages` are carried on the type for forward-compatibility
 * but have no consumer yet.
 *
 * No React, no DOM: pure and unit-testable, mirroring presentation.ts.
 */

// #########
// # TYPES #
// #########

/** Infinite-canvas content width. `normal` reproduces today's 860px sheet exactly. */
export type InfiniteWidth =
   | 'narrow'          // ~640px  , prose-focused
   | 'normal'          // ~860px  , TODAY'S width (byte-identical default)
   | 'wide'            // ~1080px , wide tables / graphs
   | { custom: number } // explicit max-width in px, clamped to a sane window

export type PageKind = 'infinite' | 'a4-portrait' | 'a4-landscape'

/** Page margins in millimetres (the print-native unit; drives both editor padding and @page). Not
 *  consumed yet, Phase 2+ (paged rendering / export) reads this. */
export interface PageMargins { top: number; right: number; bottom: number; left: number }

/**
 * A page is defined by WHERE it starts in the flat block flow (a break marker), plus its own id +
 * optional per-page overrides. Not consumed yet, Phase 2 (`partitionIntoPages`) reads this; the type
 * is carried now so a later phase's stored data isn't dropped by this phase's normalization.
 */
export interface PageBreak {
   id: string                 // crypto.randomUUID(), stable across reorders, the sorter's key
   /** The cut point: content from this anchor onward belongs to the NEXT page. */
   before: { sectionId: string; blockId: string }
   /** Optional per-page landscape/portrait override for a mixed-orientation doc. */
   orientationOverride?: 'a4-portrait' | 'a4-landscape'
}

export interface DocFormat {
   kind: PageKind
   /** infinite only; ignored for a4-*. Absent ⇒ 'normal'. */
   width?: InfiniteWidth
   /** a4-* only; ignored for infinite. Absent ⇒ DEFAULT_A4_MARGINS. Not consumed yet. */
   margins?: PageMargins
   /** paged only: the ordered discrete pages (break-marker model). Not consumed yet. */
   pages?: PageBreak[]
}

// #############
// # CONSTANTS #
// #############

export const DEFAULT_FORMAT: DocFormat = { kind: 'infinite' }   // existing docs read as this
export const DEFAULT_A4_MARGINS: PageMargins = { top: 20, right: 20, bottom: 20, left: 20 }

// Infinite-width presets, in px. NORMAL reproduces the editor sheet's + export .doc-card's exact
// pre-feature width (WysiwygArea/index.tsx's `max-w-215` Tailwind class = 53.75rem = 860px at the
// default 16px root, and export.ts's `.doc-card { max-width: 860px }`), the byte-identical default.
export const INFINITE_WIDTH_NARROW_PX = 640
export const INFINITE_WIDTH_NORMAL_PX = 860
export const INFINITE_WIDTH_WIDE_PX   = 1080

// A custom width is clamped to a sane window: narrow enough to stay a legible document, wide enough
// to cover an ultra-wide monitor without ballooning without bound.
export const INFINITE_WIDTH_CUSTOM_MIN_PX = 480
export const INFINITE_WIDTH_CUSTOM_MAX_PX = 1600

const PAGE_KINDS: ReadonlySet<PageKind> = new Set(['infinite', 'a4-portrait', 'a4-landscape'])
const INFINITE_WIDTH_KEYWORDS: ReadonlySet<string> = new Set(['narrow', 'normal', 'wide'])

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

/** A single stored PageBreak, permissively normalized (no consumer yet, Phase 2 owns validating the
 *  anchor against live content); malformed entries (missing id/before) are dropped defensively. */
function normalizePageBreak(raw: unknown): PageBreak | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const id = typeof source.id === 'string' ? source.id : ''
   if (id.trim() === '') return undefined
   const rawBefore = source.before
   if (!rawBefore || typeof rawBefore !== 'object') return undefined
   const before = rawBefore as Record<string, unknown>
   const sectionId = typeof before.sectionId === 'string' ? before.sectionId : ''
   const blockId    = typeof before.blockId   === 'string' ? before.blockId   : ''
   if (sectionId.trim() === '' || blockId.trim() === '') return undefined
   const result: PageBreak = { id, before: { sectionId, blockId } }
   if (source.orientationOverride === 'a4-portrait' || source.orientationOverride === 'a4-landscape') {
      result.orientationOverride = source.orientationOverride
   }
   return result
}

// ################
// # NORMALIZATION #
// ################

/**
 * Absent-tolerant normalizer (mirrors normalizePresentation): any partial/legacy/malformed value
 * becomes a valid DocFormat, defaulting kind → 'infinite'. Unlike normalizePresentation, this NEVER
 * returns undefined, absent format IS a well-formed DocFormat (`DEFAULT_FORMAT`), not "no format".
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

   const result: DocFormat = { kind }
   if (width !== undefined) result.width = width
   if (margins !== undefined) result.margins = margins
   if (pages !== undefined && pages.length > 0) result.pages = pages
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
}

// ############
// # RESOLVERS #
// ############

/** Resolve an InfiniteWidth to a px max-width (narrow 640 / normal 860 / wide 1080 / custom N,
 *  clamped). Absent ⇒ 'normal' ⇒ today's exact 860px sheet. */
export function resolveInfiniteWidthPx(width: InfiniteWidth | undefined): number {
   if (width === undefined || width === 'normal') return INFINITE_WIDTH_NORMAL_PX
   if (width === 'narrow') return INFINITE_WIDTH_NARROW_PX
   if (width === 'wide')   return INFINITE_WIDTH_WIDE_PX
   return clampCustomWidthPx(width.custom)
}

/**
 * Resolve the document sheet's max-width in px from a (possibly absent) DocFormat, the single call
 * both the editor sheet (WysiwygArea) and the export `.doc-card` (export.ts) use. Only the infinite
 * kind's width setting matters THIS PHASE: a paged kind (a4-portrait/a4-landscape) isn't rendered yet
 * (Phase 2+), so it falls back to today's normal width rather than exposing a half-built A4 sheet
 * size. Absent format, or `{ kind: 'infinite' }` with no width, or `{ kind: 'infinite', width:
 * 'normal' }` all resolve to the SAME 860px, the byte-identical guarantee.
 */
export function resolveDocumentSheetWidthPx(format: DocFormat | undefined): number {
   if (!format || format.kind === 'infinite') return resolveInfiniteWidthPx(format?.width)
   return INFINITE_WIDTH_NORMAL_PX
}

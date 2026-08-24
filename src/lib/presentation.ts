/**
 * Document-level presentation extras (export + editor only).
 *
 * Pure types, defaults, and normalization for the presentation features that render IN the editor
 * and bake into the self-contained HTML export, but are intentionally NOT serialized to
 * Markdown (that carries portable content, not presentation). This object rides ALONGSIDE the flat
 * docTheme / docAccent presentation fields (never inside DocState), same category, same seams.
 *
 * The background watermark, the header logo, and the nav model each slot into
 * DocPresentationExtras as a sibling optional field, and normalizePresentation grows a branch per
 * field, so no consumer needs to change for a field to stay absent-tolerant.
 *
 * No React, no DOM: the canvas image encode lives in imageDownscale.ts; everything here is pure so
 * it is unit-testable and reusable by both the editor render and the export pipeline.
 */

import type { Block, Section } from '../types'

// ############
// # WATERMARK #
// ############

/** How a single (non-tiled) watermark image is sized within the page. Ignored when tile = true. */
export type WatermarkFit = 'cover' | 'contain' | 'natural'

/** Where a single (non-tiled) watermark image is anchored. Ignored when tile = true. */
export type WatermarkPosition =
   | 'center' | 'top' | 'bottom'
   | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** Background watermark image, rendered behind the document content (editor + export). */
export interface Watermark {
   src:         string             // base64 data: URL (inlined into every export, no external fetch)
   opacity:     number             // clamped to [WATERMARK_MIN_OPACITY, WATERMARK_MAX_OPACITY]
   fit:         WatermarkFit       // single-image sizing fallback; ignored when tile = true OR size is set
   tile:        boolean            // repeat across the page vs one placed image
   position:    WatermarkPosition  // single-image anchor; ignored when tile = true
   rotation:    number             // degrees, clamped to [WATERMARK_MIN_ROTATION, WATERMARK_MAX_ROTATION]; applies to single AND tiled
   tileSize:    number             // rendered width (px, SVG userSpace) of one tile motif; tiled only
   spacingX:    number             // horizontal gap (px) between tile repeats; tiled only; 0 = edge-to-edge
   spacingY:    number             // vertical gap (px) between tile repeats; tiled only; 0 = edge-to-edge
   aspectRatio: number             // the source image's natural width / height, so tile height derives from tileSize
   offsetX:     number             // fine horizontal position nudge (px), may be negative; applies to single AND tiled
   offsetY:     number             // fine vertical position nudge (px), may be negative; applies to single AND tiled
   size?:       number             // percentage of the page width for a SINGLE watermark, clamped to [WATERMARK_MIN_SIZE, WATERMARK_MAX_SIZE]; ignored when tile = true; absent -> falls back to `fit`
}

// ##########
// # HEADER #
// ##########

/** Where the header logo sits relative to the document title. */
export type HeaderPlacement = 'above' | 'beside'

/** Horizontal alignment of the header logo (and, for 'beside', the logo+title group). */
export type HeaderAlign = 'left' | 'center' | 'right'

/**
 * For `placement:'beside'` only: which end of the row the logo pins to, with the title at the other
 * end. 'left' (the default) preserves the original behavior, logo and title ride together as one
 * group, positioned as a unit by `align`. 'right' pins the logo to the row's trailing edge and the
 * title to its leading edge (a space-between row), so `align` no longer applies, see
 * resolveHeaderBesideLayout. Ignored for `placement:'above'`.
 */
export type HeaderLogoSide = 'left' | 'right'

/** Header logo image, placed in the document header near the title (editor + export). */
export interface Header {
   src:       string             // base64 data: URL (inlined into every export, no external fetch)
   placement: HeaderPlacement     // above the title (own line) or beside it (inline row)
   align:     HeaderAlign         // horizontal placement within the header; 'beside' + logoSide:'right' ignores this
   maxHeight: number              // px cap on the rendered logo height, clamped to a sane window
   logoSide:  HeaderLogoSide      // 'beside' only: which end the logo pins to (see HeaderLogoSide)
}

// #######
// # NAV #
// #######

/**
 * Where a custom nav entry points: an in-document section anchor, a specific anchored block (any
 * block carrying a `handle`), or an external URL.
 */
export type NavTarget =
   | { type: 'section'; sectionId: string }
   | { type: 'anchor';  handle: string }
   | { type: 'url';     href: string }

/**
 * An entry that mirrors a document section. `label` absent -> the live section title is shown (so
 * renaming the section updates the nav for free); `label` present -> a nav-only rename override.
 * `hidden: true` drops it from the exported sidebar while the section itself still renders in the body.
 */
export interface NavAutoEntry {
   kind:      'auto'
   sectionId: string
   label?:    string
   hidden?:   boolean
}

/** A user-authored nav link, pointing at either a section or an external URL. */
export interface NavCustomEntry {
   kind:   'custom'
   id:     string
   label:  string
   target: NavTarget
}

/** A non-link visual separator in the nav, with an optional caption. */
export interface NavDivider {
   kind:   'divider'
   id:     string
   label?: string
}

export type NavEntry = NavAutoEntry | NavCustomEntry | NavDivider

/** The sidebar-nav model. Absent -> today's pure section derivation (see reconcileNav below). */
export interface NavModel {
   entries: NavEntry[]
}

/**
 * The presentation extras that ride alongside docTheme / docAccent. Every field is optional; an
 * absent field means today's behavior.
 */
export interface DocPresentationExtras {
   watermark?: Watermark
   header?:    Header
   nav?:       NavModel
}

// #############
// # CONSTANTS #
// #############

// Opacity is clamped for legibility: a full-bleed watermark must never overpower the text in
// either document theme. The default is deliberately faint.
export const WATERMARK_MIN_OPACITY = 0.02
export const WATERMARK_MAX_OPACITY = 0.3
export const WATERMARK_DEFAULT_OPACITY = 0.08

// In the dark document theme the watermark is dimmed a touch further (on top of the clamp) so light
// text over a light-ish watermark stays readable, the "subtle auto-dim" legibility guard.
export const WATERMARK_DARK_DIM_FACTOR = 0.8

export const DEFAULT_WATERMARK_FIT: WatermarkFit = 'contain'
export const DEFAULT_WATERMARK_POSITION: WatermarkPosition = 'center'

const WATERMARK_FITS: ReadonlySet<WatermarkFit> = new Set(['cover', 'contain', 'natural'])
const WATERMARK_POSITIONS: ReadonlySet<WatermarkPosition> = new Set([
   'center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
])

// Rotation applies to both the single and tiled watermark. A full turn either way is never useful
// (180deg already mirrors every meaningful orientation), so the range is a plain, non-cyclic clamp,
// consistent with clampWatermarkOpacity, rather than wrap-around, which would silently flip the sign
// of an out-of-range stored value.
export const WATERMARK_MIN_ROTATION = -180
export const WATERMARK_MAX_ROTATION = 180
export const WATERMARK_DEFAULT_ROTATION = 0

// Tile motif size: the rendered width (SVG userSpace px) of one image instance in the repeating
// pattern. Height derives from this and the stored aspectRatio, so the picked image never distorts.
// The ceiling is bounded well under the image downscale cap (imageDownscale.ts DEFAULT_MAX_EDGE,
// 2048px) so a large single-motif tile still renders from real source pixels instead of upscaling.
export const WATERMARK_MIN_TILE_SIZE = 24
export const WATERMARK_MAX_TILE_SIZE = 1200
export const WATERMARK_DEFAULT_TILE_SIZE = 160

// Spacing: the gap (SVG userSpace px) between tile repeats, per axis. 0 = edge-to-edge (no gap).
export const WATERMARK_MIN_SPACING = 0
export const WATERMARK_MAX_SPACING = 400
export const WATERMARK_DEFAULT_SPACING = 40

// Single-image size: a percentage of the page width, the SINGLE (non-tiled) watermark's own explicit
// sizing knob, mirroring the tiled case's tileSize. Height is left to `auto` so the image's own aspect
// ratio is preserved (no separate height field needed, unlike the tiled pattern's derived height).
export const WATERMARK_MIN_SIZE = 5
export const WATERMARK_MAX_SIZE = 100
export const WATERMARK_DEFAULT_SIZE = 50

// The source image's natural aspect ratio (width / height), captured at pick time so a rectangular
// logo never gets squashed into a square tile. Bounded to a sane window against corrupt data.
export const WATERMARK_MIN_ASPECT_RATIO = 0.05
export const WATERMARK_MAX_ASPECT_RATIO = 20
export const WATERMARK_DEFAULT_ASPECT_RATIO = 1

// Position offset: a fine X/Y nudge (px) on top of the position anchor (single) / pattern phase
// (tiled), composed with rotation rather than replacing it. May be negative (nudge left/up). Bounded
// to a generous but sane window against corrupt/malicious data, well past any plausible page size.
export const WATERMARK_MIN_OFFSET = -1000
export const WATERMARK_MAX_OFFSET = 1000
export const WATERMARK_DEFAULT_OFFSET = 0

// Header logo max-height: a px cap on the rendered logo, clamped to stay a "logo", not a banner
// that overwhelms the title it sits beside/above.
export const HEADER_MIN_MAX_HEIGHT = 24
export const HEADER_MAX_MAX_HEIGHT = 240
export const HEADER_DEFAULT_MAX_HEIGHT = 64

export const DEFAULT_HEADER_PLACEMENT: HeaderPlacement = 'above'
export const DEFAULT_HEADER_ALIGN: HeaderAlign = 'left'
export const DEFAULT_HEADER_LOGO_SIDE: HeaderLogoSide = 'left'

// A logo doesn't need the watermark's full 2048px longest-edge cap, it renders at most at
// HEADER_MAX_MAX_HEIGHT tall. Passed as the maxEdge to the shared downscaleImageToDataUrl.
export const HEADER_LOGO_MAX_EDGE = 1024

const HEADER_PLACEMENTS: ReadonlySet<HeaderPlacement> = new Set(['above', 'beside'])
const HEADER_ALIGNS: ReadonlySet<HeaderAlign> = new Set(['left', 'center', 'right'])
const HEADER_LOGO_SIDES: ReadonlySet<HeaderLogoSide> = new Set(['left', 'right'])

// ###########
// # HELPERS #
// ###########

/** Clamp a raw opacity to the legibility window, falling back to the default for a non-number. */
export function clampWatermarkOpacity(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_OPACITY
   return Math.min(WATERMARK_MAX_OPACITY, Math.max(WATERMARK_MIN_OPACITY, value))
}

/** Clamp a raw rotation (degrees) into range, falling back to the default (0) for a non-number. */
export function clampWatermarkRotation(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_ROTATION
   return Math.min(WATERMARK_MAX_ROTATION, Math.max(WATERMARK_MIN_ROTATION, value))
}

/** Clamp a raw tile size (px) into range, falling back to the default for a non-number. */
export function clampWatermarkTileSize(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_TILE_SIZE
   return Math.min(WATERMARK_MAX_TILE_SIZE, Math.max(WATERMARK_MIN_TILE_SIZE, value))
}

/** Clamp a raw per-axis spacing (px) into range, falling back to the default for a non-number. */
export function clampWatermarkSpacing(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_SPACING
   return Math.min(WATERMARK_MAX_SPACING, Math.max(WATERMARK_MIN_SPACING, value))
}

/** Clamp a raw single-watermark size (percentage of the page width) into range, falling back to the default for a non-number. */
export function clampWatermarkSize(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_SIZE
   return Math.min(WATERMARK_MAX_SIZE, Math.max(WATERMARK_MIN_SIZE, value))
}

/** Clamp a raw aspect ratio (width / height) into range, falling back to the default (square) for a non-number. */
export function clampWatermarkAspectRatio(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_ASPECT_RATIO
   return Math.min(WATERMARK_MAX_ASPECT_RATIO, Math.max(WATERMARK_MIN_ASPECT_RATIO, value))
}

/** Clamp a raw position offset (px) into range, falling back to the default (0) for a non-number. */
export function clampWatermarkOffset(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return WATERMARK_DEFAULT_OFFSET
   return Math.min(WATERMARK_MAX_OFFSET, Math.max(WATERMARK_MIN_OFFSET, value))
}

/** Clamp a raw header logo max-height (px) into range, falling back to the default for a non-number. */
export function clampHeaderMaxHeight(value: unknown): number {
   if (typeof value !== 'number' || Number.isNaN(value)) return HEADER_DEFAULT_MAX_HEIGHT
   return Math.min(HEADER_MAX_MAX_HEIGHT, Math.max(HEADER_MIN_MAX_HEIGHT, value))
}

/**
 * Map a HeaderAlign to a CSS justify-content value. Shared by the editor's inline style and the
 * export's CSS string so the two surfaces position the logo (and, for 'beside', the logo+title
 * group) identically.
 */
export function headerJustifyContent(align: HeaderAlign): string {
   switch (align) {
      case 'center': return 'center'
      case 'right':  return 'flex-end'
      case 'left':
      default:       return 'flex-start'
   }
}

/** The concrete row layout `placement:'beside'` renders from, see resolveHeaderBesideLayout. */
export interface HeaderBesideLayout {
   justifyContent: string    // CSS justify-content for the row
   logoFirst:      boolean   // DOM order: logo-then-title (true) or title-then-logo (false)
}

/**
 * Resolve a 'beside' header's row layout from `logoSide` (+ `align` when logoSide is 'left'). Shared
 * by the editor render and the export's renderPageTitle so both surfaces lay out identically.
 *
 *   - logoSide 'left' (default): today's behavior, UNCHANGED, logo and title ride together as one
 *     group (logo first in the DOM), the group positioned by `align` via justify-content.
 *   - logoSide 'right': the logo pins to the row's trailing edge and the title to its leading edge,
 *     a space-between row, so `align` does not apply (there is no single "group" to align).
 */
export function resolveHeaderBesideLayout(header: Header): HeaderBesideLayout {
   if (header.logoSide === 'right') {
      return { justifyContent: 'space-between', logoFirst: false }
   }
   return { justifyContent: headerJustifyContent(header.align), logoFirst: true }
}

/**
 * The effective opacity a watermark renders at in a given document theme: the clamped value in
 * light, dimmed by WATERMARK_DARK_DIM_FACTOR in dark. Shared by the editor render and the export
 * pipeline so both surfaces dim identically.
 */
export function effectiveWatermarkOpacity(opacity: number, theme: 'light' | 'dark'): number {
   const clamped = clampWatermarkOpacity(opacity)
   const dimmed = theme === 'dark' ? clamped * WATERMARK_DARK_DIM_FACTOR : clamped
   // Round to 3 decimals so the dark-dim multiply (e.g. 0.1 * 0.8 = 0.08000...2) serializes cleanly
   // into the export's inline `opacity:` and the editor's style, never as a float-noise tail.
   return Math.round(dimmed * 1000) / 1000
}

/** The CSS background-* triple a watermark maps to. Shared by the editor and export renders. */
export interface WatermarkLayout {
   repeat:   string
   size:     string
   position: string
}

/**
 * Resolve a watermark's size / fit / tile / position to concrete CSS background-* values (pure).
 * The SINGLE (non-tiled) case prefers an explicit `size` (percentage of the page width, height
 * `auto` so the image's own aspect ratio is preserved) when present; when `size` is absent it falls
 * back to the EXISTING fit-based sizing exactly as before, so a stored document with no `size` keeps
 * rendering unchanged.
 */
export function resolveWatermarkLayout(watermark: Watermark): WatermarkLayout {
   const repeat = watermark.tile ? 'repeat' : 'no-repeat'
   const size = watermark.tile
      ? 'auto'
      : typeof watermark.size === 'number'
         ? `${clampWatermarkSize(watermark.size)}% auto`
         : watermark.fit === 'cover'
            ? 'cover'
            : watermark.fit === 'contain'
               ? 'contain'
               : 'auto'   // 'natural'
   return { repeat, size, position: cssBackgroundPosition(watermark.position) }
}

/**
 * The CSS `transform` value for a SINGLE (non-tiled) watermark: the X/Y position offset composed
 * with rotation. `translate()` is listed first so the offset moves the box in screen space, then
 * `rotate()` spins it around its own (now-shifted) center, "nudge, then spin in place", so rotation
 * keeps its original meaning regardless of the offset. When both offsets are 0 (the default) this
 * degrades to the bare `rotate(...)` string, byte-identical to the pre-offset output. Shared by the
 * editor render (WysiwygArea) and export.ts's renderWatermarkLayer so both surfaces compose identically.
 */
export function watermarkTransform(watermark: Watermark): string {
   const offsetX  = clampWatermarkOffset(watermark.offsetX)
   const offsetY  = clampWatermarkOffset(watermark.offsetY)
   const rotation = clampWatermarkRotation(watermark.rotation)
   if (offsetX === 0 && offsetY === 0) return `rotate(${rotation}deg)`
   return `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`
}

/** Map a WatermarkPosition to a CSS background-position value. */
function cssBackgroundPosition(position: WatermarkPosition): string {
   switch (position) {
      case 'top':          return 'center top'
      case 'bottom':       return 'center bottom'
      case 'top-left':     return 'left top'
      case 'top-right':    return 'right top'
      case 'bottom-left':  return 'left bottom'
      case 'bottom-right': return 'right bottom'
      case 'center':
      default:             return 'center center'
   }
}

// ###################
// # PATTERN GEOMETRY #
// ###################

/** Round to 2 decimals so SVG attributes never carry float noise (e.g. 39.999999999999996). */
function round2(value: number): number {
   return Math.round(value * 100) / 100
}

/** The concrete numbers a tiled watermark's SVG `<pattern>` renders from (SVG userSpace px). */
export interface WatermarkPatternGeometry {
   imageWidth:  number   // the tile motif's rendered width, from tileSize
   imageHeight: number   // derived from imageWidth / aspectRatio, so the image is never squashed
   cellWidth:   number   // imageWidth + spacingX, the pattern tile's repeat width
   cellHeight:  number   // imageHeight + spacingY, the pattern tile's repeat height
   imageX:      number   // spacingX / 2, centers the image in its cell so the gap is even
   imageY:      number   // spacingY / 2
   rotation:    number   // clamped rotation, degrees
   offsetX:     number   // clamped X phase shift (px) of the pattern origin; 0 = no shift
   offsetY:     number   // clamped Y phase shift (px) of the pattern origin; 0 = no shift
}

/**
 * Resolve a watermark's tileSize / spacingX / spacingY / aspectRatio / rotation into the concrete
 * geometry an SVG `<pattern>` needs. Pure, shared by the editor render and the export pipeline (via
 * renderWatermarkPatternSvg below) so both surfaces compute the exact same numbers.
 */
export function resolveWatermarkPatternGeometry(watermark: Watermark): WatermarkPatternGeometry {
   const imageWidth  = clampWatermarkTileSize(watermark.tileSize)
   const aspectRatio = clampWatermarkAspectRatio(watermark.aspectRatio)
   const imageHeight = round2(imageWidth / aspectRatio)
   const spacingX     = clampWatermarkSpacing(watermark.spacingX)
   const spacingY     = clampWatermarkSpacing(watermark.spacingY)
   return {
      imageWidth,
      imageHeight,
      cellWidth:  round2(imageWidth + spacingX),
      cellHeight: round2(imageHeight + spacingY),
      imageX:     round2(spacingX / 2),
      imageY:     round2(spacingY / 2),
      rotation:   clampWatermarkRotation(watermark.rotation),
      offsetX:    clampWatermarkOffset(watermark.offsetX),
      offsetY:    clampWatermarkOffset(watermark.offsetY),
   }
}

/**
 * The SVG `patternTransform` value for a tiled watermark: the X/Y position offset composed with
 * rotation, same "translate then rotate" order as watermarkTransform (single case), the offset
 * shifts the pattern's phase (where its origin sits), then rotation spins the whole tiled field
 * around that shifted origin. When both offsets are 0 this degrades to the bare `rotate(...)`
 * string, byte-identical to the pre-offset output.
 */
function watermarkPatternTransform(geometry: WatermarkPatternGeometry): string {
   if (geometry.offsetX === 0 && geometry.offsetY === 0) return `rotate(${geometry.rotation})`
   return `translate(${geometry.offsetX},${geometry.offsetY}) rotate(${geometry.rotation})`
}

/**
 * Render a tiled watermark as a self-contained inline `<svg class="doc-watermark">` whose `<defs>`
 * holds a `patternUnits="userSpaceOnUse"` pattern (rotated as a whole via `patternTransform`) tiling
 * a single `<image>`, painted onto a full-bleed `<rect>`. Both the editor (via dangerouslySetInnerHTML,
 * so it renders the IDENTICAL markup) and export.ts call this one function, so the two surfaces can
 * never drift apart. `patternId` must be unique per instance on the page (multiple watermarked
 * documents/exports must not collide on the same `<defs> id`).
 */
export function renderWatermarkPatternSvg(watermark: Watermark, theme: 'light' | 'dark', patternId: string): string {
   const geometry = resolveWatermarkPatternGeometry(watermark)
   const opacity  = effectiveWatermarkOpacity(watermark.opacity, theme)
   return (
      `<svg class="doc-watermark" aria-hidden="true" width="100%" height="100%" style="opacity:${opacity}">` +
      `<defs>` +
      `<pattern id="${patternId}" patternUnits="userSpaceOnUse" ` +
      `width="${geometry.cellWidth}" height="${geometry.cellHeight}" ` +
      `patternTransform="${watermarkPatternTransform(geometry)}">` +
      `<image href="${watermark.src}" width="${geometry.imageWidth}" height="${geometry.imageHeight}" ` +
      `x="${geometry.imageX}" y="${geometry.imageY}" preserveAspectRatio="xMidYMid meet"/>` +
      `</pattern>` +
      `</defs>` +
      `<rect width="100%" height="100%" fill="url(#${patternId})"/>` +
      `</svg>`
   )
}

/**
 * Set spacingX and spacingY to the same clamped value in one step, the pure helper behind the
 * Presentation window's linked "density" slider (spacingX === spacingY until the user opts into
 * per-axis control).
 */
export function applyLinkedWatermarkSpacing(watermark: Watermark, spacing: number): Watermark {
   const clamped = clampWatermarkSpacing(spacing)
   return { ...watermark, spacingX: clamped, spacingY: clamped }
}

// ####################
// # NAV RECONCILIATION #
// ####################

/**
 * The set of every live deep-link handle in the document, one per block (including container inner
 * blocks) that carries a `handle`. Mirrors the exact walk getAnchoredBlocks (hooks/useLinkMode.ts)
 * uses for the inline "jump to block" picker, so an anchor nav target resolves against the same
 * universe of anchors. Pure, shared by reconcileNav (drop dead anchor targets) and the export
 * scroll-spy (observe the referenced anchor elements).
 */
export function collectAnchoredHandles(sections: Section[]): Set<string> {
   const handles = new Set<string>()
   for (const section of sections) {
      for (const block of section.blocks) {
         if (block.handle) handles.add(block.handle)
         for (const inner of collectInnerBlocks(block)) {
            if (inner.handle) handles.add(inner.handle)
         }
      }
   }
   return handles
}

/** A block's container inner blocks (left + right columns), flattened; empty for non-containers. */
function collectInnerBlocks(block: Block): Block[] {
   return [...(block.left ?? []), ...(block.right ?? [])]
}

/**
 * Reconcile a stored nav model against the live section list into a clean NavEntry[], the linchpin
 * run at BOTH edit and export. Pure and deterministic:
 *
 *   - `auto` entries whose section no longer exists are DROPPED (deleted section).
 *   - `custom` / `divider` entries PASS THROUGH untouched, in their stored order.
 *   - any section not yet referenced by an `auto` entry is APPENDED as a fresh `auto` at the tail,
 *     in section order, so newly added sections auto-appear without the user re-editing the nav.
 *
 * When `nav` is undefined (or has no entries), the result is one unhidden `auto` per section in
 * section order, exactly today's `sections.map(...)` derivation. The editor seeds and edits from
 * THIS list (so a first touch starts from today's derived nav, then customizes).
 */
export function reconcileNavEntries(nav: NavModel | undefined, sections: Section[]): NavEntry[] {
   const sectionIds = sections.map(section => section.id)
   const sectionIdSet = new Set(sectionIds)
   const stored = nav?.entries ?? []
   const result: NavEntry[] = []
   const referencedSectionIds = new Set<string>()

   for (const entry of stored) {
      if (entry.kind === 'auto') {
         if (!sectionIdSet.has(entry.sectionId)) continue         // section deleted -> drop
         if (referencedSectionIds.has(entry.sectionId)) continue  // defensive de-dupe
         referencedSectionIds.add(entry.sectionId)
         result.push(entry)
      } else {
         result.push(entry)   // custom / divider pass through untouched
      }
   }

   // Append any section not yet mirrored by an auto entry, in section order, at the tail.
   for (const sectionId of sectionIds) {
      if (referencedSectionIds.has(sectionId)) continue
      referencedSectionIds.add(sectionId)
      result.push({ kind: 'auto', sectionId })
   }

   return result
}

/**
 * A nav entry resolved to its concrete render form, what both the export pipeline and any render
 * surface consume. A `link` carries its final label + href + whether it points offsite (external ->
 * open in a new tab, not scroll-spy observed) + an optional 1-based positional `number` (see the
 * numbering rule in reconcileNav). A `divider` carries only its optional caption.
 */
export type ResolvedNavEntry =
   | { kind: 'link'; id: string; label: string; href: string; external: boolean; number?: number }
   | { kind: 'divider'; id: string; label: string }

/**
 * Reconcile AND resolve a nav model for rendering / export: runs reconcileNavEntries, then maps each
 * surviving entry to its concrete ResolvedNavEntry. Hidden `auto` entries are omitted; a broken link
 * target (custom -> a deleted section, or an empty external URL) is dropped from the rendered nav (the
 * raw reconcileNavEntries still keeps it so the editor can show + fix it).
 *
 * Numbering: section-target links (unhidden `auto` + `custom` -> section) are numbered 1..N in nav
 * order; anchor links (custom -> block handle), external links, and dividers are NOT numbered and do
 * not consume a number, an anchor link is a sub-reference into a section, sibling to an external
 * link, so it stays unnumbered. When `nav` is absent this yields all sections numbered 1..N in
 * order, byte-identical to today's derivation.
 *
 * An anchor target whose `handle` no longer exists among the document's anchored blocks is DROPPED
 * (mirrors a custom section link pointing at a deleted section), so a stale anchor never emits a
 * dead `#handle` link into the export.
 */
export function reconcileNav(nav: NavModel | undefined, sections: Section[]): ResolvedNavEntry[] {
   const entries = reconcileNavEntries(nav, sections)
   const titleBySectionId = new Map(sections.map(section => [section.id, section.title]))
   const anchoredHandles = collectAnchoredHandles(sections)
   const resolved: ResolvedNavEntry[] = []
   let sectionLinkNumber = 0

   for (const entry of entries) {
      if (entry.kind === 'divider') {
         resolved.push({ kind: 'divider', id: entry.id, label: entry.label ?? '' })
         continue
      }
      if (entry.kind === 'auto') {
         if (entry.hidden) continue
         const title = titleBySectionId.get(entry.sectionId)
         if (title === undefined) continue   // defensive; reconcileNavEntries already drops dead autos
         sectionLinkNumber += 1
         resolved.push({
            kind:     'link',
            id:       `auto-${entry.sectionId}`,
            label:    entry.label ?? title,
            href:     `#section-${entry.sectionId}`,
            external: false,
            number:   sectionLinkNumber,
         })
         continue
      }
      // custom
      if (entry.target.type === 'url') {
         if (entry.target.href.trim() === '') continue   // half-filled external adder -> don't emit a broken link
         resolved.push({ kind: 'link', id: entry.id, label: entry.label, href: entry.target.href, external: true })
      } else if (entry.target.type === 'anchor') {
         if (!anchoredHandles.has(entry.target.handle)) continue   // points at a dropped anchor -> drop
         // An anchor is an internal smooth-scroll link (external:false) but UNNUMBERED, a
         // sub-reference into a section, sibling to an external link, so it consumes no number.
         resolved.push({
            kind:     'link',
            id:       entry.id,
            label:    entry.label,
            href:     `#${entry.target.handle}`,
            external: false,
         })
      } else {
         if (!titleBySectionId.has(entry.target.sectionId)) continue   // points at a deleted section -> drop
         sectionLinkNumber += 1
         resolved.push({
            kind:     'link',
            id:       entry.id,
            label:    entry.label,
            href:     `#section-${entry.target.sectionId}`,
            external: false,
            number:   sectionLinkNumber,
         })
      }
   }

   return resolved
}

// ################
// # NORMALIZATION #
// ################

/** Defensive read-time normalization of a stored watermark, or undefined when it is unusable. */
function normalizeWatermark(raw: unknown): Watermark | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const src = typeof source.src === 'string' ? source.src : ''
   if (src.trim() === '') return undefined   // an empty-src watermark is the same as none
   const fit = WATERMARK_FITS.has(source.fit as WatermarkFit)
      ? (source.fit as WatermarkFit)
      : DEFAULT_WATERMARK_FIT
   const position = WATERMARK_POSITIONS.has(source.position as WatermarkPosition)
      ? (source.position as WatermarkPosition)
      : DEFAULT_WATERMARK_POSITION
   const watermark: Watermark = {
      src,
      opacity:  clampWatermarkOpacity(source.opacity),
      fit,
      tile:     source.tile === true,
      position,
      rotation:    clampWatermarkRotation(source.rotation),
      tileSize:    clampWatermarkTileSize(source.tileSize),
      spacingX:    clampWatermarkSpacing(source.spacingX),
      spacingY:    clampWatermarkSpacing(source.spacingY),
      aspectRatio: clampWatermarkAspectRatio(source.aspectRatio),
      offsetX:     clampWatermarkOffset(source.offsetX),
      offsetY:     clampWatermarkOffset(source.offsetY),
   }
   // `size` stays ABSENT when not stored, an old watermark keeps its `fit` fallback rather than being
   // silently switched onto the size-based slider.
   if (typeof source.size === 'number') watermark.size = clampWatermarkSize(source.size)
   return watermark
}

/** Defensive read-time normalization of a stored header logo, or undefined when it is unusable. */
function normalizeHeader(raw: unknown): Header | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const src = typeof source.src === 'string' ? source.src : ''
   if (src.trim() === '') return undefined   // an empty-src header is the same as none
   const placement = HEADER_PLACEMENTS.has(source.placement as HeaderPlacement)
      ? (source.placement as HeaderPlacement)
      : DEFAULT_HEADER_PLACEMENT
   const align = HEADER_ALIGNS.has(source.align as HeaderAlign)
      ? (source.align as HeaderAlign)
      : DEFAULT_HEADER_ALIGN
   const logoSide = HEADER_LOGO_SIDES.has(source.logoSide as HeaderLogoSide)
      ? (source.logoSide as HeaderLogoSide)
      : DEFAULT_HEADER_LOGO_SIDE
   return {
      src,
      placement,
      align,
      maxHeight: clampHeaderMaxHeight(source.maxHeight),
      logoSide,
   }
}

/** Defensive read-time normalization of one stored nav entry, or undefined when it is unusable. */
function normalizeNavEntry(raw: unknown): NavEntry | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>

   if (source.kind === 'auto') {
      const sectionId = typeof source.sectionId === 'string' ? source.sectionId : ''
      if (sectionId.trim() === '') return undefined   // an auto entry without a section is meaningless
      const entry: NavAutoEntry = { kind: 'auto', sectionId }
      if (typeof source.label === 'string') entry.label = source.label
      if (source.hidden === true) entry.hidden = true
      return entry
   }

   if (source.kind === 'custom') {
      const id = typeof source.id === 'string' ? source.id : ''
      if (id.trim() === '') return undefined
      const label = typeof source.label === 'string' ? source.label : ''
      const rawTarget = source.target
      if (!rawTarget || typeof rawTarget !== 'object') return undefined
      const target = rawTarget as Record<string, unknown>
      if (target.type === 'section' && typeof target.sectionId === 'string' && target.sectionId.trim() !== '') {
         return { kind: 'custom', id, label, target: { type: 'section', sectionId: target.sectionId } }
      }
      if (target.type === 'anchor' && typeof target.handle === 'string' && target.handle.trim() !== '') {
         return { kind: 'custom', id, label, target: { type: 'anchor', handle: target.handle } }
      }
      if (target.type === 'url' && typeof target.href === 'string') {
         return { kind: 'custom', id, label, target: { type: 'url', href: target.href } }
      }
      return undefined
   }

   if (source.kind === 'divider') {
      const id = typeof source.id === 'string' ? source.id : ''
      if (id.trim() === '') return undefined
      const entry: NavDivider = { kind: 'divider', id }
      if (typeof source.label === 'string') entry.label = source.label
      return entry
   }

   return undefined
}

/**
 * Defensive read-time normalization of a stored nav model, or undefined when nothing usable remains.
 * A model with no valid entries collapses to undefined, an empty entries array reconciles to exactly
 * today's derivation, so it is equivalent to none and should never linger as a shell.
 */
function normalizeNav(raw: unknown): NavModel | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const rawEntries = Array.isArray(source.entries) ? source.entries : []
   const entries: NavEntry[] = []
   for (const item of rawEntries) {
      const normalized = normalizeNavEntry(item)
      if (normalized) entries.push(normalized)
   }
   if (entries.length === 0) return undefined
   return { entries }
}

/**
 * Normalize a stored / imported presentation-extras value into a clean DocPresentationExtras, or
 * undefined when nothing usable remains (so an empty object never lingers). Called on every read
 * boundary that reconstitutes a document (binder read, JSON backup import), mirroring how
 * migrateMeta normalizes the metadata on read. Absent / malformed input yields undefined, i.e.
 * today's behavior.
 */
export function normalizePresentation(raw: unknown): DocPresentationExtras | undefined {
   if (!raw || typeof raw !== 'object') return undefined
   const source = raw as Record<string, unknown>
   const watermark = normalizeWatermark(source.watermark)
   const header = normalizeHeader(source.header)
   const nav = normalizeNav(source.nav)
   if (!watermark && !header && !nav) return undefined
   const result: DocPresentationExtras = {}
   if (watermark) result.watermark = watermark
   if (header)    result.header    = header
   if (nav)       result.nav       = nav
   return result
}

/**
 * A fresh default watermark for a newly picked image. `aspectRatio` should be the picked image's
 * natural width / height (defaults to square when unknown) so a tiled rectangular logo isn't squashed.
 */
export function makeWatermark(src: string, aspectRatio: number = WATERMARK_DEFAULT_ASPECT_RATIO): Watermark {
   return {
      src,
      opacity:  WATERMARK_DEFAULT_OPACITY,
      fit:      DEFAULT_WATERMARK_FIT,
      tile:     false,
      position: DEFAULT_WATERMARK_POSITION,
      rotation:    WATERMARK_DEFAULT_ROTATION,
      tileSize:    WATERMARK_DEFAULT_TILE_SIZE,
      spacingX:    WATERMARK_DEFAULT_SPACING,
      spacingY:    WATERMARK_DEFAULT_SPACING,
      aspectRatio: clampWatermarkAspectRatio(aspectRatio),
      offsetX:     WATERMARK_DEFAULT_OFFSET,
      offsetY:     WATERMARK_DEFAULT_OFFSET,
      size:        WATERMARK_DEFAULT_SIZE,
   }
}

/** A fresh default header logo for a newly picked image. */
export function makeHeader(src: string): Header {
   return {
      src,
      placement: DEFAULT_HEADER_PLACEMENT,
      align:     DEFAULT_HEADER_ALIGN,
      maxHeight: HEADER_DEFAULT_MAX_HEIGHT,
      logoSide:  DEFAULT_HEADER_LOGO_SIDE,
   }
}

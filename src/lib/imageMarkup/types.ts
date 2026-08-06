/**
 * types.ts, the pure data model for the home-grown image-markup (annotation) block.
 *
 * PURE TYPES + a handful of frozen render defaults. Imports NOTHING (no React, no DOM). Mirrors
 * `lib/graph/types.ts`'s role for the graph block: `ImageMarkupSpec` is the block's nested source
 * of truth, consumed by the pure renderer (`lib/imageMarkup/index.ts`) to produce a self-contained
 * SVG string.
 *
 * Coordinate convention: every geometric field on a `MarkupElement` is NORMALIZED 0..1 relative
 * to the base image, so
 * annotations are resolution-independent and survive the base image being re-encoded at a
 * different pixel size. The renderer projects these fractions into a fixed VIEWBOX whose aspect
 * ratio matches the image (see {@link MARKUP_VIEWBOX_LONG_EDGE}); `strokeWidth`/`fontSize` are
 * stored directly in those VIEWBOX units (NOT normalized), so they scale with the displayed image
 * rather than with the screen.
 */

// #########
// # TYPES #
// #########

/** The seven overlay tool kinds. */
export type MarkupElementKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'callout' | 'freehand'

/** Contour line style for the stroke-bearing kinds; undefined -> {@link MARKUP_DEFAULT_STROKE_STYLE}. */
export type MarkupStrokeStyle = 'solid' | 'dashed' | 'dotted'

/** Arrowhead shape: `full` = the filled triangle (default), `chevron` = an open two-stroke V/barb. */
export type MarkupArrowhead = 'full' | 'chevron'

/** Where an arrow's head sits: `end` (the tip, default) or `middle` (the line's midpoint). */
export type MarkupArrowheadPosition = 'end' | 'middle'

/**
 * Fields every element shares. `id` is a stable per-element id (crypto.randomUUID), used only by
 * the editor for selection/reorder; it is NEVER serialized to the fence (element array order
 * carries z-order instead), so a fence round-trip mints a fresh id per element on reparse.
 */
interface MarkupBase {
   id:           string
   /** CSS hex stroke color; undefined = {@link MARKUP_DEFAULT_STROKE}. */
   stroke?:      string
   /** Stroke width in VIEWBOX units; undefined = {@link MARKUP_DEFAULT_STROKE_WIDTH}. */
   strokeWidth?: number
   /** CSS hex fill color; undefined = no fill (outline only). */
   fill?:        string
   /** Fill alpha 0..1; undefined = {@link MARKUP_DEFAULT_FILL_OPACITY} when `fill` is set, meaningless otherwise. */
   fillOpacity?: number
   /** Contour line style; undefined = {@link MARKUP_DEFAULT_STROKE_STYLE} (solid). Meaningful only on
    *  the stroke-bearing kinds (rect / ellipse / line / arrow / callout box / freehand). */
   strokeStyle?: MarkupStrokeStyle
}

export interface MarkupRect extends MarkupBase {
   kind: 'rect'
   x: number; y: number; w: number; h: number
   /** Corner radius, normalized (same 0..1 units as x/y/w/h); undefined = square corners. */
   radius?: number
}

/** Bounding-box geometry (NOT center/radii), matches rect's shape so the two tools share drag math. */
export interface MarkupEllipse extends MarkupBase {
   kind: 'ellipse'
   x: number; y: number; w: number; h: number
}

export interface MarkupLine extends MarkupBase {
   kind: 'line'
   x1: number; y1: number; x2: number; y2: number
}

/** Same geometry as {@link MarkupLine}; the renderer additionally draws an arrowhead at (x2, y2). */
export interface MarkupArrow extends MarkupBase {
   kind: 'arrow'
   x1: number; y1: number; x2: number; y2: number
   /** Arrowhead shape; undefined = {@link MARKUP_DEFAULT_ARROWHEAD} (the filled triangle). */
   arrowhead?: MarkupArrowhead
   /** Arrowhead placement; undefined = {@link MARKUP_DEFAULT_ARROWHEAD_POSITION} (the tip end). */
   arrowheadPosition?: MarkupArrowheadPosition
}

export interface MarkupText extends MarkupBase {
   kind: 'text'
   /** Anchor point: the text's left baseline start. */
   x: number; y: number
   text: string
   /** Font size in VIEWBOX units; undefined = {@link MARKUP_DEFAULT_FONT_SIZE}. */
   fontSize?:  number
   /** CSS hex text color; undefined = {@link MARKUP_DEFAULT_TEXT_COLOR}. */
   textColor?: string
   /** Optional label background CSS hex; undefined = no background (text floats over the image). */
   background?: string
}

export interface MarkupCallout extends MarkupBase {
   kind: 'callout'
   /** The callout box (bounding rect), same shape as rect/ellipse. */
   x: number; y: number; w: number; h: number
   /** The tail's pointed tip, wherever it is on the image (independent of the box's own bounds). */
   tipX: number; tipY: number
   text: string
   fontSize?:  number
   textColor?: string
}

/** Two or more points captured from a pointer drag (lightly RDP/distance-simplified at capture
 *  time, so the model already carries a lean point count, not raw hundreds). */
export interface MarkupFreehand extends MarkupBase {
   kind: 'freehand'
   points: { x: number; y: number }[]
}

/** A markup overlay element. A discriminated union on `kind`. */
export type MarkupElement =
   | MarkupRect | MarkupEllipse | MarkupLine | MarkupArrow
   | MarkupText | MarkupCallout | MarkupFreehand

/**
 * The base image plus its overlay stack, the block's whole payload.
 *
 * `src` is EMPTY on a `.mint`/`.md` reopen (no base64 is stored in text formats, see
 * `lib/imageMarkupFence.ts`). Full fidelity (base image pixels) lives only in the binder JSON and
 * the self-contained HTML export; the renderer tolerates an empty `src` gracefully (a neutral
 * placeholder ground, never a crash, see {@link renderImageMarkupToSvg} in `index.ts`).
 */
export interface ImageMarkupSpec {
   /** Base image as a `data:` URI, or '' until picked / after a text-format reopen. */
   src: string
   /** The base image's natural pixel dimensions at encode time, the SOURCE OF TRUTH for the
    *  render viewBox's aspect ratio. Kept even when `src` is empty, so a `.mint` reopen still
    *  reconstructs the correct aspect ratio for the overlay geometry. */
   width:  number
   height: number
   /** Ordered overlay stack; array order IS z-order (first = bottom, last = top). */
   elements: MarkupElement[]
   /** Optional accessible alt text / caption, reusing the image block's conventions. */
   alt?:     string
   caption?: string
}

// ####################
// # RENDER DEFAULTS  #
// ####################
// One source of truth for the renderer's fallbacks AND the fence serializer's "only emit a
// token when it differs from the default" lean-serialization rule, the same pattern
// `GRAPH_DEFAULT_*` follows in `lib/graph/types.ts`. An untouched element therefore round-trips
// through the fence without ever writing its style fields.

/** The long edge of the fixed render viewBox (the other edge follows the image aspect ratio). */
export const MARKUP_VIEWBOX_LONG_EDGE = 1000

/** Decimal places normalized 0..1 coordinates are rounded to on fence serialization. */
export const MARKUP_COORDINATE_PRECISION = 4

export const MARKUP_DEFAULT_STROKE        = '#e5484d' // annotation red
export const MARKUP_DEFAULT_STROKE_WIDTH  = 4          // viewBox units
export const MARKUP_DEFAULT_STROKE_STYLE: MarkupStrokeStyle = 'solid' // solid -> no dash-array emitted
export const MARKUP_DEFAULT_FILL_OPACITY  = 1          // 0..1, only meaningful when `fill` is set
export const MARKUP_DEFAULT_FONT_SIZE     = 28          // viewBox units
export const MARKUP_DEFAULT_TEXT_COLOR    = '#1a1a2e'   // neutral ink, independent of doc theme

/** Arrow defaults: a filled-triangle head at the tip. */
export const MARKUP_DEFAULT_ARROWHEAD: MarkupArrowhead = 'full'
export const MARKUP_DEFAULT_ARROWHEAD_POSITION: MarkupArrowheadPosition = 'end'

/** Callout boxes default to a legible neutral card even when the author never set a fill, since
 *  a borderless callout over a busy screenshot is hard to read text on. */
export const MARKUP_DEFAULT_CALLOUT_FILL         = '#ffffff'
export const MARKUP_DEFAULT_CALLOUT_FILL_OPACITY = 0.95

/** Arrowhead geometry (see `geometry.ts`'s arrowheadPolygonPoints). */
export const MARKUP_ARROWHEAD_LENGTH         = 18 // viewBox units, wing length from the tip
export const MARKUP_ARROWHEAD_ANGLE_DEGREES  = 24 // half-angle between the two wings

/** The callout tail's base width where it meets the box edge (see geometry.ts). */
export const MARKUP_CALLOUT_TAIL_BASE_WIDTH = 28 // viewBox units

/** The callout box's corner-radius factor (x the box's shorter side). ONE source of truth shared by
 *  the box `rx` in render.ts and the tail-base flush clamp in geometry.ts, so the tail base always
 *  attaches on the straight part of the rounded-rect edge rather than floating over a rounded corner. */
export const MARKUP_CALLOUT_CORNER_RADIUS_FACTOR = 0.08

/** Every element kind the renderer/fence accepts; the fence parser skips any other tag. */
export const VALID_MARKUP_KINDS: ReadonlySet<MarkupElementKind> = new Set<MarkupElementKind>([
   'rect', 'ellipse', 'line', 'arrow', 'text', 'callout', 'freehand',
])

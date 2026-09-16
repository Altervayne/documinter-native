/*
 * The pure data model for the image-markup (annotation) block. Every geometric field on a
 * `MarkupElement` is NORMALIZED 0..1 relative to the base image, so annotations survive the image
 * being re-encoded at a different pixel size. The renderer projects these fractions into a fixed
 * VIEWBOX matching the image aspect (see {@link MARKUP_VIEWBOX_LONG_EDGE}); `strokeWidth`/`fontSize`
 * are stored in VIEWBOX units (not normalized), so they scale with the image rather than the screen.
 */

// #########
// # TYPES #
// #########

export type MarkupElementKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'callout' | 'freehand'

/** undefined -> {@link MARKUP_DEFAULT_STROKE_STYLE}. */
export type MarkupStrokeStyle = 'solid' | 'dashed' | 'dotted'

/** `full` = filled triangle (default), `chevron` = an open two-stroke V/barb. */
export type MarkupArrowhead = 'full' | 'chevron'

/** `end` (the tip, default) or `middle` (the line's midpoint). */
export type MarkupArrowheadPosition = 'end' | 'middle'

/** `id` is used only by the editor for selection/reorder; it is NEVER serialized (array order carries
 *  z-order), so a fence round-trip mints a fresh id per element. */
interface MarkupBase {
   id:           string
   stroke?:      string
   /** VIEWBOX units; undefined = {@link MARKUP_DEFAULT_STROKE_WIDTH}. */
   strokeWidth?: number
   /** undefined = no fill (outline only). */
   fill?:        string
   /** undefined = {@link MARKUP_DEFAULT_FILL_OPACITY} when `fill` is set, meaningless otherwise. */
   fillOpacity?: number
   /** Meaningful only on the stroke-bearing kinds. */
   strokeStyle?: MarkupStrokeStyle
}

export interface MarkupRect extends MarkupBase {
   kind: 'rect'
   x: number; y: number; w: number; h: number
   /** Normalized (same 0..1 units as x/y/w/h); undefined = square corners. */
   radius?: number
}

/** Bounding-box geometry (NOT center/radii), so rect and ellipse share drag math. */
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
   arrowhead?: MarkupArrowhead
   arrowheadPosition?: MarkupArrowheadPosition
}

export interface MarkupText extends MarkupBase {
   kind: 'text'
   /** Anchor: the text's left baseline start. */
   x: number; y: number
   text: string
   /** VIEWBOX units; undefined = {@link MARKUP_DEFAULT_FONT_SIZE}. */
   fontSize?:  number
   textColor?: string
   /** undefined = no background (text floats over the image). */
   background?: string
}

export interface MarkupCallout extends MarkupBase {
   kind: 'callout'
   x: number; y: number; w: number; h: number
   /** The tail's pointed tip, independent of the box's own bounds. */
   tipX: number; tipY: number
   text: string
   fontSize?:  number
   textColor?: string
}

/** Points lightly simplified at capture time, so the model carries a lean count, not raw hundreds. */
export interface MarkupFreehand extends MarkupBase {
   kind: 'freehand'
   points: { x: number; y: number }[]
}

export type MarkupElement =
   | MarkupRect | MarkupEllipse | MarkupLine | MarkupArrow
   | MarkupText | MarkupCallout | MarkupFreehand

/**
 * The base image plus its overlay stack. `src` is EMPTY on a `.mint`/`.md` reopen (no base64 in text
 * formats); full fidelity lives only in the binder JSON and the HTML export, and the renderer tolerates
 * an empty `src` (a neutral placeholder ground).
 */
export interface ImageMarkupSpec {
   /** A `data:` URI, or '' until picked / after a text-format reopen. */
   src: string
   /** Natural pixel dimensions at encode time, the SOURCE OF TRUTH for the viewBox aspect ratio. Kept
    *  even when `src` is empty so a `.mint` reopen reconstructs the correct aspect. */
   width:  number
   height: number
   /** Array order IS z-order (first = bottom, last = top). */
   elements: MarkupElement[]
   alt?:     string
   caption?: string
}

// ####################
// # RENDER DEFAULTS  #
// ####################
// One source of truth for the renderer's fallbacks AND the fence's "only emit a token when it differs
// from the default" rule, so an untouched element round-trips without writing its style fields.

/** The long edge of the fixed render viewBox (the other edge follows the image aspect ratio). */
export const MARKUP_VIEWBOX_LONG_EDGE = 1000

/** Decimal places normalized coordinates round to on fence serialization. */
export const MARKUP_COORDINATE_PRECISION = 4

export const MARKUP_DEFAULT_STROKE        = '#e5484d' // annotation red
export const MARKUP_DEFAULT_STROKE_WIDTH  = 4          // viewBox units
export const MARKUP_DEFAULT_STROKE_STYLE: MarkupStrokeStyle = 'solid' // solid -> no dash-array emitted
export const MARKUP_DEFAULT_FILL_OPACITY  = 1          // only meaningful when `fill` is set
export const MARKUP_DEFAULT_FONT_SIZE     = 28          // viewBox units
export const MARKUP_DEFAULT_TEXT_COLOR    = '#1a1a2e'   // neutral ink, independent of doc theme

export const MARKUP_DEFAULT_ARROWHEAD: MarkupArrowhead = 'full'
export const MARKUP_DEFAULT_ARROWHEAD_POSITION: MarkupArrowheadPosition = 'end'

/** Callout boxes default to a legible neutral card even with no author fill, since a borderless
 *  callout over a busy screenshot is hard to read text on. */
export const MARKUP_DEFAULT_CALLOUT_FILL         = '#ffffff'
export const MARKUP_DEFAULT_CALLOUT_FILL_OPACITY = 0.95

export const MARKUP_ARROWHEAD_LENGTH         = 18 // viewBox units, wing length from the tip
export const MARKUP_ARROWHEAD_ANGLE_DEGREES  = 24 // half-angle between the two wings

export const MARKUP_CALLOUT_TAIL_BASE_WIDTH = 28 // viewBox units

/** ONE source of truth shared by the box `rx` in render.ts and the tail-base flush clamp in
 *  geometry.ts, so the tail base attaches on the straight part of the rounded-rect edge. */
export const MARKUP_CALLOUT_CORNER_RADIUS_FACTOR = 0.08

/** Every element kind the renderer/fence accepts; the fence parser skips any other tag. */
export const VALID_MARKUP_KINDS: ReadonlySet<MarkupElementKind> = new Set<MarkupElementKind>([
   'rect', 'ellipse', 'line', 'arrow', 'text', 'callout', 'freehand',
])

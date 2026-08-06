/**
 * index.ts, the public entry point for the home-grown image-markup (annotation) renderer.
 *
 * `renderImageMarkupToSvg(spec)` is the ONLY export a caller needs: it wraps the base image (or a
 * neutral placeholder when `src` is empty) plus the overlay stack in a self-contained, responsive
 * `<svg>` (viewBox + width:100%), with the accessible root `<title>`/`<desc>`. Mirrors the graph
 * block's `renderGraphToSvg` / the math block's `renderLatexToMathML`: a pure, synchronous function
 * producing a self-contained markup string with zero runtime and zero external fonts/assets (the
 * base image is the one exception, inlined as a `data:` URI when present), safe to inline verbatim
 * into the HTML export.
 *
 * NO async gate (unlike Math/Temml) and NO theme argument (unlike Graph): annotation colors are
 * the author's explicit per-element choices, not resolved from the document theme. It NEVER
 * throws: a missing/empty `src` renders a neutral placeholder ground instead of the image, and a
 * malformed element's coordinates clamp to 0 via the shared svg.ts number formatting rather than
 * emitting `NaN`/`Infinity`, the "invalid never breaks the document" contract every graphic block
 * here honors.
 */

import { titleElement, descElement, selfClosingElement } from '../svg'
import { computeViewBox } from './geometry'
import { renderElement } from './render'
import type { ImageMarkupSpec, MarkupElement } from './types'

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif"

/** Neutral placeholder ground color when there is no base image to draw (empty `src`). */
const PLACEHOLDER_FILL = '#e2e8f0'

/**
 * Render an image-markup spec to a complete, self-contained SVG string. Pure, synchronous,
 * deterministic, and total. `spec.src` is inlined verbatim (a `data:` URI or ''); an empty `src`
 * (the `.mint`/`.md` reopen case, see `lib/imageMarkupFence.ts`) renders a flat neutral rect in
 * its place so the overlay still has a ground to sit on rather than floating on nothing.
 */
export function renderImageMarkupToSvg(spec: ImageMarkupSpec): string {
   const { vbWidth, vbHeight } = computeViewBox(spec.width, spec.height)

   const baseLayer = spec.src
      ? selfClosingElement('image', {
         href: spec.src, x: 0, y: 0, width: vbWidth, height: vbHeight,
         preserveAspectRatio: 'none',
      })
      : selfClosingElement('rect', { x: 0, y: 0, width: vbWidth, height: vbHeight, fill: PLACEHOLDER_FILL })

   const elements = spec.elements ?? []
   const overlayMarkup = elements.map(oneElement => renderElement(oneElement, vbWidth, vbHeight)).join('')

   const accessibleTitle = spec.alt?.trim() || 'Annotated image'
   const accessibleDesc = describeMarkup(elements.length, !!spec.src)

   return wrapSvg(accessibleTitle, accessibleDesc, vbWidth, vbHeight, baseLayer + overlayMarkup)
}

/**
 * Render ONLY the overlay elements (no base image, no accessible title/desc) into a bare, responsive
 * `<svg>` whose viewBox matches the base image aspect ratio. This is an EDITOR-ONLY helper: the
 * interactive block layers this transparent element-overlay over a plain `<img>` of the base image
 * so a live drag re-renders just the (cheap) shapes each pointer-move without re-parsing the base
 * image's heavy base64 `data:` URI every frame. It does NOT change the export path, which still goes
 * through {@link renderImageMarkupToSvg} (base image + overlay, self-contained). Pure + total, same
 * as the full renderer.
 */
export function renderMarkupOverlayToSvg(elements: MarkupElement[], width: number, height: number): string {
   const { vbWidth, vbHeight } = computeViewBox(width, height)
   const body = (elements ?? []).map(oneElement => renderElement(oneElement, vbWidth, vbHeight)).join('')
   return (
      `<svg xmlns="http://www.w3.org/2000/svg"` +
      ` viewBox="0 0 ${vbWidth} ${vbHeight}" preserveAspectRatio="none"` +
      ` style="position:absolute;inset:0;width:100%;height:100%;font-family:${FONT_STACK}">${body}</svg>`
   )
}

/** A one-line accessible summary of what the block shows. */
function describeMarkup(elementCount: number, hasImage: boolean): string {
   const elementWord = elementCount === 1 ? 'annotation' : 'annotations'
   const imagePart = hasImage ? 'an image' : 'a placeholder (no image)'
   return `Annotated image with ${elementCount} ${elementWord} over ${imagePart}.`
}

/**
 * Wrap inner markup in the responsive `<svg>` root with the accessible title/desc. `role="img"` +
 * `<title>` + `<desc>` give it an accessible name and summary; the viewBox + inline
 * `width:100%;height:auto` make it scale to its column with no runtime resize.
 */
function wrapSvg(accessibleTitle: string, accessibleDesc: string, vbWidth: number, vbHeight: number, body: string): string {
   const open =
      `<svg xmlns="http://www.w3.org/2000/svg" role="img"` +
      ` viewBox="0 0 ${vbWidth} ${vbHeight}"` +
      ` style="width:100%;height:auto;font-family:${FONT_STACK}">`
   return `${open}${titleElement(accessibleTitle)}${descElement(accessibleDesc)}${body}</svg>`
}

// #####################
// # RE-EXPORTS        #
// #####################

export type {
   ImageMarkupSpec,
   MarkupElement,
   MarkupElementKind,
   MarkupStrokeStyle,
   MarkupArrowhead,
   MarkupArrowheadPosition,
   MarkupRect,
   MarkupEllipse,
   MarkupLine,
   MarkupArrow,
   MarkupText,
   MarkupCallout,
   MarkupFreehand,
} from './types'

export {
   MARKUP_VIEWBOX_LONG_EDGE,
   MARKUP_COORDINATE_PRECISION,
   MARKUP_DEFAULT_STROKE,
   MARKUP_DEFAULT_STROKE_WIDTH,
   MARKUP_DEFAULT_FILL_OPACITY,
   MARKUP_DEFAULT_FONT_SIZE,
   MARKUP_DEFAULT_TEXT_COLOR,
   MARKUP_DEFAULT_CALLOUT_FILL,
   MARKUP_DEFAULT_CALLOUT_FILL_OPACITY,
   MARKUP_DEFAULT_STROKE_STYLE,
   MARKUP_DEFAULT_ARROWHEAD,
   MARKUP_DEFAULT_ARROWHEAD_POSITION,
   VALID_MARKUP_KINDS,
} from './types'

export {
   computeViewBox, arrowheadPolygonPoints, arrowShaftEnd, calloutTailPolygonPoints,
   ellipseFromBoundingBox, strokeDashArray,
} from './geometry'
export { catmullRomPath } from './smooth'

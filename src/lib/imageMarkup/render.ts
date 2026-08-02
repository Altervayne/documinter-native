/**
 * render.ts, per-element SVG string builders for the image-markup renderer.
 *
 * Each function projects an element's NORMALIZED 0..1 coordinates into the fixed viewBox
 * (`vbWidth` x `vbHeight`, aspect-matched to the base image, see `geometry.ts`'s computeViewBox)
 * and returns a self-contained SVG fragment string, reusing the shared `lib/svg.ts` builders
 * (`element`, `selfClosingElement`, `textElement`, `escapeXml`). PURE, total: a non-finite datum
 * collapses to 0 via `attributesToString`'s `roundCoordinate`, so a bad element can never emit
 * `NaN`/`Infinity` into the markup (the "invalid never breaks the document" contract every graphic
 * block here honors).
 *
 * Because the viewBox aspect ratio always matches the base image's, scaling an x-fraction by
 * `vbWidth` and a y-fraction by `vbHeight` is a UNIFORM scale (no distortion), a length (stroke
 * width, radius, font size) is stored directly in viewBox units already (see types.ts), so it
 * needs no further scaling.
 */

import { selfClosingElement, textElement } from '../svg'
import { estimateTextWidth } from '../graph/layout'
import {
   arrowheadPolygonPoints, arrowShaftEnd, calloutTailPolygonPoints, ellipseFromBoundingBox,
   strokeDashArray,
} from './geometry'
import { catmullRomPath } from './smooth'
import type { Point } from './geometry'
import type {
   MarkupArrow, MarkupCallout, MarkupEllipse, MarkupElement, MarkupFreehand,
   MarkupLine, MarkupRect, MarkupText,
} from './types'
import {
   MARKUP_CALLOUT_CORNER_RADIUS_FACTOR,
   MARKUP_DEFAULT_ARROWHEAD, MARKUP_DEFAULT_ARROWHEAD_POSITION,
   MARKUP_DEFAULT_CALLOUT_FILL, MARKUP_DEFAULT_CALLOUT_FILL_OPACITY, MARKUP_DEFAULT_FILL_OPACITY,
   MARKUP_DEFAULT_FONT_SIZE, MARKUP_DEFAULT_STROKE, MARKUP_DEFAULT_STROKE_WIDTH, MARKUP_DEFAULT_TEXT_COLOR,
} from './types'

// ###################
// # SHARED RESOLVERS #
// ###################

/** Resolve the stroke color, falling back to the shared annotation-red default. */
function resolveStroke(base: { stroke?: string }): string {
   return base.stroke ?? MARKUP_DEFAULT_STROKE
}

/** Resolve the stroke width (viewBox units), falling back to the shared default. */
function resolveStrokeWidth(base: { strokeWidth?: number }): number {
   return base.strokeWidth ?? MARKUP_DEFAULT_STROKE_WIDTH
}

/** A point in normalized 0..1 image space. */
interface NormalizedPoint {
   x: number
   y: number
}

/** Project a normalized coordinate into the viewBox. */
function project(point: NormalizedPoint, vbWidth: number, vbHeight: number): Point {
   return { x: point.x * vbWidth, y: point.y * vbHeight }
}

// ################
// # RECT/ELLIPSE #
// ################

export function renderRect(markupRect: MarkupRect, vbWidth: number, vbHeight: number): string {
   const { x, y } = project({ x: markupRect.x, y: markupRect.y }, vbWidth, vbHeight)
   const w = markupRect.w * vbWidth
   const h = markupRect.h * vbHeight
   const attrs: Record<string, string | number | undefined> = {
      x, y, width: w, height: h,
      stroke: resolveStroke(markupRect),
      'stroke-width': resolveStrokeWidth(markupRect),
      'stroke-dasharray': strokeDashArray(markupRect.strokeStyle, resolveStrokeWidth(markupRect)),
      fill: markupRect.fill ?? 'none',
   }
   if (markupRect.fill !== undefined) {
      attrs['fill-opacity'] = markupRect.fillOpacity ?? MARKUP_DEFAULT_FILL_OPACITY
   }
   if (markupRect.radius !== undefined) {
      attrs.rx = markupRect.radius * vbWidth
   }
   return selfClosingElement('rect', attrs)
}

export function renderEllipse(markupEllipse: MarkupEllipse, vbWidth: number, vbHeight: number): string {
   const box = {
      x: markupEllipse.x * vbWidth, y: markupEllipse.y * vbHeight,
      w: markupEllipse.w * vbWidth, h: markupEllipse.h * vbHeight,
   }
   const { cx, cy, rx, ry } = ellipseFromBoundingBox(box)
   const attrs: Record<string, string | number | undefined> = {
      cx, cy, rx, ry,
      stroke: resolveStroke(markupEllipse),
      'stroke-width': resolveStrokeWidth(markupEllipse),
      'stroke-dasharray': strokeDashArray(markupEllipse.strokeStyle, resolveStrokeWidth(markupEllipse)),
      fill: markupEllipse.fill ?? 'none',
   }
   if (markupEllipse.fill !== undefined) {
      attrs['fill-opacity'] = markupEllipse.fillOpacity ?? MARKUP_DEFAULT_FILL_OPACITY
   }
   return selfClosingElement('ellipse', attrs)
}

// ################
// # LINE/ARROW   #
// ################

export function renderLine(markupLine: MarkupLine, vbWidth: number, vbHeight: number): string {
   const start = project({ x: markupLine.x1, y: markupLine.y1 }, vbWidth, vbHeight)
   const end   = project({ x: markupLine.x2, y: markupLine.y2 }, vbWidth, vbHeight)
   return selfClosingElement('line', {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      stroke: resolveStroke(markupLine),
      'stroke-width': resolveStrokeWidth(markupLine),
      'stroke-dasharray': strokeDashArray(markupLine.strokeStyle, resolveStrokeWidth(markupLine)),
      'stroke-linecap': 'round',
   })
}

export function renderArrow(markupArrow: MarkupArrow, vbWidth: number, vbHeight: number): string {
   const start = project({ x: markupArrow.x1, y: markupArrow.y1 }, vbWidth, vbHeight)
   const end   = project({ x: markupArrow.x2, y: markupArrow.y2 }, vbWidth, vbHeight)
   const stroke = resolveStroke(markupArrow)
   const strokeWidth = resolveStrokeWidth(markupArrow)
   const headType = markupArrow.arrowhead ?? MARKUP_DEFAULT_ARROWHEAD
   const headPosition = markupArrow.arrowheadPosition ?? MARKUP_DEFAULT_ARROWHEAD_POSITION

   // The head sits at the tip (default) or the line's midpoint. When at the midpoint it is oriented
   // along the same start→end direction (from `start` toward the head point is collinear with the line).
   const headPoint: Point = headPosition === 'middle'
      ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      : end

   // The shaft runs the full line, EXCEPT for a `full` head at the `end`: there we stop the shaft at
   // the arrowhead's base so the line's stroke width can't blunt the sharp tip (Bug 3). A chevron is
   // open (its barbs meet AT the tip), so its shaft reaches the tip; a mid-line head never retracts.
   const shaftEnd = (headType === 'full' && headPosition === 'end')
      ? arrowShaftEnd(start.x, start.y, end.x, end.y)
      : end
   const dashArray = strokeDashArray(markupArrow.strokeStyle, strokeWidth)
   const shaft = selfClosingElement('line', {
      x1: start.x, y1: start.y, x2: shaftEnd.x, y2: shaftEnd.y,
      stroke, 'stroke-width': strokeWidth,
      'stroke-dasharray': dashArray,
      'stroke-linecap': 'round',
   })

   const [tip, wingA, wingB] = arrowheadPolygonPoints(start.x, start.y, headPoint.x, headPoint.y)
   const head = headType === 'chevron'
      // An open V: a two-leg polyline wingA → tip → wingB, stroked (never dashed) and never filled.
      ? selfClosingElement('polyline', {
         points: `${round(wingA.x)},${round(wingA.y)} ${round(tip.x)},${round(tip.y)} ${round(wingB.x)},${round(wingB.y)}`,
         fill: 'none', stroke, 'stroke-width': strokeWidth,
         'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      })
      : selfClosingElement('polygon', {
         points: `${round(tip.x)},${round(tip.y)} ${round(wingA.x)},${round(wingA.y)} ${round(wingB.x)},${round(wingB.y)}`,
         fill: stroke,
      })
   return shaft + head
}

// ##########
// # TEXT   #
// ##########

export function renderText(markupText: MarkupText, vbWidth: number, vbHeight: number): string {
   const anchor = project({ x: markupText.x, y: markupText.y }, vbWidth, vbHeight)
   const fontSize = markupText.fontSize ?? MARKUP_DEFAULT_FONT_SIZE
   const color = markupText.textColor ?? MARKUP_DEFAULT_TEXT_COLOR
   const text = markupText.text ?? ''

   let backgroundMarkup = ''
   if (markupText.background !== undefined && text !== '') {
      // DOM-free width estimate (the same limitation the graph renderer accepts, see
      // `lib/graph/layout.ts`'s estimateTextWidth doc comment): occasionally over/under-reserves.
      const estimatedWidth = estimateTextWidth(text, fontSize)
      const paddingX = fontSize * 0.25
      const paddingY = fontSize * 0.2
      backgroundMarkup = selfClosingElement('rect', {
         x: anchor.x - paddingX,
         y: anchor.y - fontSize - paddingY * 0.5,
         width: estimatedWidth + paddingX * 2,
         height: fontSize + paddingY,
         fill: markupText.background,
      })
   }

   const textMarkup = textElement({ x: anchor.x, y: anchor.y, 'font-size': fontSize, fill: color }, text)
   return backgroundMarkup + textMarkup
}

// #############
// # CALLOUT   #
// #############

export function renderCallout(markupCallout: MarkupCallout, vbWidth: number, vbHeight: number): string {
   const box = {
      x: markupCallout.x * vbWidth, y: markupCallout.y * vbHeight,
      w: markupCallout.w * vbWidth, h: markupCallout.h * vbHeight,
   }
   const tip = project({ x: markupCallout.tipX, y: markupCallout.tipY }, vbWidth, vbHeight)
   const stroke = resolveStroke(markupCallout)
   const strokeWidth = resolveStrokeWidth(markupCallout)
   const fill = markupCallout.fill ?? MARKUP_DEFAULT_CALLOUT_FILL
   const fillOpacity = markupCallout.fill !== undefined
      ? (markupCallout.fillOpacity ?? MARKUP_DEFAULT_FILL_OPACITY)
      : MARKUP_DEFAULT_CALLOUT_FILL_OPACITY

   // The box's corner radius, shared with the tail so the tail base attaches on the straight part of
   // the rounded-rect edge rather than floating over a rounded corner (Bug 2).
   const cornerRadius = Math.min(box.w, box.h) * MARKUP_CALLOUT_CORNER_RADIUS_FACTOR

   // The tail is drawn FIRST (bottom layer) so its base line disappears under the box border,
   // then the box, then the text on top.
   const [tailTip, tailBaseA, tailBaseB] = calloutTailPolygonPoints(box, tip, undefined, cornerRadius)
   const tailMarkup = selfClosingElement('polygon', {
      points: `${round(tailTip.x)},${round(tailTip.y)} ${round(tailBaseA.x)},${round(tailBaseA.y)} ${round(tailBaseB.x)},${round(tailBaseB.y)}`,
      fill, stroke, 'stroke-width': strokeWidth,
   })
   const boxMarkup = selfClosingElement('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill, 'fill-opacity': fillOpacity,
      stroke, 'stroke-width': strokeWidth,
      'stroke-dasharray': strokeDashArray(markupCallout.strokeStyle, strokeWidth),
      rx: cornerRadius,
   })

   const fontSize = markupCallout.fontSize ?? MARKUP_DEFAULT_FONT_SIZE
   const textColor = markupCallout.textColor ?? MARKUP_DEFAULT_TEXT_COLOR
   const paddingX = fontSize * 0.4
   const textMarkup = textElement(
      { x: box.x + paddingX, y: box.y + box.h / 2 + fontSize * 0.32, 'font-size': fontSize, fill: textColor },
      markupCallout.text ?? '',
   )

   return tailMarkup + boxMarkup + textMarkup
}

// ##############
// # FREEHAND   #
// ##############

export function renderFreehand(markupFreehand: MarkupFreehand, vbWidth: number, vbHeight: number): string {
   const projected = markupFreehand.points.map(point => project(point, vbWidth, vbHeight))
   const pathData = catmullRomPath(projected)
   if (pathData === '') return ''
   return selfClosingElement('path', {
      d: pathData,
      fill: 'none',
      stroke: resolveStroke(markupFreehand),
      'stroke-width': resolveStrokeWidth(markupFreehand),
      'stroke-dasharray': strokeDashArray(markupFreehand.strokeStyle, resolveStrokeWidth(markupFreehand)),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
   })
}

// ################
// # DISPATCHER   #
// ################

/** Render one overlay element to its SVG fragment. Exhaustive over {@link MarkupElement.kind}. */
export function renderElement(markupElement: MarkupElement, vbWidth: number, vbHeight: number): string {
   switch (markupElement.kind) {
      case 'rect':     return renderRect(markupElement, vbWidth, vbHeight)
      case 'ellipse':  return renderEllipse(markupElement, vbWidth, vbHeight)
      case 'line':     return renderLine(markupElement, vbWidth, vbHeight)
      case 'arrow':    return renderArrow(markupElement, vbWidth, vbHeight)
      case 'text':     return renderText(markupElement, vbWidth, vbHeight)
      case 'callout':  return renderCallout(markupElement, vbWidth, vbHeight)
      case 'freehand': return renderFreehand(markupElement, vbWidth, vbHeight)
   }
}

/** Round to 2 decimals for compact, deterministic polygon `points` strings (NaN-safe). */
function round(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value * 100) / 100
}

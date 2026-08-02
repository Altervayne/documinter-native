/**
 * imageMarkupFence.ts, the ` ```imagemarkup ` fence serializer / parser for the image-markup block.
 *
 * RATIFIED (2026-08-02, see docs/reference/image_markup_study.md's "Ratified decisions" section,
 * this is the one deliberate DIVERGENCE from the study's original recommendation): the fence NEVER
 * carries the base64 image pixels, in EITHER `.mint` or `.md`. Both text formats stay pure,
 * human-readable, standalone-readable text, exactly like the existing `image` block, which drops
 * its base64 `src` on serialization (see `markdown.ts`'s `case 'image'`). Only the base image's
 * PIXEL DIMENSIONS (`w=`/`h=`, needed to reconstruct the viewBox aspect ratio without decoding any
 * image) plus `alt=`/`caption=` metadata ride the info string; the overlay stack rides the body as
 * one compact `kind key=value …` line per element, in z-order. Consequence: a `.mint`/`.md` reopen
 * restores the block + every annotation but with an EMPTY `src` (no pixels), the renderer already
 * tolerates that gracefully (see `lib/imageMarkup/index.ts`). Full fidelity (base image pixels) is
 * the JSON path only (binder IndexedDB + the self-contained HTML export).
 *
 * The element-line grammar reuses the same `key=value` tokenizer/quoter as the top-level info
 * string (`fenceInfoString.ts`, promoted from the graph fence), each line is tokenized exactly
 * like an info string, with the leading token naming the element `kind`.
 *
 * Both directions are total: `imageMarkupSpecToFence` never throws on a partial spec, and
 * `fenceToImageMarkupSpec` never throws on a malformed fence (unknown element kinds and bad
 * numeric fields are skipped/zeroed rather than thrown), so a hand-edited file can never break
 * the document.
 */

import type { ImageMarkupSpec, MarkupElement, MarkupElementKind } from './imageMarkup'
import { VALID_MARKUP_KINDS, MARKUP_COORDINATE_PRECISION } from './imageMarkup'
import { serializeInfoValue, unquoteInfoValue, tokenizeInfoString } from './fenceInfoString'

// #############
// # ROUNDING  #
// #############

/** Round a normalized 0..1 coordinate to the ratified fence precision (4 decimal places). */
function roundCoordinate(value: number): number {
   if (!Number.isFinite(value)) return 0
   const factor = 10 ** MARKUP_COORDINATE_PRECISION
   return Math.round(value * factor) / factor
}

/** Round a viewBox-unit length (stroke width, font size, radius) to 2 decimal places. */
function roundLength(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value * 100) / 100
}

/** Parse a `key=value` token's numeric value; a missing/malformed token falls back to `fallback`. */
function parseNumberToken(raw: string | undefined, fallback = 0): number {
   if (raw === undefined) return fallback
   const parsed = Number(raw)
   return Number.isFinite(parsed) ? parsed : fallback
}

// ###################################
// # INFO STRING (w=/h=/alt=/caption=) #
// ###################################

interface ParsedMarkupInfo {
   width:    number
   height:   number
   alt?:     string
   caption?: string
}

function parseInfoString(fenceInfo: string): ParsedMarkupInfo {
   const tokens = tokenizeInfoString(fenceInfo)
   const info: ParsedMarkupInfo = { width: 0, height: 0 }
   // tokens[0] is the `imagemarkup` tag itself; options start at index 1.
   for (const token of tokens.slice(1)) {
      const equalsIndex = token.indexOf('=')
      if (equalsIndex === -1) continue
      const key   = token.slice(0, equalsIndex)
      const value = unquoteInfoValue(token.slice(equalsIndex + 1))
      switch (key) {
         case 'w': {
            const parsed = Number(value)
            if (Number.isFinite(parsed) && parsed > 0) info.width = parsed
            break
         }
         case 'h': {
            const parsed = Number(value)
            if (Number.isFinite(parsed) && parsed > 0) info.height = parsed
            break
         }
         case 'alt':
            if (value !== '') info.alt = value
            break
         case 'caption':
            if (value !== '') info.caption = value
            break
         default:
            break
      }
   }
   return info
}

function serializeInfoTokens(spec: ImageMarkupSpec): string[] {
   const tokens: string[] = []
   if (spec.width > 0)  tokens.push(`w=${roundLength(spec.width)}`)
   if (spec.height > 0) tokens.push(`h=${roundLength(spec.height)}`)
   if (spec.alt !== undefined && spec.alt !== '')
      tokens.push(`alt=${serializeInfoValue(spec.alt)}`)
   if (spec.caption !== undefined && spec.caption !== '')
      tokens.push(`caption=${serializeInfoValue(spec.caption)}`)
   return tokens
}

// ###################################
// # ELEMENT LINES (body)             #
// ###################################

/** The shared MarkupBase style fields, read from / written to the fence independently of `kind`. */
interface MarkupStyleFields {
   stroke?:      string
   strokeWidth?: number
   fill?:        string
   fillOpacity?: number
}

/** Read the shared MarkupBase style fields (stroke/strokeWidth/fill/fillOpacity) off a token map. */
function readBaseStyle(fields: Map<string, string>): MarkupStyleFields {
   const style: MarkupStyleFields = {}
   const stroke = fields.get('stroke')
   if (stroke !== undefined && stroke !== '') style.stroke = stroke
   const strokeWidthRaw = fields.get('sw')
   if (strokeWidthRaw !== undefined) {
      const parsedStrokeWidth = Number(strokeWidthRaw)
      if (Number.isFinite(parsedStrokeWidth)) style.strokeWidth = parsedStrokeWidth
   }
   const fill = fields.get('fill')
   if (fill !== undefined && fill !== '') style.fill = fill
   const fillOpacityRaw = fields.get('fillOpacity')
   if (fillOpacityRaw !== undefined) {
      const parsedFillOpacity = Number(fillOpacityRaw)
      if (Number.isFinite(parsedFillOpacity)) style.fillOpacity = parsedFillOpacity
   }
   return style
}

/** Serialize the shared MarkupBase style fields to `key=value` tokens, only when set. */
function serializeBaseStyle(base: MarkupStyleFields): string[] {
   const tokens: string[] = []
   if (base.stroke !== undefined)      tokens.push(`stroke=${serializeInfoValue(base.stroke)}`)
   if (base.strokeWidth !== undefined) tokens.push(`sw=${roundLength(base.strokeWidth)}`)
   if (base.fill !== undefined) {
      tokens.push(`fill=${serializeInfoValue(base.fill)}`)
      if (base.fillOpacity !== undefined) tokens.push(`fillOpacity=${base.fillOpacity}`)
   }
   return tokens
}

/** Tokenize one element line into its kind + a key->value field map (last write wins on duplicates). */
function parseElementLine(line: string): { kind: string; fields: Map<string, string> } | null {
   const tokens = tokenizeInfoString(line)
   if (tokens.length === 0) return null
   const kind = tokens[0]
   const fields = new Map<string, string>()
   for (const token of tokens.slice(1)) {
      const equalsIndex = token.indexOf('=')
      if (equalsIndex === -1) continue
      const key   = token.slice(0, equalsIndex)
      const value = unquoteInfoValue(token.slice(equalsIndex + 1))
      fields.set(key, value)
   }
   return { kind, fields }
}

/** Parse one `freehand` line's `pts=x,y x,y …` field into a point list. Malformed pairs are skipped. */
function parsePoints(raw: string | undefined): { x: number; y: number }[] {
   if (raw === undefined || raw.trim() === '') return []
   const points: { x: number; y: number }[] = []
   for (const pair of raw.trim().split(/\s+/)) {
      const [xRaw, yRaw] = pair.split(',')
      const x = Number(xRaw)
      const y = Number(yRaw)
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y })
   }
   return points
}

/** Serialize a freehand point list to the compact `pts=` value (space-separated `x,y` pairs). */
function serializePoints(points: { x: number; y: number }[]): string {
   return points.map(point => `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`).join(' ')
}

/**
 * Parse one element line (kind already validated against {@link VALID_MARKUP_KINDS} by the caller)
 * into a {@link MarkupElement}. Never throws: missing/malformed numeric fields fall back to 0, a
 * missing `text` falls back to '', and freehand degenerates to an empty point list.
 */
function elementFromFields(kind: MarkupElementKind, fields: Map<string, string>): MarkupElement {
   const id = crypto.randomUUID()
   const base = readBaseStyle(fields)
   const number = (key: string) => parseNumberToken(fields.get(key))
   const text = (key: string) => fields.get(key) ?? ''

   switch (kind) {
      case 'rect': {
         const radius = fields.get('radius')
         return {
            id, kind, ...base,
            x: number('x'), y: number('y'), w: number('w'), h: number('h'),
            ...(radius !== undefined ? { radius: parseNumberToken(radius) } : {}),
         }
      }
      case 'ellipse':
         return { id, kind, ...base, x: number('x'), y: number('y'), w: number('w'), h: number('h') }
      case 'line':
         return { id, kind, ...base, x1: number('x1'), y1: number('y1'), x2: number('x2'), y2: number('y2') }
      case 'arrow':
         return { id, kind, ...base, x1: number('x1'), y1: number('y1'), x2: number('x2'), y2: number('y2') }
      case 'text': {
         const size = fields.get('size')
         const color = fields.get('color')
         const background = fields.get('background')
         return {
            id, kind, ...base,
            x: number('x'), y: number('y'), text: text('text'),
            ...(size !== undefined ? { fontSize: parseNumberToken(size) } : {}),
            ...(color !== undefined && color !== '' ? { textColor: color } : {}),
            ...(background !== undefined && background !== '' ? { background } : {}),
         }
      }
      case 'callout': {
         const size = fields.get('size')
         const color = fields.get('color')
         return {
            id, kind, ...base,
            x: number('x'), y: number('y'), w: number('w'), h: number('h'),
            tipX: number('tipX'), tipY: number('tipY'), text: text('text'),
            ...(size !== undefined ? { fontSize: parseNumberToken(size) } : {}),
            ...(color !== undefined && color !== '' ? { textColor: color } : {}),
         }
      }
      case 'freehand':
         return { id, kind, ...base, points: parsePoints(fields.get('pts')) }
   }
}

/** Serialize one {@link MarkupElement} to its fence body line (no leading/trailing backticks). */
function elementToLine(markupElement: MarkupElement): string {
   const tokens: string[] = [markupElement.kind]
   const pushCoordinate = (key: string, value: number) => tokens.push(`${key}=${roundCoordinate(value)}`)

   switch (markupElement.kind) {
      case 'rect':
         pushCoordinate('x', markupElement.x); pushCoordinate('y', markupElement.y)
         pushCoordinate('w', markupElement.w); pushCoordinate('h', markupElement.h)
         if (markupElement.radius !== undefined) pushCoordinate('radius', markupElement.radius)
         tokens.push(...serializeBaseStyle(markupElement))
         break
      case 'ellipse':
         pushCoordinate('x', markupElement.x); pushCoordinate('y', markupElement.y)
         pushCoordinate('w', markupElement.w); pushCoordinate('h', markupElement.h)
         tokens.push(...serializeBaseStyle(markupElement))
         break
      case 'line':
      case 'arrow':
         pushCoordinate('x1', markupElement.x1); pushCoordinate('y1', markupElement.y1)
         pushCoordinate('x2', markupElement.x2); pushCoordinate('y2', markupElement.y2)
         tokens.push(...serializeBaseStyle(markupElement))
         break
      case 'text':
         pushCoordinate('x', markupElement.x); pushCoordinate('y', markupElement.y)
         if (markupElement.fontSize !== undefined) tokens.push(`size=${roundLength(markupElement.fontSize)}`)
         if (markupElement.textColor !== undefined) tokens.push(`color=${serializeInfoValue(markupElement.textColor)}`)
         if (markupElement.background !== undefined) tokens.push(`background=${serializeInfoValue(markupElement.background)}`)
         tokens.push(`text=${serializeInfoValue(markupElement.text ?? '')}`)
         tokens.push(...serializeBaseStyle(markupElement))
         break
      case 'callout':
         pushCoordinate('x', markupElement.x); pushCoordinate('y', markupElement.y)
         pushCoordinate('w', markupElement.w); pushCoordinate('h', markupElement.h)
         pushCoordinate('tipX', markupElement.tipX); pushCoordinate('tipY', markupElement.tipY)
         if (markupElement.fontSize !== undefined) tokens.push(`size=${roundLength(markupElement.fontSize)}`)
         if (markupElement.textColor !== undefined) tokens.push(`color=${serializeInfoValue(markupElement.textColor)}`)
         tokens.push(`text=${serializeInfoValue(markupElement.text ?? '')}`)
         tokens.push(...serializeBaseStyle(markupElement))
         break
      case 'freehand':
         tokens.push(...serializeBaseStyle(markupElement))
         tokens.push(`pts=${serializeInfoValue(serializePoints(markupElement.points ?? []))}`)
         break
   }
   return tokens.join(' ')
}

// ################
// # PUBLIC API   #
// ################

/**
 * Serialize an ImageMarkupSpec to its fence pieces: the full info string (including the leading
 * `imagemarkup` tag) and the element-lines body. The caller wraps them in the ``` … ``` fence.
 * The base64 `src` is NEVER emitted (see the module doc), same output in both `.mint` and `.md`.
 */
export function imageMarkupSpecToFence(spec: ImageMarkupSpec): { info: string; body: string } {
   const tokens = [`imagemarkup`, ...serializeInfoTokens(spec)]
   const body = (spec.elements ?? []).map(elementToLine).join('\n')
   return { info: tokens.join(' '), body }
}

/**
 * Parse an `imagemarkup` fence (its whole info string + its body) back into an ImageMarkupSpec.
 * `src` always comes back EMPTY (the ratified no-base64-in-text-formats rule), full fidelity is
 * the JSON path only. Total: an unknown element kind or a malformed numeric field degrades
 * gracefully (skipped / zeroed) rather than throwing.
 */
export function fenceToImageMarkupSpec(fenceInfo: string, body: string): ImageMarkupSpec {
   const info = parseInfoString(fenceInfo)
   const elements: MarkupElement[] = []
   for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (line === '') continue
      const parsed = parseElementLine(line)
      if (!parsed) continue
      if (!VALID_MARKUP_KINDS.has(parsed.kind as MarkupElementKind)) continue // unknown kind: skip, forward-compatible
      elements.push(elementFromFields(parsed.kind as MarkupElementKind, parsed.fields))
   }
   const spec: ImageMarkupSpec = { src: '', width: info.width, height: info.height, elements }
   if (info.alt !== undefined)     spec.alt = info.alt
   if (info.caption !== undefined) spec.caption = info.caption
   return spec
}

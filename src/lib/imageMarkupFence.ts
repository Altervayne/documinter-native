/*
 * The ` ```imagemarkup ` fence serializer/parser. NEVER carries the base64 pixels, in `.mint` or
 * `.md`: only the base PIXEL DIMENSIONS (w=/h=, to rebuild the viewBox aspect) plus alt=/caption=
 * ride the info string, and the overlay stack rides the body as one `kind key=value ...` line per
 * element in z-order. A reopen restores every annotation with an EMPTY `src` (full pixels are the
 * JSON path). Both directions are total: unknown kinds and bad numeric fields are skipped/zeroed.
 */

import type {
   ImageMarkupSpec, MarkupElement, MarkupElementKind, MarkupStrokeStyle,
} from './imageMarkup'
import { VALID_MARKUP_KINDS, MARKUP_COORDINATE_PRECISION } from './imageMarkup'
import { serializeInfoValue, unquoteInfoValue, tokenizeInfoString } from './fenceInfoString'

// #############
// # ROUNDING  #
// #############

/** Round a normalized coordinate to the fence's precision. */
function roundCoordinate(value: number): number {
   if (!Number.isFinite(value)) return 0
   const factor = 10 ** MARKUP_COORDINATE_PRECISION
   return Math.round(value * factor) / factor
}

/** Round a viewBox-unit length (stroke width, font size, radius) to 2 decimals. */
function roundLength(value: number): number {
   if (!Number.isFinite(value)) return 0
   return Math.round(value * 100) / 100
}

/** Parse a token's numeric value; a missing/malformed token falls back to `fallback`. */
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
   // tokens[0] is the `imagemarkup` tag; options start at index 1.
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

/** The shared MarkupBase style fields, read/written independently of `kind`. */
interface MarkupStyleFields {
   stroke?:      string
   strokeWidth?: number
   strokeStyle?: MarkupStrokeStyle
   fill?:        string
   fillOpacity?: number
}

function readBaseStyle(fields: Map<string, string>): MarkupStyleFields {
   const style: MarkupStyleFields = {}
   const stroke = fields.get('stroke')
   if (stroke !== undefined && stroke !== '') style.stroke = stroke
   const strokeWidthRaw = fields.get('sw')
   if (strokeWidthRaw !== undefined) {
      const parsedStrokeWidth = Number(strokeWidthRaw)
      if (Number.isFinite(parsedStrokeWidth)) style.strokeWidth = parsedStrokeWidth
   }
   const strokeStyle = fields.get('strokeStyle')
   if (strokeStyle === 'dashed' || strokeStyle === 'dotted') style.strokeStyle = strokeStyle
   const fill = fields.get('fill')
   if (fill !== undefined && fill !== '') style.fill = fill
   const fillOpacityRaw = fields.get('fillOpacity')
   if (fillOpacityRaw !== undefined) {
      const parsedFillOpacity = Number(fillOpacityRaw)
      if (Number.isFinite(parsedFillOpacity)) style.fillOpacity = parsedFillOpacity
   }
   return style
}

/** Serialize the shared style fields, only when set. `strokeStyle` is emitted only when non-default,
 *  so a solid contour stays byte-identical. */
function serializeBaseStyle(base: MarkupStyleFields): string[] {
   const tokens: string[] = []
   if (base.stroke !== undefined)      tokens.push(`stroke=${serializeInfoValue(base.stroke)}`)
   if (base.strokeWidth !== undefined) tokens.push(`sw=${roundLength(base.strokeWidth)}`)
   if (base.strokeStyle !== undefined && base.strokeStyle !== 'solid') tokens.push(`strokeStyle=${base.strokeStyle}`)
   if (base.fill !== undefined) {
      tokens.push(`fill=${serializeInfoValue(base.fill)}`)
      if (base.fillOpacity !== undefined) tokens.push(`fillOpacity=${base.fillOpacity}`)
   }
   return tokens
}

/** Tokenize one element line into its kind + a key->value field map (last write wins). */
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

/** Parse one `freehand` line's `pts=x,y x,y ...` field into a point list. Malformed pairs are skipped. */
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

/** One element line (kind pre-validated) into a MarkupElement. Never throws: malformed numbers fall
 *  back to 0, a missing text to '', freehand to an empty point list. */
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
      case 'arrow': {
         const arrowhead = fields.get('arrowhead')
         const arrowPos = fields.get('arrowPos')
         return {
            id, kind, ...base,
            x1: number('x1'), y1: number('y1'), x2: number('x2'), y2: number('y2'),
            ...(arrowhead === 'chevron' ? { arrowhead: 'chevron' as const } : {}),
            ...(arrowPos === 'middle' ? { arrowheadPosition: 'middle' as const } : {}),
         }
      }
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

/** Serialize one MarkupElement to its fence body line. */
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
         pushCoordinate('x1', markupElement.x1); pushCoordinate('y1', markupElement.y1)
         pushCoordinate('x2', markupElement.x2); pushCoordinate('y2', markupElement.y2)
         tokens.push(...serializeBaseStyle(markupElement))
         break
      case 'arrow':
         pushCoordinate('x1', markupElement.x1); pushCoordinate('y1', markupElement.y1)
         pushCoordinate('x2', markupElement.x2); pushCoordinate('y2', markupElement.y2)
         // Emitted only when non-default, so a plain arrow stays byte-identical.
         if (markupElement.arrowhead !== undefined && markupElement.arrowhead !== 'full')
            tokens.push(`arrowhead=${markupElement.arrowhead}`)
         if (markupElement.arrowheadPosition !== undefined && markupElement.arrowheadPosition !== 'end')
            tokens.push(`arrowPos=${markupElement.arrowheadPosition}`)
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

/** Serialize an ImageMarkupSpec to its fence pieces (info string + element-lines body). The base64
 *  `src` is NEVER emitted. */
export function imageMarkupSpecToFence(spec: ImageMarkupSpec): { info: string; body: string } {
   const tokens = [`imagemarkup`, ...serializeInfoTokens(spec)]
   const body = (spec.elements ?? []).map(elementToLine).join('\n')
   return { info: tokens.join(' '), body }
}

/** Parse an `imagemarkup` fence back into an ImageMarkupSpec. `src` always comes back EMPTY. Total: an
 *  unknown kind or a malformed numeric field is skipped/zeroed, never thrown. */
export function fenceToImageMarkupSpec(fenceInfo: string, body: string): ImageMarkupSpec {
   const info = parseInfoString(fenceInfo)
   const elements: MarkupElement[] = []
   for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (line === '') continue
      const parsed = parseElementLine(line)
      if (!parsed) continue
      if (!VALID_MARKUP_KINDS.has(parsed.kind as MarkupElementKind)) continue
      elements.push(elementFromFields(parsed.kind as MarkupElementKind, parsed.fields))
   }
   const spec: ImageMarkupSpec = { src: '', width: info.width, height: info.height, elements }
   if (info.alt !== undefined)     spec.alt = info.alt
   if (info.caption !== undefined) spec.caption = info.caption
   return spec
}

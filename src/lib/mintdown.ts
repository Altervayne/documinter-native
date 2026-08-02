import type { Block, CalloutStyle, CodeLang, DocMeta, Section } from '../types'
import { serializeBlock, buildListTree, buildTableBlock } from './markdown'
import { inlineContentToMintdown, mintdownToInlineContent } from './inline'
import { parseMathScaleToken } from './mathScale'
import { fenceToGraphSpec } from './graphFence'
import { fenceToImageMarkupSpec } from './imageMarkupFence'
import { slugify } from './text'
import { sanitizeCalloutHex } from './calloutColor'

// #############
// # CONSTANTS #
// #############

/** Maps fence language tags (lower-cased) to CodeLang for import. */
const FENCE_TO_CODE_LANG: Record<string, CodeLang> = {
   windev:     'windev',
   javascript: 'js',
   js:         'js',
   ts:         'js',
   typescript: 'js',
   bash:       'plain',
   shell:      'plain',
   sh:         'plain',
   sql:        'sql',
   python:     'python',
   py:         'python',
   c:          'c',
   cpp:        'c',
   html:       'html',
   xml:        'html',
   css:        'css',
   scss:       'css',
   sass:       'css',
}

/**
 * Builds the block for a closed fence from its full info string and body. The first token is the
 * language tag; a ```math fence becomes a math block carrying the raw LaTeX, and any following
 * `scale=<step>` token sets its display scale (junk / out-of-range values are ignored, never
 * thrown). Every other tag becomes a code block (the MathML is re-derived from the LaTeX on load).
 */
function buildFenceBlock(fenceInfo: string, body: string): Block {
   const tokens  = fenceInfo.trim().split(/\s+/)
   const langTag = tokens[0] ?? ''
   if (langTag.toLowerCase() === 'math') {
      const scaleToken = tokens.slice(1).find(token => token.startsWith('scale='))
      const scale      = parseMathScaleToken(scaleToken?.slice('scale='.length))
      const block: Block = { id: crypto.randomUUID(), type: 'math', latex: body }
      if (scale !== undefined) block.mathScale = scale
      return block
   }
   if (langTag.toLowerCase() === 'graph') {
      // Pass the FULL info string so the graph parser can tokenize quoted options itself;
      // malformed fences degrade gracefully (default type + empty data), never throw.
      return { id: crypto.randomUUID(), type: 'graph', graph: fenceToGraphSpec(fenceInfo, body) }
   }
   if (langTag.toLowerCase() === 'imagemarkup') {
      // `src` always comes back empty (no base64 in Mintdown either, see imageMarkupFence.ts);
      // malformed fences degrade gracefully, never throw.
      return { id: crypto.randomUUID(), type: 'image-markup', imageMarkup: fenceToImageMarkupSpec(fenceInfo, body) }
   }
   const lang: CodeLang = FENCE_TO_CODE_LANG[langTag.toLowerCase()] ?? 'plain'
   return { id: crypto.randomUUID(), type: 'code', lang, code: body }
}

// ###################
// # PRIVATE HELPERS #
// ###################

// ==========================
//  YAML front-matter scalars
// ==========================

/** True when a scalar can't be written bare and must be double-quoted in the front matter. */
function yamlNeedsQuote(text: string): boolean {
   if (text === '') return true
   if (text !== text.trim()) return true                 // leading / trailing whitespace
   if (/[:#"'\\\n]/.test(text)) return true              // structural or quote characters
   if (/^[-?[\]{}&*!|>%@`,]/.test(text)) return true     // YAML indicator start characters
   return false
}

/** Serialise a front-matter key or value, quoting (and escaping) only when necessary. */
function yamlQuoteScalar(text: string): string {
   if (!yamlNeedsQuote(text)) return text
   return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'
}

/** Read a double-quoted scalar starting at `text[start]` (a `"`), returning its value + end index. */
function parseQuotedScalar(text: string, start: number): { value: string; end: number } {
   let result = ''
   let index  = start + 1
   while (index < text.length) {
      const char = text[index]
      if (char === '\\') {
         const next = text[index + 1]
         if (next === undefined)  { index++; break }
         else if (next === 'n')   result += '\n'
         else                     result += next   // covers \" and \\ and any other escape
         index += 2
      } else if (char === '"') {
         return { value: result, end: index + 1 }
      } else {
         result += char
         index++
      }
   }
   return { value: result, end: index }
}

/**
 * Parse the inline-mapping form of a field value: `{ value: <v>, position: above, color: <c> }`.
 * Returns the extracted parts, or null when `text` is not a brace-wrapped mapping. Values are
 * read with the same need-based quoting the serializer emits (double-quoted scalar or bare token).
 */
function parseFieldMapping(text: string): { value: string; position: string; color: string; showLabel: string } | null {
   const trimmed = text.trim()
   if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
   const inner = trimmed.slice(1, -1)

   const result = { value: '', position: '', color: '', showLabel: '' }
   let index = 0
   while (index < inner.length) {
      // Skip separators / whitespace between entries.
      while (index < inner.length && (inner[index] === ',' || inner[index] === ' ')) index++
      if (index >= inner.length) break

      const colonIndex = inner.indexOf(':', index)
      if (colonIndex === -1) break
      const key = inner.slice(index, colonIndex).trim()
      index = colonIndex + 1
      while (index < inner.length && inner[index] === ' ') index++

      let entryValue: string
      if (inner[index] === '"') {
         const parsed = parseQuotedScalar(inner, index)
         entryValue = parsed.value
         index = parsed.end
      } else {
         const commaIndex = inner.indexOf(',', index)
         const end = commaIndex === -1 ? inner.length : commaIndex
         entryValue = inner.slice(index, end).trim()
         index = end
      }

      if (key === 'value')    result.value    = entryValue
      else if (key === 'position')  result.position  = entryValue
      else if (key === 'color')     result.color     = entryValue
      else if (key === 'showLabel') result.showLabel = entryValue
   }
   return result
}

/** Parse one `key: value` front-matter line into its (possibly quoted) key + value, or null. */
function parseFrontMatterEntry(line: string): { key: string; value: string } | null {
   let index = 0
   while (index < line.length && line[index] === ' ') index++
   if (index >= line.length) return null

   let key: string
   if (line[index] === '"') {
      const parsed = parseQuotedScalar(line, index)
      key   = parsed.value
      index = parsed.end
      while (index < line.length && line[index] === ' ') index++
      if (line[index] !== ':') return null
      index++
   } else {
      const colonIndex = line.indexOf(':', index)
      if (colonIndex === -1) return null
      key   = line.slice(index, colonIndex).trim()
      index = colonIndex + 1
   }

   while (index < line.length && line[index] === ' ') index++
   const value = index < line.length && line[index] === '"'
      ? parseQuotedScalar(line, index).value
      : line.slice(index).trim()
   return { key, value }
}

/** Resolves a ratio shorthand or explicit leftPct|rightPct token to a 0–1 fraction. */
function parseRatioToken(token: string): number {
   switch (token) {
      case '':   return 0.5
      case '2':  return 0.5
      case '3':  return 1 / 3
      case '4':  return 0.25
      case '-3': return 2 / 3
      case '-4': return 0.75
      default: {
         const pipeIndex = token.indexOf('|')
         if (pipeIndex !== -1) {
            const left = parseInt(token.slice(0, pipeIndex), 10)
            if (!isNaN(left)) return left / 100
         }
         return 0.5
      }
   }
}

/** Builds a callout Block from stripped blockquote lines (leading `> ` already removed). */
function parseCalloutLines(strippedLines: string[]): Block {
   const STYLE_MAP: Record<string, CalloutStyle> = {
      i: 'info', info: 'info',
      w: 'warning', warning: 'warning',
      v: 'valid', valid: 'valid',
      d: 'danger', danger: 'danger',
   }

   const first    = strippedLines[0] ?? ''
   // Accepts either a preset style token or a `#rgb`/`#rrggbb` hex; the hex can carry inline
   // content after it on the same line, same as the style tokens do.
   const tagMatch = first.match(/^\[(i|info|w|warning|v|valid|d|danger|#[0-9a-fA-F]{1,8})\]\s*(.*)/i)

   let style: CalloutStyle = 'info'
   let calloutColor: string | undefined
   let contentLines: string[]

   if (tagMatch) {
      const tag = tagMatch[1]
      // A malformed hex (wrong digit count) leaves calloutColor unset, falls back to the
      // 'info' preset, while the tag is still consumed rather than left as literal content.
      if (tag.startsWith('#')) calloutColor = sanitizeCalloutHex(tag)
      else style = STYLE_MAP[tag.toLowerCase()]
      const restOfFirstLine = tagMatch[2]
      contentLines = restOfFirstLine.length > 0
         ? [restOfFirstLine, ...strippedLines.slice(1)]
         : strippedLines.slice(1)
   } else {
      contentLines = strippedLines
   }

   return {
      id:       crypto.randomUUID(),
      type:     'callout',
      style,
      ...(calloutColor ? { calloutColor } : {}),
      richText: mintdownToInlineContent(contentLines.join('\n')),
   }
}

/**
 * Body scanner for container column content.
 * Same logic as the main body scan in mintdownToDocument but without section
 * detection and without nested container detection (Mintdown does not allow them).
 */
function parseBodyBlocks(lines: string[]): Block[] {
   const blocks: Block[] = []

   let pendingHandle:     string | null = null
   let pendingImageBlock: Block  | null = null

   type AccumKind = 'p' | 'blockquote' | 'list' | 'checklist' | 'table'
   let accumKind:  AccumKind | null = null
   let accumLines: string[]         = []

   let inCodeFence  = false
   let fenceMark    = ''
   let fenceInfo    = ''
   let codeLines:   string[] = []

   function flushAccum(): Block | null {
      const kind = accumKind
      accumKind  = null
      if (accumLines.length === 0) return null
      const capturedLines = accumLines
      accumLines = []

      switch (kind) {
         case 'p':
            return {
               id:       crypto.randomUUID(),
               type:     'p',
               richText: mintdownToInlineContent(capturedLines.join('\n')),
            }
         case 'blockquote':
            return parseCalloutLines(capturedLines.map(line => line.replace(/^> ?/, '')))
         case 'list':
            return { id: crypto.randomUUID(), type: 'list', items: buildListTree(capturedLines) }
         case 'checklist':
            return { id: crypto.randomUUID(), type: 'checklist', items: buildListTree(capturedLines, true) }
         case 'table':
            return buildTableBlock(capturedLines)
         default:
            return null
      }
   }

   function commitBlock(block: Block | null): void {
      if (!block) return
      if (pendingHandle && !block.handle) block.handle = pendingHandle
      pendingHandle = null
      blocks.push(block)
      pendingImageBlock = block.type === 'image' ? block : null
   }

   function startAccum(kind: AccumKind, firstLine: string): void {
      commitBlock(flushAccum())
      accumKind  = kind
      accumLines = [firstLine]
      pendingImageBlock = null
   }

   let index = 0
   while (index < lines.length) {
      const line = lines[index]
      index++

      // Inside code fence
      if (inCodeFence) {
         if (/^`+\s*$/.test(line) && line.trim().length >= fenceMark.length) {
            commitBlock(buildFenceBlock(fenceInfo, codeLines.join('\n')))
            inCodeFence = false; fenceMark = ''; fenceInfo = ''; codeLines = []
         } else {
            codeLines.push(line)
         }
         continue
      }

      // h4 heading (check before h3)
      const h4Match = line.match(/^#### (.*)$/)
      if (h4Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h4', richText: mintdownToInlineContent(h4Match[1].trim()) })
         continue
      }

      // h3 heading
      const h3Match = line.match(/^### (.*)$/)
      if (h3Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h3', richText: mintdownToInlineContent(h3Match[1].trim()) })
         continue
      }

      // Opening code fence
      // Group 2 captures the whole info string (lang tag plus any attributes such as the
      // math block's `scale=`), trimmed of surrounding whitespace.
      const fenceOpenMatch = line.match(/^(`{3,})\s*(.*?)\s*$/)
      if (fenceOpenMatch) {
         commitBlock(flushAccum())
         inCodeFence = true; fenceMark = fenceOpenMatch[1]; fenceInfo = fenceOpenMatch[2]; codeLines = []
         pendingImageBlock = null
         continue
      }

      // Blockquote / callout
      if (line.startsWith('> ') || line === '>') {
         if ((accumKind as AccumKind | null) === 'blockquote') {
            accumLines.push(line)
         } else {
            startAccum('blockquote', line)
         }
         continue
      }

      // Handle anchor
      const handleMatch = line.match(/^\^([a-z0-9-]+)\s*$/)
      if (handleMatch) {
         commitBlock(flushAccum())
         pendingHandle     = handleMatch[1]
         pendingImageBlock = null
         continue
      }

      // List item, or GFM task-list item (checklist). The checkbox marker selects which.
      if (/^\s*- /.test(line)) {
         const kind: AccumKind = /^\s*- \[[ xX]\] /.test(line) ? 'checklist' : 'list'
         if ((accumKind as AccumKind | null) === kind) {
            accumLines.push(line)
         } else {
            startAccum(kind, line)
         }
         continue
      }

      // Pipe table
      if (line.startsWith('|')) {
         if ((accumKind as AccumKind | null) === 'table') {
            accumLines.push(line)
         } else {
            startAccum('table', line)
         }
         continue
      }

      // HR block
      if (line === '---') {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'hr' })
         pendingImageBlock = null
         continue
      }

      // Image (URL form)
      const imageAMatch = line.match(/^!\[([^\]]*)\]\(([^)]*)\)/)
      if (imageAMatch) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'image', alt: imageAMatch[1], src: imageAMatch[2] })
         continue
      }

      // HTML comments (image metadata round-trip)
      if (line.startsWith('<!--')) {
         const captionTarget = pendingImageBlock as Block | null
         const captionMatch  = line.match(/^<!-- image-caption: (.+) -->$/)
         if (captionMatch && captionTarget !== null) { captionTarget.caption = captionMatch[1]; continue }

         const attrsTarget = pendingImageBlock as Block | null
         const attrsMatch  = line.match(/^<!-- image-attrs: (.+) -->$/)
         if (attrsMatch && attrsTarget !== null) {
            const attrsStr   = attrsMatch[1]
            const alignMatch = attrsStr.match(/align="(left|center|right)"/)
            const hgtMatch   = attrsStr.match(/height=(\d+)/)
            if (alignMatch) attrsTarget.align       = alignMatch[1] as 'left' | 'center' | 'right'
            if (hgtMatch)   attrsTarget.imageHeight = parseInt(hgtMatch[1], 10)
            continue
         }

         const imageBMatch = line.match(/^<!-- image: (.+) -->$/)
         if (imageBMatch) {
            commitBlock(flushAccum())
            const attrsStr  = imageBMatch[1]
            const altMatch  = attrsStr.match(/alt="([^"]*)"/)
            const capMatch  = attrsStr.match(/caption="([^"]*)"/)
            const algMatch  = attrsStr.match(/align="(left|center|right)"/)
            const hgtMatch  = attrsStr.match(/height=(\d+)/)
            const block: Block = {
               id:   crypto.randomUUID(),
               type: 'image',
               alt:  altMatch ? altMatch[1] : '',
               ...(capMatch && { caption:     capMatch[1] }),
               ...(algMatch && { align:       algMatch[1] as 'left' | 'center' | 'right' }),
               ...(hgtMatch && { imageHeight: parseInt(hgtMatch[1], 10) }),
            }
            commitBlock(block)
         }
         continue
      }

      // Blank line
      if (line.trim() === '') {
         if (accumKind !== null) commitBlock(flushAccum())
         pendingImageBlock = null
         continue
      }

      // Default: paragraph
      if (accumKind === 'p') {
         accumLines.push(line)
      } else {
         commitBlock(flushAccum())
         accumKind  = 'p'
         accumLines = [line]
         pendingImageBlock = null
      }
   }

   commitBlock(flushAccum())

   if (inCodeFence && codeLines.length > 0) {
      commitBlock(buildFenceBlock(fenceInfo, codeLines.join('\n')))
   }

   return blocks
}

// ###################################
// # PRIVATE HELPERS, SERIALISATION #
// ###################################

/** Serialises a callout block in Mintdown format (`> [style]` not `> [!style]`). A custom hex
 *  overrides the preset style token entirely (`> [#ff8800]`). */
function serializeCallout(block: Block): string {
   const tag     = block.calloutColor ?? (block.style ?? 'info')
   const content = inlineContentToMintdown(block.richText ?? [])
   const trimmed = content.replace(/\n+$/, '')

   if (trimmed.length === 0) return `> [${tag}]`

   const contentLines = trimmed.split('\n')
   const lines = [`> [${tag}] ${contentLines[0]}`, ...contentLines.slice(1).map(line => `> ${line}`)]
   return lines.join('\n')
}

/**
 * Serialises a single block for use inside a container column.
 * Handles callouts directly; delegates the rest to serializeBlock with
 * handle-clearing for h3/h4 (handle emitted as `^handle` by the caller).
 */
function serializeInnerBlock(block: Block): string {
   if (block.type === 'callout') return serializeCallout(block)
   if ((block.type === 'h3' || block.type === 'h4') && block.handle) {
      return serializeBlock({ ...block, handle: undefined }, { mintdown: true })
   }
   return serializeBlock(block, { mintdown: true })
}

/**
 * Serialises a top-level block for documentToMintdown.
 * Handles callouts and containers directly; delegates all other types to
 * serializeBlock, clearing h3/h4 handles first to avoid `{#slug}` double-emission.
 */
function serializeTopLevelBlock(block: Block): string {
   if (block.type === 'callout') return serializeCallout(block)

   if (block.type === 'container') {
      const leftPct  = Math.round((block.ratio ?? 0.5) * 100)
      const rightPct = 100 - leftPct
      const parts: string[] = [`{${leftPct}|${rightPct}`]

      for (const innerBlock of block.left ?? []) {
         parts.push('')
         if (innerBlock.handle) parts.push(`^${innerBlock.handle}`)
         const serialized = serializeInnerBlock(innerBlock)
         if (serialized.length > 0) parts.push(serialized)
      }

      parts.push('')
      parts.push('---')

      for (const innerBlock of block.right ?? []) {
         parts.push('')
         if (innerBlock.handle) parts.push(`^${innerBlock.handle}`)
         const serialized = serializeInnerBlock(innerBlock)
         if (serialized.length > 0) parts.push(serialized)
      }

      parts.push('')
      parts.push('}')
      return parts.join('\n')
   }

   if ((block.type === 'h3' || block.type === 'h4') && block.handle) {
      return serializeBlock({ ...block, handle: undefined }, { mintdown: true })
   }

   return serializeBlock(block, { mintdown: true })
}

// ###################################
// # PUBLIC API, DOCUMENTTOMINTDOWN #
// ###################################

/**
 * Serialises the full document state to a UTF-8 Mintdown string.
 * Pure. No side effects. Deterministic.
 */
export function documentToMintdown(sections: Section[], meta: DocMeta): string {
   const parts: string[] = []

   // ==================
   //  YAML front matter
   // ==================
   // title stays first-class; each freeform field is keyed by its label, in order. A plain
   // below-title field with no color stays a simple `Label: value` scalar; a field with a
   // non-default position or a color is emitted as an inline mapping carrying those extras.
   // Empty-label fields can't be a key, so they are skipped (they don't survive serialization).
   parts.push('---')
   parts.push(`title: ${yamlQuoteScalar(meta.title)}`)
   for (const field of meta.fields) {
      if (field.label.trim() === '') continue
      const key = yamlQuoteScalar(field.label)
      const isPlain = field.position === 'below' && field.color === undefined && field.showLabel !== false
      if (isPlain) {
         parts.push(`${key}: ${yamlQuoteScalar(field.value)}`)
      } else {
         const mappingParts = [`value: ${yamlQuoteScalar(field.value)}`]
         if (field.position === 'above')     mappingParts.push('position: above')
         if (field.color !== undefined)       mappingParts.push(`color: ${yamlQuoteScalar(field.color)}`)
         if (field.showLabel === false)       mappingParts.push('showLabel: false')
         parts.push(`${key}: { ${mappingParts.join(', ')} }`)
      }
   }
   parts.push('---')

   // =========
   //  Sections
   // =========
   for (const section of sections) {
      parts.push('')
      parts.push(`## ${section.title}`)

      for (const block of section.blocks) {
         parts.push('')
         if (block.handle) parts.push(`^${block.handle}`)
         const serialized = serializeTopLevelBlock(block)
         if (serialized.length > 0) parts.push(serialized)
      }
   }

   return parts.join('\n') + '\n'
}

// ###################################
// # PUBLIC API, MINTDOWNTODOCUMENT #
// ###################################

/**
 * Parses a Mintdown string into document state.
 * Pure. No side effects. Never throws. Deterministic.
 * Always returns a fully-formed { sections, meta } regardless of input quality.
 */
export function mintdownToDocument(source: string): { sections: Section[], meta: DocMeta } {
   const lines = source.split('\n')
   const meta: DocMeta = { title: '', fields: [] }
   const sections: Section[] = []

   let lineIndex = 0

   // ======================
   //  Phase 1: Front matter
   // ======================

   while (lineIndex < lines.length && lines[lineIndex].trim() === '') lineIndex++

   if (lineIndex < lines.length && lines[lineIndex] === '---') {
      lineIndex++ // skip opening ---
      while (lineIndex < lines.length && lines[lineIndex] !== '---') {
         const fmLine = lines[lineIndex]
         lineIndex++
         const entry = parseFrontMatterEntry(fmLine)
         if (!entry) continue
         if (entry.key.toLowerCase() === 'title') { meta.title = entry.value; continue }
         // A brace-wrapped value carries position + color; a bare scalar is a plain below field.
         const mapping = parseFieldMapping(entry.value)
         if (mapping) {
            meta.fields.push({
               id:       crypto.randomUUID(),
               label:    entry.key,
               value:    mapping.value,
               position: mapping.position === 'above' ? 'above' : 'below',
               ...(mapping.color !== '' ? { color: mapping.color } : {}),
               ...(mapping.showLabel === 'false' ? { showLabel: false } : {}),
            })
         } else {
            meta.fields.push({ id: crypto.randomUUID(), label: entry.key, value: entry.value, position: 'below' })
         }
      }
      if (lineIndex < lines.length) lineIndex++ // skip closing ---
   } else {
      // Legacy inline format fallback (`.md` import compatibility)
      while (lineIndex < lines.length) {
         const line = lines[lineIndex]
         if (line === '---' || /^## /.test(line)) break
         lineIndex++

         const titleMatch = line.match(/^# (.*)$/)
         if (titleMatch) { meta.title = titleMatch[1].trim(); continue }

         const fieldMatch = line.match(/^\*\*(.+?):\*\*\s?(.*)$/)
         if (fieldMatch) {
            meta.fields.push({ id: crypto.randomUUID(), label: fieldMatch[1].trim(), value: fieldMatch[2], position: 'below' })
         }
      }
      if (lineIndex < lines.length && lines[lineIndex] === '---') lineIndex++
   }

   // ===================
   //  Phase 2: Body scan
   // ===================

   let currentSection:    Section | null = null
   let pendingHandle:     string  | null = null
   let pendingImageBlock: Block   | null = null

   type AccumKind = 'p' | 'blockquote' | 'list' | 'checklist' | 'table'
   let accumKind:  AccumKind | null = null
   let accumLines: string[]         = []

   let inCodeFence   = false
   let fenceMark     = ''
   let fenceInfo     = ''
   let codeLines:    string[] = []

   let inContainer     = false
   let containerLines: string[] = []
   let containerRatio  = 0.5

   // ==========================
   //  Accumulator flush helpers
   // ==========================

   function flushAccum(): Block | null {
      const kind = accumKind
      accumKind  = null
      if (accumLines.length === 0) return null
      const capturedLines = accumLines
      accumLines = []

      switch (kind) {
         case 'p':
            return {
               id:       crypto.randomUUID(),
               type:     'p',
               richText: mintdownToInlineContent(capturedLines.join('\n')),
            }
         case 'blockquote':
            return parseCalloutLines(capturedLines.map(line => line.replace(/^> ?/, '')))
         case 'list':
            return { id: crypto.randomUUID(), type: 'list', items: buildListTree(capturedLines) }
         case 'checklist':
            return { id: crypto.randomUUID(), type: 'checklist', items: buildListTree(capturedLines, true) }
         case 'table':
            return buildTableBlock(capturedLines)
         default:
            return null
      }
   }

   function commitBlock(block: Block | null): void {
      if (!block) return
      if (pendingHandle && !block.handle) block.handle = pendingHandle
      pendingHandle = null
      if (!currentSection) { pendingImageBlock = null; return }
      currentSection.blocks.push(block)
      pendingImageBlock = block.type === 'image' ? block : null
   }

   function startAccum(kind: AccumKind, firstLine: string): void {
      commitBlock(flushAccum())
      accumKind  = kind
      accumLines = [firstLine]
      pendingImageBlock = null
   }

   // ===============
   //  Main scan loop
   // ===============

   while (lineIndex < lines.length) {
      const line = lines[lineIndex]
      lineIndex++

      // Inside code fence
      if (inCodeFence) {
         if (/^`+\s*$/.test(line) && line.trim().length >= fenceMark.length) {
            commitBlock(buildFenceBlock(fenceInfo, codeLines.join('\n')))
            inCodeFence = false; fenceMark = ''; fenceInfo = ''; codeLines = []
         } else {
            codeLines.push(line)
         }
         continue
      }

      // Inside container collection
      if (inContainer) {
         if (line === '}') {
            const sepIndex    = containerLines.findIndex(collected => collected === '---')
            const leftLines   = sepIndex === -1 ? containerLines : containerLines.slice(0, sepIndex)
            const rightLines  = sepIndex === -1 ? [] : containerLines.slice(sepIndex + 1)
            commitBlock({
               id:    crypto.randomUUID(),
               type:  'container',
               ratio: containerRatio,
               left:  parseBodyBlocks(leftLines),
               right: parseBodyBlocks(rightLines),
            })
            inContainer    = false
            containerLines = []
            containerRatio = 0.5
         } else {
            containerLines.push(line)
         }
         continue
      }

      // Section boundary: ## heading
      const sectionMatch = line.match(/^## (.*)$/)
      if (sectionMatch) {
         commitBlock(flushAccum())
         pendingHandle     = null
         pendingImageBlock = null
         currentSection    = {
            id:        crypto.randomUUID(),
            title:     sectionMatch[1].trim(),
            collapsed: false,
            blocks:    [],
         }
         sections.push(currentSection)
         continue
      }

      // h4 heading (check before h3)
      const h4Match = line.match(/^#### (.*)$/)
      if (h4Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h4', richText: mintdownToInlineContent(h4Match[1].trim()) })
         continue
      }

      // h3 heading
      const h3Match = line.match(/^### (.*)$/)
      if (h3Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h3', richText: mintdownToInlineContent(h3Match[1].trim()) })
         continue
      }

      // Opening code fence
      // Group 2 captures the whole info string (lang tag plus any attributes such as the
      // math block's `scale=`), trimmed of surrounding whitespace.
      const fenceOpenMatch = line.match(/^(`{3,})\s*(.*?)\s*$/)
      if (fenceOpenMatch) {
         commitBlock(flushAccum())
         inCodeFence = true; fenceMark = fenceOpenMatch[1]; fenceInfo = fenceOpenMatch[2]; codeLines = []
         pendingImageBlock = null
         continue
      }

      // Blockquote / callout
      if (line.startsWith('> ') || line === '>') {
         if ((accumKind as AccumKind | null) === 'blockquote') {
            accumLines.push(line)
         } else {
            startAccum('blockquote', line)
         }
         continue
      }

      // Handle anchor
      const handleMatch = line.match(/^\^([a-z0-9-]+)\s*$/)
      if (handleMatch) {
         commitBlock(flushAccum())
         pendingHandle     = handleMatch[1]
         pendingImageBlock = null
         continue
      }

      // List item, or GFM task-list item (checklist). The checkbox marker selects which.
      if (/^\s*- /.test(line)) {
         const kind: AccumKind = /^\s*- \[[ xX]\] /.test(line) ? 'checklist' : 'list'
         if ((accumKind as AccumKind | null) === kind) {
            accumLines.push(line)
         } else {
            startAccum(kind, line)
         }
         continue
      }

      // Pipe table
      if (line.startsWith('|')) {
         if ((accumKind as AccumKind | null) === 'table') {
            accumLines.push(line)
         } else {
            startAccum('table', line)
         }
         continue
      }

      // HR block
      if (line === '---') {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'hr' })
         pendingImageBlock = null
         continue
      }

      // Multi-line container opener
      // Matches `{` optionally followed by a ratio token and nothing else.
      // e.g. `{`, `{2`, `{-3`, `{60|40`, but NOT `{some prose text`
      const containerOpenMatch = line.match(/^\{(2|3|4|-3|-4|\d+\|\d+)?\s*$/)
      if (containerOpenMatch) {
         commitBlock(flushAccum())
         containerRatio  = parseRatioToken(containerOpenMatch[1] ?? '')
         inContainer     = true
         containerLines  = []
         pendingImageBlock = null
         continue
      }

      // Single-line container
      // e.g. `{2: Left content | Right content}` or `{60|40: Left | Right}`
      const singleLineMatch = line.match(/^\{([^:]*?):\s*(.*)\}$/)
      if (singleLineMatch) {
         commitBlock(flushAccum())
         const ratio     = parseRatioToken(singleLineMatch[1].trim())
         const content   = singleLineMatch[2]
         const pipeIndex = content.indexOf(' | ')
         const leftText  = pipeIndex === -1 ? content : content.slice(0, pipeIndex)
         const rightText = pipeIndex === -1 ? '' : content.slice(pipeIndex + 3)
         commitBlock({
            id:    crypto.randomUUID(),
            type:  'container',
            ratio,
            left:  [{ id: crypto.randomUUID(), type: 'p', richText: mintdownToInlineContent(leftText) }],
            right: [{ id: crypto.randomUUID(), type: 'p', richText: mintdownToInlineContent(rightText) }],
         })
         pendingImageBlock = null
         continue
      }

      // Image (URL form)
      const imageAMatch = line.match(/^!\[([^\]]*)\]\(([^)]*)\)/)
      if (imageAMatch) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'image', alt: imageAMatch[1], src: imageAMatch[2] })
         continue
      }

      // HTML comments (image metadata round-trip)
      if (line.startsWith('<!--')) {
         const captionTarget = pendingImageBlock as Block | null
         const captionMatch  = line.match(/^<!-- image-caption: (.+) -->$/)
         if (captionMatch && captionTarget !== null) { captionTarget.caption = captionMatch[1]; continue }

         const attrsTarget = pendingImageBlock as Block | null
         const attrsMatch  = line.match(/^<!-- image-attrs: (.+) -->$/)
         if (attrsMatch && attrsTarget !== null) {
            const attrsStr   = attrsMatch[1]
            const alignMatch = attrsStr.match(/align="(left|center|right)"/)
            const hgtMatch   = attrsStr.match(/height=(\d+)/)
            if (alignMatch) attrsTarget.align       = alignMatch[1] as 'left' | 'center' | 'right'
            if (hgtMatch)   attrsTarget.imageHeight = parseInt(hgtMatch[1], 10)
            continue
         }

         const imageBMatch = line.match(/^<!-- image: (.+) -->$/)
         if (imageBMatch) {
            commitBlock(flushAccum())
            const attrsStr  = imageBMatch[1]
            const altMatch  = attrsStr.match(/alt="([^"]*)"/)
            const capMatch  = attrsStr.match(/caption="([^"]*)"/)
            const algMatch  = attrsStr.match(/align="(left|center|right)"/)
            const hgtMatch  = attrsStr.match(/height=(\d+)/)
            const block: Block = {
               id:   crypto.randomUUID(),
               type: 'image',
               alt:  altMatch ? altMatch[1] : '',
               ...(capMatch && { caption:     capMatch[1] }),
               ...(algMatch && { align:       algMatch[1] as 'left' | 'center' | 'right' }),
               ...(hgtMatch && { imageHeight: parseInt(hgtMatch[1], 10) }),
            }
            commitBlock(block)
         }
         continue
      }

      // Blank line
      if (line.trim() === '') {
         if (accumKind !== null) commitBlock(flushAccum())
         pendingImageBlock = null
         continue
      }

      // Default: paragraph
      if (accumKind === 'p') {
         accumLines.push(line)
      } else {
         commitBlock(flushAccum())
         accumKind  = 'p'
         accumLines = [line]
         pendingImageBlock = null
      }
   }

   // ==================
   //  End-of-file flush
   // ==================
   commitBlock(flushAccum())

   if (inCodeFence && codeLines.length > 0) {
      commitBlock(buildFenceBlock(fenceInfo, codeLines.join('\n')))
   }

   // Unclosed container at end of file: discarded per spec (no partial block emitted)

   return { sections, meta }
}

// ########################################################
// # PUBLIC API, IMPORTMINTDOWNFILE / EXPORTMINTDOWNFILE #
// ########################################################

/**
 * Reads a .mint File object and parses it into document state.
 * Thin async wrapper, all parsing logic lives in mintdownToDocument.
 */
export async function importMintdownFile(
   file: File,
): Promise<{ sections: Section[], meta: DocMeta }> {
   const source = await file.text()
   return mintdownToDocument(source)
}

/**
 * Serialises the document and triggers a browser file download of the .mint content (Documint's
 * native format; the Open picker also still accepts legacy .mintd / .mintdown for backward compat).
 */
export function exportMintdownFile(sections: Section[], meta: DocMeta): void {
   const content  = documentToMintdown(sections, meta)
   const filename = `${slugify(meta.title) || 'document'}.mint`
   const blob     = new Blob([content], { type: 'text/plain;charset=utf-8' })
   const url      = URL.createObjectURL(blob)
   const anchor   = document.createElement('a')
   anchor.href     = url
   anchor.download = filename
   anchor.click()
   URL.revokeObjectURL(url)
}

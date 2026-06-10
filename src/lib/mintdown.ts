import type { Block, CalloutStyle, CodeLang, DocMeta, Section } from '../types'
import { serializeBlock, buildListTree, buildTableBlock } from './markdown'
import { inlineContentToMintdown, mintdownToInlineContent } from './inline'
import { slugify } from './text'

// ############################################################
// Constants
// ############################################################

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

// ############################################################
// Private helpers
// ############################################################

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
   const tagMatch = first.match(/^\[(i|info|w|warning|v|valid|d|danger)\]\s*(.*)/i)

   let style: CalloutStyle = 'info'
   let contentLines: string[]

   if (tagMatch) {
      style = STYLE_MAP[tagMatch[1].toLowerCase()]
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

   type AccumKind = 'p' | 'blockquote' | 'list' | 'table'
   let accumKind:  AccumKind | null = null
   let accumLines: string[]         = []

   let inCodeFence  = false
   let fenceMark    = ''
   let fenceLangTag = ''
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

      // ── Inside code fence ─────────────────────────────────
      if (inCodeFence) {
         if (/^`+\s*$/.test(line) && line.trim().length >= fenceMark.length) {
            const lang: CodeLang = FENCE_TO_CODE_LANG[fenceLangTag.toLowerCase()] ?? 'plain'
            commitBlock({ id: crypto.randomUUID(), type: 'code', lang, code: codeLines.join('\n') })
            inCodeFence = false; fenceMark = ''; fenceLangTag = ''; codeLines = []
         } else {
            codeLines.push(line)
         }
         continue
      }

      // ── h4 heading (check before h3) ─────────────────────
      const h4Match = line.match(/^#### (.*)$/)
      if (h4Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h4', richText: mintdownToInlineContent(h4Match[1].trim()) })
         continue
      }

      // ── h3 heading ───────────────────────────────────────
      const h3Match = line.match(/^### (.*)$/)
      if (h3Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h3', richText: mintdownToInlineContent(h3Match[1].trim()) })
         continue
      }

      // ── Opening code fence ───────────────────────────────
      const fenceOpenMatch = line.match(/^(`{3,})\s*(\S*)\s*$/)
      if (fenceOpenMatch) {
         commitBlock(flushAccum())
         inCodeFence = true; fenceMark = fenceOpenMatch[1]; fenceLangTag = fenceOpenMatch[2]; codeLines = []
         pendingImageBlock = null
         continue
      }

      // ── Blockquote / callout ─────────────────────────────
      if (line.startsWith('> ') || line === '>') {
         if ((accumKind as AccumKind | null) === 'blockquote') {
            accumLines.push(line)
         } else {
            startAccum('blockquote', line)
         }
         continue
      }

      // ── Handle anchor ────────────────────────────────────
      const handleMatch = line.match(/^\^([a-z0-9-]+)\s*$/)
      if (handleMatch) {
         commitBlock(flushAccum())
         pendingHandle     = handleMatch[1]
         pendingImageBlock = null
         continue
      }

      // ── List item ────────────────────────────────────────
      if (/^\s*- /.test(line)) {
         if ((accumKind as AccumKind | null) === 'list') {
            accumLines.push(line)
         } else {
            startAccum('list', line)
         }
         continue
      }

      // ── Pipe table ───────────────────────────────────────
      if (line.startsWith('|')) {
         if ((accumKind as AccumKind | null) === 'table') {
            accumLines.push(line)
         } else {
            startAccum('table', line)
         }
         continue
      }

      // ── HR block ─────────────────────────────────────────
      if (line === '---') {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'hr' })
         pendingImageBlock = null
         continue
      }

      // ── Image (URL form) ─────────────────────────────────
      const imageAMatch = line.match(/^!\[([^\]]*)\]\(([^)]*)\)/)
      if (imageAMatch) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'image', alt: imageAMatch[1], src: imageAMatch[2] })
         continue
      }

      // ── HTML comments (image metadata round-trip) ─────────
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

      // ── Blank line ────────────────────────────────────────
      if (line.trim() === '') {
         if (accumKind !== null) commitBlock(flushAccum())
         pendingImageBlock = null
         continue
      }

      // ── Default: paragraph ───────────────────────────────
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
      commitBlock({
         id:   crypto.randomUUID(),
         type: 'code',
         lang: FENCE_TO_CODE_LANG[fenceLangTag.toLowerCase()] ?? 'plain',
         code: codeLines.join('\n'),
      })
   }

   return blocks
}

// ############################################################
// Private helpers — serialisation
// ############################################################

/** Serialises a callout block in Mintdown format (`> [style]` not `> [!style]`). */
function serializeCallout(block: Block): string {
   const style   = block.style ?? 'info'
   const content = inlineContentToMintdown(block.richText ?? [])
   const trimmed = content.replace(/\n+$/, '')

   if (trimmed.length === 0) return `> [${style}]`

   const contentLines = trimmed.split('\n')
   const lines = [`> [${style}] ${contentLines[0]}`, ...contentLines.slice(1).map(line => `> ${line}`)]
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
      return serializeBlock({ ...block, handle: undefined })
   }
   return serializeBlock(block)
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
      return serializeBlock({ ...block, handle: undefined })
   }

   return serializeBlock(block)
}

// ############################################################
// Public API — documentToMintdown
// ############################################################

/**
 * Serialises the full document state to a UTF-8 Mintdown string.
 * Pure. No side effects. Deterministic.
 */
export function documentToMintdown(sections: Section[], meta: DocMeta): string {
   const parts: string[] = []

   // ── YAML front matter ────────────────────────────────────
   parts.push('---')
   parts.push(`title: ${meta.title}`)
   parts.push(`module: ${meta.module}`)
   parts.push(`environment: ${meta.env}`)
   parts.push(`date: ${meta.date}`)
   parts.push(`author: ${meta.author}`)
   parts.push('---')

   // ── Sections ─────────────────────────────────────────────
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

// ############################################################
// Public API — mintdownToDocument
// ############################################################

/**
 * Parses a Mintdown string into document state.
 * Pure. No side effects. Never throws. Deterministic.
 * Always returns a fully-formed { sections, meta } regardless of input quality.
 */
export function mintdownToDocument(source: string): { sections: Section[], meta: DocMeta } {
   const lines = source.split('\n')
   const meta: DocMeta = { title: '', module: '', env: '', date: '', author: '' }
   const sections: Section[] = []

   let lineIndex = 0

   // ── Phase 1: Front matter ─────────────────────────────────

   while (lineIndex < lines.length && lines[lineIndex].trim() === '') lineIndex++

   if (lineIndex < lines.length && lines[lineIndex] === '---') {
      lineIndex++ // skip opening ---
      while (lineIndex < lines.length && lines[lineIndex] !== '---') {
         const fmLine     = lines[lineIndex]
         lineIndex++
         const colonIndex = fmLine.indexOf(':')
         if (colonIndex === -1) continue
         const key   = fmLine.slice(0, colonIndex).trim().toLowerCase()
         const value = fmLine.slice(colonIndex + 1).trim()
         switch (key) {
            case 'title':       meta.title  = value; break
            case 'module':      meta.module = value; break
            case 'environment': meta.env    = value; break
            case 'date':        meta.date   = value; break
            case 'author':      meta.author = value; break
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

         const fieldMatch = line.match(/^\*\*(\w+):\*\*\s*(.*)$/)
         if (fieldMatch) {
            const key   = fieldMatch[1].toLowerCase()
            const value = fieldMatch[2]
            switch (key) {
               case 'module':       meta.module = value; break
               case 'environment':
               case 'env':          meta.env    = value; break
               case 'date':         meta.date   = value; break
               case 'author':       meta.author = value; break
            }
         }
      }
      if (lineIndex < lines.length && lines[lineIndex] === '---') lineIndex++
   }

   // ── Phase 2: Body scan ────────────────────────────────────

   let currentSection:    Section | null = null
   let pendingHandle:     string  | null = null
   let pendingImageBlock: Block   | null = null

   type AccumKind = 'p' | 'blockquote' | 'list' | 'table'
   let accumKind:  AccumKind | null = null
   let accumLines: string[]         = []

   let inCodeFence   = false
   let fenceMark     = ''
   let fenceLangTag  = ''
   let codeLines:    string[] = []

   let inContainer     = false
   let containerLines: string[] = []
   let containerRatio  = 0.5

   // ── Accumulator flush helpers ────────────────────────────

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

   // ── Main scan loop ────────────────────────────────────────

   while (lineIndex < lines.length) {
      const line = lines[lineIndex]
      lineIndex++

      // ── Inside code fence ─────────────────────────────────
      if (inCodeFence) {
         if (/^`+\s*$/.test(line) && line.trim().length >= fenceMark.length) {
            const lang: CodeLang = FENCE_TO_CODE_LANG[fenceLangTag.toLowerCase()] ?? 'plain'
            commitBlock({ id: crypto.randomUUID(), type: 'code', lang, code: codeLines.join('\n') })
            inCodeFence = false; fenceMark = ''; fenceLangTag = ''; codeLines = []
         } else {
            codeLines.push(line)
         }
         continue
      }

      // ── Inside container collection ───────────────────────
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

      // ── Section boundary: ## heading ─────────────────────
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

      // ── h4 heading (check before h3) ─────────────────────
      const h4Match = line.match(/^#### (.*)$/)
      if (h4Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h4', richText: mintdownToInlineContent(h4Match[1].trim()) })
         continue
      }

      // ── h3 heading ───────────────────────────────────────
      const h3Match = line.match(/^### (.*)$/)
      if (h3Match) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'h3', richText: mintdownToInlineContent(h3Match[1].trim()) })
         continue
      }

      // ── Opening code fence ───────────────────────────────
      const fenceOpenMatch = line.match(/^(`{3,})\s*(\S*)\s*$/)
      if (fenceOpenMatch) {
         commitBlock(flushAccum())
         inCodeFence = true; fenceMark = fenceOpenMatch[1]; fenceLangTag = fenceOpenMatch[2]; codeLines = []
         pendingImageBlock = null
         continue
      }

      // ── Blockquote / callout ─────────────────────────────
      if (line.startsWith('> ') || line === '>') {
         if ((accumKind as AccumKind | null) === 'blockquote') {
            accumLines.push(line)
         } else {
            startAccum('blockquote', line)
         }
         continue
      }

      // ── Handle anchor ────────────────────────────────────
      const handleMatch = line.match(/^\^([a-z0-9-]+)\s*$/)
      if (handleMatch) {
         commitBlock(flushAccum())
         pendingHandle     = handleMatch[1]
         pendingImageBlock = null
         continue
      }

      // ── List item ────────────────────────────────────────
      if (/^\s*- /.test(line)) {
         if ((accumKind as AccumKind | null) === 'list') {
            accumLines.push(line)
         } else {
            startAccum('list', line)
         }
         continue
      }

      // ── Pipe table ───────────────────────────────────────
      if (line.startsWith('|')) {
         if ((accumKind as AccumKind | null) === 'table') {
            accumLines.push(line)
         } else {
            startAccum('table', line)
         }
         continue
      }

      // ── HR block ─────────────────────────────────────────
      if (line === '---') {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'hr' })
         pendingImageBlock = null
         continue
      }

      // ── Multi-line container opener ───────────────────────
      // Matches `{` optionally followed by a ratio token and nothing else.
      // e.g. `{`, `{2`, `{-3`, `{60|40` — but NOT `{some prose text`
      const containerOpenMatch = line.match(/^\{(2|3|4|-3|-4|\d+\|\d+)?\s*$/)
      if (containerOpenMatch) {
         commitBlock(flushAccum())
         containerRatio  = parseRatioToken(containerOpenMatch[1] ?? '')
         inContainer     = true
         containerLines  = []
         pendingImageBlock = null
         continue
      }

      // ── Single-line container ─────────────────────────────
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

      // ── Image (URL form) ─────────────────────────────────
      const imageAMatch = line.match(/^!\[([^\]]*)\]\(([^)]*)\)/)
      if (imageAMatch) {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'image', alt: imageAMatch[1], src: imageAMatch[2] })
         continue
      }

      // ── HTML comments (image metadata round-trip) ─────────
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

      // ── Blank line ────────────────────────────────────────
      if (line.trim() === '') {
         if (accumKind !== null) commitBlock(flushAccum())
         pendingImageBlock = null
         continue
      }

      // ── Default: paragraph ───────────────────────────────
      if (accumKind === 'p') {
         accumLines.push(line)
      } else {
         commitBlock(flushAccum())
         accumKind  = 'p'
         accumLines = [line]
         pendingImageBlock = null
      }
   }

   // ── End-of-file flush ─────────────────────────────────────
   commitBlock(flushAccum())

   if (inCodeFence && codeLines.length > 0) {
      commitBlock({
         id:   crypto.randomUUID(),
         type: 'code',
         lang: FENCE_TO_CODE_LANG[fenceLangTag.toLowerCase()] ?? 'plain',
         code: codeLines.join('\n'),
      })
   }

   // Unclosed container at end of file: discarded per spec (no partial block emitted)

   return { sections, meta }
}

// ############################################################
// Public API — importMintdownFile / exportMintdownFile
// ############################################################

/**
 * Reads a .mintd File object and parses it into document state.
 * Thin async wrapper — all parsing logic lives in mintdownToDocument.
 */
export async function importMintdownFile(
   file: File,
): Promise<{ sections: Section[], meta: DocMeta }> {
   const source = await file.text()
   return mintdownToDocument(source)
}

/**
 * Serialises the document and triggers a browser file download of the .mintd content.
 */
export function exportMintdownFile(sections: Section[], meta: DocMeta): void {
   const content  = documentToMintdown(sections, meta)
   const filename = `${slugify(meta.title) || 'document'}.mintd`
   const blob     = new Blob([content], { type: 'text/plain;charset=utf-8' })
   const url      = URL.createObjectURL(blob)
   const anchor   = document.createElement('a')
   anchor.href     = url
   anchor.download = filename
   anchor.click()
   URL.revokeObjectURL(url)
}

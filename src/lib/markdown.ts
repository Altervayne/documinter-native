import type { Block, CalloutStyle, CodeLang, DocMeta, InlineContent, ListItem, ListMarker, Section } from '../types'
import { ALL_LIST_MARKERS, markerOrDefault, isOrderedMarker } from './listMarkers'
import { inlineContentToMintdown, mintdownToInlineContent } from './inline'
import { parseMathScaleToken } from './mathScale'
import { graphSpecToFence, fenceToGraphSpec } from './graphFence'
import { diagramSpecToFence, fenceToDiagramSpec } from './diagramFence'
import { imageMarkupSpecToFence, fenceToImageMarkupSpec } from './imageMarkupFence'
import { imageBlockToMarkupSpec, markupSpecToImageBlock } from './imageMarkupBlock'
import { slugify } from './text'
import { saveTextFile } from './platform/fileTransfer'
import { sanitizeCalloutHex } from './calloutColor'

// #############
// # CONSTANTS #
// #############

/** Maps CodeLang values to the fence language tag used on export. */
const CODE_LANG_TO_FENCE: Record<CodeLang, string> = {
   windev:   'windev',
   js:       'javascript',
   ts:       'typescript',
   python:   'python',
   rust:     'rust',
   c:        'c',
   sql:      'sql',
   bash:     'bash',
   json:     'json',
   yaml:     'yaml',
   html:     'html',
   css:      'css',
   markdown: 'markdown',
   plain:    '',
}

/** Maps fence language tags (lower-cased) back to CodeLang on import. */
const FENCE_LANG_TO_CODE_LANG: Record<string, CodeLang> = {
   windev:     'windev',
   javascript: 'js',
   js:         'js',
   jsx:        'js',
   ts:         'ts',
   typescript: 'ts',
   tsx:        'ts',
   sql:        'sql',
   python:     'python',
   py:         'python',
   rust:       'rust',
   rs:         'rust',
   c:          'c',
   cpp:        'c',
   bash:       'bash',
   sh:         'bash',
   shell:      'bash',
   zsh:        'bash',
   json:       'json',
   yaml:       'yaml',
   yml:        'yaml',
   html:       'html',
   xml:        'html',
   css:        'css',
   scss:       'css',
   sass:       'css',
   markdown:   'markdown',
   md:         'markdown',
}

// ###################################
// # PRIVATE HELPERS, SERIALISATION #
// ###################################

function serializeInline(content: InlineContent | undefined): string {
   return inlineContentToMintdown(content ?? [])
}

/** Render list items recursively, two spaces per level. Checklist mode prefixes each with a GFM
 *  `[x]`/`[ ]` marker; otherwise `marker` is the sub-list's marker, ordered ones emitting `${n}. `
 *  and unordered `- `. Portable Markdown keeps only the ordered/unordered split; the alpha/roman
 *  refinement rides the JSON backup. */
function serializeListItems(
   items: ListItem[],
   depth: number,
   options: { checklist?: boolean; marker?: ListMarker },
): string {
   const { checklist = false, marker = 'dot' } = options
   const lines: string[] = []
   const indent = '  '.repeat(depth)
   const ordered = !checklist && isOrderedMarker(marker)
   items.forEach((item, index) => {
      const bullet = checklist
         ? `- [${item.checked ? 'x' : ' '}] `
         : ordered
            ? `${index + 1}. `
            : '- '
      lines.push(`${indent}${bullet}${serializeInline(item.richText)}`)
      if (item.children.length > 0) {
         const childMarker = checklist ? 'dot' : markerOrDefault(item.childMarker)
         lines.push(serializeListItems(item.children, depth + 1, { checklist, marker: childMarker }))
      }
   })
   return lines.join('\n')
}

/** Serialize one block to Markdown. h3/h4 handles are emitted inline as {#slug}; every other block's
 *  handle is emitted by the caller as a <!-- handle: slug --> comment before this output. */
export function serializeBlock(block: Block): string {
   switch (block.type) {
      case 'p': {
         return serializeInline(block.richText)
      }

      case 'h3': {
         const text   = serializeInline(block.richText)
         const suffix = block.handle ? ` {#${block.handle}}` : ''
         return `### ${text}${suffix}`
      }

      case 'h4': {
         const text   = serializeInline(block.richText)
         const suffix = block.handle ? ` {#${block.handle}}` : ''
         return `#### ${text}${suffix}`
      }

      case 'callout': {
         // A custom hex overrides the preset style token entirely (`> [!#ff8800]`); the
         // underlying `style` still defaults to 'info' when only a hex is present (see model).
         const tag     = block.calloutColor ?? (block.style ?? 'info')
         const content = serializeInline(block.richText)
         const trimmed = content.replace(/\n+$/, '')
         const contentLines = trimmed.length > 0 ? trimmed.split('\n') : []
         const lines = [`> [!${tag}]`, ...contentLines.map(line => `> ${line}`)]
         return lines.join('\n')
      }

      case 'code': {
         const code      = block.code ?? ''
         const langTag   = CODE_LANG_TO_FENCE[block.lang ?? 'plain']
         // Use 4-backtick fence if the content itself contains a line of 3 backticks.
         const fence     = /^```\s*$/m.test(code) ? '````' : '```'
         return `${fence}${langTag}\n${code}\n${fence}`
      }

      case 'math': {
         // Raw LaTeX in a ```math fence; the MathML is re-derived from it on load.
         const latex = block.latex ?? ''
         const fence = /^```\s*$/m.test(latex) ? '````' : '```'
         // Stays bare `math`: GitHub disables its native math rendering when the info string carries
         // any suffix, so the display scale rides the JSON backup, not here.
         return `${fence}math\n${latex}\n${fence}`
      }

      case 'graph': {
         // A ```graph fence: type + options on the info string, data as a pipe-table body. `type=` is
         // load-bearing; Documinter-specific. The SVG is re-derived from this spec on load.
         const spec = block.graph
         if (!spec) return '```graph type=bar\n|  |\n| --- |\n```'
         const { info, body } = graphSpecToFence(spec)
         return `\`\`\`graph ${info}\n${body}\n\`\`\``
      }

      case 'diagram': {
         // A ```diagram fence: options on the info string, two pipe tables (nodes + edges) in the
         // body split by a blank line. Documinter-specific. The SVG is re-derived on load.
         const spec = block.diagram
         if (!spec) {
            const { info, body } = diagramSpecToFence({ nodes: [], edges: [], options: {} })
            return `\`\`\`${info}\n${body}\n\`\`\``
         }
         const { info, body } = diagramSpecToFence(spec)
         return `\`\`\`${info}\n${body}\n\`\`\``
      }

      case 'list': {
         const items = block.items ?? []
         if (items.length === 0) return ''
         const rootMarker = markerOrDefault(block.listMarker)
         return serializeListItems(items, 0, { marker: rootMarker })
      }

      case 'checklist': {
         const items = block.items ?? []
         if (items.length === 0) return ''
         return serializeListItems(items, 0, { checklist: true })
      }

      case 'table': {
         const richHeaders = block.richHeaders ?? []
         if (richHeaders.length === 0) return ''
         const richRows = block.richRows ?? []

         function escapePipe(text: string): string {
            return text.replace(/\|/g, '\\|')
         }

         const headerCells    = richHeaders.map(header => escapePipe(serializeInline(header)))
         const headerRow      = `| ${headerCells.join(' | ')} |`
         const separatorRow   = `| ${richHeaders.map(() => '----------').join(' | ')} |`
         const bodyRows       = richRows.map(row =>
            '| ' + richHeaders.map((_, colIndex) =>
               escapePipe(serializeInline(row[colIndex] ?? []))
            ).join(' | ') + ' |'
         )

         return [headerRow, separatorRow, ...bodyRows].join('\n')
      }

      case 'image': {
         // A marked-up image serializes as a ```imagemarkup fence (see imageMarkupFence.ts): the
         // base64 `src` is NEVER emitted, so a reopen restores every annotation with an empty `src`.
         // A plain image keeps its own convention below, byte-identical.
         if (block.imageMarkup) {
            const { info, body } = imageMarkupSpecToFence(imageBlockToMarkupSpec(block))
            return body ? `\`\`\`${info}\n${body}\n\`\`\`` : `\`\`\`${info}\n\`\`\``
         }

         const src     = block.src ?? ''
         const alt     = block.alt ?? ''
         const isUrl   = /^https?:\/\//i.test(src) || src.startsWith('/')

         if (isUrl) {
            const outputLines: string[] = [`![${alt}](${src})`]
            if (block.caption)     outputLines.push(`<!-- image-caption: ${block.caption} -->`)
            const attrs: string[] = []
            if (block.align && block.align !== 'center') attrs.push(`align="${block.align}"`)
            if (block.imageHeight !== undefined)          attrs.push(`height=${block.imageHeight}`)
            if (attrs.length > 0) outputLines.push(`<!-- image-attrs: ${attrs.join(' ')} -->`)
            return outputLines.join('\n')
         }

         // Base64 data URL or no src: emit as a comment with attributes only.
         const attrs: string[] = [`alt="${alt}"`]
         if (block.caption)                               attrs.push(`caption="${block.caption}"`)
         if (block.align && block.align !== 'center')     attrs.push(`align="${block.align}"`)
         if (block.imageHeight !== undefined)             attrs.push(`height=${block.imageHeight}`)
         return `<!-- image: ${attrs.join(' ')} -->`
      }

      case 'hr':
         return '---'

      case 'container': {
         const parts: string[] = ['<!-- container-start -->']

         for (const innerBlock of block.left ?? []) {
            parts.push('')
            const isHeading = innerBlock.type === 'h3' || innerBlock.type === 'h4'
            if (innerBlock.handle && !isHeading) {
               parts.push(`<!-- handle: ${innerBlock.handle} -->`)
            }
            parts.push(serializeBlock(innerBlock))
         }

         parts.push('')
         parts.push('<!-- column-break -->')

         for (const innerBlock of block.right ?? []) {
            parts.push('')
            const isHeading = innerBlock.type === 'h3' || innerBlock.type === 'h4'
            if (innerBlock.handle && !isHeading) {
               parts.push(`<!-- handle: ${innerBlock.handle} -->`)
            }
            parts.push(serializeBlock(innerBlock))
         }

         parts.push('')
         parts.push('<!-- container-end -->')
         return parts.join('\n')
      }

      default:
         return ''
   }
}

// #############################
// # PRIVATE HELPERS, PARSING #
// #############################

/** Maps a fence language tag to a CodeLang, falling back to 'plain'. */
function normalizeFenceLang(tag: string): CodeLang {
   return FENCE_LANG_TO_CODE_LANG[tag.toLowerCase()] ?? 'plain'
}

/** Build the block for a closed fence from its full info string and body. The first token is the
 *  language tag: `math` becomes a math block (a following `scale=<step>` token sets its display scale,
 *  read on import but never emitted), `graph`/`diagram`/`imagemarkup` their block types, everything
 *  else a code block. */
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
      // Pass the FULL info string so the parser tokenizes quoted options itself; malformed fences
      // degrade gracefully inside fenceToGraphSpec.
      return { id: crypto.randomUUID(), type: 'graph', graph: fenceToGraphSpec(fenceInfo, body) }
   }
   if (langTag.toLowerCase() === 'diagram') {
      // Full info string so the parser tokenizes quoted options; the two-table body (nodes + edges)
      // is parsed by fenceToDiagramSpec. Malformed fences degrade gracefully, never throw.
      return { id: crypto.randomUUID(), type: 'diagram', diagram: fenceToDiagramSpec(fenceInfo, body) }
   }
   if (langTag.toLowerCase() === 'imagemarkup') {
      // Reads into an `image` block with a markup overlay; `src` always comes back empty (no base64
      // in this format). Malformed fences degrade gracefully, never throw.
      return markupSpecToImageBlock(crypto.randomUUID(), fenceToImageMarkupSpec(fenceInfo, body))
   }
   return { id: crypto.randomUUID(), type: 'code', lang: normalizeFenceLang(langTag), code: body }
}

/** Split a Markdown pipe-table row into trimmed cells, handling backslash-escaped pipes (\|). */
export function parsePipeTableRow(line: string): string[] {
   const inner = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
   const cells: string[] = []
   let current            = ''
   let charIndex          = 0

   while (charIndex < inner.length) {
      if (inner[charIndex] === '\\' && inner[charIndex + 1] === '|') {
         current   += '|'
         charIndex += 2
      } else if (inner[charIndex] === '|') {
         cells.push(current.trim())
         current    = ''
         charIndex++
      } else {
         current += inner[charIndex]
         charIndex++
      }
   }
   cells.push(current.trim())
   return cells
}

/** Build a nested ListItem tree from indented `- text` lines. In checklist mode each line's leading
 *  `[ ]`/`[x]` marker is stripped and recorded as the item's `checked` flag. */
export function buildListTree(lines: string[], checklist = false): ListItem[] {
   interface StackEntry { depth: number; item: ListItem }

   const roots: ListItem[]   = []
   const stack: StackEntry[] = []

   for (const line of lines) {
      const match = line.match(/^(\s*)- (.*)$/)
      if (!match) continue

      const depth = Math.floor(match[1].length / 2)

      let rawText = match[2]
      let checked = false
      if (checklist) {
         const checkboxMatch = rawText.match(/^\[([ xX])\] (.*)$/)
         if (checkboxMatch) {
            checked = checkboxMatch[1] === 'x' || checkboxMatch[1] === 'X'
            rawText = checkboxMatch[2]
         }
      }

      const item: ListItem = {
         id:       crypto.randomUUID(),
         richText: mintdownToInlineContent(rawText),
         children: [],
         ...(checklist ? { checked } : {}),
      }

      // Clamp depth: cannot exceed (parent depth + 1).
      const parentDepth   = stack.length > 0 ? stack[stack.length - 1].depth : -1
      const effectiveDepth = Math.min(depth, parentDepth + 1)

      // Pop stack until the top is a valid parent.
      while (stack.length > 0 && stack[stack.length - 1].depth >= effectiveDepth) {
         stack.pop()
      }

      if (stack.length === 0) {
         roots.push(item)
      } else {
         stack[stack.length - 1].item.children.push(item)
      }

      stack.push({ depth: effectiveDepth, item })
   }

   return roots
}

/** Parse a `<!-- list-marker: lower-alpha -->` comment into its sub-list marker, or null when the
 *  line is not that comment. Leading indentation is allowed (a nested sub-list's comment sits at the
 *  child indent). An unknown token degrades to `'dot'` rather than throw. */
export function parseListMarkerComment(line: string): ListMarker | null {
   const match = line.match(/^\s*<!-- list-marker: (.+?) -->\s*$/)
   if (!match) return null
   const trimmed = match[1].trim() as ListMarker
   return ALL_LIST_MARKERS.includes(trimmed) ? trimmed : 'dot'
}

/** Build a `list` Block from accumulated list lines: unordered (`- `) and ordered (`1. `) items plus
 *  interleaved `<!-- list-marker -->` comments, rebuilding the nested tree. Each sub-list gets its own
 *  marker; a comment before a sub-list's first item, at that indent, is authoritative (the root's
 *  arrives as `rootMarkerOverride`, setting `block.listMarker`; a nested one sets the parent's
 *  `childMarker`). With no comment the marker follows the syntax: ordered becomes `'decimal'`,
 *  unordered stays `dot`. A `dot` marker is never stored, so a plain list round-trips byte-identical. */
export function buildListBlockFromLines(lines: string[], rootMarkerOverride?: ListMarker): Block {
   interface StackEntry { depth: number; item: ListItem }

   const roots: ListItem[]   = []
   const stack: StackEntry[]  = []
   const childOrderedByParent = new WeakMap<ListItem, boolean>()
   const childCommentByParent = new WeakMap<ListItem, ListMarker>()
   let rootOrdered            = false
   let rootCommentFromLines: ListMarker | undefined
   // A marker comment buffers here until the sub-list it precedes begins at the same indent.
   let pendingComment: { marker: ListMarker; depth: number } | null = null

   for (const line of lines) {
      const commentMarker = parseListMarkerComment(line)
      if (commentMarker) {
         const indentLength = line.match(/^(\s*)/)?.[1].length ?? 0
         pendingComment = { marker: commentMarker, depth: Math.floor(indentLength / 2) }
         continue
      }

      const orderedMatch   = line.match(/^(\s*)\d+\. (.*)$/)
      const unorderedMatch = line.match(/^(\s*)- (.*)$/)

      let indentText: string
      let rawText:    string
      let ordered:    boolean
      if (orderedMatch) {
         indentText = orderedMatch[1]; rawText = orderedMatch[2]; ordered = true
      } else if (unorderedMatch) {
         indentText = unorderedMatch[1]; rawText = unorderedMatch[2]; ordered = false
      } else {
         continue
      }

      const depth = Math.floor(indentText.length / 2)

      // Clamp depth: cannot exceed (parent depth + 1).
      const parentDepth    = stack.length > 0 ? stack[stack.length - 1].depth : -1
      const effectiveDepth = Math.min(depth, parentDepth + 1)

      // Pop the stack until its top is a valid parent for this depth.
      while (stack.length > 0 && stack[stack.length - 1].depth >= effectiveDepth) {
         stack.pop()
      }

      const parent = stack.length > 0 ? stack[stack.length - 1].item : null

      // Record this sub-list's ordered-ness (siblings share one marker; last write wins).
      if (effectiveDepth === 0) rootOrdered = ordered
      else if (parent)          childOrderedByParent.set(parent, ordered)

      // A buffered comment at this same indent belongs to the sub-list this item opens.
      if (pendingComment && pendingComment.depth === effectiveDepth) {
         if (effectiveDepth === 0)  rootCommentFromLines = pendingComment.marker
         else if (parent)           childCommentByParent.set(parent, pendingComment.marker)
      }
      pendingComment = null

      const item: ListItem = {
         id:       crypto.randomUUID(),
         richText: mintdownToInlineContent(rawText),
         children: [],
      }

      if (parent) parent.children.push(item)
      else        roots.push(item)

      stack.push({ depth: effectiveDepth, item })
   }

   // Resolve each item's child sub-list marker: an explicit comment wins, else the derived
   // ordered-ness (decimal / dot). A `dot` result is never stored.
   function resolveChildMarkers(items: ListItem[]): void {
      for (const item of items) {
         if (item.children.length > 0) {
            const marker = childCommentByParent.get(item)
               ?? (childOrderedByParent.get(item) ? 'decimal' : 'dot')
            if (marker !== 'dot') item.childMarker = marker
            resolveChildMarkers(item.children)
         }
      }
   }
   resolveChildMarkers(roots)

   const block: Block = { id: crypto.randomUUID(), type: 'list', items: roots }

   const rootMarker = rootMarkerOverride ?? rootCommentFromLines ?? (rootOrdered ? 'decimal' : 'dot')
   if (rootMarker !== 'dot') block.listMarker = rootMarker

   return block
}

/** Builds a table Block from accumulated pipe-table lines (header, separator, body rows). */
export function buildTableBlock(lines: string[]): Block {
   const tableLines = lines.filter(line => line.trimStart().startsWith('|'))

   if (tableLines.length < 2) {
      // Too few lines for header + separator: fall back to a paragraph.
      return {
         id:       crypto.randomUUID(),
         type:     'p',
         richText: mintdownToInlineContent(lines.join('\n')),
      }
   }

   const headerCells  = parsePipeTableRow(tableLines[0])
   // tableLines[1] is the separator row, skip it.
   const bodyLines    = tableLines.slice(2)

   const richHeaders: InlineContent[]   = headerCells.map(cell => mintdownToInlineContent(cell))
   const richRows:    InlineContent[][] = bodyLines.map(line => {
      const cells = parsePipeTableRow(line)
      return richHeaders.map((_, colIndex) => mintdownToInlineContent(cells[colIndex] ?? ''))
   })

   return { id: crypto.randomUUID(), type: 'table', richHeaders, richRows }
}

// ###################################
// # PUBLIC API, DOCUMENTTOMARKDOWN #
// ###################################

/** Serialize the full document to a UTF-8 Markdown string. Pure, deterministic. Metadata block then
 *  `---`; each section as `<!-- section-id: uuid -->` + `## Title`; each block preceded by a blank
 *  line and an optional handle comment (h3/h4 handles inline as ` {#slug}`). */
export function documentToMarkdown(sections: Section[], meta: DocMeta): string {
   const parts: string[] = []

   // ===============
   //  Metadata block
   // ===============
   // title stays first-class; each freeform field becomes a bold-colon line, in order. An
   // empty-label field can't form a `**label:**` key, so it is skipped.
   parts.push(`# ${meta.title}`)
   for (const field of meta.fields) {
      if (field.label.trim() === '') continue
      parts.push(`**${field.label.trim()}:** ${field.value}`)
   }
   parts.push('---')

   // =========
   //  Sections
   // =========
   for (const section of sections) {
      parts.push('')
      parts.push(`<!-- section-id: ${section.id} -->`)
      parts.push(`## ${section.title}`)

      for (const block of section.blocks) {
         parts.push('')
         // Headings carry their handle inline; everything else uses a comment.
         const isHeading = block.type === 'h3' || block.type === 'h4'
         if (block.handle && !isHeading) {
            parts.push(`<!-- handle: ${block.handle} -->`)
         }
         const serialized = serializeBlock(block)
         if (serialized.length > 0) parts.push(serialized)
      }
   }

   return parts.join('\n') + '\n'
}

// ###################################
// # PUBLIC API, MARKDOWNTODOCUMENT #
// ###################################

/** Parse a Markdown string from `documentToMarkdown` (or hand-authored in the same format) into
 *  sections + meta. Never throws; single-pass O(n) scan. Content before the first `##` is discarded as
 *  preamble. A `<!-- section-id: uuid -->` preserves its section's UUID; sections without one get a
 *  fresh UUID. */
export function markdownToDocument(source: string): { sections: Section[], meta: DocMeta } {
   const lines = source.split('\n')

   const meta: DocMeta = { title: '', fields: [] }
   const sections: Section[] = []

   let lineIndex = 0

   // =======================
   //  Metadata scan
   // =======================
   // Read until '---' divider or end of input.
   while (lineIndex < lines.length) {
      const line = lines[lineIndex]
      lineIndex++

      if (line === '---') break

      const titleMatch = line.match(/^# (.*)$/)
      if (titleMatch) {
         meta.title = titleMatch[1].trim()
         continue
      }

      // **Label:** value  (bold-colon format; label may contain spaces / special chars)
      // Markdown is the lossy portable format: position/color are not encoded, so parsed
      // fields default to the below-title zone with the default (undefined) color.
      const fieldMatch = line.match(/^\*\*(.+?):\*\*\s?(.*)$/)
      if (fieldMatch) {
         meta.fields.push({ id: crypto.randomUUID(), label: fieldMatch[1].trim(), value: fieldMatch[2], position: 'below' })
      }
   }

   // ===================
   //  Body scan
   // ===================

   let currentSection:    Section | null = null
   let pendingSectionId:  string  | null = null
   let pendingHandle:     string  | null = null
   // Root sub-list marker from a `<!-- list-marker -->` comment, applied to the next list flush.
   let pendingListMarker: ListMarker | null = null
   // Last committed image block, set so that caption/attrs comments can patch it.
   let pendingImageBlock: Block   | null = null

   // Paragraph/blockquote/list/table accumulator
   type AccumKind = 'p' | 'blockquote' | 'list' | 'checklist' | 'table'
   let accumKind:  AccumKind | null = null
   let accumLines: string[]         = []

   // Code fence state (separate from the text accumulator)
   let inCodeFence   = false
   let fenceMark     = ''    // e.g. '```' or '````'
   let fenceInfo     = ''    // full info string after the opening fence (lang tag + any attrs)
   let codeLines:      string[] = []

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
         case 'p': {
            return {
               id:       crypto.randomUUID(),
               type:     'p',
               richText: mintdownToInlineContent(capturedLines.join('\n')),
            }
         }

         case 'blockquote': {
            const stripped   = capturedLines.map(line => line.replace(/^> ?/, ''))
            // Accepts either a preset style token or a `#rgb`/`#rrggbb` hex, alone on its own
            // line. A malformed hex (wrong digit count) still matches the tag shape and falls
            // back to the 'info' preset rather than dropping to a plain paragraph.
            const typeMatch  = stripped[0]?.match(/^\[!(info|valid|warning|danger|#[0-9a-fA-F]{1,8})\]$/i)
            if (typeMatch) {
               const tag = typeMatch[1]
               let style: CalloutStyle = 'info'
               let calloutColor: string | undefined
               if (tag.startsWith('#')) {
                  calloutColor = sanitizeCalloutHex(tag)
               } else {
                  style = tag.toLowerCase() as CalloutStyle
               }
               // Join remaining stripped lines; trim leading blank line if any.
               const content = stripped.slice(1).join('\n').replace(/^\n+/, '')
               return {
                  id:       crypto.randomUUID(),
                  type:     'callout',
                  style,
                  ...(calloutColor ? { calloutColor } : {}),
                  richText: mintdownToInlineContent(content),
               }
            }
            // No type directive, treat as plain paragraph.
            return {
               id:       crypto.randomUUID(),
               type:     'p',
               richText: mintdownToInlineContent(stripped.join('\n')),
            }
         }

         case 'list': {
            const rootMarker = pendingListMarker
            pendingListMarker = null
            return buildListBlockFromLines(capturedLines, rootMarker ?? undefined)
         }

         case 'checklist': {
            return {
               id:    crypto.randomUUID(),
               type:  'checklist',
               items: buildListTree(capturedLines, true),
            }
         }

         case 'table': {
            return buildTableBlock(capturedLines)
         }

         default:
            return null
      }
   }

   // ====================
   //  Block commit helper
   // ====================

   function commitBlock(block: Block | null): void {
      if (!block) return
      // Assign pending handle, but don't overwrite an inline {#slug} handle.
      if (pendingHandle && !block.handle) {
         block.handle  = pendingHandle
      }
      pendingHandle = null

      // Discard blocks that arrived before the first ## section (preamble).
      if (!currentSection) {
         pendingImageBlock = null
         return
      }

      currentSection.blocks.push(block)
      pendingImageBlock = block.type === 'image' ? block : null
   }

   // Start a new accumulator (flushing any existing one first).
   function startAccum(kind: AccumKind, firstLine: string): void {
      commitBlock(flushAccum())
      accumKind  = kind
      accumLines = [firstLine]
      // Starting any new block breaks the image metadata chain. A marker comment only ever
      // precedes a list, so any pending marker not consumed by a list start is stale here.
      if (kind !== 'list') pendingListMarker = null
      pendingImageBlock = null
   }

   // ===============
   //  Main scan loop
   // ===============

   while (lineIndex < lines.length) {
      const line = lines[lineIndex]
      lineIndex++

      // Inside a code fence: accumulate verbatim
      if (inCodeFence) {
         // Closing fence: line is only backticks with at least fenceMark.length of them.
         if (/^`+\s*$/.test(line) && line.trim().length >= fenceMark.length) {
            const block = buildFenceBlock(fenceInfo, codeLines.join('\n'))
            inCodeFence  = false
            fenceMark    = ''
            fenceInfo    = ''
            codeLines    = []
            commitBlock(block)
         } else {
            codeLines.push(line)
         }
         continue
      }

      // Section boundary: ## heading
      const sectionMatch = line.match(/^## (.*)$/)
      if (sectionMatch) {
         commitBlock(flushAccum())
         const sectionId  = pendingSectionId ?? crypto.randomUUID()
         pendingSectionId = null
         pendingHandle    = null   // handles before ## don't attach to the section
         pendingListMarker = null
         pendingImageBlock = null
         currentSection   = {
            id:        sectionId,
            title:     sectionMatch[1].trim(),
            collapsed: false,
            blocks:    [],
         }
         sections.push(currentSection)
         continue
      }

      // h4 heading (check before h3 to avoid prefix ambiguity)
      const h4Match = line.match(/^#### (.*)$/)
      if (h4Match) {
         commitBlock(flushAccum())
         const raw          = h4Match[1]
         const handleSuffix = raw.match(/\s*\{#([a-z0-9-]+)\}$/)
         const text         = handleSuffix
            ? raw.slice(0, raw.length - handleSuffix[0].length).trim()
            : raw.trim()
         const block: Block = {
            id:       crypto.randomUUID(),
            type:     'h4',
            richText: mintdownToInlineContent(text),
         }
         if (handleSuffix) {
            block.handle  = handleSuffix[1]
            pendingHandle = null  // inline handle takes precedence
         }
         commitBlock(block)
         continue
      }

      // h3 heading
      const h3Match = line.match(/^### (.*)$/)
      if (h3Match) {
         commitBlock(flushAccum())
         const raw          = h3Match[1]
         const handleSuffix = raw.match(/\s*\{#([a-z0-9-]+)\}$/)
         const text         = handleSuffix
            ? raw.slice(0, raw.length - handleSuffix[0].length).trim()
            : raw.trim()
         const block: Block = {
            id:       crypto.randomUUID(),
            type:     'h3',
            richText: mintdownToInlineContent(text),
         }
         if (handleSuffix) {
            block.handle  = handleSuffix[1]
            pendingHandle = null
         }
         commitBlock(block)
         continue
      }

      // Opening code fence. Group 2 captures the whole info string (lang tag plus any
      // attributes such as the math block's `scale=`), trimmed of surrounding whitespace.
      const fenceOpenMatch = line.match(/^(`{3,})\s*(.*?)\s*$/)
      if (fenceOpenMatch) {
         commitBlock(flushAccum())
         inCodeFence  = true
         fenceMark    = fenceOpenMatch[1]
         fenceInfo    = fenceOpenMatch[2]
         codeLines    = []
         pendingImageBlock = null
         continue
      }

      // Blockquote line
      if (line.startsWith('> ') || line === '>') {
         // Cast: TypeScript over-narrows accumKind within the loop body.
         if ((accumKind as AccumKind | null) === 'blockquote') {
            accumLines.push(line)
         } else {
            startAccum('blockquote', line)
         }
         continue
      }

      // A nested sub-list's `<!-- list-marker -->` comment is indented, so it falls through the
      // column-0 comment branch below; keep it inside the active list accumulator so
      // buildListBlockFromLines can bind it to the sub-list it precedes.
      if ((accumKind as AccumKind | null) === 'list' && parseListMarkerComment(line) !== null) {
         accumLines.push(line)
         continue
      }

      // List item: unordered (`- `), GFM task-list (`- [ ] `, checklist), or ordered (`1. `).
      // The checkbox marker selects checklist; ordered and plain unordered both accumulate as one
      // `list` block so a per-sub-list mix (numbers outside, bullets inside) stays a single list.
      if (/^\s*- /.test(line) || /^\s*\d+\. /.test(line)) {
         const kind: AccumKind = /^\s*- \[[ xX]\] /.test(line) ? 'checklist' : 'list'
         if ((accumKind as AccumKind | null) === kind) {
            accumLines.push(line)
         } else {
            startAccum(kind, line)
         }
         continue
      }

      // Pipe-table row
      if (line.startsWith('|')) {
         if ((accumKind as AccumKind | null) === 'table') {
            accumLines.push(line)
         } else {
            startAccum('table', line)
         }
         continue
      }

      // HTML comment lines
      if (line.startsWith('<!--')) {

         // list-marker: the following list's ROOT sub-list adopts this marker style. Markdown export
         // never emits this comment, but the importer still honours an authored one when present.
         const listMarkerFromComment = parseListMarkerComment(line)
         if (listMarkerFromComment) {
            commitBlock(flushAccum())
            pendingListMarker = listMarkerFromComment
            pendingImageBlock = null
            continue
         }

         // section-id: preserve UUID for the next ## heading.
         const sectionIdMatch = line.match(/^<!-- section-id: ([0-9a-f-]+) -->$/)
         if (sectionIdMatch) {
            pendingSectionId = sectionIdMatch[1]
            continue
         }

         // handle: the following block will receive this anchor ID.
         const handleMatch = line.match(/^<!-- handle: ([a-z0-9-]+) -->$/)
         if (handleMatch) {
            commitBlock(flushAccum())
            pendingHandle     = handleMatch[1]
            pendingImageBlock = null
            continue
         }

         // image-caption: patch the last committed image block.
         // Cast: TypeScript over-narrows pendingImageBlock to never via closure analysis.
         const captionMatch     = line.match(/^<!-- image-caption: (.+) -->$/)
         const captionTarget    = pendingImageBlock as Block | null
         if (captionMatch && captionTarget !== null) {
            captionTarget.caption = captionMatch[1]
            continue
         }

         // image-attrs: patch the last committed image block.
         const attrsMatch   = line.match(/^<!-- image-attrs: (.+) -->$/)
         const attrsTarget  = pendingImageBlock as Block | null
         if (attrsMatch && attrsTarget !== null) {
            const attrsString = attrsMatch[1]
            const alignMatch  = attrsString.match(/align="(left|center|right)"/)
            const heightMatch = attrsString.match(/height=(\d+)/)
            if (alignMatch)  attrsTarget.align       = alignMatch[1] as 'left' | 'center' | 'right'
            if (heightMatch) attrsTarget.imageHeight = parseInt(heightMatch[1], 10)
            continue
         }

         // image (Case B): base64 / missing-src image stored as comment.
         const imageBMatch = line.match(/^<!-- image: (.+) -->$/)
         if (imageBMatch) {
            commitBlock(flushAccum())
            const attrsString  = imageBMatch[1]
            const altMatch     = attrsString.match(/alt="([^"]*)"/)
            const capMatch     = attrsString.match(/caption="([^"]*)"/)
            const alignMatch   = attrsString.match(/align="(left|center|right)"/)
            const heightMatch  = attrsString.match(/height=(\d+)/)
            const block: Block = {
               id:   crypto.randomUUID(),
               type: 'image',
               alt:  altMatch ? altMatch[1] : '',
               ...(capMatch    && { caption:     capMatch[1] }),
               ...(alignMatch  && { align:       alignMatch[1] as 'left' | 'center' | 'right' }),
               ...(heightMatch && { imageHeight: parseInt(heightMatch[1], 10) }),
            }
            commitBlock(block)
            continue
         }

         // All other HTML comments (container-start, column-break, container-end,
         // or any unrecognised comment) are silently ignored.
         continue
      }

      // Markdown image link: ![alt](src)
      const imageAMatch = line.match(/^!\[([^\]]*)\]\(([^)]*)\)/)
      if (imageAMatch) {
         commitBlock(flushAccum())
         const block: Block = {
            id:   crypto.randomUUID(),
            type: 'image',
            alt:  imageAMatch[1],
            src:  imageAMatch[2],
         }
         commitBlock(block)
         continue
      }

      // Thematic break: --- becomes an hr block
      if (line === '---') {
         commitBlock(flushAccum())
         commitBlock({ id: crypto.randomUUID(), type: 'hr' })
         pendingImageBlock = null
         continue
      }

      // Blank line: flush accumulator
      if (line.trim() === '') {
         if (accumKind !== null) commitBlock(flushAccum())
         pendingImageBlock = null
         continue
      }

      // Default: paragraph text accumulation
      if (accumKind === 'p') {
         accumLines.push(line)
      } else {
         commitBlock(flushAccum())
         accumKind  = 'p'
         accumLines = [line]
         pendingImageBlock = null
      }
   }

   // Flush any remaining accumulator after the last line.
   commitBlock(flushAccum())

   // If a fence was never closed, emit the accumulated lines as their fenced block type.
   if (inCodeFence && codeLines.length > 0) {
      commitBlock(buildFenceBlock(fenceInfo, codeLines.join('\n')))
   }

   return { sections, meta }
}

// ########################################################
// # PUBLIC API, IMPORTMARKDOWNFILE / EXPORTMARKDOWNFILE #
// ########################################################

/** Parse Markdown source text into a document. The picked file is read to text by the transfer seam,
 *  so this takes the text directly rather than a File. */
export function importMarkdownFile(source: string): { sections: Section[], meta: DocMeta } {
   return markdownToDocument(source)
}

/** Save the document as a .md file, named from the title via slugify. */
export async function exportMarkdownFile(sections: Section[], meta: DocMeta): Promise<void> {
   await saveTextFile({
      suggestedName: `${slugify(meta.title) || 'document'}.md`,
      contents:      documentToMarkdown(sections, meta),
      filters:       [{ name: 'Markdown document', extensions: ['md'] }],
   })
}

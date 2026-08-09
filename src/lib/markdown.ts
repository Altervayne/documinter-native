import type { Block, CalloutStyle, CodeLang, DocMeta, InlineContent, ListItem, ListMarker, Section } from '../types'
import { ALL_LIST_MARKERS, markerOrDefault, isOrderedMarker } from './listMarkers'
import { inlineContentToMintdown, mintdownToInlineContent } from './inline'
import { parseMathScaleToken } from './mathScale'
import { graphSpecToFence, fenceToGraphSpec } from './graphFence'
import { diagramSpecToFence, fenceToDiagramSpec } from './diagramFence'
import { imageMarkupSpecToFence, fenceToImageMarkupSpec } from './imageMarkupFence'
import { imageBlockToMarkupSpec, markupSpecToImageBlock } from './imageMarkupBlock'
import { slugify } from './text'
import { sanitizeCalloutHex } from './calloutColor'

// #############
// # CONSTANTS #
// #############

/** Maps CodeLang values to the fence language tag used on export. */
const CODE_LANG_TO_FENCE: Record<CodeLang, string> = {
   windev: 'windev',
   js:     'javascript',
   sql:    'sql',
   python: 'python',
   c:      'c',
   html:   'html',
   css:    'css',
   plain:  '',
}

/** Maps fence language tags (lower-cased) back to CodeLang on import. */
const FENCE_LANG_TO_CODE_LANG: Record<string, CodeLang> = {
   windev:     'windev',
   javascript: 'js',
   js:         'js',
   ts:         'js',
   typescript: 'js',
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

// ###################################
// # PRIVATE HELPERS, SERIALISATION #
// ###################################

/** Serialises InlineContent to Mintdown inline syntax. */
function serializeInline(content: InlineContent | undefined): string {
   return inlineContentToMintdown(content ?? [])
}

/** Renders list items recursively with two-space indentation per level. In checklist mode each
 *  item carries a GFM task-list marker (`[x]` checked / `[ ]` unchecked) right after the dash.
 *  For a plain list, `marker` is the CURRENT sub-list's marker: an ORDERED marker emits the
 *  1-based sibling index as `${n}. `, an unordered marker emits `- ` (the historical default, so a
 *  sub-list with no marker stays byte-identical). The alpha/roman refinement is carried only by the
 *  Mintdown `<!-- list-marker -->` comment. Under `mintdown`, each nested sub-list whose owning
 *  item's `childMarker` is non-`dot` gets its own comment line at the child indent, right before
 *  its first item; the root sub-list's comment is emitted by the caller (serializeBlock). */
function serializeListItems(
   items: ListItem[],
   depth: number,
   options: { checklist?: boolean; mintdown?: boolean; marker?: ListMarker },
): string {
   const { checklist = false, mintdown = false, marker = 'dot' } = options
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
         if (!checklist && mintdown && childMarker !== 'dot') {
            lines.push(`${'  '.repeat(depth + 1)}<!-- list-marker: ${childMarker} -->`)
         }
         lines.push(serializeListItems(item.children, depth + 1, { checklist, mintdown, marker: childMarker }))
      }
   })
   return lines.join('\n')
}

/** Serialises a single block to its Markdown/Mintdown representation.
 *  For h3/h4 blocks that carry a handle, the handle is emitted inline as {#slug}.
 *  For all other block types, the caller is responsible for emitting the
 *  <!-- handle: slug --> comment BEFORE this function's output.
 *
 *  `options.mintdown` selects the Mintdown flavour, which is a superset of Markdown: it
 *  currently only affects the `math` fence (the display scale rides the fence info string in
 *  Mintdown but is dropped in portable Markdown). Defaults to Markdown (bare) so `.md` output
 *  is unchanged. The flag is forwarded through the recursive `container` serialization. */
export function serializeBlock(block: Block, options?: { mintdown?: boolean }): string {
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
         // A ```math fence carrying the raw LaTeX source, exactly mirroring the code fence.
         // The rendered MathML is not serialized; it is re-derived from the LaTeX on load.
         const latex = block.latex ?? ''
         const fence = /^```\s*$/m.test(latex) ? '````' : '```'
         // Flavour-aware info string: Mintdown carries a non-default display scale as
         // `math scale=1.5`; portable Markdown stays bare `math` (GitHub disables its native
         // math rendering when the info string carries any suffix), so the scale is dropped there.
         const scale = block.mathScale
         const info  = options?.mintdown && scale !== undefined && scale !== 1
            ? `math scale=${scale}`
            : 'math'
         return `${fence}${info}\n${latex}\n${fence}`
      }

      case 'graph': {
         // A ```graph fence: chart type + options on the info string, data as a Markdown pipe
         // table body. `type=` is load-bearing and rides BOTH flavours (no mintdown branch),
         // a graph fence is Documinter-specific in either format. The rendered SVG is never
         // serialized; it is re-derived from this spec on load.
         const spec = block.graph
         if (!spec) return '```graph type=bar\n|  |\n| --- |\n```'
         const { info, body } = graphSpecToFence(spec)
         return `\`\`\`graph ${info}\n${body}\n\`\`\``
      }

      case 'diagram': {
         // A ```diagram fence: options on the info string, TWO pipe tables (nodes + edges) in the
         // body separated by a blank line. Documinter-specific in both flavours (no mintdown branch).
         // The rendered SVG is never serialized; it is re-derived from this spec on load.
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
         const body = serializeListItems(items, 0, { mintdown: options?.mintdown, marker: rootMarker })
         // Byte-identical guard: a list whose root sub-list is `dot` emits no root token and plain
         // `- ` bullets, exactly as before. The `<!-- list-marker -->` refinement rides ONLY the
         // Mintdown flavour, and only for a non-`dot` sub-list; portable Markdown keeps just the
         // native ordered/unordered distinction each sub-list already carries positionally.
         if (options?.mintdown && rootMarker !== 'dot') {
            return `<!-- list-marker: ${rootMarker} -->\n${body}`
         }
         return body
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
         // A marked-up image serializes as a ```imagemarkup fence: base dims + alt/caption on the
         // info string, one overlay element per body line. See imageMarkupFence.ts: the
         // base64 `src` is NEVER emitted in either flavour, so a `.mint`/`.md` reopen restores every
         // annotation but with an empty `src`. A PLAIN image (no overlay) keeps its own convention
         // below, byte-identical. The rendered SVG is never serialized, re-derived from the spec.
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

         // Base64 data URL or no src, emit as comment with attributes only.
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
            parts.push(serializeBlock(innerBlock, options))
         }

         parts.push('')
         parts.push('<!-- column-break -->')

         for (const innerBlock of block.right ?? []) {
            parts.push('')
            const isHeading = innerBlock.type === 'h3' || innerBlock.type === 'h4'
            if (innerBlock.handle && !isHeading) {
               parts.push(`<!-- handle: ${innerBlock.handle} -->`)
            }
            parts.push(serializeBlock(innerBlock, options))
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

/** Maps a fence language tag string to a CodeLang (falls back to 'plain'). */
function normalizeFenceLang(tag: string): CodeLang {
   return FENCE_LANG_TO_CODE_LANG[tag.toLowerCase()] ?? 'plain'
}

/**
 * Builds the block for a closed fence from its full info string and body. The first token is the
 * language tag; a ```math fence becomes a math block carrying the raw LaTeX, and any following
 * `scale=<step>` token sets its display scale (junk / out-of-range values are ignored). Every
 * other tag becomes a code block. Symmetric with mintdown.ts, harmless in the bare-Markdown path.
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
      // Pass the FULL info string (not the pre-split tokens) so the graph parser can tokenize
      // quoted options itself. Malformed fences degrade gracefully inside fenceToGraphSpec.
      return { id: crypto.randomUUID(), type: 'graph', graph: fenceToGraphSpec(fenceInfo, body) }
   }
   if (langTag.toLowerCase() === 'diagram') {
      // Pass the FULL info string so the diagram parser can tokenize quoted options itself; the
      // two-table body (nodes + edges) is parsed by fenceToDiagramSpec. Malformed fences degrade
      // gracefully (bad fields default, dangling edges kept for the renderer to skip), never throw.
      return { id: crypto.randomUUID(), type: 'diagram', diagram: fenceToDiagramSpec(fenceInfo, body) }
   }
   if (langTag.toLowerCase() === 'imagemarkup') {
      // Pass the FULL info string so the parser can tokenize quoted alt/caption values itself.
      // Reads into an `image` block WITH a markup overlay (the standalone block type is gone).
      // `src` always comes back empty (no base64 in this format, see imageMarkupFence.ts);
      // malformed fences degrade gracefully (unknown element kinds skipped), never throw.
      return markupSpecToImageBlock(crypto.randomUUID(), fenceToImageMarkupSpec(fenceInfo, body))
   }
   return { id: crypto.randomUUID(), type: 'code', lang: normalizeFenceLang(langTag), code: body }
}

/** Splits a Markdown pipe-table row into trimmed cell strings,
 *  correctly handling backslash-escaped pipes (\|). */
export function parsePipeTableRow(line: string): string[] {
   // Strip leading/trailing pipe and surrounding whitespace.
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

/** Builds a nested ListItem tree from indented `- text` lines. In checklist mode each line's
 *  leading `[ ]`/`[x]` task-list marker is stripped and recorded as the item's `checked` flag. */
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

/** Parses a `<!-- list-marker: lower-alpha -->` comment into its single sub-list marker, or null
 *  when the line is not that comment. Leading indentation is allowed (a nested sub-list's comment
 *  sits at the child indent). An unknown token degrades to `'dot'` rather than throw, so a
 *  hand-authored or future-versioned token can never break a load. */
export function parseListMarkerComment(line: string): ListMarker | null {
   const match = line.match(/^\s*<!-- list-marker: (.+?) -->\s*$/)
   if (!match) return null
   const trimmed = match[1].trim() as ListMarker
   return ALL_LIST_MARKERS.includes(trimmed) ? trimmed : 'dot'
}

/**
 * Builds a `list` Block from accumulated list lines, recognising both unordered (`- `) and ordered
 * (`1. `) items plus interleaved `<!-- list-marker -->` comment lines, rebuilding the nested tree.
 *
 * Each sub-list gets its own marker. A comment sits immediately before a sub-list's first item, at
 * that sub-list's indent, and is AUTHORITATIVE for it: the root sub-list's comment (arriving as
 * `rootMarkerOverride` from the scanner, since it is a column-0 line before the list) sets
 * `block.listMarker`; a nested sub-list's comment sets the owning parent item's `childMarker`. With
 * no comment, the marker is derived from the base syntax, an ordered sub-list becomes `'decimal'`,
 * an unordered one stays `dot`. A `dot` marker is never stored (absent field), so a plain list
 * round-trips back byte-identical.
 */
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
      // Degenerate: not enough lines for header + separator, return as paragraph.
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

/**
 * Serialises the full document state to a UTF-8 Markdown string.
 * Pure. No side effects. No DOM access. Deterministic.
 *
 * Format overview:
 *   - Document metadata block at the top, followed by `---`.
 *   - Each section preceded by `<!-- section-id: uuid -->` then `## Title`.
 *   - Each block preceded by a blank line and an optional handle comment.
 *   - h3/h4 handles are emitted inline as ` {#slug}` rather than a comment.
 */
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

/**
 * Parses a Markdown string produced by `documentToMarkdown` (or hand-authored
 * in the same format) into a DocState.
 *
 * Guarantees:
 *   - Never throws, any valid or invalid input returns a usable DocState.
 *   - O(n) single-pass line scanner.
 *   - Content before the first `##` heading is treated as preamble and discarded.
 *   - Sections with `<!-- section-id: uuid -->` preserve their UUIDs; sections
 *     without one receive newly-generated UUIDs.
 */
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

         // list-marker: the following list's ROOT sub-list adopts this marker style (Mintdown
         // refinement; harmless in Markdown, which never emits it but can round-trip an authored one).
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

/**
 * Reads a .md File object and parses it via markdownToDocument.
 * Thin async wrapper, all parsing logic lives in markdownToDocument.
 */
export async function importMarkdownFile(
   file: File,
): Promise<{ sections: Section[], meta: DocMeta }> {
   const source = await file.text()
   return markdownToDocument(source)
}

/**
 * Triggers a browser download of the document as a .md file.
 * The filename is derived from the document title via slugify.
 */
export function exportMarkdownFile(sections: Section[], meta: DocMeta): void {
   const content  = documentToMarkdown(sections, meta)
   const filename = `${slugify(meta.title) || 'document'}.md`
   const blob     = new Blob([content], { type: 'text/markdown;charset=utf-8' })
   const url      = URL.createObjectURL(blob)
   const anchor   = document.createElement('a')
   anchor.href     = url
   anchor.download = filename
   anchor.click()
   URL.revokeObjectURL(url)
}

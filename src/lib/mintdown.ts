// -- Library Imports --
import { htmlToMd, mdCell } from './markdown'
import { mkBlock, mkSection } from './state'

// -- Type Imports --
import type { Block, CalloutStyle, CodeLang, DocMeta, Section } from '../types'

// #############################
// # Inline formatting helpers #
// #############################

/**
 * Convert Markdown inline syntax → rich HTML string.
 * This is the parse-direction counterpart to htmlToMd() in markdown.ts.
 */
export function mdInlineToHtml(text: string): string {
   if (!text) return ''

   // Private-use sentinel characters that cannot appear in normal Mintdown text.
   // Used to protect code-span content from bold/italic regex passes.
   const CODE_OPEN  = '\uE000'
   const CODE_CLOSE = '\uE001'

   // Step 1: Extract code spans to placeholders so bold/italic rules can't touch their content
   const codeSpans: string[] = []
   let result = text.replace(/`([^`]+)`/g, (_, inner: string) => {
      codeSpans.push(inner)
      return `${CODE_OPEN}${codeSpans.length - 1}${CODE_CLOSE}`
   })

   // Step 2: Bold — ** and __ (must come before italic to avoid ** being eaten as two *)
   result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
   result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')

   // Step 3: Italic — * and _
   result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
   result = result.replace(/_(.+?)_/g, '<em>$1</em>')

   // Step 4: Strikethrough
   result = result.replace(/~~(.+?)~~/g, '<s>$1</s>')

   // Step 5: Links [label](url)
   result = result.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')

   // Step 6: <u>…</u> passthrough — already valid HTML, no action needed

   // Step 7: Restore code spans
   const sentinelPattern = new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g')
   result = result.replace(sentinelPattern, (_, index: string) => `<code>${codeSpans[Number(index)]}</code>`)

   return result
}

// ##############
// # Serializer #
// ##############

function serializeBlock(block: Block): string {
   const anchor = block.handle ? `^${block.handle}\n` : ''
   const body = serializeBlockBody(block)
   if (!body) return ''
   return anchor + body
}

function serializeBlockBody(block: Block): string {
   switch (block.type) {
      case 'p': {
         const text = htmlToMd(block.text ?? '')
         if (!text.trim()) return ''
         return text + '\n\n'
      }

      case 'h3': {
         const text = htmlToMd(block.text ?? '')
         if (!text.trim()) return ''
         return `### ${text}\n\n`
      }

      case 'h4': {
         const text = htmlToMd(block.text ?? '')
         if (!text.trim()) return ''
         return `#### ${text}\n\n`
      }

      case 'callout': {
         const style = block.style ?? 'info'
         const lines = htmlToMd(block.text ?? '').split('\n')
         const firstLine = `> [${style}] ${lines[0] ?? ''}`
         const restLines = lines.slice(1).map(line => `> ${line}`)
         return [firstLine, ...restLines].join('\n') + '\n\n'
      }

      case 'code': {
         const lang = block.lang ?? 'plain'
         return `\`\`\`${lang}\n${block.code ?? ''}\n\`\`\`\n\n`
      }

      case 'list': {
         const items = block.items ?? []
         if (!items.length) return ''
         const lines = items.map(item => {
            const itemLine = `- ${htmlToMd(item.text)}`
            if (item.children?.length) {
               const childLines = item.children.map(child => `  - ${htmlToMd(child)}`)
               return itemLine + '\n' + childLines.join('\n')
            }
            return itemLine
         })
         return lines.join('\n') + '\n\n'
      }

      case 'table': {
         const headers = block.headers ?? []
         const rows    = block.rows    ?? []
         if (!headers.length) return ''
         const headerRow = `| ${headers.map(header => mdCell(header)).join(' | ')} |`
         const separator = `| ${headers.map(() => '---').join(' | ')} |`
         const bodyRows  = rows.map(row => `| ${row.map(cell => mdCell(cell)).join(' | ')} |`)
         return [headerRow, separator, ...bodyRows].join('\n') + '\n\n'
      }

      case 'image':
         // Images are not serialized to Mintdown (spec §6 — deferred)
         return ''

      case 'container': {
         const leftPct  = Math.round((block.ratio ?? 0.5) * 100)
         const rightPct = 100 - leftPct
         const leftBody  = blocksToMintdown(block.left  ?? []).trimEnd()
         const rightBody = blocksToMintdown(block.right ?? []).trimEnd()
         return `{${leftPct}|${rightPct}\n${leftBody}\n---\n${rightBody}\n}\n\n`
      }

      default:
         return ''
   }
}

/**
 * Serialize a section's blocks to Mintdown text.
 * Returns a string ending with a trailing newline.
 */
export function blocksToMintdown(blocks: Block[]): string {
   return blocks.map(serializeBlock).filter(Boolean).join('')
}

/**
 * Serialize a full document (meta + sections) to Mintdown text.
 */
export function documentToMintdown(meta: DocMeta, sections: Section[]): string {
   const parts: string[] = []

   // Frontmatter
   parts.push('---')
   parts.push(`module: ${meta.module}`)
   parts.push(`author: ${meta.author}`)
   parts.push(`date: ${meta.date}`)
   parts.push(`env: ${meta.env}`)
   parts.push('---')
   parts.push('')

   // Document title
   parts.push(`# ${meta.title || 'Untitled'}`)
   parts.push('')

   // Sections
   for (const section of sections) {
      parts.push(`## ${section.title}`)
      parts.push('')
      const blocksText = blocksToMintdown(section.blocks).trimEnd()
      if (blocksText) parts.push(blocksText)
      parts.push('')
   }

   return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// #########################
// # Parser infrastructure #
// #########################

interface Cursor {
   lines: string[]
   pos: number
}

function peek(cursor: Cursor): string | undefined {
   return cursor.lines[cursor.pos]
}

function consume(cursor: Cursor): string {
   return cursor.lines[cursor.pos++]
}

function atEnd(cursor: Cursor): boolean {
   return cursor.pos >= cursor.lines.length
}

// #####################
// # Per-block parsers #
// #####################

function parseParagraph(cursor: Cursor): Block {
   const lines: string[] = []
   while (!atEnd(cursor) && (peek(cursor) ?? '').trim() !== '') {
      lines.push(consume(cursor))
   }
   const block = mkBlock('p')
   block.text = mdInlineToHtml(lines.join(' '))
   return block
}

function parseCallout(cursor: Cursor): Block {
   const rawLines: string[] = []
   while (!atEnd(cursor) && (peek(cursor) ?? '').trimStart().startsWith('>')) {
      // Strip the leading '>' and optional single space
      rawLines.push(consume(cursor).replace(/^>\s?/, ''))
   }

   const first = rawLines[0] ?? ''
   let style: CalloutStyle = 'info'
   let firstContent = first

   // Try typed tag: [info], [w], [WARNING], etc.
   const tagMatch = first.match(/^\[(info|warning|valid|danger|i|w|v|d)\]\s*/i)
   if (tagMatch) {
      const tag = tagMatch[1].toLowerCase()
      style = tag === 'i' ? 'info'
            : tag === 'w' ? 'warning'
            : tag === 'v' ? 'valid'
            : tag === 'd' ? 'danger'
            : tag as CalloutStyle
      firstContent = first.slice(tagMatch[0].length)
   } else {
      // Handle legacy bold-wrapped format from generateMarkdown: **[INFO]**
      const legacyMatch = first.match(/^\*\*\[(INFO|WARNING|VALID|DANGER)\]\*\*\s*$/)
      if (legacyMatch) {
         style = legacyMatch[1].toLowerCase() as CalloutStyle
         firstContent = ''
      }
      // Plain '>' with no type tag → default info (MD import compatibility)
   }

   const allContent = [firstContent, ...rawLines.slice(1)]
      .join('\n')
      .replace(/\n$/, '')

   const block = mkBlock('callout')
   block.style = style
   block.text  = mdInlineToHtml(allContent)
   return block
}

function parseCodeFence(cursor: Cursor): Block {
   const openLine = consume(cursor).trim()
   const rawLang  = openLine.replace(/^`{3}/, '').trim()
   const validLangs = new Set<string>(['windev', 'js', 'sql', 'plain'])
   const lang: CodeLang = validLangs.has(rawLang) ? rawLang as CodeLang : 'plain'

   const codeLines: string[] = []
   while (!atEnd(cursor)) {
      const line = peek(cursor)!
      if (line.trim().startsWith('```')) { consume(cursor); break }
      codeLines.push(consume(cursor))
   }

   const block = mkBlock('code')
   block.lang = lang
   block.code = codeLines.join('\n')
   return block
}

function parseList(cursor: Cursor): Block {
   const items: Array<{ text: string; children: string[] }> = []

   while (!atEnd(cursor)) {
      const line = peek(cursor) ?? ''
      if (line.trim() === '') break

      // Top-level: "- item", "* item", or "1. item"
      const topMatch = line.match(/^[-*]\s+(.*)$/) ?? line.match(/^\d+\.\s+(.*)$/)
      if (!topMatch) break

      consume(cursor)
      const itemText = mdInlineToHtml(topMatch[1])
      const children: string[] = []

      // Peek for indented sub-items (exactly 2 spaces)
      while (!atEnd(cursor) && /^ {2}[-*]\s/.test(peek(cursor) ?? '')) {
         const subLine = consume(cursor)
         const subMatch = subLine.match(/^ {2}[-*]\s+(.*)$/)
         if (subMatch) children.push(mdInlineToHtml(subMatch[1]))
      }

      items.push({ text: itemText, children })
   }

   const block = mkBlock('list')
   block.items = items
   return block
}

function parseTableRow(line: string): string[] {
   return line.trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(cell => cell.trim().replace(/\\([|\\])/g, '$1'))
}

function parseTable(cursor: Cursor): Block {
   const headerLine    = consume(cursor)
   consume(cursor) // separator row — discard

   const headers = parseTableRow(headerLine).map(mdInlineToHtml)
   const rows: string[][] = []

   while (!atEnd(cursor) && (peek(cursor) ?? '').trim().startsWith('|')) {
      rows.push(parseTableRow(consume(cursor)).map(mdInlineToHtml))
   }

   const block = mkBlock('table')
   block.headers = headers
   block.rows    = rows
   return block
}

function parseImage(cursor: Cursor): Block {
   const line  = consume(cursor).trim()
   const match = line.match(/^!\[([^\]]*)\]\(([^)]*)\)/)
   const block = mkBlock('image')
   if (match) {
      block.alt = match[1]
      block.src = match[2]
   }
   return block
}

function parseContainerRatio(openLine: string): number {
   const spec = openLine.slice(1).trim() // remove leading '{'
   if (!spec || spec === '2') return 0.5
   if (spec === '3')          return 0.33
   if (spec === '4')          return 0.25
   if (spec === '-3')         return 0.67
   if (spec === '-4')         return 0.75
   const match = spec.match(/^(\d+)\|(\d+)$/)
   if (match) return Math.max(0.1, Math.min(0.9, parseInt(match[1], 10) / 100))
   return 0.5
}

function parseContainer(cursor: Cursor): Block {
   const openLine = consume(cursor).trim()
   const ratio    = parseContainerRatio(openLine)

   // Collect all lines until closing '}' (blank lines inside are fine)
   const bodyLines: string[] = []
   while (!atEnd(cursor)) {
      const line = peek(cursor)!
      if (line.trim() === '}') { consume(cursor); break }
      bodyLines.push(consume(cursor))
   }

   // Split at the first bare '---' separator line
   const separatorIndex = bodyLines.findIndex(line => line.trim() === '---')
   const leftLines  = separatorIndex >= 0 ? bodyLines.slice(0, separatorIndex) : bodyLines
   const rightLines = separatorIndex >= 0 ? bodyLines.slice(separatorIndex + 1) : []

   const block = mkBlock('container')
   block.ratio = ratio
   block.left  = mintdownToBlocks(leftLines.join('\n'))
   block.right = mintdownToBlocks(rightLines.join('\n'))
   return block
}

function parseBlock(cursor: Cursor): Block | null {
   const line = peek(cursor) ?? ''

   if (line.trim().startsWith('```'))   return parseCodeFence(cursor)
   if (line.trimStart().startsWith('>')) return parseCallout(cursor)
   if (line.trim().startsWith('{'))     return parseContainer(cursor)
   if (line.trim().startsWith('|'))     return parseTable(cursor)

   if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) return parseList(cursor)

   if (line.startsWith('#### ')) {
      const text = consume(cursor).slice(5).trim()
      const block = mkBlock('h4')
      block.text  = mdInlineToHtml(text)
      return block
   }
   if (line.startsWith('### ')) {
      const text = consume(cursor).slice(4).trim()
      const block = mkBlock('h3')
      block.text  = mdInlineToHtml(text)
      return block
   }

   // Structural markers and HR — skip
   if (line.trim().startsWith('#') || line.trim() === '---') {
      consume(cursor)
      return null
   }

   if (line.trim().startsWith('![')) return parseImage(cursor)

   return parseParagraph(cursor)
}

/**
 * Parse Mintdown text (for a single section) into blocks.
 * Does not handle frontmatter, `#` titles, or `##` section headers.
 */
export function mintdownToBlocks(text: string): Block[] {
   const cursor: Cursor = { lines: text.split('\n'), pos: 0 }
   const blocks: Block[] = []
   let pendingHandle: string | undefined

   while (!atEnd(cursor)) {
      // Skip blank lines
      if ((peek(cursor) ?? '').trim() === '') { consume(cursor); continue }

      // Anchor declaration: ^my-handle
      if (/^\^[\w-]+$/.test((peek(cursor) ?? '').trim())) {
         pendingHandle = consume(cursor).trim().slice(1)
         continue
      }

      const block = parseBlock(cursor)
      if (block) {
         if (pendingHandle) block.handle = pendingHandle
         blocks.push(block)
      }
      pendingHandle = undefined
   }

   return blocks
}

export function downloadMintdown(text: string, title: string): void {
   const slug = (title || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
   const anchor = document.createElement('a')
   anchor.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
   anchor.download = slug + '.mint'
   anchor.click()
   URL.revokeObjectURL(anchor.href)
}

// ######################
// # Frontmatter parser #
// ######################

function parseFrontmatter(cursor: Cursor): Partial<DocMeta> {
   if (peek(cursor)?.trim() !== '---') return {}
   consume(cursor)

   const meta: Partial<DocMeta> = {}
   while (!atEnd(cursor) && peek(cursor)!.trim() !== '---') {
      const line      = consume(cursor)
      const colonIdx  = line.indexOf(':')
      if (colonIdx < 0) continue
      const key   = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (['module', 'author', 'date', 'env', 'title'].includes(key)) {
         (meta as Record<string, string>)[key] = value
      }
   }
   if (peek(cursor)?.trim() === '---') consume(cursor)
   return meta
}

/**
 * Parse a full Mintdown document into meta + sections.
 * Handles optional frontmatter, `# Title`, and `## Section` headings.
 */
export function mintdownToDocument(text: string): { meta: Partial<DocMeta>; sections: Section[] } {
   const cursor: Cursor = { lines: text.split('\n'), pos: 0 }

   // 1. Parse optional frontmatter
   const meta = parseFrontmatter(cursor)

   // 2. Skip blank lines
   while (!atEnd(cursor) && (peek(cursor) ?? '').trim() === '') consume(cursor)

   // 3. Parse document title (# Title) — frontmatter title takes precedence
   if (!atEnd(cursor)) {
      const line = peek(cursor)!.trim()
      if (line.startsWith('# ') && !line.startsWith('## ')) {
         const titleFromHash = consume(cursor).trim().slice(2).trim()
         if (!meta.title) meta.title = titleFromHash
      }
   }

   // 4. Parse sections
   const sections: Section[] = []

   while (!atEnd(cursor)) {
      const line = (peek(cursor) ?? '').trim()

      if (line === '' || line === '---') { consume(cursor); continue }

      if (line.startsWith('## ')) {
         const title = consume(cursor).trim().slice(3).trim()
         const bodyLines: string[] = []

         // Collect until next '##' heading or end of input
         while (!atEnd(cursor) && !(peek(cursor) ?? '').trim().startsWith('## ')) {
            bodyLines.push(consume(cursor))
         }

         const section = mkSection(title)
         section.blocks = mintdownToBlocks(bodyLines.join('\n'))
         sections.push(section)
      } else {
         consume(cursor) // skip unexpected top-level content
      }
   }

   // Fallback: no ## sections found — treat all content as one unnamed section
   if (sections.length === 0) {
      const section = mkSection()
      section.blocks = mintdownToBlocks(text)
      sections.push(section)
   }

   return { meta, sections }
}

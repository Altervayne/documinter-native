import type { Block, DocMeta, Section } from '../types'
import { stripTags } from './helpers'

/** Convert stored rich HTML to Markdown inline syntax. */
function htmlToMd(html: string): string {
   if (!html) return ''
   // Use DOMParser for reliable parsing
   const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

   function walk(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      const inner = Array.from(el.childNodes).map(walk).join('')
      switch (tag) {
         case 'strong': case 'b':                  return `**${inner}**`
         case 'em':     case 'i':                  return `*${inner}*`
         case 's':      case 'del': case 'strike': return `~~${inner}~~`
         case 'u':                                 return inner // no standard Markdown for underline
         case 'br':                                return '\n'
         case 'a': {
            const href = (el as HTMLAnchorElement).getAttribute('href') ?? ''
            return href ? `[${inner}](${href})` : inner
         }
         default:                                  return inner
      }
   }

   return Array.from(doc.body.childNodes).map(walk).join('')
}

/** Escape pipe and backslash characters in table cells. */
function mdCell(text: string): string {
   return htmlToMd(text).replace(/\|/g, '\\|').replace(/\\/g, '\\\\').trim()
}

const CALLOUT_LABEL: Record<string, string> = {
   info:    'INFO',
   valid:   'VALID',
   warning: 'WARNING',
   danger:  'DANGER',
}

function blockToMd(block: Block): string {
   switch (block.type) {
      case 'p':
         return `${htmlToMd(block.text ?? '')}\n\n`

      case 'h3':
         return `### ${stripTags(block.text ?? '')}\n\n`

      case 'h4':
         return `#### ${stripTags(block.text ?? '')}\n\n`

      case 'callout': {
         const label = CALLOUT_LABEL[block.style ?? 'info']
         const body  = htmlToMd(block.text ?? '').split('\n').map(line => `> ${line}`).join('\n')
         return `> **[${label}]**\n${body}\n\n`
      }

      case 'code': {
         const lang = block.lang === 'windev' ? 'windev' : (block.lang ?? '')
         return `\`\`\`${lang}\n${block.code ?? ''}\n\`\`\`\n\n`
      }

      case 'list':
         return (block.items ?? []).map(listItem =>
            `- ${htmlToMd(listItem.text)}` +
            (listItem.children?.length ? '\n' + listItem.children.map(child => `  - ${htmlToMd(child)}`).join('\n') : '')
         ).join('\n') + '\n\n'

      case 'table': {
         const headers = block.headers ?? []
         const rows    = block.rows    ?? []
         if (!headers.length) return ''
         const headerRow = `| ${headers.map(header => mdCell(header)).join(' | ')} |`
         const separator = `| ${headers.map(() => '---').join(' | ')} |`
         const bodyRows  = rows.map(row =>
            `| ${row.map(cell => mdCell(cell)).join(' | ')} |`
         ).join('\n')
         return [headerRow, separator, bodyRows].filter(Boolean).join('\n') + '\n\n'
      }

      case 'image':
         if (!block.src) return ''
         return `![${block.alt ?? ''}](${block.src})${block.caption ? `\n*${block.caption}*` : ''}\n\n`

      case 'container': {
         const leftMd  = (block.left  ?? []).map(blockToMd).join('')
         const rightMd = (block.right ?? []).map(blockToMd).join('')
         return leftMd + (leftMd && rightMd ? '---\n\n' : '') + rightMd
      }

      default:
         return ''
   }
}

export function generateMarkdown(meta: DocMeta, sections: Section[]): string {
   const parts: string[] = []

   // Document header
   const titleLine  = meta.title  || 'Documentation'
   const metaParts  = [meta.module, meta.author, meta.date, meta.env].filter(Boolean)
   parts.push(`# ${titleLine}\n`)
   if (metaParts.length) parts.push(`*${metaParts.join(' — ')}*\n`)
   parts.push('\n---\n\n')

   // Sections
   sections.forEach((sec, index) => {
      parts.push(`## ${index + 1}. ${sec.title}\n\n`)
      sec.blocks.forEach(block => parts.push(blockToMd(block)))
      if (index < sections.length - 1) parts.push('---\n\n')
   })

   return parts.join('')
}

export function downloadMarkdown(meta: DocMeta, sections: Section[]): void {
   const md   = generateMarkdown(meta, sections)
   const slug = (meta.title || 'documentation')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
   const anchor = document.createElement('a')
   anchor.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
   anchor.download = slug + '.md'
   anchor.click()
   URL.revokeObjectURL(anchor.href)
}

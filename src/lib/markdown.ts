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
         default:                                  return inner
      }
   }

   return Array.from(doc.body.childNodes).map(walk).join('')
}

/** Escape pipe and backslash characters in table cells. */
function mdCell(s: string): string {
   return htmlToMd(s).replace(/\|/g, '\\|').replace(/\\/g, '\\\\').trim()
}

const CALLOUT_LABEL: Record<string, string> = {
   info:    'INFO',
   valid:   'VALID',
   warning: 'WARNING',
   danger:  'DANGER',
}

function blockToMd(b: Block): string {
   switch (b.type) {
      case 'p':
         return `${htmlToMd(b.text ?? '')}\n\n`

      case 'h3':
         return `### ${stripTags(b.text ?? '')}\n\n`

      case 'h4':
         return `#### ${stripTags(b.text ?? '')}\n\n`

      case 'callout': {
         const label = CALLOUT_LABEL[b.style ?? 'info']
         const body  = htmlToMd(b.text ?? '').split('\n').map(l => `> ${l}`).join('\n')
         return `> **[${label}]**\n${body}\n\n`
      }

      case 'code': {
         const lang = b.lang === 'windev' ? 'windev' : (b.lang ?? '')
         return `\`\`\`${lang}\n${b.code ?? ''}\n\`\`\`\n\n`
      }

      case 'list':
         return (b.items ?? []).map(i => `- ${htmlToMd(i)}`).join('\n') + '\n\n'

      case 'table': {
         const headers = b.headers ?? []
         const rows    = b.rows    ?? []
         if (!headers.length) return ''
         const header    = `| ${headers.map(h => mdCell(h)).join(' | ')} |`
         const separator = `| ${headers.map(() => '---').join(' | ')} |`
         const body      = rows.map(r =>
            `| ${r.map(c => mdCell(c)).join(' | ')} |`
         ).join('\n')
         return [header, separator, body].filter(Boolean).join('\n') + '\n\n'
      }

      case 'image':
         if (!b.src) return ''
         return `![${b.alt ?? ''}](${b.src})${b.caption ? `\n*${b.caption}*` : ''}\n\n`

      case 'container': {
         const leftMd  = (b.left  ?? []).map(blockToMd).join('')
         const rightMd = (b.right ?? []).map(blockToMd).join('')
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
   sections.forEach((sec, i) => {
      parts.push(`## ${i + 1}. ${sec.title}\n\n`)
      sec.blocks.forEach(b => parts.push(blockToMd(b)))
      if (i < sections.length - 1) parts.push('---\n\n')
   })

   return parts.join('')
}

export function downloadMarkdown(meta: DocMeta, sections: Section[]): void {
   const md   = generateMarkdown(meta, sections)
   const slug = (meta.title || 'documentation')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
   const a = document.createElement('a')
   a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
   a.download = slug + '.md'
   a.click()
   URL.revokeObjectURL(a.href)
}

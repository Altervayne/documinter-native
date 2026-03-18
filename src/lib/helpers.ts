import type { Block } from '../types'

export function esc(str: unknown): string {
   return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
}

/** Strip HTML tags — used for plain-text previews of rich-text content. */
export function stripTags(s: string): string {
   return s.replace(/<[^>]+>/g, '')
}

/**
 * Sanitize innerHTML from a rich ContentEditable.
 * Keeps only <strong>, <em>, <u>, <s>, <br>. Normalises <b>→<strong>, <i>→<em>.
 * Everything else (divs, spans, inline styles…) has its text content preserved.
 */
export function sanitizeRichText(html: string): string {
   const parser = new DOMParser()
   const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html')

   function walk(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
         const t = node.textContent ?? ''
         return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      if (tag === 'br') return '<br>'
      const inner = Array.from(el.childNodes).map(walk).join('')
      switch (tag) {
         case 'strong': case 'b':                    return inner ? `<strong>${inner}</strong>` : ''
         case 'em':     case 'i':                    return inner ? `<em>${inner}</em>` : ''
         case 'u':                                   return inner ? `<u>${inner}</u>` : ''
         case 's':      case 'del': case 'strike':   return inner ? `<s>${inner}</s>` : ''
         case 'span': {
            // Handle inline-style bold/italic produced by some browsers
            const s = (el as HTMLElement).style
            let r = inner
            if (s.fontWeight === 'bold' || s.fontWeight === '700') r = `<strong>${r}</strong>`
            if (s.fontStyle === 'italic') r = `<em>${r}</em>`
            if (s.textDecoration?.includes('underline')) r = `<u>${r}</u>`
            if (s.textDecoration?.includes('line-through')) r = `<s>${r}</s>`
            return r
         }
         default: return inner
      }
   }

   // Trim trailing <br> added by some browsers on last-line divs
   return Array.from(doc.body.childNodes).map(walk).join('').replace(/(<br>)+$/, '')
}

export const BLOCK_TYPE_LABELS: Record<string, string> = {
   p:         '¶',
   h3:        'H3',
   h4:        'H4',
   callout:   '!',
   code:      '<>',
   list:      '•',
   table:     '⊞',
   image:     '🖼',
   container: '⊟',
}

export function slugify(s: string): string {
   return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'doc'
}

export function blkPreview(b: Block): string {
   if (b.type === 'p' || b.type === 'h3' || b.type === 'h4')
      return stripTags(b.text ?? '').substring(0, 32)
   if (b.type === 'callout')
      return `[${b.style}] ${stripTags(b.text ?? '').substring(0, 20)}`
   if (b.type === 'code')
      return (b.code ?? '').substring(0, 32)
   if (b.type === 'list')
      return stripTags((b.items ?? [''])[0] ?? '').substring(0, 32)
   if (b.type === 'table')
      return `${(b.headers ?? []).length} col × ${(b.rows ?? []).length} rows`
   if (b.type === 'image')
      return `[Image] ${b.alt || '—'}`
   if (b.type === 'container') {
      const pct = Math.round((b.ratio ?? 0.5) * 100)
      return `Container (${pct}/${100 - pct})`
   }
   return ''
}

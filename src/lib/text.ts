/**
 * text.ts — Pure string and HTML utilities.
 *
 * Exports: esc, stripTags, sanitizeRichText, slugify
 *
 * These are stateless functions with no dependencies on document types.
 * They live here rather than in document.ts because they operate on raw
 * strings and have no knowledge of the block/section data model.
 */

/** Escape a value for safe HTML insertion. Covers &, <, >, and ". */
export function esc(str: unknown): string {
   return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
}

/** Strip all HTML tags, leaving only the text content. */
export function stripTags(s: string): string {
   return s.replace(/<[^>]+>/g, '')
}

/**
 * Sanitize innerHTML from a rich ContentEditable.
 * Keeps only <strong>, <em>, <u>, <s>, <a>, <br>.
 * Normalises <b>→<strong>, <i>→<em>.
 * Inline styles produced by some browsers (bold/italic/underline spans) are
 * converted to their semantic equivalents. Everything else loses its tags but
 * keeps its text content. Trailing <br> added by browsers is stripped.
 */
export function sanitizeRichText(html: string): string {
   const parser = new DOMParser()
   const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html')

   function walk(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
         const text = node.textContent ?? ''
         return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
         case 'a': {
            const href = (el as HTMLAnchorElement).getAttribute('href') ?? ''
            if (/^javascript:/i.test(href)) return inner
            return inner ? `<a href="${href.replace(/"/g, '&quot;')}">${inner}</a>` : ''
         }
         case 'span': {
            const style = (el as HTMLElement).style
            let result = inner
            if (style.fontWeight === 'bold' || style.fontWeight === '700') result = `<strong>${result}</strong>`
            if (style.fontStyle === 'italic') result = `<em>${result}</em>`
            if (style.textDecoration?.includes('underline')) result = `<u>${result}</u>`
            if (style.textDecoration?.includes('line-through')) result = `<s>${result}</s>`
            return result
         }
         default: return inner
      }
   }

   return Array.from(doc.body.childNodes).map(walk).join('').replace(/(<br>)+$/, '')
}

/** Convert a string to a URL-safe slug. Falls back to 'doc' for empty input. */
export function slugify(s: string): string {
   return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'doc'
}

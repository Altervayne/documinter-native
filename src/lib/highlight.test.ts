import { describe, it, expect } from 'vitest'
import { highlight } from './highlight'

// tokenize wraps each matched token in <span class="tok-{type}">…</span> and HTML-escapes the rest.
// Substring assertions keep these resilient to incidental spacing/markup.

describe('highlight', () => {
   it('wraps JavaScript keywords, numbers, and calls in token spans', () => {
      const output = highlight('const total = sum(1)', 'js')
      expect(output).toContain('<span class="tok-kw">const</span>')
      expect(output).toContain('<span class="tok-num">1</span>')
      expect(output).toContain('<span class="tok-fn">sum</span>')
   })

   it('wraps SQL keywords case-insensitively', () => {
      const output = highlight('select * from users', 'sql')
      expect(output).toContain('<span class="tok-kw">select</span>')
   })

   it('plain performs HTML escaping only, with no token spans', () => {
      const output = highlight('a < b && c', 'plain')
      expect(output).toBe('a &lt; b &amp;&amp; c')
      expect(output).not.toContain('<span')
   })
})

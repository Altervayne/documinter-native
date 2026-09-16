import { describe, it, expect } from 'vitest'
import { highlight } from './highlight'

// highlight() wraps each source line in <span class="code-line"> and each matched run in
// <span class="tok-{type}">, HTML-escaping the rest. Substring assertions stay resilient to spacing.

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

   it('plain escapes HTML and emits no token spans, inside one code line', () => {
      const output = highlight('a < b && c', 'plain')
      expect(output).toBe('<span class="code-line">a &lt; b &amp;&amp; c</span>')
   })
})

describe('highlight, line wrapping', () => {
   it('wraps each source line in its own code-line block', () => {
      const output = highlight('let a = 1\nlet b = 2', 'js')
      expect((output.match(/class="code-line"/g) ?? []).length).toBe(2)
   })

   it('splits a newline-spanning token, re-wrapping it per line', () => {
      const output = highlight('/* one\ntwo */', 'js')
      expect((output.match(/class="code-line"/g) ?? []).length).toBe(2)
      expect((output.match(/class="tok-cmt"/g) ?? []).length).toBe(2)
   })

   it('keeps a blank line as its own empty code-line', () => {
      const output = highlight('a\n\nb', 'plain')
      expect(output).toContain('<span class="code-line"></span>')
   })
})

describe('highlight, added languages', () => {
   it('TypeScript: type keywords and types (built-in and PascalCase)', () => {
      const output = highlight('interface User { id: number }', 'ts')
      expect(output).toContain('<span class="tok-kw">interface</span>')
      expect(output).toContain('<span class="tok-type">User</span>')
      expect(output).toContain('<span class="tok-type">number</span>')
   })

   it('Rust: keywords and a macro call keep their bang', () => {
      const output = highlight('fn main() { println!("hi") }', 'rust')
      expect(output).toContain('<span class="tok-kw">fn</span>')
      expect(output).toContain('<span class="tok-fn">println!</span>')
      expect(output).toContain('<span class="tok-str">"hi"</span>')
   })

   it('Bash: commands and variables', () => {
      const output = highlight('echo $HOME', 'bash')
      expect(output).toContain('<span class="tok-kw">echo</span>')
      expect(output).toContain('<span class="tok-type">$HOME</span>')
   })

   it('JSON: a key is distinct from a string value', () => {
      const output = highlight('{"name": "bob"}', 'json')
      expect(output).toContain('<span class="tok-fn">"name"</span>')
      expect(output).toContain('<span class="tok-str">"bob"</span>')
   })

   it('YAML: a key before its colon', () => {
      const output = highlight('name: bob', 'yaml')
      expect(output).toContain('<span class="tok-kw">name</span>')
   })

   it('Markdown: bold emphasis', () => {
      const output = highlight('**bold**', 'markdown')
      expect(output).toContain('<span class="tok-bold">**bold**</span>')
   })

   it('XML: tags and attributes', () => {
      const output = highlight('<note id="1">hi</note>', 'xml')
      expect(output).toContain('<span class="tok-kw">&lt;note</span>')
      expect(output).toContain('<span class="tok-fn">id</span>')
   })
})

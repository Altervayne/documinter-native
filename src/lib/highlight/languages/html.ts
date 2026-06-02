import type { Language } from '../types'

// ============================================================
// HTML — tags, attributes, values, comments, entities
// ============================================================
//
// Token mapping:
//   kw   (blue)   — tag names, including the opening <  or </
//   type (teal)   — <!DOCTYPE …>, HTML entities (&amp; etc.)
//   fn   (purple) — attribute names
//   str  (red)    — attribute values ("…" / '…')
//   cmt  (green)  — <!-- … --> comments
//   op   (muted)  — angle brackets, =, /
// ============================================================

export const html: Language = {
   name: 'html',
   rules: [
      // Comments — must come first to avoid misinterpreting <!-- as a tag
      { type: 'cmt',  pattern: /<!--[\s\S]*?-->/ },
      // DOCTYPE declaration
      { type: 'type', pattern: /<!DOCTYPE[^>]*>/i },
      // HTML entities (&amp; &#39; &#x2F; etc.)
      { type: 'type', pattern: /&(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[\da-fA-F]+);/ },
      // Opening / self-closing / closing tag names — includes the leading < or </
      { type: 'kw',   pattern: /<\/?[a-zA-Z][a-zA-Z0-9\-]*/ },
      // Attribute values (double or single quoted)
      { type: 'str',  pattern: /"[^"]*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      // Attribute names — word (with hyphens, colons for XML namespaces) before =
      { type: 'fn',   pattern: /[a-zA-Z_:][\w\-:.]*(?=\s*=)/ },
      // Standalone boolean attributes (word not followed by =, inside a tag)
      { type: 'fn',   pattern: /\b(?:async|autofocus|autoplay|checked|controls|default|defer|disabled|formnovalidate|hidden|ismap|loop|multiple|muted|nomodule|novalidate|open|readonly|required|reversed|selected|typemustmatch)\b/ },
      // Remaining punctuation
      { type: 'op',   pattern: /[<>=/]/ },
   ],
}

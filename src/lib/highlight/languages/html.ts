import type { Language } from '../types'

// #######################################################
// # HTML, TAGS, ATTRIBUTES, VALUES, COMMENTS, ENTITIES #
// #######################################################
//
// Token reuse: tag names -> kw, DOCTYPE + entities -> type, attribute names -> fn,
// attribute values -> str, comments -> cmt, brackets/=/ -> op.

export const html: Language = {
   name: 'html',
   rules: [
      // Comments first, so <!-- is not read as a tag.
      { type: 'cmt',  pattern: /<!--[\s\S]*?-->/ },
      { type: 'type', pattern: /<!DOCTYPE[^>]*>/i },
      { type: 'type', pattern: /&(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[\da-fA-F]+);/ },
      { type: 'kw',   pattern: /<\/?[a-zA-Z][a-zA-Z0-9\-]*/ },
      { type: 'str',  pattern: /"[^"]*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      { type: 'fn',   pattern: /[a-zA-Z_:][\w\-:.]*(?=\s*=)/ },
      // Standalone boolean attributes (no = value).
      { type: 'fn',   pattern: /\b(?:async|autofocus|autoplay|checked|controls|default|defer|disabled|formnovalidate|hidden|ismap|loop|multiple|muted|nomodule|novalidate|open|readonly|required|reversed|selected|typemustmatch)\b/ },
      { type: 'op',   pattern: /[<>=/]/ },
   ],
}

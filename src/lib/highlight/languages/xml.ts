import type { Language } from '../types'

export const xml: Language = {
   name: 'xml',
   rules: [
      { type: 'cmt',  pattern: /<!--[\s\S]*?-->/ },
      { type: 'cmt',  pattern: /<!\[CDATA\[[\s\S]*?\]\]>/ },
      // Processing instruction / XML declaration, e.g. <?xml version="1.0"?>.
      { type: 'type', pattern: /<\?[\s\S]*?\?>/ },
      { type: 'type', pattern: /<!DOCTYPE[^>]*>/i },
      // Entity reference, named or numeric.
      { type: 'type', pattern: /&(?:[a-zA-Z][\w.-]*|#\d+|#x[\da-fA-F]+);/ },
      // Tag, with an optional namespace prefix (ns:tag).
      { type: 'kw',   pattern: /<\/?[a-zA-Z_][\w.-]*(?::[a-zA-Z_][\w.-]*)?/ },
      { type: 'str',  pattern: /"[^"]*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      // Attribute name (before the =).
      { type: 'fn',   pattern: /[a-zA-Z_:][\w\-:.]*(?=\s*=)/ },
      { type: 'op',   pattern: /[<>/=]/ },
   ],
}

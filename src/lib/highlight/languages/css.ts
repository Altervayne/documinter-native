import type { Language } from '../types'

// ############################################################
// # CSS, PROPERTIES, SELECTORS, VALUES, AT-RULES, VARIABLES #
// ############################################################
//
// Token reuse: property names -> kw, at-rules + pseudos -> type, selectors/vars/functions -> fn,
// numbers + hex colours -> num, strings -> str, comments -> cmt, punctuation -> op.

export const css: Language = {
   name: 'css',
   rules: [
      { type: 'cmt',  pattern: /\/\*[\s\S]*?\*\// },
      { type: 'type', pattern: /@[\w-]+/ },
      // Hex colours before the ID-selector rule, so short hex wins over #id.
      { type: 'num',  pattern: /#[\da-fA-F]{3,8}\b/ },
      { type: 'num',  pattern: /\b\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|svh|svw|dvh|dvw|pt|pc|cm|mm|in|fr|ch|ex|deg|rad|grad|turn|s|ms|dpi|dpcm|dppx)?\b/ },
      { type: 'str',  pattern: /"[^"]*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      { type: 'fn',   pattern: /--[\w-]+/ },
      // Pseudo-elements/classes before the generic : operator.
      { type: 'type', pattern: /::?[\w-]+/ },
      // Class/ID selectors; an ID starts with a letter, so it is not read as a hex colour.
      { type: 'fn',   pattern: /[.#][a-zA-Z_][\w-]*/ },
      { type: 'fn',   pattern: /\b[\w-]+(?=\s*\()/ },
      // Property names: a word before a single colon, not ::.
      { type: 'kw',   pattern: /\b[\w-]+(?=\s*:(?!:))/ },
      { type: 'op',   pattern: /[{}()[\]:;,!>+~*=|^$@]/ },
   ],
}

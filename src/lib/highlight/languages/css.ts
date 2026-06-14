import type { Language } from '../types'

// ############################################################
// # CSS — PROPERTIES, SELECTORS, VALUES, AT-RULES, VARIABLES #
// ############################################################
//
// Token mapping:
//   kw   (blue)   — property names (word before : that isn't ::pseudo)
//   type (teal)   — at-rules (@media, @keyframes…), pseudo-classes/elements
//   fn   (purple) — class/ID selectors (.foo #bar), CSS variables (--x), functions (calc()…)
//   num  (green)  — numbers with units, hex colours (#fff, #rrggbb)
//   str  (red)    — quoted strings
//   cmt  (green)  — /* … */ comments
//   op   (muted)  — braces, semicolons, colons, punctuation

export const css: Language = {
   name: 'css',
   rules: [
      // Block comments
      { type: 'cmt',  pattern: /\/\*[\s\S]*?\*\// },
      // At-rules (@media, @import, @keyframes, @supports, etc.)
      { type: 'type', pattern: /@[\w-]+/ },
      // Hex colours — before ID selector rule to take priority on short hex strings
      { type: 'num',  pattern: /#[\da-fA-F]{3,8}\b/ },
      // Numbers with optional CSS units
      { type: 'num',  pattern: /\b\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|svh|svw|dvh|dvw|pt|pc|cm|mm|in|fr|ch|ex|deg|rad|grad|turn|s|ms|dpi|dpcm|dppx)?\b/ },
      // Quoted strings (font names, url values, content, etc.)
      { type: 'str',  pattern: /"[^"]*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      // CSS custom properties (--variable-name)
      { type: 'fn',   pattern: /--[\w-]+/ },
      // Pseudo-elements (::before) and pseudo-classes (:hover) — before generic : op
      { type: 'type', pattern: /::?[\w-]+/ },
      // Class and ID selectors (.foo, #bar — ID starts with letter to avoid hex conflict)
      { type: 'fn',   pattern: /[.#][a-zA-Z_][\w-]*/ },
      // CSS function calls: url(), calc(), var(), rgba(), linear-gradient(), etc.
      { type: 'fn',   pattern: /\b[\w-]+(?=\s*\()/ },
      // Property names — hyphenated word before a single colon (not ::)
      { type: 'kw',   pattern: /\b[\w-]+(?=\s*:(?!:))/ },
      // Operators and punctuation
      { type: 'op',   pattern: /[{}()[\]:;,!>+~*=|^$@]/ },
   ],
}

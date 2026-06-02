import type { Language } from '../types'

// ============================================================
// C — C99/C11 keywords + common extended types
// ============================================================

const KEYWORDS = [
   // Control flow
   'break', 'case', 'continue', 'default', 'do', 'else', 'for',
   'goto', 'if', 'return', 'switch', 'while',
   // Storage / linkage
   'auto', 'extern', 'inline', 'register', 'restrict', 'static',
   // Type keywords
   'char', 'const', 'double', 'enum', 'float', 'int', 'long',
   'short', 'signed', 'sizeof', 'struct', 'typedef', 'union',
   'unsigned', 'void', 'volatile',
   // C11 _keyword forms
   '_Alignas', '_Alignof', '_Atomic', '_Bool', '_Complex',
   '_Generic', '_Imaginary', '_Noreturn', '_Static_assert', '_Thread_local',
]

// Extended types and well-known macros from standard headers
const TYPES = [
   'bool', 'true', 'false', 'NULL',
   'int8_t', 'int16_t', 'int32_t', 'int64_t',
   'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
   'int_least8_t', 'int_least16_t', 'int_least32_t', 'int_least64_t',
   'uint_least8_t', 'uint_least16_t', 'uint_least32_t', 'uint_least64_t',
   'int_fast8_t', 'int_fast16_t', 'int_fast32_t', 'int_fast64_t',
   'uint_fast8_t', 'uint_fast16_t', 'uint_fast32_t', 'uint_fast64_t',
   'intmax_t', 'uintmax_t', 'intptr_t', 'uintptr_t',
   'size_t', 'ssize_t', 'ptrdiff_t', 'FILE', 'wchar_t',
]

const kwPattern   = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`)
const typePattern = new RegExp(`\\b(${TYPES.join('|')})\\b`)

export const c: Language = {
   name: 'c',
   rules: [
      // Single-line comments
      { type: 'cmt',  pattern: /\/\/[^\n]*/ },
      // Block comments
      { type: 'cmt',  pattern: /\/\*[\s\S]*?\*\// },
      // Preprocessor lines (#include, #define, etc.) — entire line as one token
      { type: 'type', pattern: /#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|line|warning)\b[^\n]*/ },
      // String literals
      { type: 'str',  pattern: /L?"(?:[^"\\]|\\.)*"/ },
      // Character literals (single char or escape sequence)
      { type: 'str',  pattern: /'(?:[^'\\]|\\.)'/ },
      // Numbers: hex, octal, float (with exponent), int — with optional suffixes
      { type: 'num',  pattern: /\b0x[\da-fA-F]+[uUlL]*\b|\b0[0-7]+[uUlL]*\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*\b/ },
      // Extended types and standard macros
      { type: 'type', pattern: typePattern },
      // Keywords
      { type: 'kw',   pattern: kwPattern },
      // Function / macro calls
      { type: 'fn',   pattern: /\b([a-zA-Z_]\w*)\s*(?=\()/ },
      // Operators and punctuation (including -> and pointer *)
      { type: 'op',   pattern: /[+\-*/%=<>!&|^~?:.;,(){}[\]]+/ },
   ],
}

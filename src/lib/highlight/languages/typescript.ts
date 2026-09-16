import type { Language } from '../types'

// JavaScript keywords plus the TypeScript type-system keywords, enough for short snippets.
const KEYWORDS = [
   'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
   'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
   'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'throw', 'try', 'typeof', 'var',
   'void', 'while', 'with', 'yield', 'async', 'await', 'from', 'this', 'as', 'is', 'keyof', 'infer',
   'satisfies', 'declare', 'abstract', 'implements', 'interface', 'enum', 'namespace', 'type',
   'readonly', 'public', 'private', 'protected', 'override', 'get', 'set',
   'true', 'false', 'null', 'undefined',
]
const kwPattern = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`)

// The built-in / primitive types; any other PascalCase word is read as a type below.
const TYPES = [
   'string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'object', 'symbol', 'bigint',
   'Array', 'Promise', 'Record', 'Partial', 'Readonly', 'Map', 'Set',
]
const typePattern = new RegExp(`\\b(${TYPES.join('|')})\\b`)

export const typescript: Language = {
   name: 'typescript',
   rules: [
      { type: 'cmt',  pattern: /\/\/[^\n]*/ },
      { type: 'cmt',  pattern: /\/\*[\s\S]*?\*\// },
      { type: 'str',  pattern: /`[\s\S]*?`/ },
      { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
      { type: 'str',  pattern: /'(?:[^'\\]|\\.)*'/ },
      { type: 'num',  pattern: /\b0x[\da-fA-F]+\b|\b\d+\.?\d*\b/ },
      { type: 'kw',   pattern: kwPattern },
      { type: 'type', pattern: typePattern },
      { type: 'type', pattern: /\b[A-Z][A-Za-z0-9_]*\b/ },
      { type: 'fn',   pattern: /\b([a-zA-Z_$][\w$]*)\s*(?=\()/ },
      { type: 'op',   pattern: /[+\-*/%=<>!&|^~?:]+/ },
   ],
}

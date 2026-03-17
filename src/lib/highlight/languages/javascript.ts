import type { Language } from '../types'

// JS/TS subset — good enough for short snippets
const KEYWORDS = [
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
  'of', 'return', 'static', 'super', 'switch', 'throw', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'async', 'await', 'from',
  'true', 'false', 'null', 'undefined', 'this', 'type', 'interface',
  'enum', 'implements', 'namespace',
]

const kwPattern = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`)

export const javascript: Language = {
  name: 'javascript',
  rules: [
    { type: 'cmt',  pattern: /\/\/[^\n]*/  },
    { type: 'cmt',  pattern: /\/\*[\s\S]*?\*\// },
    { type: 'str',  pattern: /`[\s\S]*?`/ },
    { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
    { type: 'str',  pattern: /'(?:[^'\\]|\\.)*'/ },
    { type: 'num',  pattern: /\b0x[\da-fA-F]+\b|\b\d+\.?\d*\b/ },
    { type: 'kw',   pattern: kwPattern },
    { type: 'fn',   pattern: /\b([a-zA-Z_$][\w$]*)\s*(?=\()/ },
    { type: 'op',   pattern: /[+\-*/%=<>!&|^~?:]+/ },
  ],
}

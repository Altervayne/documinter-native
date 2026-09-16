import type { Language } from '../types'

// ######################################################
// # PYTHON KEYWORD LIST (ALL RESERVED WORDS AS OF 3.X) #
// ######################################################

const KEYWORDS = [
   'False', 'None', 'True',
   'and', 'as', 'assert', 'async', 'await',
   'break', 'class', 'continue', 'def', 'del',
   'elif', 'else', 'except', 'finally', 'for',
   'from', 'global', 'if', 'import', 'in', 'is',
   'lambda', 'nonlocal', 'not', 'or', 'pass',
   'raise', 'return', 'try', 'while', 'with', 'yield',
]

const BUILTINS = [
   'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint',
   'bytearray', 'bytes', 'callable', 'chr', 'classmethod',
   'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod',
   'enumerate', 'eval', 'exec', 'filter', 'float', 'format',
   'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help',
   'hex', 'id', 'input', 'int', 'isinstance', 'issubclass',
   'iter', 'len', 'list', 'locals', 'map', 'max', 'memoryview',
   'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
   'print', 'property', 'range', 'repr', 'reversed', 'round',
   'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str',
   'sum', 'super', 'tuple', 'type', 'vars', 'zip',
]

const kwPattern      = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`)
const builtinPattern = new RegExp(`\\b(${BUILTINS.join('|')})\\b(?=\\s*\\()`)

export const python: Language = {
   name: 'python',
   rules: [
      { type: 'cmt',  pattern: /#[^\n]*/  },

      // Triple-quoted strings before single-quoted, with the f/b/r/u prefixes (up to 2).
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}"""[\s\S]*?"""/ },
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}'''[\s\S]*?'''/ },

      // Single-line strings; a newline terminates (an unclosed string is a Python error).
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}"(?:[^"\\\n]|\\.)*"/ },
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}'(?:[^'\\\n]|\\.)*'/ },

      { type: 'num',  pattern: /\b0x[\da-fA-F]+\b|\b0o[0-7]+\b|\b0b[01]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?[jJ]?\b/ },

      // Decorators reuse the type token (teal) for visual distinction.
      { type: 'type', pattern: /@[\w.]+/ },

      { type: 'kw',   pattern: kwPattern },
      { type: 'fn',   pattern: builtinPattern },
      { type: 'fn',   pattern: /\b([a-zA-Z_]\w*)\s*(?=\()/ },
      { type: 'op',   pattern: /[+\-*/%=<>!&|^~@:,]+/ },
   ],
}

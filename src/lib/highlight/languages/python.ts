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

// Built-in functions and types commonly seen in code snippets
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
      // Comments (# to end of line)
      { type: 'cmt',  pattern: /#[^\n]*/  },

      // Triple-quoted strings, must precede single-quoted rules
      // Handles f""" b""" r""" rf""" etc. (up to 2-char prefix)
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}"""[\s\S]*?"""/ },
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}'''[\s\S]*?'''/ },

      // Single-line strings, newline terminates (unclosed = error in Python)
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}"(?:[^"\\\n]|\\.)*"/ },
      { type: 'str',  pattern: /[fFbBrRuU]{0,2}'(?:[^'\\\n]|\\.)*'/ },

      // Numbers: hex  octal  binary  float/int with optional exponent or complex suffix
      { type: 'num',  pattern: /\b0x[\da-fA-F]+\b|\b0o[0-7]+\b|\b0b[01]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?[jJ]?\b/ },

      // Decorators, @name or @module.name, use tok-type (teal) for visual distinction
      { type: 'type', pattern: /@[\w.]+/ },

      { type: 'kw',   pattern: kwPattern },

      // Built-in function calls (word followed by open-paren)
      { type: 'fn',   pattern: builtinPattern },

      // Any other function / method call
      { type: 'fn',   pattern: /\b([a-zA-Z_]\w*)\s*(?=\()/ },

      { type: 'op',   pattern: /[+\-*/%=<>!&|^~@:,]+/ },
   ],
}

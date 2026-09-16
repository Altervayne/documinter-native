import type { Language } from '../types'

const KEYWORDS = [
   'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in',
   'function', 'select', 'return', 'break', 'continue', 'local', 'export', 'readonly', 'declare',
   'set', 'unset', 'shift', 'exit', 'source', 'alias', 'echo', 'cd',
]
const kwPattern = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`)

export const bash: Language = {
   name: 'bash',
   rules: [
      { type: 'cmt',  pattern: /#[^\n]*/ },
      { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      // Variables: $name, ${expr}, and the specials ($?, $@, $1, ...).
      { type: 'type', pattern: /\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[@*#?$!0-9-]/ },
      { type: 'kw',   pattern: kwPattern },
      // Short / long flags. The letter requirement keeps a bare "-" or a "-5" out.
      { type: 'fn',   pattern: /-{1,2}[A-Za-z][\w-]*/ },
      { type: 'num',  pattern: /\b\d+\b/ },
      { type: 'op',   pattern: /[|&;<>(){}=]+/ },
   ],
}

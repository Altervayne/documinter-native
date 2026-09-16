import type { Language } from '../types'

export const yaml: Language = {
   name: 'yaml',
   rules: [
      { type: 'cmt',  pattern: /#[^\n]*/ },
      // Document separator / end. A key-value line never starts with a bare --- so this is unambiguous.
      { type: 'op',   pattern: /^(?:---|\.\.\.)$/m },
      { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
      { type: 'str',  pattern: /'[^']*'/ },
      // A key at line start (past indent + an optional list dash), colon followed by space or EOL, so a
      // "url: http://x" value keeps its "//" out of the match.
      { type: 'kw',   pattern: /^\s*(?:-\s+)?[\w.-]+(?=\s*:(?:\s|$))/m },
      // Anchors (&name) and aliases (*name).
      { type: 'type', pattern: /[&*][\w-]+/ },
      { type: 'kw',   pattern: /\b(?:true|false|null|yes|no|on|off)\b/i },
      { type: 'num',  pattern: /-?\b\d+\.?\d*\b/ },
      { type: 'op',   pattern: /[-:>|]/ },
   ],
}

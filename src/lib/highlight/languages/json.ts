import type { Language } from '../types'

export const json: Language = {
   name: 'json',
   rules: [
      // A key is the string immediately before a colon; it must win over the value-string rule below.
      { type: 'fn',  pattern: /"(?:[^"\\]|\\.)*"(?=\s*:)/ },
      { type: 'str', pattern: /"(?:[^"\\]|\\.)*"/ },
      { type: 'kw',  pattern: /\b(?:true|false|null)\b/ },
      { type: 'num', pattern: /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/ },
      { type: 'op',  pattern: /[{}[\]:,]/ },
   ],
}

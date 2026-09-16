import type { Language } from '../types'

const KEYWORDS = [
   'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern',
   'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub',
   'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe',
   'use', 'where', 'while',
]
const kwPattern = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`)

const TYPES = [
   'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
   'f32', 'f64', 'bool', 'char', 'str', 'String', 'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc',
   'HashMap', 'HashSet',
]
const typePattern = new RegExp(`\\b(${TYPES.join('|')})\\b`)

export const rust: Language = {
   name: 'rust',
   rules: [
      { type: 'cmt',  pattern: /\/\/[^\n]*/ },
      { type: 'cmt',  pattern: /\/\*[\s\S]*?\*\// },
      { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
      // Char literal before the lifetime rule: a lifetime ('a) has no closing quote, so it only reaches
      // the lifetime rule when the char rule fails.
      { type: 'str',  pattern: /'(?:[^'\\]|\\.)'/ },
      { type: 'type', pattern: /'[a-z_]\w*\b/ },
      { type: 'num',  pattern: /\b0x[\da-fA-F_]+\b|\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?(?:[iuf](?:8|16|32|64|128|size))?\b/ },
      // Attribute: #[derive(...)] / #![feature].
      { type: 'type', pattern: /#!?\[[^\]]*\]/ },
      { type: 'kw',   pattern: kwPattern },
      { type: 'type', pattern: typePattern },
      { type: 'type', pattern: /\b[A-Z][A-Za-z0-9_]*\b/ },
      // Function or macro call (println! keeps its bang).
      { type: 'fn',   pattern: /\b([a-zA-Z_]\w*)!?\s*(?=\()/ },
      { type: 'op',   pattern: /[+\-*/%=<>!&|^~?:.@]+/ },
   ],
}

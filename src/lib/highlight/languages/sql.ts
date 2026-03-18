import type { Language } from '../types'

const KEYWORDS = [
   'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
   'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'IS', 'NULL', 'BETWEEN',
   'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
   'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
   'ALTER', 'DROP', 'INDEX', 'VIEW', 'DISTINCT', 'EXISTS', 'CASE', 'WHEN',
   'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE', 'PRIMARY', 'KEY', 'FOREIGN',
   'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'NOT NULL', 'UNIQUE',
   'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST',
   'TOP',
]

const kwPattern = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'i')

export const sql: Language = {
   name: 'sql',
   rules: [
      { type: 'cmt', pattern: /--[^\n]*/ },
      { type: 'cmt', pattern: /\/\*[\s\S]*?\*\// },
      { type: 'str', pattern: /'(?:[^'\\]|\\.)*'/ },
      { type: 'str', pattern: /"(?:[^"\\]|\\.)*"/ },
      { type: 'num', pattern: /\b\d+\.?\d*\b/ },
      { type: 'kw',  pattern: kwPattern },
      { type: 'fn',  pattern: /\b([a-zA-Z_][\w]*)\s*(?=\()/ },
      { type: 'op',  pattern: /[=<>!+\-*/%]+/ },
   ],
}

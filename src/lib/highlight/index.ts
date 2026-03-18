import type { CodeLang } from '../../types'
import { tokenize } from './tokenize'
import { windev } from './languages/windev'
import { javascript } from './languages/javascript'
import { sql } from './languages/sql'
import { plain } from './languages/plain'

const LANGUAGES = { windev, js: javascript, sql, plain }

export function highlight(code: string, lang: CodeLang = 'windev'): string {
   const language = LANGUAGES[lang] ?? plain
   return tokenize(code, language.rules)
}

export const LANG_LABELS: Record<CodeLang, string> = {
   windev: 'WinDev',
   js:     'JS',
   sql:    'SQL',
   plain:  'Plain',
}

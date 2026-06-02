import type { CodeLang } from '../../types'
import { tokenize } from './tokenize'
import { windev } from './languages/windev'
import { javascript } from './languages/javascript'
import { sql } from './languages/sql'
import { python } from './languages/python'
import { c } from './languages/c'
import { html } from './languages/html'
import { css } from './languages/css'
import { plain } from './languages/plain'

const LANGUAGES = { windev, js: javascript, sql, python, c, html, css, plain }

export function highlight(code: string, lang: CodeLang = 'windev'): string {
   const language = LANGUAGES[lang] ?? plain
   return tokenize(code, language.rules)
}

export const LANG_LABELS: Record<CodeLang, string> = {
   windev: 'W-Langage',
   js:     'JavaScript',
   sql:    'SQL',
   python: 'Python',
   c:      'C',
   html:   'HTML',
   css:    'CSS',
   plain:  'Plaintext',
}

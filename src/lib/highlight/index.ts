import type { CodeLang } from '../../types'
import { tokenize } from './tokenize'
import { windev } from './languages/windev'
import { javascript } from './languages/javascript'
import { typescript } from './languages/typescript'
import { python } from './languages/python'
import { rust } from './languages/rust'
import { c } from './languages/c'
import { sql } from './languages/sql'
import { bash } from './languages/bash'
import { json } from './languages/json'
import { yaml } from './languages/yaml'
import { html } from './languages/html'
import { xml } from './languages/xml'
import { css } from './languages/css'
import { markdown } from './languages/markdown'
import { plain } from './languages/plain'

const LANGUAGES = {
   windev, js: javascript, ts: typescript, python, rust, c, sql,
   bash, json, yaml, html, xml, css, markdown, plain,
}

/** Highlight a code block, wrapping each source line so long lines wrap (with a hanging indent) rather
 *  than scrolling. The Markdown editor overlay calls tokenize directly for its own flat, aligned output. */
export function highlight(code: string, lang: CodeLang = 'windev'): string {
   const language = LANGUAGES[lang] ?? plain
   return tokenize(code, language.rules, true)
}

export const LANG_LABELS: Record<CodeLang, string> = {
   windev:   'W-Langage',
   js:       'JavaScript',
   ts:       'TypeScript',
   python:   'Python',
   rust:     'Rust',
   c:        'C',
   sql:      'SQL',
   bash:     'Bash',
   json:     'JSON',
   yaml:     'YAML',
   html:     'HTML',
   xml:      'XML',
   css:      'CSS',
   markdown: 'Markdown',
   plain:    'Plaintext',
}

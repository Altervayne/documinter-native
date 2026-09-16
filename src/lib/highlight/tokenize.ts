import type { TokenRule } from './types'

function escChar(text: string): string {
   return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Greedy left-to-right scan: at each position the first matching rule wins, patterns forced sticky so a
 *  match is anchored at the cursor. Yields the matched run (with its token type) or a single unmatched
 *  character. */
function* scan(code: string, rules: TokenRule[]): Generator<{ text: string; type?: string }> {
   const stickyRules = rules.map(rule => ({
      type: rule.type,
      re: new RegExp(rule.pattern.source, rule.pattern.flags.includes('y') ? rule.pattern.flags : rule.pattern.flags + 'y'),
   }))

   let pos = 0
   while (pos < code.length) {
      let matched = false
      for (const { type, re } of stickyRules) {
         re.lastIndex = pos
         const match = re.exec(code)
         if (match && match[0].length > 0) {
            yield { text: match[0], type }
            pos += match[0].length
            matched = true
            break
         }
      }
      if (!matched) {
         yield { text: code[pos] }
         pos++
      }
   }
}

/**
 * Tokenize `code` to HTML, wrapping each matched run in `<span class="tok-{type}">` and escaping the rest.
 *
 * `wrapLines` false (the default) returns one flat string with newlines preserved, the shape the Markdown
 * editor overlay needs to stay aligned with its textarea. `wrapLines` true wraps every source line in a
 * `<span class="code-line">` block, splitting a run that spans newlines (a block comment, a template
 * string) and re-wrapping it per line; the per-line blocks let CSS hang-indent wrapped continuations
 * instead of scrolling them, so a long line still prints in full.
 */
export function tokenize(code: string, rules: TokenRule[], wrapLines = false): string {
   if (!wrapLines) {
      let out = ''
      for (const { text, type } of scan(code, rules)) {
         out += type ? `<span class="tok-${type}">${escChar(text)}</span>` : escChar(text)
      }
      return out
   }

   const lines: string[] = ['']
   for (const { text, type } of scan(code, rules)) {
      const segments = text.split('\n')
      segments.forEach((segment, index) => {
         if (index > 0) lines.push('')
         if (segment === '') return
         const escaped = escChar(segment)
         lines[lines.length - 1] += type ? `<span class="tok-${type}">${escaped}</span>` : escaped
      })
   }
   return lines.map(line => `<span class="code-line">${line}</span>`).join('')
}

import type { TokenRule } from './types'

function escChar(ch: string): string {
   return ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Greedy left-to-right tokenizer: at each position the first matching rule wins. Patterns are forced
 *  sticky so a match is anchored at the cursor. Returns HTML with <span class="tok-{type}"> wrappers. */
export function tokenize(code: string, rules: TokenRule[]): string {
   const stickyRules = rules.map(rule => ({
      type: rule.type,
      re: new RegExp(rule.pattern.source, rule.pattern.flags.includes('y') ? rule.pattern.flags : rule.pattern.flags + 'y'),
   }))

   let pos = 0
   let out = ''

   while (pos < code.length) {
      let matched = false

      for (const { type, re } of stickyRules) {
         re.lastIndex = pos
         const match = re.exec(code)
         if (match) {
            out += `<span class="tok-${type}">${escChar(match[0])}</span>`
            pos += match[0].length
            matched = true
            break
         }
      }

      if (!matched) {
         out += escChar(code[pos])
         pos++
      }
   }

   return out
}

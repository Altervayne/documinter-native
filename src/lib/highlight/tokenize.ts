import type { TokenRule } from './types'

function escChar(ch: string): string {
  return ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Greedy left-to-right tokenizer.
 * Each rule's pattern must have the `y` (sticky) flag.
 * Returns an HTML string with <span class="tok-{type}">…</span> wrappers.
 */
export function tokenize(code: string, rules: TokenRule[]): string {
  // Ensure all patterns are sticky
  const stickyRules = rules.map(r => ({
    type: r.type,
    re: new RegExp(r.pattern.source, r.pattern.flags.includes('y') ? r.pattern.flags : r.pattern.flags + 'y'),
  }))

  let pos = 0
  let out = ''

  while (pos < code.length) {
    let matched = false

    for (const { type, re } of stickyRules) {
      re.lastIndex = pos
      const m = re.exec(code)
      if (m) {
        out += `<span class="tok-${type}">${escChar(m[0])}</span>`
        pos += m[0].length
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

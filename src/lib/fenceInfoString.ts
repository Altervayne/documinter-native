/**
 * The shared `key=value` info-string tokenizer/quoter used by every fenced block whose options
 * ride the fence's info string (the line right after the opening backticks). The grammar is
 * format-agnostic, not graph-specific, so `graphFence.ts` and `imageMarkupFence.ts` both reuse the
 * exact same quoting/escaping/tokenizing rules instead of duplicating them.
 *
 * Grammar: whitespace-separated `key=value` tokens; a value containing whitespace or a double
 * quote is wrapped in `"..."` with `\"`/`\\` escaped inside. Parsing a malformed or hand-edited
 * info string never throws.
 */

/** Whether a scalar must be double-quoted on the info string (spaces, quotes, or empty). */
export function infoValueNeedsQuote(value: string): boolean {
   return value === '' || /[\s"]/.test(value)
}

/** Serialize one info-string value, double-quoting + escaping only when necessary. */
export function serializeInfoValue(value: string): string {
   if (!infoValueNeedsQuote(value)) return value
   return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** Unescape a value that arrived double-quoted (drops the quotes, resolves `\"` and `\\`). */
export function unquoteInfoValue(raw: string): string {
   if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw
   const inner = raw.slice(1, -1)
   let result = ''
   let index  = 0
   while (index < inner.length) {
      if (inner[index] === '\\' && index + 1 < inner.length) {
         result += inner[index + 1]
         index += 2
      } else {
         result += inner[index]
         index++
      }
   }
   return result
}

/**
 * Split a fence info string into whitespace-separated tokens, keeping a double-quoted region
 * (including any escaped quotes inside it) as part of a single token. So
 * `graph type=bar title="Quarterly revenue"` tokenizes to
 * `['graph', 'type=bar', 'title="Quarterly revenue"']`, not on the space inside the title.
 */
export function tokenizeInfoString(info: string): string[] {
   const source = info.trim()
   const tokens: string[] = []
   let index = 0

   while (index < source.length) {
      // Skip run of whitespace between tokens.
      while (index < source.length && /\s/.test(source[index])) index++
      if (index >= source.length) break

      let token = ''
      while (index < source.length && !/\s/.test(source[index])) {
         if (source[index] === '"') {
            // Consume the whole quoted region, quotes and escapes included, so an inner
            // space does not end the token.
            token += source[index]
            index++
            while (index < source.length && source[index] !== '"') {
               if (source[index] === '\\' && index + 1 < source.length) {
                  token += source[index] + source[index + 1]
                  index += 2
               } else {
                  token += source[index]
                  index++
               }
            }
            if (index < source.length) { token += source[index]; index++ } // closing quote
         } else {
            token += source[index]
            index++
         }
      }
      tokens.push(token)
   }
   return tokens
}

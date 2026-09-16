/*
 * The inline-content model: parse/render InlineContent to and from HTML, Mintdown inline text, and
 * live DOM, plus cursor + split helpers. Almost all pure; domToInlineContent and computeCursorPosition
 * READ the live DOM without mutating it. Color application and the sole Selection writer live in
 * inlineFormatting.ts.
 */

import { esc } from './text'
import type { CursorPosition, InlineContent, InlineRun } from '../types'

// ##################
// # INTERNAL TYPES #
// ##################

interface ParseFlags {
   bold?:          boolean
   italic?:        boolean
   underline?:     boolean
   strikethrough?: boolean
   link?:          string
   color?:         string
   highlight?:     string
}

// #####################################################
// # PRIVATE HELPERS, SHARED BY PARSING AND RENDERING #
// #####################################################

/** Normalize a browser-read CSS color back to lowercase hex. Setting `style.color='#b91c1c'` reads
 *  back as `rgb(185, 28, 28)`, which would break inlineContentEquals round-trips. Handles rgb()/rgba()
 *  (alpha dropped) and #rgb shorthand; anything else is returned lowercased. */
function normalizeColorValue(cssColor: string): string {
   const trimmed = cssColor.trim()

   const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
   if (rgbMatch) {
      const red   = parseInt(rgbMatch[1], 10)
      const green = parseInt(rgbMatch[2], 10)
      const blue  = parseInt(rgbMatch[3], 10)
      return '#'
         + red.toString(16).padStart(2, '0')
         + green.toString(16).padStart(2, '0')
         + blue.toString(16).padStart(2, '0')
   }

   const shortHexMatch = trimmed.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/)
   if (shortHexMatch) {
      return '#'
         + shortHexMatch[1].repeat(2)
         + shortHexMatch[2].repeat(2)
         + shortHexMatch[3].repeat(2)
   }

   return trimmed.toLowerCase()
}

function flagsMatch(run: InlineRun, flags: ParseFlags): boolean {
   return !!run.bold          === !!flags.bold
       && !!run.italic        === !!flags.italic
       && !!run.underline     === !!flags.underline
       && !!run.strikethrough === !!flags.strikethrough
       && (run.link      ?? '') === (flags.link      ?? '')
       && (run.color     ?? '') === (flags.color     ?? '')
       && (run.highlight ?? '') === (flags.highlight ?? '')
}

/** Append text to the run list, merging with the previous run when flags match. */
function appendRun(runs: InlineRun[], text: string, flags: ParseFlags): void {
   if (!text) return
   const last = runs[runs.length - 1]
   if (last && flagsMatch(last, flags)) {
      last.text += text
      return
   }
   const run: InlineRun = { text }
   if (flags.bold)          run.bold          = true
   if (flags.italic)        run.italic        = true
   if (flags.underline)     run.underline     = true
   if (flags.strikethrough) run.strikethrough = true
   if (flags.link)          run.link          = flags.link
   if (flags.color)         run.color         = flags.color
   if (flags.highlight)     run.highlight     = flags.highlight
   runs.push(run)
}

/** Strip trailing '\n'-only runs from a run list. Every write path calls it; also exported so the
 *  migration pass can sanitize richText from older saves that predate this normalization. */
export function stripTrailingNewlines(runs: InlineRun[]): InlineRun[] {
   const result = [...runs]
   while (result.length > 0) {
      const last = result[result.length - 1]
      const stripped = last.text.replace(/\n+$/, '')
      if (stripped.length === 0) {
         result.pop()
      } else if (stripped !== last.text) {
         result[result.length - 1] = { ...last, text: stripped }
         break
      } else {
         break
      }
   }
   return result
}

// ###########################################################
// # PRIVATE HELPERS, CHARACTER-LEVEL SPLIT (splitInlineContent) #
// ###########################################################

interface CharacterEntry {
   character: string
   run:       InlineRun
}

/** Explode InlineContent into one entry per character, run marks carried along. */
function explodeIntoCharacters(content: InlineContent): CharacterEntry[] {
   const characters: CharacterEntry[] = []
   for (const run of content) {
      for (const character of run.text) {
         characters.push({ character, run })
      }
   }
   return characters
}

function runMarksEqual(runA: InlineRun, runB: InlineRun): boolean {
   return !!runA.bold          === !!runB.bold
       && !!runA.italic        === !!runB.italic
       && !!runA.underline     === !!runB.underline
       && !!runA.strikethrough === !!runB.strikethrough
       && (runA.link      ?? '') === (runB.link      ?? '')
       && (runA.color     ?? '') === (runB.color     ?? '')
       && (runA.highlight ?? '') === (runB.highlight ?? '')
}

/** Collapse character entries back into runs, merging neighbours with identical marks. */
function collapseCharactersIntoRuns(characters: CharacterEntry[]): InlineContent {
   if (characters.length === 0) return []
   const runs: InlineRun[] = []
   let currentRun: InlineRun = { ...characters[0].run, text: characters[0].character }
   for (let index = 1; index < characters.length; index++) {
      const entry = characters[index]
      if (runMarksEqual(entry.run, currentRun)) {
         currentRun = { ...currentRun, text: currentRun.text + entry.character }
      } else {
         runs.push(currentRun)
         currentRun = { ...entry.run, text: entry.character }
      }
   }
   runs.push(currentRun)
   return runs
}

// ###################################################################################
// # PRIVATE HELPER, DOM WALK (SHARED BY PARSEINLINECONTENT AND DOMTOINLINECONTENT) #
// ###################################################################################

/** Recursively walk DOM nodes into InlineRun entries: formatting tags push flags, text nodes emit
 *  runs, <br> emits '\n', unknown elements are traversed without changing flags. */
function walkNodes(nodes: Iterable<ChildNode>, flags: ParseFlags, runs: InlineRun[]): void {
   for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
         const text = node.textContent ?? ''
         if (text) appendRun(runs, text, flags)
         continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue

      const element  = node as Element
      const tag      = element.tagName.toLowerCase()

      if (tag === 'br') {
         appendRun(runs, '\n', flags)
         continue
      }

      const newFlags: ParseFlags = { ...flags }

      switch (tag) {
         case 'strong':
         case 'b':
            newFlags.bold = true
            break
         case 'em':
         case 'i':
            newFlags.italic = true
            break
         case 'u':
            newFlags.underline = true
            break
         case 's':
         case 'del':
         case 'strike':
            newFlags.strikethrough = true
            break
         case 'a': {
            const href = (element as HTMLAnchorElement).getAttribute('href') ?? ''
            if (!/^javascript:/i.test(href)) newFlags.link = href
            break
         }
         case 'span': {
            const htmlElement = element as HTMLElement
            const style = htmlElement.style
            if (style.fontWeight === 'bold' || style.fontWeight === '700') newFlags.bold = true
            if (style.fontStyle === 'italic') newFlags.italic = true
            if (style.textDecoration?.includes('underline'))    newFlags.underline     = true
            if (style.textDecoration?.includes('line-through')) newFlags.strikethrough = true
            if (style.color)           newFlags.color     = normalizeColorValue(style.color)
            if (style.backgroundColor) newFlags.highlight = normalizeColorValue(style.backgroundColor)
            break
         }
         case 'font': {
            // Some browsers produce <font color="..."> via execCommand.
            const colorAttr = (element as HTMLElement).getAttribute('color')
            if (colorAttr) newFlags.color = normalizeColorValue(colorAttr)
            break
         }
      }

      walkNodes(element.childNodes, newFlags, runs)
   }
}

// ############################################
// # PRIVATE HELPERS, MINTDOWN SERIALISATION #
// ############################################

/** Escape Mintdown special characters in run text. '\n' is left as-is (emitted as literal newline). */
function escapeMintdown(text: string): string {
   return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/~/g, '\\~')
      .replace(/\[/g, '\\[')
}

/** Index of the next `marker` at/after `pos`, skipping any `skipMarker` (a longer delimiter that
 *  contains `marker` as a prefix). -1 when not found. */
function findClosingMarker(source: string, pos: number, marker: string, skipMarker?: string): number {
   while (pos <= source.length - marker.length) {
      if (skipMarker && source.startsWith(skipMarker, pos)) {
         pos += skipMarker.length
         continue
      }
      if (source.startsWith(marker, pos)) return pos
      pos++
   }
   return -1
}

/** Recursively scan a Mintdown inline string, accumulating runs with the active flags. */
function scanMintdown(source: string, flags: ParseFlags): InlineRun[] {
   const runs: InlineRun[] = []
   let pos = 0

   while (pos < source.length) {
      const char = source[pos]

      // Escape sequence.
      if (char === '\\' && pos + 1 < source.length) {
         appendRun(runs, source[pos + 1], flags)
         pos += 2
         continue
      }

      // Bold + italic: ***
      if (source.startsWith('***', pos)) {
         const closeIndex = findClosingMarker(source, pos + 3, '***')
         if (closeIndex !== -1) {
            const inner = scanMintdown(source.slice(pos + 3, closeIndex), { ...flags, bold: true, italic: true })
            runs.push(...inner)
            pos = closeIndex + 3
            continue
         }
         appendRun(runs, '***', flags)
         pos += 3
         continue
      }

      // Bold: **
      if (source.startsWith('**', pos)) {
         // findClosingMarker skips *** so we don't accidentally match ** inside ***
         const closeIndex = findClosingMarker(source, pos + 2, '**', '***')
         if (closeIndex !== -1) {
            const inner = scanMintdown(source.slice(pos + 2, closeIndex), { ...flags, bold: true })
            runs.push(...inner)
            pos = closeIndex + 2
            continue
         }
         appendRun(runs, '**', flags)
         pos += 2
         continue
      }

      // Italic: * (but not ** or ***)
      if (char === '*') {
         // findClosingMarker skips ** (and thus *** as well)
         const closeIndex = findClosingMarker(source, pos + 1, '*', '**')
         if (closeIndex !== -1) {
            const inner = scanMintdown(source.slice(pos + 1, closeIndex), { ...flags, italic: true })
            runs.push(...inner)
            pos = closeIndex + 1
            continue
         }
         appendRun(runs, '*', flags)
         pos++
         continue
      }

      // Underline: __
      if (source.startsWith('__', pos)) {
         const closeIndex = findClosingMarker(source, pos + 2, '__')
         if (closeIndex !== -1) {
            const inner = scanMintdown(source.slice(pos + 2, closeIndex), { ...flags, underline: true })
            runs.push(...inner)
            pos = closeIndex + 2
            continue
         }
         // Unclosed: emit one underscore literally, re-examine the second.
         appendRun(runs, '_', flags)
         pos++
         continue
      }

      // Strikethrough: ~~
      if (source.startsWith('~~', pos)) {
         const closeIndex = findClosingMarker(source, pos + 2, '~~')
         if (closeIndex !== -1) {
            const inner = scanMintdown(source.slice(pos + 2, closeIndex), { ...flags, strikethrough: true })
            runs.push(...inner)
            pos = closeIndex + 2
            continue
         }
         appendRun(runs, '~~', flags)
         pos += 2
         continue
      }

      // Link: [text](href)
      if (char === '[') {
         const closeBracket = source.indexOf(']', pos + 1)
         if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
            const closeParen = source.indexOf(')', closeBracket + 2)
            if (closeParen !== -1) {
               const linkText = source.slice(pos + 1, closeBracket)
               // URL-decode ')' that was encoded as %29 during serialisation
               const href = source.slice(closeBracket + 2, closeParen).replace(/%29/g, ')')
               const inner = scanMintdown(linkText, { ...flags, link: href })
               runs.push(...inner)
               pos = closeParen + 1
               continue
            }
         }
         // Malformed link: treat '[' as literal
         appendRun(runs, '[', flags)
         pos++
         continue
      }

      // Color: {color:VALUE}text{/color}
      if (source.startsWith('{color:', pos)) {
         const openTagClose = source.indexOf('}', pos + 7)
         if (openTagClose !== -1) {
            const colorValue   = source.slice(pos + 7, openTagClose)
            const contentStart = openTagClose + 1
            const closeTag     = source.indexOf('{/color}', contentStart)
            if (closeTag !== -1) {
               const inner = scanMintdown(source.slice(contentStart, closeTag), { ...flags, color: colorValue })
               runs.push(...inner)
               pos = closeTag + 8
               continue
            }
         }
         // Malformed: fall through to literal '{'
      }

      // Highlight: {highlight:VALUE}text{/highlight}
      if (source.startsWith('{highlight:', pos)) {
         const openTagClose = source.indexOf('}', pos + 11)
         if (openTagClose !== -1) {
            const highlightValue = source.slice(pos + 11, openTagClose)
            const contentStart   = openTagClose + 1
            const closeTag       = source.indexOf('{/highlight}', contentStart)
            if (closeTag !== -1) {
               const inner = scanMintdown(source.slice(contentStart, closeTag), { ...flags, highlight: highlightValue })
               runs.push(...inner)
               pos = closeTag + 12
               continue
            }
         }
         // Malformed: fall through to literal '{'
      }

      appendRun(runs, char, flags)
      pos++
   }

   return runs
}

// ##############
// # PUBLIC API #
// ##############

/** Raw innerHTML (legacy rich-text) to InlineContent. Migration bridge; uses DOMParser, never touches
 *  the live document. */
export function parseInlineContent(html: string): InlineContent {
   if (!html) return []
   const parser = new DOMParser()
   const doc    = parser.parseFromString(`<body>${html}</body>`, 'text/html')
   const runs: InlineRun[] = []
   walkNodes(doc.body.childNodes, {}, runs)
   return stripTrailingNewlines(runs)
}

/** InlineContent to a clean HTML string (for innerHTML or export). Wraps inside-out: link > color >
 *  highlight > strong > em > u > s; '\n' becomes <br>; text is HTML-escaped. */
export function renderInlineContent(content: InlineContent): string {
   return content.map(run => {
      let inner = run.text.split('\n').map(part => esc(part)).join('<br>')

      if (run.strikethrough) inner = `<s>${inner}</s>`
      if (run.underline)     inner = `<u>${inner}</u>`
      if (run.italic)        inner = `<em>${inner}</em>`
      if (run.bold)          inner = `<strong>${inner}</strong>`
      if (run.highlight)     inner = `<span style="background-color:${esc(run.highlight)}">${inner}</span>`
      if (run.color)         inner = `<span style="color:${esc(run.color)}">${inner}</span>`
      if (run.link !== undefined) inner = `<a href="${esc(run.link)}">${inner}</a>`

      return inner
   }).join('')
}

/** Live contentEditable DOM to a normalised InlineContent. Reads, never mutates. */
export function domToInlineContent(element: HTMLElement): InlineContent {
   const runs: InlineRun[] = []
   walkNodes(element.childNodes, {}, runs)
   return stripTrailingNewlines(runs)
}

/** InlineContent to Mintdown inline syntax. Wraps inside-out: s, u, em, strong, color, highlight,
 *  link; **bold**, *italic*, __underline__, ~~strike~~, [text](href) with ')' as %29, {color:V}..{/color},
 *  {highlight:V}..{/highlight}. '\n' stays a literal newline. */
export function inlineContentToMintdown(content: InlineContent): string {
   return content.map(run => {
      let inner = escapeMintdown(run.text)

      if (run.strikethrough) inner = `~~${inner}~~`
      if (run.underline)     inner = `__${inner}__`
      if (run.italic)        inner = `*${inner}*`
      if (run.bold)          inner = `**${inner}**`
      if (run.color)         inner = `{color:${run.color}}${inner}{/color}`
      if (run.highlight)     inner = `{highlight:${run.highlight}}${inner}{/highlight}`
      if (run.link !== undefined) {
         const encodedHref = run.link.replace(/\)/g, '%29')
         inner = `[${inner}](${encodedHref})`
      }

      return inner
   }).join('')
}

/** Mintdown inline string to InlineContent. Lenient: unclosed markers become literal text, unknown
 *  {...} tags keep their inner text as a plain run. */
export function mintdownToInlineContent(source: string): InlineContent {
   if (!source) return []
   const runs = scanMintdown(source, {})
   return stripTrailingNewlines(runs)
}

/** True when content is empty or all-whitespace. */
export function isEmptyContent(content: InlineContent): boolean {
   return content.length === 0 || content.every(run => !run.text.trim())
}

/** Deep field-by-field equality of two InlineContent arrays (not JSON.stringify). */
export function inlineContentEquals(a: InlineContent, b: InlineContent): boolean {
   if (a.length !== b.length) return false
   for (let index = 0; index < a.length; index++) {
      const runA = a[index]
      const runB = b[index]
      if (runA.text          !== runB.text)          return false
      if (!!runA.bold          !== !!runB.bold)          return false
      if (!!runA.italic        !== !!runB.italic)        return false
      if (!!runA.underline     !== !!runB.underline)     return false
      if (!!runA.strikethrough !== !!runB.strikethrough) return false
      if ((runA.link      ?? '') !== (runB.link      ?? '')) return false
      if ((runA.color     ?? '') !== (runB.color     ?? '')) return false
      if ((runA.highlight ?? '') !== (runB.highlight ?? '')) return false
   }
   return true
}

/** CursorPosition from the browser Selection, relative to the element's live InlineContent. Null when
 *  the selection is outside the element or not collapsed. */
export function computeCursorPosition(element: HTMLElement): CursorPosition | null {
   const selection = window.getSelection()
   if (!selection || selection.rangeCount === 0) return null

   const range      = selection.getRangeAt(0)
   const anchorNode = range.startContainer

   if (!element.contains(anchorNode)) return null

   // Count characters (with '\n' for <br>) from element start to cursor
   let charOffset = 0
   let found = false

   function countToAnchor(node: Node): boolean {
      if (node === anchorNode) {
         charOffset += range.startOffset
         found = true
         return true
      }
      if (node.nodeType === Node.TEXT_NODE) {
         charOffset += (node.textContent ?? '').length
         return false
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
         const tag = (node as Element).tagName.toLowerCase()
         if (tag === 'br') {
            charOffset += 1
            return false
         }
         for (const child of Array.from(node.childNodes)) {
            if (countToAnchor(child)) return true
         }
      }
      return false
   }

   for (const child of Array.from(element.childNodes)) {
      if (countToAnchor(child)) break
   }

   if (!found) return null

   // Map the character offset to a run index + offset within that run
   const currentContent = domToInlineContent(element)
   let remaining = charOffset

   for (let runIndex = 0; runIndex < currentContent.length; runIndex++) {
      const runLength = currentContent[runIndex].text.length
      if (remaining <= runLength) {
         // Boundary canonicalization: at the end of a run, prefer start of the next
         if (remaining === runLength && runIndex + 1 < currentContent.length) {
            return { runIndex: runIndex + 1, offset: 0 }
         }
         return { runIndex, offset: remaining }
      }
      remaining -= runLength
   }

   // Cursor is past the last run (e.g. empty content)
   const lastRunIndex = Math.max(0, currentContent.length - 1)
   return { runIndex: lastRunIndex, offset: currentContent[lastRunIndex]?.text.length ?? 0 }
}

/** Split InlineContent into two halves at a 0-based character offset ('\n' counts as one). The first
 *  half covers [0, charOffset), the second the rest; a split inside a run divides it, carrying the
 *  same marks; out-of-range offsets clamp. Both halves are freshly built (no shared run objects) and
 *  normalised. */
export function splitInlineContent(content: InlineContent, charOffset: number): [InlineContent, InlineContent] {
   const characters    = explodeIntoCharacters(content)
   const clampedOffset = Math.max(0, Math.min(charOffset, characters.length))

   return [
      collapseCharactersIntoRuns(characters.slice(0, clampedOffset)),
      collapseCharactersIntoRuns(characters.slice(clampedOffset)),
   ]
}

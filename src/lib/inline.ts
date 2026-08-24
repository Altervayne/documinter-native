/**
 * inline.ts, All inline-content logic.
 *
 * Exports:
 *   parseInlineContent      , HTML string -> InlineContent (migration bridge)
 *   renderInlineContent     , InlineContent -> HTML string
 *   domToInlineContent      , live HTMLElement -> InlineContent (called on commit)
 *   inlineContentToMintdown , InlineContent -> inline text string
 *   mintdownToInlineContent , inline text string -> InlineContent
 *   stripTrailingNewlines   , remove trailing newline-only runs (exposed for migration)
 *   isEmptyContent          , true if array is empty or all-whitespace
 *   inlineContentEquals     , deep equality check
 *   computeCursorPosition   , derive CursorPosition from the browser Selection API
 *   splitInlineContent      , split content into two halves at a character offset
 *
 * Almost all functions are pure. The DOM-aware exceptions, domToInlineContent and
 * computeCursorPosition, READ live DOM state without modifying it. The color application
 * and selection helpers (including the sole Selection writer) now live in inlineFormatting.ts.
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

/**
 * Convert a browser-normalised CSS color value back to a lowercase hex string.
 *
 * When we set `element.style.color = '#b91c1c'` and later read `element.style.color`
 * the browser returns `'rgb(185, 28, 28)'`. This breaks round-trip equality checks
 * (`inlineContentEquals`) because the stored value and the read-back value differ.
 *
 * Handles:
 *   rgb(r, g, b)       -> #rrggbb
 *   rgba(r, g, b, a)   -> #rrggbb  (alpha dropped, we only store opaque colors)
 *   #rgb               -> #rrggbb  (3-digit shorthand)
 *   #rrggbb            -> #rrggbb  (already canonical, lowercased)
 *   anything else      -> returned as-is (lowercased)
 */
function normalizeColorValue(cssColor: string): string {
   const trimmed = cssColor.trim()

   // rgb(...) or rgba(...)
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

   // #rgb shorthand -> #rrggbb
   const shortHexMatch = trimmed.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/)
   if (shortHexMatch) {
      return '#'
         + shortHexMatch[1].repeat(2)
         + shortHexMatch[2].repeat(2)
         + shortHexMatch[3].repeat(2)
   }

   return trimmed.toLowerCase()
}

/** Returns true when a run's flags match the given ParseFlags exactly. */
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

/**
 * Strip trailing '\n' runs from the end of a run list.
 * Exported so that migrateBlock / migrateListItem in documentMigration.ts can sanitize
 * richText arrays loaded from older save files that predate this normalisation.
 * All current write paths (domToInlineContent, mintdownToInlineContent,
 * parseInlineContent) already call this before returning.
 */
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

/** One character of InlineContent paired with the run it came from. */
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

/** Returns true when two runs carry identical formatting marks (ignoring text). */
function runMarksEqual(runA: InlineRun, runB: InlineRun): boolean {
   return !!runA.bold          === !!runB.bold
       && !!runA.italic        === !!runB.italic
       && !!runA.underline     === !!runB.underline
       && !!runA.strikethrough === !!runB.strikethrough
       && (runA.link      ?? '') === (runB.link      ?? '')
       && (runA.color     ?? '') === (runB.color     ?? '')
       && (runA.highlight ?? '') === (runB.highlight ?? '')
}

/**
 * Collapse character entries back into runs, merging consecutive characters whose
 * marks match into a single run. Inverse of explodeIntoCharacters.
 */
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

/**
 * Recursively walk a list of DOM child nodes, accumulating InlineRun entries.
 * Recognised formatting elements push flags; text nodes emit runs; <br> emits '\n'.
 * Unknown elements (div, p, etc.) are traversed without changing flags.
 */
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
            // Some browsers produce <font color="..."> via execCommand
            const colorAttr = (element as HTMLElement).getAttribute('color')
            if (colorAttr) newFlags.color = normalizeColorValue(colorAttr)
            break
         }
         // default: descend without changing flags
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

/**
 * Scan forward from `pos` in `source` looking for the next occurrence of `marker`,
 * skipping over any occurrence of `skipMarker` (a longer delimiter that contains `marker`
 * as a prefix). Returns the index of the match, or -1 if not found.
 */
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

/**
 * Recursively scan a Mintdown inline string, accumulating runs with the given active flags.
 * Called by mintdownToInlineContent and recursively for nested markers.
 */
function scanMintdown(source: string, flags: ParseFlags): InlineRun[] {
   const runs: InlineRun[] = []
   let pos = 0

   while (pos < source.length) {
      const char = source[pos]

      // Escape sequence
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
         // Unclosed: emit the three stars as literal text and advance
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
         // Unclosed: emit one underscore as literal and re-examine the second
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

      // Plain character
      appendRun(runs, char, flags)
      pos++
   }

   return runs
}

// ##############
// # PUBLIC API #
// ##############

/**
 * Convert a raw innerHTML string (from the legacy rich-text model) to InlineContent.
 * Migration bridge, used by migrateBlock() in documentMigration.ts when loading old documents.
 * Uses DOMParser; never touches the live document.
 */
export function parseInlineContent(html: string): InlineContent {
   if (!html) return []
   const parser = new DOMParser()
   const doc    = parser.parseFromString(`<body>${html}</body>`, 'text/html')
   const runs: InlineRun[] = []
   walkNodes(doc.body.childNodes, {}, runs)
   return stripTrailingNewlines(runs)
}

/**
 * Convert an InlineContent array to a clean HTML string.
 * Suitable for: setting innerHTML on a contentEditable element, or embedding in export HTML.
 *
 * Nesting order (outermost to innermost): link -> color -> highlight -> strong -> em -> u -> s
 * '\n' in a run's text is output as <br>.
 * Text is always HTML-escaped.
 */
export function renderInlineContent(content: InlineContent): string {
   return content.map(run => {
      // Escape text and convert \n to <br>
      let inner = run.text.split('\n').map(part => esc(part)).join('<br>')

      // Apply formatting wrappers inside-out
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

/**
 * Read the current live DOM state of a contentEditable element and produce a
 * normalised InlineContent array. Called by RichEditable on blur (commit).
 *
 * Reads the DOM; never modifies it.
 */
export function domToInlineContent(element: HTMLElement): InlineContent {
   const runs: InlineRun[] = []
   walkNodes(element.childNodes, {}, runs)
   return stripTrailingNewlines(runs)
}

/**
 * Serialise InlineContent to Mintdown inline syntax.
 *
 * Marker syntax:
 *   Bold        **text**
 *   Italic      *text*
 *   Bold+italic ***text***  (sequential wrapping: italic first, then bold)
 *   Underline   __text__
 *   Strikethrough ~~text~~
 *   Link        [text](href)   href ')' is encoded as %29
 *   Color       {color:VALUE}text{/color}
 *   Highlight   {highlight:VALUE}text{/highlight}
 *
 * '\n' in run text is emitted as a literal newline character.
 */
export function inlineContentToMintdown(content: InlineContent): string {
   return content.map(run => {
      let inner = escapeMintdown(run.text)

      // Wrap inside-out: s -> u -> em -> strong -> color -> highlight -> link
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

/**
 * Parse a Mintdown inline string into an InlineContent array.
 * Inverse of inlineContentToMintdown.
 *
 * Lenient: unclosed markers are treated as literal text.
 * Unknown {...} tags have their inner text preserved as a plain run.
 */
export function mintdownToInlineContent(source: string): InlineContent {
   if (!source) return []
   const runs = scanMintdown(source, {})
   return stripTrailingNewlines(runs)
}

/**
 * Returns true when content is empty or consists only of whitespace.
 * Replaces scattered `text === ''` / `!text` checks across block components.
 */
export function isEmptyContent(content: InlineContent): boolean {
   return content.length === 0 || content.every(run => !run.text.trim())
}

/**
 * Deep equality check for two InlineContent arrays.
 * Used by RichEditable's snapshot-on-focus / compare-on-blur guard.
 * Compares each field explicitly, does not use JSON.stringify.
 */
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

/**
 * Derive a CursorPosition from the browser's current Selection, relative to the
 * live InlineContent of the given contentEditable element.
 *
 * Returns null when the selection is not inside the element or is not collapsed.
 *
 * Kept narrow and self-contained so its internals can be swapped for a different
 * cursor-tracking strategy without touching callers.
 */
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

/**
 * Split a paragraph's InlineContent into two independent halves at a character offset.
 * Foundation for splitting a paragraph across a page boundary during layout.
 *
 * charOffset is 0-based over the concatenation of every run's text ('\n' counts as one
 * character). The first half covers [0, charOffset), the second covers the rest. A split
 * that lands inside a run divides it into two runs carrying the same marks; a split on a
 * run boundary leaves runs whole. Out-of-range offsets clamp, so charOffset <= 0 yields an
 * empty first half and charOffset >= the total length yields an empty second half.
 *
 * Both halves are freshly built: no run object is shared with the input or between the
 * two halves, and each half is normalised (no empty runs, no adjacent runs with identical
 * marks left unmerged).
 */
export function splitInlineContent(content: InlineContent, charOffset: number): [InlineContent, InlineContent] {
   const characters    = explodeIntoCharacters(content)
   const clampedOffset = Math.max(0, Math.min(charOffset, characters.length))

   return [
      collapseCharactersIntoRuns(characters.slice(0, clampedOffset)),
      collapseCharactersIntoRuns(characters.slice(clampedOffset)),
   ]
}

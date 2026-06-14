/**
 * inline.ts — All inline-content logic.
 *
 * Exports:
 *   parseInlineContent       — HTML string → InlineContent (migration bridge)
 *   renderInlineContent      — InlineContent → HTML string
 *   domToInlineContent       — live HTMLElement → InlineContent (called on commit)
 *   inlineContentToMintdown  — InlineContent → Mintdown string
 *   mintdownToInlineContent  — Mintdown string → InlineContent
 *   stripTrailingNewlines    — remove trailing newline-only runs (exposed for migration)
 *   isEmptyContent           — true if array is empty or all-whitespace
 *   inlineContentEquals      — deep equality check
 *   computeCursorPosition    — derive CursorPosition from the browser Selection API
 *   runsHaveSameFlags        — true when two runs share identical formatting flags
 *   mergeAdjacentRuns        — collapse neighbouring runs with identical flags
 *   countCharsToPosition     — flat char offset of a (node, offset) within an element
 *   applyColorToRange        — set/clear a color field over a flat char range
 *   restoreSelectionRange    — re-select a flat char range after an innerHTML rewrite
 *   deriveActiveColorsAt     — active font/highlight color at a selection position
 *
 * Almost all functions are pure. The DOM-aware exceptions: domToInlineContent,
 * computeCursorPosition, countCharsToPosition and deriveActiveColorsAt READ live DOM
 * state without modifying it; restoreSelectionRange is the sole writer — it mutates
 * the browser Selection to re-establish a range and touches nothing else.
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
// # PRIVATE HELPERS — SHARED BY PARSING AND RENDERING #
// #####################################################

/**
 * Convert a browser-normalised CSS color value back to a lowercase hex string.
 *
 * When we set `element.style.color = '#b91c1c'` and later read `element.style.color`
 * the browser returns `'rgb(185, 28, 28)'`. This breaks round-trip equality checks
 * (`inlineContentEquals`) because the stored value and the read-back value differ.
 *
 * Handles:
 *   rgb(r, g, b)       → #rrggbb
 *   rgba(r, g, b, a)   → #rrggbb  (alpha dropped — we only store opaque colors)
 *   #rgb               → #rrggbb  (3-digit shorthand)
 *   #rrggbb            → #rrggbb  (already canonical — lowercased)
 *   anything else      → returned as-is (lowercased)
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

   // #rgb shorthand → #rrggbb
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
 * Exported so that migrateBlock / migrateListItem in storage.ts can sanitize
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

// ###################################################################################
// # PRIVATE HELPER — DOM WALK (SHARED BY PARSEINLINECONTENT AND DOMTOINLINECONTENT) #
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
// # PRIVATE HELPERS — MINTDOWN SERIALISATION #
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
 * Migration bridge — used by migrateBlock() in storage.ts when loading old documents.
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
 * Nesting order (outermost → innermost): link → color → highlight → strong → em → u → s
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

      // Wrap inside-out: s → u → em → strong → color → highlight → link
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
 * Unknown {…} tags have their inner text preserved as a plain run.
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
 * Compares each field explicitly — does not use JSON.stringify.
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
 * This function is the designated replacement slot for the custom cursor engine:
 * when the engine arrives, only this function's internals change.
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

// #########################################
// # COLOR APPLICATION & SELECTION HELPERS #
// #########################################

/** Returns true when two InlineRun objects have identical formatting flags (ignoring text). */
export function runsHaveSameFlags(runA: InlineRun, runB: InlineRun): boolean {
   return !!runA.bold          === !!runB.bold
       && !!runA.italic        === !!runB.italic
       && !!runA.underline     === !!runB.underline
       && !!runA.strikethrough === !!runB.strikethrough
       && (runA.link      ?? '') === (runB.link      ?? '')
       && (runA.color     ?? '') === (runB.color     ?? '')
       && (runA.highlight ?? '') === (runB.highlight ?? '')
}

/** Merge adjacent runs that have identical flags. Called after splitting to normalise. */
export function mergeAdjacentRuns(runs: InlineRun[]): InlineRun[] {
   if (runs.length === 0) return runs
   const merged: InlineRun[] = [{ ...runs[0] }]
   for (let index = 1; index < runs.length; index++) {
      const previous = merged[merged.length - 1]
      const current  = runs[index]
      if (runsHaveSameFlags(previous, current)) {
         previous.text += current.text
      } else {
         merged.push({ ...current })
      }
   }
   return merged
}

/**
 * Walk the DOM, counting characters until the given `targetNode` / `targetOffset`.
 * Returns the flat character offset from the element's start. Returns -1 on failure.
 *
 * '\n' from <br> counts as 1 character (matches walkNodes behaviour above).
 */
export function countCharsToPosition(
   root:         HTMLElement,
   targetNode:   Node,
   targetOffset: number,
): number {
   let count = 0
   let found = false

   function walk(node: Node): void {
      if (found) return
      if (node === targetNode) {
         count += targetOffset
         found = true
         return
      }
      if (node.nodeType === Node.TEXT_NODE) {
         count += (node.textContent ?? '').length
         return
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
         const tag = (node as Element).tagName.toLowerCase()
         if (tag === 'br') {
            count += 1
            return
         }
         for (const child of Array.from(node.childNodes)) walk(child)
      }
   }

   for (const child of Array.from(root.childNodes)) walk(child)
   return found ? count : -1
}

/**
 * Apply a color (or clear it) to runs that overlap the character range [start, end).
 *
 * - `field`  — `'color'` for font color, `'highlight'` for background highlight.
 * - `value`  — hex string to set, or `undefined` to clear the field.
 *
 * Strategy:
 *   1. Build a flat array of (run, startOffset, endOffset) segments.
 *   2. For each segment that overlaps [start, end):
 *      a. Split the run at the selection boundaries if needed.
 *      b. Apply or clear the field on the interior piece.
 *   3. Merge adjacent identical-flag runs.
 */
export function applyColorToRange(
   content:  InlineContent,
   start:    number,
   end:      number,
   field:    'color' | 'highlight',
   value:    string | undefined,
): InlineContent {
   // Expand each run into individual characters with their flags, apply the field,
   // then re-collapse into runs. This is the simplest correct approach and handles
   // all edge-cases (selection spanning multiple runs, partial first/last run, etc.)
   type CharEntry = { char: string; run: InlineRun }
   const chars: CharEntry[] = []
   for (const run of content) {
      for (const char of run.text) {
         chars.push({ char, run })
      }
   }

   // Apply the color field to chars in [start, end)
   const modifiedChars: CharEntry[] = chars.map((entry, index) => {
      if (index < start || index >= end) return entry
      const newRun: InlineRun = { ...entry.run }
      if (value === undefined) {
         delete newRun[field]
      } else {
         newRun[field] = value
      }
      return { char: entry.char, run: newRun }
   })

   // Re-collapse chars into runs
   if (modifiedChars.length === 0) return []
   const resultRuns: InlineRun[] = []
   let currentRun: InlineRun = { ...modifiedChars[0].run, text: modifiedChars[0].char }
   for (let index = 1; index < modifiedChars.length; index++) {
      const entry = modifiedChars[index]
      const testRun: InlineRun = { ...entry.run, text: '' }
      const previousTest: InlineRun = { ...currentRun, text: '' }
      if (runsHaveSameFlags(testRun, previousTest)) {
         currentRun = { ...currentRun, text: currentRun.text + entry.char }
      } else {
         resultRuns.push(currentRun)
         currentRun = { ...entry.run, text: entry.char }
      }
   }
   resultRuns.push(currentRun)

   return mergeAdjacentRuns(resultRuns)
}

/**
 * After rewriting an element's innerHTML, restore a text selection described by
 * flat character offsets [start, end). Walks the new DOM to find the right nodes.
 *
 * The sole DOM-mutating function in this module: it rewrites the browser Selection.
 */
export function restoreSelectionRange(element: HTMLElement, start: number, end: number): void {
   function resolveOffset(target: number): { node: Node; offset: number } | null {
      let count = 0
      function walk(node: Node): { node: Node; offset: number } | null {
         if (node.nodeType === Node.TEXT_NODE) {
            const length = (node.textContent ?? '').length
            if (count + length >= target) return { node, offset: target - count }
            count += length
            return null
         }
         if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node as Element).tagName.toLowerCase()
            if (tag === 'br') {
               if (count + 1 >= target) return { node: node.parentNode ?? node, offset: target - count }
               count += 1
               return null
            }
            for (const child of Array.from(node.childNodes)) {
               const result = walk(child)
               if (result) return result
            }
         }
         return null
      }
      for (const child of Array.from(element.childNodes)) {
         const result = walk(child)
         if (result) return result
      }
      // Fallback: place cursor at end of element
      return { node: element, offset: element.childNodes.length }
   }

   const startResult = resolveOffset(start)
   const endResult   = resolveOffset(end)
   if (!startResult || !endResult) return

   try {
      const range = document.createRange()
      range.setStart(startResult.node, startResult.offset)
      range.setEnd(endResult.node, endResult.offset)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
   } catch {
      // If the range is invalid (e.g. after a complex split), silently skip.
   }
}

/**
 * Derive the active font + highlight colors for the selection position described
 * by (node, offset), relative to the rich element's current InlineContent.
 *
 * Boundary handling mirrors computeCursorPosition: when the position lands exactly
 * on a run boundary, the run that STARTS at the boundary wins. This is what makes a
 * freshly-applied color read back correctly — after a color pick the selection start
 * sits on the new run's leading boundary, and the covered (colored) run must win over
 * the preceding (uncolored) one. A naive `offset <= charCount` test reads the
 * preceding run and clears the indicator.
 */
export function deriveActiveColorsAt(
   richElement: HTMLElement,
   node:        Node,
   offset:      number,
): { fontColor: string | undefined; highlightColor: string | undefined } {
   const content    = domToInlineContent(richElement)
   const charOffset = countCharsToPosition(richElement, node, offset)
   if (charOffset < 0 || content.length === 0) {
      return { fontColor: undefined, highlightColor: undefined }
   }
   let remaining = charOffset
   for (let runIndex = 0; runIndex < content.length; runIndex++) {
      const run       = content[runIndex]
      const runLength = run.text.length
      if (remaining < runLength) {
         return { fontColor: run.color, highlightColor: run.highlight }
      }
      if (remaining === runLength) {
         const boundaryRun = runIndex + 1 < content.length ? content[runIndex + 1] : run
         return { fontColor: boundaryRun.color, highlightColor: boundaryRun.highlight }
      }
      remaining -= runLength
   }
   const lastRun = content[content.length - 1]
   return { fontColor: lastRun.color, highlightColor: lastRun.highlight }
}

/**
 * inlineFormatting.ts, Color application + selection helpers for the FormatToolbar.
 *
 * These operate on InlineContent and the live DOM Selection in service of the rich-text
 * toolbar; editor-interaction logic, kept separate from the pure inline-content model in
 * inline.ts.
 *
 * computeCursorPosition's relatives countCharsToPosition and deriveActiveColorsAt READ
 * live DOM state without modifying it; restoreSelectionRange is the sole writer, it
 * mutates the browser Selection to re-establish a range and touches nothing else.
 *
 * Exports:
 *   runsHaveSameFlags     , true when two runs share identical formatting flags
 *   mergeAdjacentRuns     , collapse neighbouring runs with identical flags
 *   countCharsToPosition  , flat char offset of a (node, offset) within an element
 *   caretCharOffsetAtPoint, flat char offset under a viewport point within an element
 *   applyColorToRange     , set/clear a color field over a flat char range
 *   restoreSelectionRange , re-select a flat char range after an innerHTML rewrite
 *   deriveActiveColorsAt  , active font/highlight color at a selection position
 */

import { domToInlineContent } from './inline'
import type { InlineContent, InlineRun } from '../types'

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
 * Map a viewport point to a flat char offset within `root`, via the browser's point-to-caret API
 * (`caretPositionFromPoint` in most engines, `caretRangeFromPoint` in WebKit/Blink). Returns -1 when
 * neither resolves a caret inside `root`.
 */
export function caretCharOffsetAtPoint(root: HTMLElement, clientX: number, clientY: number): number {
   let node: Node | null = null
   let offset = 0
   const withCaretPosition = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
   }
   if (typeof withCaretPosition.caretPositionFromPoint === 'function') {
      const position = withCaretPosition.caretPositionFromPoint(clientX, clientY)
      if (position) { node = position.offsetNode; offset = position.offset }
   }
   if (!node && typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(clientX, clientY)
      if (range) { node = range.startContainer; offset = range.startOffset }
   }
   if (!node || !root.contains(node)) return -1
   return countCharsToPosition(root, node, offset)
}

/**
 * Apply a color (or clear it) to runs that overlap the character range [start, end).
 *
 * - `field` , `'color'` for font color, `'highlight'` for background highlight.
 * - `value` , hex string to set, or `undefined` to clear the field.
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
 * freshly-applied color read back correctly, after a color pick the selection start
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

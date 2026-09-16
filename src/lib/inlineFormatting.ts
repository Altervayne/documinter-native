/*
 * Color application + selection helpers for the FormatToolbar, over InlineContent and the live DOM
 * Selection. countCharsToPosition / caretCharOffsetAtPoint / deriveActiveColorsAt READ the DOM;
 * restoreSelectionRange is the sole Selection writer. The pure inline-content model is in inline.ts.
 */

import { domToInlineContent } from './inline'
import type { InlineContent, InlineRun } from '../types'

/** True when two runs have identical formatting flags, ignoring text. */
export function runsHaveSameFlags(runA: InlineRun, runB: InlineRun): boolean {
   return !!runA.bold          === !!runB.bold
       && !!runA.italic        === !!runB.italic
       && !!runA.underline     === !!runB.underline
       && !!runA.strikethrough === !!runB.strikethrough
       && (runA.link      ?? '') === (runB.link      ?? '')
       && (runA.color     ?? '') === (runB.color     ?? '')
       && (runA.highlight ?? '') === (runB.highlight ?? '')
}

/** Merge adjacent runs with identical flags. */
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

/** Flat character offset from `root`'s start to (targetNode, targetOffset); '\n' from <br> counts as
 *  one. -1 when the target isn't found. */
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

/** Flat char offset under a viewport point, via caretPositionFromPoint (WebKit/Blink:
 *  caretRangeFromPoint). -1 when neither resolves a caret inside `root`. */
export function caretCharOffsetAtPoint(root: HTMLElement, clientX: number, clientY: number): number {
   let node: Node | null = null
   let offset = 0
   // Hit-test against the element's OWN document: a root in a detached or offscreen document would
   // miss every hit against the top-level `document`.
   const ownerDocument = root.ownerDocument
   const withCaretPosition = ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
   }
   if (typeof withCaretPosition.caretPositionFromPoint === 'function') {
      const position = withCaretPosition.caretPositionFromPoint(clientX, clientY)
      if (position) { node = position.offsetNode; offset = position.offset }
   }
   if (!node && typeof ownerDocument.caretRangeFromPoint === 'function') {
      const range = ownerDocument.caretRangeFromPoint(clientX, clientY)
      if (range) { node = range.startContainer; offset = range.startOffset }
   }
   if (!node || !root.contains(node)) return -1
   return countCharsToPosition(root, node, offset)
}

/** Set (`value` hex) or clear (`value` undefined) a color `field` ('color' or 'highlight') over the
 *  character range [start, end). Splits runs at the boundaries and re-merges. */
export function applyColorToRange(
   content:  InlineContent,
   start:    number,
   end:      number,
   field:    'color' | 'highlight',
   value:    string | undefined,
): InlineContent {
   // Expand runs to characters, apply the field, re-collapse: handles selections spanning runs and
   // partial first/last runs uniformly.
   type CharEntry = { char: string; run: InlineRun }
   const chars: CharEntry[] = []
   for (const run of content) {
      for (const char of run.text) {
         chars.push({ char, run })
      }
   }

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

/** Restore a text selection over the flat char range [start, end) after an innerHTML rewrite, walking
 *  the new DOM. The only Selection-mutating function here. */
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
      // Fallback: cursor at the end of the element.
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

/** Active font + highlight colors for the position (node, offset), relative to the element's
 *  InlineContent. On a run boundary the run that STARTS at the boundary wins, so a freshly applied
 *  color reads back from the covered run instead of the preceding uncolored one. */
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

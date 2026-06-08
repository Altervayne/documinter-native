import { useEffect, useRef, useState } from 'react'
import {
   Bold, Italic, Underline, Strikethrough,
   Link, Link2Off, Baseline, Highlighter, CornerDownLeft,
} from 'lucide-react'
import type { Block, InlineContent, InlineRun, Section } from '../types'
import { blockAnchor } from '../lib/document'
import { domToInlineContent, renderInlineContent } from '../lib/inline'
import { useLang } from '../contexts/LangContext'
import { InlineColorPicker } from '../atoms/InlineColorPicker'

// ============================================================
// Color palettes
// ============================================================

/** Curated font-color palette — all pass WCAG AA on white (#ffffff) and dark (#1a1a1a) backgrounds. */
const FONT_COLOR_PALETTE = [
   '#dc2626', // red-600
   '#ea580c', // orange-600
   '#d97706', // amber-600
   '#16a34a', // green-600
   '#0891b2', // cyan-600
   '#2563eb', // blue-600
   '#7c3aed', // violet-600
   '#db2777', // pink-600
   '#000000', // black
   '#374151', // gray-700
   '#6b7280', // gray-500
   '#ffffff', // white
] as const

/** Curated highlight-color palette — all pass WCAG AA for dark text (#1a1a1a) on the swatch itself. */
const HIGHLIGHT_COLOR_PALETTE = [
   '#fef08a', // yellow-200
   '#bbf7d0', // green-200
   '#bae6fd', // sky-200
   '#ddd6fe', // violet-200
   '#fecdd3', // rose-200
   '#fed7aa', // orange-200
   '#e0f2fe', // sky-100
   '#f3e8ff', // purple-100
   '#fce7f3', // pink-100
   '#ecfccb', // lime-100
] as const

// ============================================================
// Pure helpers — color application
// ============================================================

/** Returns true when two InlineRun objects have identical formatting flags (ignoring text). */
function runsHaveSameFlags(runA: InlineRun, runB: InlineRun): boolean {
   return !!runA.bold          === !!runB.bold
       && !!runA.italic        === !!runB.italic
       && !!runA.underline     === !!runB.underline
       && !!runA.strikethrough === !!runB.strikethrough
       && (runA.link      ?? '') === (runB.link      ?? '')
       && (runA.color     ?? '') === (runB.color     ?? '')
       && (runA.highlight ?? '') === (runB.highlight ?? '')
}

/** Merge adjacent runs that have identical flags. Called after splitting to normalise. */
function mergeAdjacentRuns(runs: InlineRun[]): InlineRun[] {
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
 * '\n' from <br> counts as 1 character (matches walkNodes behaviour in inline.ts).
 */
function countCharsToPosition(
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
function applyColorToRange(
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
 */
function restoreSelectionRange(element: HTMLElement, start: number, end: number): void {
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

// ============================================================
// Helpers
// ============================================================

interface AnchoredBlock {
   block:        Block
   sectionIndex: number
}

function getAnchoredBlocks(sections: Section[]): AnchoredBlock[] {
   const result: AnchoredBlock[] = []
   for (const [sectionIndex, section] of sections.entries()) {
      for (const block of section.blocks) {
         if (block.handle) result.push({ block, sectionIndex })
         for (const inner of [...(block.left ?? []), ...(block.right ?? [])]) {
            if (inner.handle) result.push({ block: inner, sectionIndex })
         }
      }
   }
   return result
}

// execCommand is deprecated but remains the practical cross-browser solution
// for formatting in contenteditable. All major browsers still support it.
function cmd(command: string, value?: string) {
   document.execCommand(command, false, value ?? undefined)
}

function applyBoldItalic() {
   const isBold   = document.queryCommandState('bold')
   const isItalic = document.queryCommandState('italic')
   if (isBold && isItalic) {
      cmd('bold')
      cmd('italic')
   } else {
      if (!isBold)   cmd('bold')
      if (!isItalic) cmd('italic')
   }
}

// ============================================================
// Types
// ============================================================

interface Pos { top: number; left: number }

interface FormatState {
   bold:          boolean
   italic:        boolean
   underline:     boolean
   strikethrough: boolean
   fontColor:     string | undefined
   highlightColor: string | undefined
}

interface FormatToolbarProps {
   sections: Section[]
}

// ============================================================
// Component
// ============================================================

export function FormatToolbar({ sections }: FormatToolbarProps) {
   const { t } = useLang()

   const [pos, setPos]             = useState<Pos>({ top: 0, left: 0 })
   const [visible, setVisible]     = useState(false)
   const [linkMode, setLinkMode]   = useState(false)
   const [linkUrl, setLinkUrl]     = useState('')
   const [formatState, setFormatState] = useState<FormatState>({
      bold: false, italic: false, underline: false, strikethrough: false,
      fontColor: undefined, highlightColor: undefined,
   })
   const [isEditingExistingLink, setIsEditingExistingLink] = useState(false)
   const [fontColorOpen,      setFontColorOpen]      = useState(false)
   const [highlightColorOpen, setHighlightColorOpen] = useState(false)

   const toolbarRef           = useRef<HTMLDivElement>(null)
   const inputRef             = useRef<HTMLInputElement>(null)
   const savedRange           = useRef<Range | null>(null)
   const linkModeRef          = useRef(false)
   const fontColorOpenRef     = useRef(false)
   const highlightColorOpenRef = useRef(false)
   const pendingLinkOpen      = useRef(false)
   const pendingLinkAnchor    = useRef<HTMLAnchorElement | null>(null)
   const debounceTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

   // ============================================================
   // Link mode helpers
   // ============================================================

   function openLinkMode() {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
      const existingLink = pendingLinkAnchor.current
         ?? sel?.anchorNode?.parentElement?.closest('a')
      pendingLinkAnchor.current = null
      setIsEditingExistingLink(!!existingLink)
      setLinkUrl(existingLink?.getAttribute('href') ?? '')
      linkModeRef.current = true
      setLinkMode(true)
   }

   function closeLinkMode() {
      linkModeRef.current = false
      setLinkMode(false)
      setLinkUrl('')
      setIsEditingExistingLink(false)
   }

   function applyLink() {
      const sel = window.getSelection()
      if (savedRange.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRange.current)
      }
      if (linkUrl.trim()) cmd('createLink', linkUrl.trim())
      closeLinkMode()
   }

   function removeLink() {
      const sel = window.getSelection()
      if (savedRange.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRange.current)
      }
      cmd('unlink')
      closeLinkMode()
   }

   // ============================================================
   // Effects
   // ============================================================

   useEffect(() => {
      function onSelChange() {
         // While the URL input or a color picker is focused, the contenteditable
         // selection collapses. Bail out so the toolbar stays visible.
         if (linkModeRef.current) return
         if (fontColorOpenRef.current || highlightColorOpenRef.current) return

         if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

         const sel = window.getSelection()
         if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            setVisible(false)
            return
         }
         const inRich = sel.anchorNode?.parentElement?.closest('[data-rich]')
         if (!inRich) {
            setVisible(false)
            return
         }

         // Debounce position updates to prevent jitter during active selection
         debounceTimerRef.current = setTimeout(() => {
            const currentSel = window.getSelection()
            if (!currentSel || currentSel.isCollapsed || currentSel.rangeCount === 0) {
               setVisible(false)
               return
            }
            const rect = currentSel.getRangeAt(0).getBoundingClientRect()
            if (!rect.width) { setVisible(false); return }

            // Derive active color from the run at the anchor of the selection
            const richElement = currentSel.anchorNode?.parentElement?.closest<HTMLElement>('[data-rich]')
            let activeFontColor: string | undefined      = undefined
            let activeHighlightColor: string | undefined = undefined
            if (richElement) {
               const currentContent = domToInlineContent(richElement)
               const anchorOffset   = countCharsToPosition(richElement, currentSel.anchorNode!, currentSel.anchorOffset)
               if (anchorOffset >= 0 && currentContent.length > 0) {
                  let charCount = 0
                  for (const run of currentContent) {
                     charCount += run.text.length
                     if (anchorOffset <= charCount) {
                        activeFontColor      = run.color
                        activeHighlightColor = run.highlight
                        break
                     }
                  }
               }
            }

            setPos({ top: rect.top - 44, left: rect.left + rect.width / 2 })
            setFormatState({
               bold:           document.queryCommandState('bold'),
               italic:         document.queryCommandState('italic'),
               underline:      document.queryCommandState('underline'),
               strikethrough:  document.queryCommandState('strikeThrough'),
               fontColor:      activeFontColor,
               highlightColor: activeHighlightColor,
            })
            setVisible(true)
         }, 40)
      }

      // Clicking on an <a> inside a rich contenteditable auto-selects the link
      // and opens the link panel, so the user doesn't have to precisely drag-select.
      function onDocClick(event: MouseEvent) {
         const anchor = (event.target as Element).closest('a')
         if (!anchor?.closest('[data-rich]')) return
         event.preventDefault()
         const range = document.createRange()
         range.selectNodeContents(anchor)
         const sel = window.getSelection()
         sel?.removeAllRanges()
         sel?.addRange(range)
         pendingLinkAnchor.current = anchor as HTMLAnchorElement
         pendingLinkOpen.current = true
         // selectionchange fires next, sets pos, then useEffect([visible]) opens link mode
      }

      // Dismiss link mode or color pickers when the user clicks outside the toolbar
      function onOutsideMouseDown(event: MouseEvent) {
         if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
            if (linkModeRef.current) closeLinkMode()
            if (fontColorOpenRef.current)      { fontColorOpenRef.current = false;      setFontColorOpen(false) }
            if (highlightColorOpenRef.current) { highlightColorOpenRef.current = false; setHighlightColorOpen(false) }
         }
      }

      document.addEventListener('selectionchange', onSelChange)
      document.addEventListener('click', onDocClick)
      document.addEventListener('mousedown', onOutsideMouseDown)
      return () => {
         document.removeEventListener('selectionchange', onSelChange)
         document.removeEventListener('click', onDocClick)
         document.removeEventListener('mousedown', onOutsideMouseDown)
         if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      }
   }, [])

   // After a link-click sets pendingLinkOpen, wait for the toolbar to become visible,
   // then open link mode so the panel appears with the href pre-filled.
   useEffect(() => {
      if (visible && pendingLinkOpen.current) {
         pendingLinkOpen.current = false
         // eslint-disable-next-line react-hooks/set-state-in-effect
         openLinkMode()
      }
   }, [visible])

   // Focus the URL input whenever link mode opens
   useEffect(() => {
      if (linkMode) inputRef.current?.focus()
   }, [linkMode])

   // ============================================================
   // Format state helpers
   // ============================================================

   function refreshFormatState() {
      setFormatState(previous => ({
         bold:           document.queryCommandState('bold'),
         italic:         document.queryCommandState('italic'),
         underline:      document.queryCommandState('underline'),
         strikethrough:  document.queryCommandState('strikeThrough'),
         // Preserve color state — format button clicks don't change colors
         fontColor:      previous.fontColor,
         highlightColor: previous.highlightColor,
      }))
   }

   // ============================================================
   // Color picker helpers
   // ============================================================

   function openFontColorPicker() {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
      fontColorOpenRef.current = true
      setFontColorOpen(true)
      setHighlightColorOpen(false)
      highlightColorOpenRef.current = false
   }

   function openHighlightColorPicker() {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
      highlightColorOpenRef.current = true
      setHighlightColorOpen(true)
      setFontColorOpen(false)
      fontColorOpenRef.current = false
   }

   function closeFontColorPicker() {
      fontColorOpenRef.current = false
      setFontColorOpen(false)
   }

   function closeHighlightColorPicker() {
      highlightColorOpenRef.current = false
      setHighlightColorOpen(false)
   }

   /**
    * Apply or clear a color field on the current selection.
    *
    * Strategy:
    *   1. Restore the saved range back into the selection.
    *   2. Find the [data-rich] contenteditable element that owns the selection.
    *   3. Read its current InlineContent via domToInlineContent.
    *   4. Compute flat char offsets for the selection start and end.
    *   5. Call applyColorToRange → produces a new InlineContent.
    *   6. Rewrite element.innerHTML via renderInlineContent.
    *   7. Restore the selection range in the new DOM.
    *   8. The next blur event on RichEditable will commit the new content normally.
    */
   function applyInlineColor(field: 'color' | 'highlight', colorValue: string | undefined) {
      // Restore selection
      const sel = window.getSelection()
      if (savedRange.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRange.current)
      }

      const currentSel = window.getSelection()
      if (!currentSel || currentSel.rangeCount === 0) return

      const range = currentSel.getRangeAt(0)
      const richElement = range.commonAncestorContainer instanceof HTMLElement
         ? range.commonAncestorContainer.closest<HTMLElement>('[data-rich]')
         : range.commonAncestorContainer.parentElement?.closest<HTMLElement>('[data-rich]')
      if (!richElement) return

      const currentContent = domToInlineContent(richElement)
      if (currentContent.length === 0) return

      const startChar = countCharsToPosition(richElement, range.startContainer, range.startOffset)
      const endChar   = countCharsToPosition(richElement, range.endContainer,   range.endOffset)
      if (startChar < 0 || endChar < 0 || startChar === endChar) return

      const updatedContent = applyColorToRange(currentContent, startChar, endChar, field, colorValue)

      // Rewrite the element's innerHTML
      richElement.innerHTML = renderInlineContent(updatedContent)

      // Restore selection
      restoreSelectionRange(richElement, startChar, endChar)

      // Close the picker and update active-color indicator
      if (field === 'color') {
         closeFontColorPicker()
         setFormatState(previous => ({ ...previous, fontColor: colorValue }))
      } else {
         closeHighlightColorPicker()
         setFormatState(previous => ({ ...previous, highlightColor: colorValue }))
      }
   }

   // ============================================================
   // Button class helper
   // ============================================================

   function formatButtonClass(active: boolean): string {
      return `w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
         active
            ? 'text-accent bg-accent/15'
            : 'text-muted hover:text-text hover:bg-accent/10'
      }`
   }

   // ============================================================
   // Render
   // ============================================================

   return (
      // Outer div: handles fixed positioning only.
      // Inner div: handles visual appearance + enter/exit animation.
      // Keeping them separate avoids a transform conflict between the
      // positioning translate and the animation scale.
      <div
         ref={toolbarRef}
         className={`fixed z-9999 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
         style={{ top: 0, left: 0, transform: `translate(calc(${pos.left}px - 50%), ${pos.top}px)` }}
         onMouseDown={event => event.preventDefault()}
      >
         <div
            className={`relative flex flex-col rounded-lg shadow-xl border border-border bg-raised transition-[opacity,transform] duration-[120ms] ease-out ${
               visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.97]'
            }`}
         >
            {/* ── Toolbar buttons row ─────────────────────────── */}
            <div className="flex items-center gap-0.5 px-1.5 py-1">

               {/* Formatting group */}
               <button className={formatButtonClass(formatState.bold)}   title={t.formatBold}         onClick={() => { cmd('bold');   refreshFormatState() }}>
                  <Bold size={13} />
               </button>
               <button className={formatButtonClass(formatState.italic)} title={t.formatItalic}       onClick={() => { cmd('italic'); refreshFormatState() }}>
                  <Italic size={13} />
               </button>
               <button
                  className={formatButtonClass(formatState.bold && formatState.italic)}
                  title={t.formatBoldItalic}
                  onClick={() => { applyBoldItalic(); refreshFormatState() }}
                  style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontStyle: 'italic', fontSize: '0.68rem' }}
               >
                  BI
               </button>

               <div className="w-px h-4 bg-border mx-1" />

               <button className={formatButtonClass(formatState.underline)}     title={t.formatUnderline}     onClick={() => { cmd('underline');    refreshFormatState() }}>
                  <Underline size={13} />
               </button>
               <button className={formatButtonClass(formatState.strikethrough)} title={t.formatStrikethrough} onClick={() => { cmd('strikeThrough'); refreshFormatState() }}>
                  <Strikethrough size={13} />
               </button>

               {/* Link group */}
               <div className="w-px h-4 bg-border mx-1" />
               <button className={formatButtonClass(linkMode)} title={t.formatLink} onClick={openLinkMode}>
                  <Link size={13} />
               </button>

               {/* Color buttons */}
               <div className="w-px h-4 bg-border mx-1" />

               {/* Font color button */}
               <div className="relative">
                  <button
                     className={formatButtonClass(fontColorOpen)}
                     title={t.formatFontColor}
                     onClick={fontColorOpen ? closeFontColorPicker : openFontColorPicker}
                  >
                     <div className="flex flex-col items-center gap-px">
                        <Baseline size={11} />
                        {/* Active color underline indicator */}
                        <div
                           className="w-3.5 rounded-sm"
                           style={{
                              height:          2,
                              backgroundColor: formatState.fontColor ?? 'transparent',
                              border:          formatState.fontColor ? 'none' : '1px solid var(--color-border)',
                           }}
                        />
                     </div>
                  </button>
                  {fontColorOpen && (
                     <InlineColorPicker
                        activeColor={formatState.fontColor}
                        palette={FONT_COLOR_PALETTE}
                        removeLabel={t.removeFontColor}
                        onChange={colorValue => applyInlineColor('color', colorValue)}
                        onDismiss={closeFontColorPicker}
                     />
                  )}
               </div>

               {/* Highlight color button */}
               <div className="relative">
                  <button
                     className={formatButtonClass(highlightColorOpen)}
                     title={t.formatHighlightColor}
                     onClick={highlightColorOpen ? closeHighlightColorPicker : openHighlightColorPicker}
                  >
                     <div className="flex flex-col items-center gap-px">
                        <Highlighter size={11} />
                        {/* Active color underline indicator */}
                        <div
                           className="w-3.5 rounded-sm"
                           style={{
                              height:          2,
                              backgroundColor: formatState.highlightColor ?? 'transparent',
                              border:          formatState.highlightColor ? 'none' : '1px solid var(--color-border)',
                           }}
                        />
                     </div>
                  </button>
                  {highlightColorOpen && (
                     <InlineColorPicker
                        activeColor={formatState.highlightColor}
                        palette={HIGHLIGHT_COLOR_PALETTE}
                        removeLabel={t.removeHighlightColor}
                        onChange={colorValue => applyInlineColor('highlight', colorValue)}
                        onDismiss={closeHighlightColorPicker}
                     />
                  )}
               </div>
            </div>

            {/* ── Link creator panel ──────────────────────────── */}
            {linkMode && (
               <div
                  className="absolute w-72 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
                  style={{
                     top: 'calc(100% + 6px)',
                     left: '50%',
                     transform: 'translateX(-50%)',
                     animation: 'link-panel-in 120ms ease-out both',
                  }}
                  onKeyDown={event => { if (event.key === 'Escape') closeLinkMode() }}
               >
                  {/* URL input */}
                  <div className="px-3 pt-3 pb-2.5">
                     <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider mb-1.5">
                        {t.linkPanelUrl}
                     </div>
                     <input
                        ref={inputRef}
                        type="url"
                        placeholder="https://…"
                        value={linkUrl}
                        onChange={event => setLinkUrl(event.target.value)}
                        onKeyDown={event => {
                           if (event.key === 'Enter')  applyLink()
                           if (event.key === 'Escape') closeLinkMode()
                        }}
                        className="w-full bg-el border border-border rounded-md px-3 py-1.5 text-sm text-text outline-none focus:border-accent transition-colors placeholder:text-muted/50"
                     />
                  </div>

                  {/* Block anchor list */}
                  {getAnchoredBlocks(sections).length > 0 && (
                     <div className="border-t border-border">
                        <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider px-3 pt-2 pb-1">
                           {t.linkPanelJumpToBlock}
                        </div>
                        <div className="max-h-28 overflow-y-auto px-1.5 pb-1.5">
                           {getAnchoredBlocks(sections).map(({ block, sectionIndex }) => {
                              const isActive = linkUrl === `#${blockAnchor(block)}`
                              return (
                                 <button
                                    key={block.id}
                                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left transition-colors cursor-pointer ${
                                       isActive
                                          ? 'bg-accent/10 text-text'
                                          : 'text-text/65 hover:text-text hover:bg-accent/10'
                                    }`}
                                    onClick={() => {
                                       const sel = window.getSelection()
                                       if (savedRange.current) { sel?.removeAllRanges(); sel?.addRange(savedRange.current) }
                                       cmd('createLink', `#${blockAnchor(block)}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="font-mono text-[0.6rem] text-muted/50 w-5 shrink-0 text-right">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    <span className="truncate">#{block.handle}</span>
                                 </button>
                              )
                           })}
                        </div>
                     </div>
                  )}

                  {/* Section anchor list */}
                  {sections.length > 0 && (
                     <div className="border-t border-border">
                        <div className="text-muted/70 text-[0.6rem] font-mono uppercase tracking-wider px-3 pt-2 pb-1">
                           {t.linkPanelJumpToSection}
                        </div>
                        <div className="max-h-28 overflow-y-auto px-1.5 pb-1.5">
                           {sections.map((section, sectionIndex) => {
                              const isActive = linkUrl === `#section-${section.id}`
                              return (
                                 <button
                                    key={section.id}
                                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left transition-colors cursor-pointer ${
                                       isActive
                                          ? 'bg-accent/10 text-text'
                                          : 'text-text/65 hover:text-text hover:bg-accent/10'
                                    }`}
                                    onClick={() => {
                                       const sel = window.getSelection()
                                       if (savedRange.current) { sel?.removeAllRanges(); sel?.addRange(savedRange.current) }
                                       cmd('createLink', `#section-${section.id}`)
                                       closeLinkMode()
                                    }}
                                 >
                                    <span className="font-mono text-[0.6rem] text-muted/50 w-5 shrink-0 text-right">
                                       {String(sectionIndex + 1).padStart(2, '0')}
                                    </span>
                                    <span className="truncate">{section.title || `${t.linkPanelSectionFallback} ${sectionIndex + 1}`}</span>
                                 </button>
                              )
                           })}
                        </div>
                     </div>
                  )}

                  {/* Action row */}
                  <div className="border-t border-border px-3 py-2.5 flex items-center justify-between">
                     <button
                        className="text-sm text-muted hover:text-text transition-colors cursor-pointer"
                        onClick={closeLinkMode}
                     >
                        {t.linkPanelCancel}
                     </button>
                     <div className="flex items-center gap-2">
                        {isEditingExistingLink && (
                           <button
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-red/70 hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
                              onClick={removeLink}
                           >
                              <Link2Off size={12} />
                              {t.linkPanelRemove}
                           </button>
                        )}
                        <button
                           className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium bg-accent hover:bg-accent/90 text-on-accent transition-colors cursor-pointer"
                           onClick={applyLink}
                        >
                           <CornerDownLeft size={12} />
                           {t.linkPanelApply}
                        </button>
                     </div>
                  </div>
               </div>
            )}
         </div>
      </div>
   )
}

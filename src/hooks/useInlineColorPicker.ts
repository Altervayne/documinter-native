import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { FormatState } from '../types'
import { FONT_COLOR_PALETTE, HIGHLIGHT_COLOR_PALETTE } from '../lib/constants'
import { readRecentColors, pushRecentColor } from '../lib/recentColors'
import {
   domToInlineContent,
   renderInlineContent,
   countCharsToPosition,
   applyColorToRange,
   restoreSelectionRange,
   deriveActiveColorsAt,
} from '../lib/inline'

interface UseInlineColorPickerOptions {
   /** Selection range shared with the toolbar + link mode; restored before applying color. */
   savedRangeRef:     RefObject<Range | null>
   /** Toolbar format state setter, the post-apply re-derive writes the active colors into it. */
   setFormatState: Dispatch<SetStateAction<FormatState>>
}

/**
 * Owns the FormatToolbar's font-color and highlight-color pickers: their open/closed
 * state, the recent-custom-colors backlog, and the model-level color application
 * (`applyInlineColor`). Only one picker is open at a time. The toolbar keeps the
 * orchestrating selectionchange listener and reads the `*OpenRef`s to suppress it
 * while a picker is open, and calls `close*()` on outside clicks.
 */
export function useInlineColorPicker({ savedRangeRef, setFormatState }: UseInlineColorPickerOptions) {
   const [fontColorOpen,      setFontColorOpen]      = useState(false)
   const [highlightColorOpen, setHighlightColorOpen] = useState(false)
   const [recentColors, setRecentColors]             = useState(() => readRecentColors())

   const fontColorOpenRef      = useRef(false)
   const highlightColorOpenRef = useRef(false)
   const recentColorTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

   // Cancel a pending recents write if the toolbar unmounts mid-debounce.
   useEffect(() => () => {
      if (recentColorTimerRef.current) clearTimeout(recentColorTimerRef.current)
   }, [])

   function openFontColorPicker() {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      fontColorOpenRef.current = true
      setFontColorOpen(true)
      setHighlightColorOpen(false)
      highlightColorOpenRef.current = false
   }

   function openHighlightColorPicker() {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      highlightColorOpenRef.current = true
      setHighlightColorOpen(true)
      setFontColorOpen(false)
      fontColorOpenRef.current = false
   }

   // Stable: the toolbar's orchestrator effect closes pickers on outside clicks, so
   // their identity must not change between renders.
   const closeFontColorPicker = useCallback(() => {
      fontColorOpenRef.current = false
      setFontColorOpen(false)
   }, [])

   const closeHighlightColorPicker = useCallback(() => {
      highlightColorOpenRef.current = false
      setHighlightColorOpen(false)
   }, [])

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
      if (savedRangeRef.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRangeRef.current)
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

      // Re-capture the now-current selection. The innerHTML rewrite above destroyed the
      // nodes savedRangeRef pointed at; refreshing it lets repeated applies (the ColorPicker
      // emits onChange continuously while dragging) restore a valid range each time
      // instead of a detached one. Closing the picker is left to the discrete callers
      // (quick-pick swatch / remove) so a live drag stays open.
      const restoredSelection = window.getSelection()
      if (restoredSelection && restoredSelection.rangeCount > 0) {
         savedRangeRef.current = restoredSelection.getRangeAt(0).cloneRange()
      }

      // Re-derive the active colors from the settled selection so the button indicators
      // reflect the committed model. Deferred to the next frame so the innerHTML rewrite
      // and selection restore have committed, reading colorValue directly would be
      // clobbered by the debounced selectionchange re-read that follows. Re-derives both
      // fields so font and highlight indicators stay consistent regardless of which one
      // was just picked.
      requestAnimationFrame(() => {
         const settledSelection = window.getSelection()
         if (!settledSelection || settledSelection.rangeCount === 0) return
         const settledRange = settledSelection.getRangeAt(0)
         const activeColors = deriveActiveColorsAt(richElement, settledRange.startContainer, settledRange.startOffset)
         setFormatState(previous => ({
            ...previous,
            fontColor:      activeColors.fontColor,
            highlightColor: activeColors.highlightColor,
         }))
      })

      // Record settled custom colors (those not in the curated palette) into the recents
      // backlog. Debounced so dragging the ColorPicker, which emits onChange continuously
      //, records only the final value the user lands on, not every intermediate hue.
      const palette: readonly string[] = field === 'color' ? FONT_COLOR_PALETTE : HIGHLIGHT_COLOR_PALETTE
      if (colorValue !== undefined && !palette.includes(colorValue)) {
         if (recentColorTimerRef.current) clearTimeout(recentColorTimerRef.current)
         recentColorTimerRef.current = setTimeout(() => {
            setRecentColors(pushRecentColor(field, colorValue))
         }, 400)
      }
   }

   return {
      fontColorOpen,
      highlightColorOpen,
      fontColorOpenRef,
      highlightColorOpenRef,
      recentColors,
      openFontColorPicker,
      openHighlightColorPicker,
      closeFontColorPicker,
      closeHighlightColorPicker,
      applyInlineColor,
   }
}

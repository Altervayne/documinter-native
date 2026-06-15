import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Block, Section } from '../types'
import { execFormatCommand } from '../lib/execCommand'

// ###################################################
// # ANCHORED-BLOCK HELPER (LINK PANEL JUMP TARGETS) #
// ###################################################

export interface AnchoredBlock {
   block:        Block
   sectionIndex: number
}

/** Flatten all blocks (including container inner blocks) that carry a deep-link handle. */
export function getAnchoredBlocks(sections: Section[]): AnchoredBlock[] {
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

// ########
// # HOOK #
// ########

interface UseLinkModeOptions {
   /** Selection range shared with the toolbar + color picker; saved on open, restored on apply. */
   savedRangeRef: RefObject<Range | null>
   /** Toolbar visibility, used to defer opening link mode after a link auto-select click. */
   visible:    boolean
}

/**
 * Owns the FormatToolbar's link-creation panel: its mode/url/editing state, the
 * save-and-restore of the user's selection, and the "click an existing link to edit it"
 * auto-select behaviour. The toolbar keeps the orchestrating selectionchange listener
 * and reads `linkModeRef` to suppress it while the panel is open.
 */
export function useLinkMode({ savedRangeRef, visible }: UseLinkModeOptions) {
   const [linkMode, setLinkMode]                           = useState(false)
   const [linkUrl, setLinkUrl]                             = useState('')
   const [isEditingExistingLink, setIsEditingExistingLink] = useState(false)

   const inputRef          = useRef<HTMLInputElement>(null)
   const linkModeRef       = useRef(false)
   const pendingLinkOpen   = useRef(false)
   const pendingLinkAnchor = useRef<HTMLAnchorElement | null>(null)

   // Stable: referenced from the toolbar's orchestrator effect and the visible-gated
   // effect below, so their identity must not change between renders.
   const openLinkMode = useCallback(() => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      const existingLink = pendingLinkAnchor.current
         ?? sel?.anchorNode?.parentElement?.closest('a')
      pendingLinkAnchor.current = null
      setIsEditingExistingLink(!!existingLink)
      setLinkUrl(existingLink?.getAttribute('href') ?? '')
      linkModeRef.current = true
      setLinkMode(true)
   }, [savedRangeRef])

   const closeLinkMode = useCallback(() => {
      linkModeRef.current = false
      setLinkMode(false)
      setLinkUrl('')
      setIsEditingExistingLink(false)
   }, [])

   function applyLink() {
      const sel = window.getSelection()
      if (savedRangeRef.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRangeRef.current)
      }
      if (linkUrl.trim()) execFormatCommand('createLink', linkUrl.trim())
      closeLinkMode()
   }

   function removeLink() {
      const sel = window.getSelection()
      if (savedRangeRef.current) {
         sel?.removeAllRanges()
         sel?.addRange(savedRangeRef.current)
      }
      execFormatCommand('unlink')
      closeLinkMode()
   }

   // Clicking on an <a> inside a rich contenteditable auto-selects the link
   // and queues the link panel, so the user doesn't have to precisely drag-select.
   useEffect(() => {
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
         // selectionchange fires next, toolbar becomes visible, then the effect below opens link mode
      }
      document.addEventListener('click', onDocClick)
      return () => document.removeEventListener('click', onDocClick)
   }, [])

   // After a link-click sets pendingLinkOpen, wait for the toolbar to become visible,
   // then open link mode so the panel appears with the href pre-filled.
   useEffect(() => {
      if (visible && pendingLinkOpen.current) {
         pendingLinkOpen.current = false
         // eslint-disable-next-line react-hooks/set-state-in-effect
         openLinkMode()
      }
   }, [visible, openLinkMode])

   // Focus the URL input whenever link mode opens
   useEffect(() => {
      if (linkMode) inputRef.current?.focus()
   }, [linkMode])

   return {
      linkMode,
      linkUrl,
      setLinkUrl,
      isEditingExistingLink,
      inputRef,
      linkModeRef,
      openLinkMode,
      closeLinkMode,
      applyLink,
      removeLink,
   }
}

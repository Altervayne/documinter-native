// -- React Imports --
import { useState, useEffect } from 'react'
import type { RefObject } from 'react'

// -- Lib / Type Imports --
import { generateHandle } from '../../lib/document'
import type { Block } from '../../types'

interface UseAnchorEditorOptions {
   block:       Block
   /** The block's wrapper element, measured to position the anchor editor beside it. */
   blockDivRef: RefObject<HTMLDivElement | null>
   /** Commit a handle change onto the block (inner/outer routing handled by the caller). */
   patch:       (partialBlock: Partial<Block>) => void
}

// #############
// # CONSTANTS #
// #############

const VIEWPORT_MARGIN = 8
// Conservative estimate of the anchor-editor pill's rendered box (padding + "#" prefix + the
// w-35 input + optional duplicate-warning icon + optional remove button). Only used as a ceiling
// on the CSS `right` offset / floor on `top` — the common case still positions exactly against
// the block's rect, unaffected by this estimate; it only kicks in when the block sits near an edge.
const ANCHOR_EDITOR_ESTIMATED_WIDTH  = 220
const ANCHOR_EDITOR_ESTIMATED_HEIGHT = 40

interface UseAnchorEditorResult {
   anchorEditing:     boolean
   anchorDraft:       string
   anchorPos:         { top: number; right: number } | null
   setAnchorDraft:    (value: string) => void
   openAnchorEditor:  () => void
   closeAnchorEditor: () => void
   confirmAnchor:     () => void
   removeAnchor:      () => void
}

/**
 * Anchor-editor state for a WysiwygBlock: open/draft state, the slug normalisation on confirm,
 * and the fixed position derived from the block's bounding rect (so the editor escapes the
 * scroll container's overflow clipping). The markup itself lives in blocks/AnchorEditor.tsx,
 * which the block renders with these values — this hook owns only the state + slugify.
 */
export function useAnchorEditor({ block, blockDivRef, patch }: UseAnchorEditorOptions): UseAnchorEditorResult {
   const [anchorEditing, setAnchorEditing] = useState(false)
   const [anchorDraft,   setAnchorDraft]   = useState('')
   const [anchorPos,     setAnchorPos]     = useState<{ top: number; right: number } | null>(null)

   function openAnchorEditor() {
      setAnchorDraft(block.handle ?? generateHandle(block))
      setAnchorEditing(true)
   }
   function closeAnchorEditor() { setAnchorEditing(false) }
   function confirmAnchor() {
      const slug = anchorDraft.trim().toLowerCase()
         .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
      patch({ handle: slug || undefined })
      closeAnchorEditor()
   }
   function removeAnchor() { patch({ handle: undefined }); closeAnchorEditor() }

   useEffect(() => {
      if (anchorEditing) {
         const rect = blockDivRef.current?.getBoundingClientRect()
         if (rect) {
            // `right` grows leftward from the block's left edge — clamp its ceiling so the pill's
            // far (left) edge can't be pushed past the viewport when the block sits near the left.
            const desiredRight = window.innerWidth - rect.left + 10
            const maxRight     = window.innerWidth - ANCHOR_EDITOR_ESTIMATED_WIDTH - VIEWPORT_MARGIN
            const clampedRight = Math.min(desiredRight, maxRight)
            const clampedTop   = Math.max(
               VIEWPORT_MARGIN,
               Math.min(rect.top, window.innerHeight - ANCHOR_EDITOR_ESTIMATED_HEIGHT - VIEWPORT_MARGIN),
            )
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAnchorPos({ top: clampedTop, right: clampedRight })
         }
      } else {
         setAnchorPos(null)
      }
   }, [anchorEditing, blockDivRef])

   return { anchorEditing, anchorDraft, anchorPos, setAnchorDraft, openAnchorEditor, closeAnchorEditor, confirmAnchor, removeAnchor }
}

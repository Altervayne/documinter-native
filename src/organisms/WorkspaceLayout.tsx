import { useRef } from 'react'
import type { ViewLayout } from '../types'

// ============================================================
// Types
// ============================================================

interface WorkspaceLayoutProps {
   viewLayout:   ViewLayout
   splitRatio:   number
   onSplitRatio: (ratio: number) => void
   wysiwygPane:  React.ReactNode
   markdownPane: React.ReactNode
}

// ============================================================
// Component
// ============================================================

/**
 * Manages the three view layouts (wysiwyg, split, markdown).
 *
 * Both panes are ALWAYS mounted — switching layouts never unmounts either
 * panel, preserving in-progress edits and pending debounce timers.
 * The non-visible pane is hidden with `display: none`.
 *
 * In split mode a draggable divider lets the user adjust the ratio.
 * The pointer-capture pattern prevents the pointer from escaping the
 * divider element during fast drags.
 */
export function WorkspaceLayout({
   viewLayout,
   splitRatio,
   onSplitRatio,
   wysiwygPane,
   markdownPane,
}: WorkspaceLayoutProps) {
   const containerRef = useRef<HTMLDivElement>(null)

   // ── Divider drag handlers ──────────────────────────────────

   function handleDividerPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
   }

   function handleDividerPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const container = containerRef.current
      if (!container) return
      const rect     = container.getBoundingClientRect()
      const newRatio = Math.max(0.15, Math.min(0.85, (event.clientX - rect.left) / rect.width))
      onSplitRatio(newRatio)
   }

   function handleDividerPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
      event.currentTarget.releasePointerCapture(event.pointerId)
   }

   // ── Pane visibility / sizing ───────────────────────────────

   const wysiwygHidden  = viewLayout === 'markdown'
   const markdownHidden = viewLayout === 'wysiwyg'
   const isSplit        = viewLayout === 'split'

   return (
      <div
         ref={containerRef}
         className="flex flex-1 min-h-0 overflow-hidden"
      >
         {/* ── WYSIWYG pane ── */}
         <div
            style={{
               display:    wysiwygHidden ? 'none' : undefined,
               flexBasis:  isSplit ? `${splitRatio * 100}%` : undefined,
               flexGrow:   isSplit ? 0 : 1,
               flexShrink: 0,
               minWidth:   0,
               overflow:   'auto',
            }}
         >
            {wysiwygPane}
         </div>

         {/* ── Split divider ── */}
         <div
            style={{ display: isSplit ? undefined : 'none' }}
            className="flex-none w-1 bg-border hover:bg-accent/60 cursor-col-resize transition-colors select-none"
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
         />

         {/* ── Markdown pane ── */}
         <div
            style={{
               display:    markdownHidden ? 'none' : undefined,
               flexGrow:   1,
               flexShrink: 1,
               flexBasis:  0,
               minWidth:   0,
               overflow:   'auto',
            }}
         >
            {markdownPane}
         </div>
      </div>
   )
}

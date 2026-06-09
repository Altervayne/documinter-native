import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { useLang } from '../contexts/LangContext'
import type { PaneId, PaneLeaf, PaneSplit, PaneNode } from '../types'

// ============================================================
// Internal types
// ============================================================

type DropZone = 'left' | 'right' | 'top' | 'bottom'

// ============================================================
// Pure helpers
// ============================================================

/**
 * Determines which quadrant of `rect` the pointer falls in, using the
 * diagonal method (compare |dx| vs |dy| from the centre).
 * Returns null when the pointer is outside the rect.
 */
function computeDropZone(
   pointerX: number,
   pointerY: number,
   rect: DOMRect,
): DropZone | null {
   if (
      pointerX < rect.left || pointerX > rect.right ||
      pointerY < rect.top  || pointerY > rect.bottom
   ) return null

   const dx = pointerX - (rect.left + rect.width  / 2)
   const dy = pointerY - (rect.top  + rect.height / 2)

   if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
   return dy < 0 ? 'top' : 'bottom'
}

/**
 * Returns a new PaneSplit that results from the user dropping `draggedId`
 * onto the given `zone` of the other pane.
 * - left / right  → horizontal split; dragged pane goes left / right
 * - top  / bottom → vertical split;   dragged pane goes top  / bottom
 * Ratio resets to 0.5 when orientation changes.
 */
function applyDropZone(
   split: PaneSplit,
   draggedId: PaneId,
   zone: DropZone,
): PaneSplit {
   const newOrientation: 'h' | 'v' = (zone === 'left' || zone === 'right') ? 'h' : 'v'
   const isFirst  = zone === 'left' || zone === 'top'
   const other    = split.children.find(child => (child as PaneLeaf).paneId !== draggedId)! as PaneLeaf
   const dragged: PaneLeaf = { kind: 'leaf', paneId: draggedId }
   const newRatio = newOrientation !== split.orientation ? 0.5 : split.ratio

   return {
      kind:        'split',
      orientation: newOrientation,
      ratio:       newRatio,
      children:    isFirst ? [dragged, other] : [other, dragged],
   }
}

// ============================================================
// PaneHeader sub-component
// ============================================================

interface PaneHeaderProps {
   label:         string
   onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
   onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
   onPointerUp:   (event: React.PointerEvent<HTMLDivElement>) => void
}

function PaneHeader({ label, onPointerDown, onPointerMove, onPointerUp }: PaneHeaderProps) {
   return (
      <div
         className="h-7 shrink-0 flex items-center gap-2 px-2 bg-raised border-b border-border select-none touch-none cursor-grab"
         onPointerDown={onPointerDown}
         onPointerMove={onPointerMove}
         onPointerUp={onPointerUp}
      >
         <GripVertical size={12} className="text-muted/60 pointer-events-none shrink-0" />
         <span className="text-[10px] font-mono text-muted/70 uppercase tracking-wider pointer-events-none">
            {label}
         </span>
      </div>
   )
}

// ============================================================
// DropZoneOverlay sub-component
// ============================================================

const ZONE_STYLES: Record<DropZone, React.CSSProperties> = {
   left:   { position: 'absolute', left: 0,   top: 0,    width: '50%',  height: '100%' },
   right:  { position: 'absolute', right: 0,  top: 0,    width: '50%',  height: '100%' },
   top:    { position: 'absolute', left: 0,   top: 0,    width: '100%', height: '50%'  },
   bottom: { position: 'absolute', left: 0,   bottom: 0, width: '100%', height: '50%'  },
}

function DropZoneOverlay({ hoveredZone }: { hoveredZone: DropZone | null }) {
   return (
      <div className="absolute inset-0 z-40 pointer-events-none">
         <div className="absolute inset-1 rounded-md border-2 border-dashed border-accent/40" />
         {hoveredZone !== null && (
            <div className="absolute bg-accent/20" style={ZONE_STYLES[hoveredZone]} />
         )}
      </div>
   )
}

// ============================================================
// Types
// ============================================================

interface WorkspaceLayoutProps {
   paneLayout:         PaneNode
   onPaneLayoutChange: (layout: PaneNode) => void
   wysiwygPane:        React.ReactNode
   markdownPane:       React.ReactNode
}

// ============================================================
// Component
// ============================================================

/**
 * Renders the workspace based on a PaneNode tree.
 *
 * ALWAYS-MOUNTED: both panes stay in the DOM at all times — the
 * wysiwyg wrapper is always the first DOM child, the markdown wrapper
 * always the second. CSS `order` values control the visual position in
 * split mode so pane reordering never unmounts either surface.
 *
 * In SPLIT mode each pane shows a draggable header strip. Grabbing it
 * and dragging to one of the four quadrants of the other pane
 * simultaneously controls orientation and order. Pointer capture is
 * used so fast drags stay reliable.
 *
 * The DIVIDER between the panes supports ratio resizing, also via
 * pointer capture.
 */
export function WorkspaceLayout({
   paneLayout,
   onPaneLayoutChange,
   wysiwygPane,
   markdownPane,
}: WorkspaceLayoutProps) {
   const { t } = useLang()

   const containerRef       = useRef<HTMLDivElement>(null)
   const wysiwygWrapperRef  = useRef<HTMLDivElement>(null)
   const markdownWrapperRef = useRef<HTMLDivElement>(null)

   const [draggingPaneId, setDraggingPaneId]   = useState<PaneId | null>(null)
   const [hoveredDropZone, setHoveredDropZone] = useState<DropZone | null>(null)

   const isSplit = paneLayout.kind === 'split'
   const split   = isSplit ? (paneLayout as PaneSplit) : null

   // ── Derived CSS values ─────────────────────────────────────

   /** paneId of children[0] when in split mode, null otherwise. */
   const firstPaneId: PaneId | null = split ? (split.children[0] as PaneLeaf).paneId : null

   /** Container flex direction. */
   const containerDirection = split?.orientation === 'v' ? 'column' : 'row'

   /** Build the inline style for the wysiwyg wrapper div. */
   function getWysiwygStyle(): React.CSSProperties {
      if (!split) {
         const isActive = (paneLayout as PaneLeaf).paneId === 'wysiwyg'
         return { display: isActive ? undefined : 'none', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }
      }
      const isFirst    = firstPaneId === 'wysiwyg'
      const ratioValue = `${split.ratio * 100}%`
      return {
         order:     isFirst ? 0 : 2,
         flex:      isFirst ? `0 0 ${ratioValue}` : '1 1 0',
         minWidth:  0,
         minHeight: 0,
         overflow:  'hidden',
         position:  'relative',
      }
   }

   /** Build the inline style for the markdown wrapper div. */
   function getMarkdownStyle(): React.CSSProperties {
      if (!split) {
         const isActive = (paneLayout as PaneLeaf).paneId === 'markdown'
         return { display: isActive ? undefined : 'none', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }
      }
      const isFirst    = firstPaneId === 'markdown'
      const ratioValue = `${split.ratio * 100}%`
      return {
         order:     isFirst ? 0 : 2,
         flex:      isFirst ? `0 0 ${ratioValue}` : '1 1 0',
         minWidth:  0,
         minHeight: 0,
         overflow:  'hidden',
         position:  'relative',
      }
   }

   /** Build the inline style for the divider bar. */
   function getDividerStyle(): React.CSSProperties {
      if (!split) return { display: 'none' }
      return split.orientation === 'h'
         ? { order: 1, flexShrink: 0, width: '4px', alignSelf: 'stretch', cursor: 'col-resize' }
         : { order: 1, flexShrink: 0, height: '4px', alignSelf: 'stretch', cursor: 'row-resize' }
   }

   // ── Pane-header drag handlers ──────────────────────────────

   function handlePaneHeaderPointerDown(
      event: React.PointerEvent<HTMLDivElement>,
      paneId: PaneId,
   ): void {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraggingPaneId(paneId)
      document.body.style.userSelect = 'none'
   }

   function handlePaneHeaderPointerMove(
      event: React.PointerEvent<HTMLDivElement>,
      paneId: PaneId,
   ): void {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const otherRef = paneId === 'wysiwyg' ? markdownWrapperRef : wysiwygWrapperRef
      const otherEl  = otherRef.current
      if (!otherEl) return
      setHoveredDropZone(computeDropZone(event.clientX, event.clientY, otherEl.getBoundingClientRect()))
   }

   function handlePaneHeaderPointerUp(
      event: React.PointerEvent<HTMLDivElement>,
      paneId: PaneId,
   ): void {
      event.currentTarget.releasePointerCapture(event.pointerId)
      document.body.style.userSelect = ''
      if (hoveredDropZone !== null && split !== null) {
         onPaneLayoutChange(applyDropZone(split, paneId, hoveredDropZone))
      }
      setDraggingPaneId(null)
      setHoveredDropZone(null)
   }

   // ── Divider ratio-resize handlers ─────────────────────────

   function handleDividerPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
   }

   function handleDividerPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      if (!split) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const rawRatio = split.orientation === 'h'
         ? (event.clientX - rect.left)  / rect.width
         : (event.clientY - rect.top)   / rect.height
      onPaneLayoutChange({ ...split, ratio: Math.max(0.15, Math.min(0.85, rawRatio)) })
   }

   function handleDividerPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
      event.currentTarget.releasePointerCapture(event.pointerId)
   }

   // ── Render ─────────────────────────────────────────────────

   return (
      <div
         ref={containerRef}
         className="flex flex-1 min-h-0 overflow-hidden"
         style={{ flexDirection: containerDirection }}
      >
         {/* ── WYSIWYG pane wrapper (always first in DOM) ── */}
         <div
            ref={wysiwygWrapperRef}
            style={getWysiwygStyle()}
            className="flex flex-col"
         >
            {isSplit && (
               <PaneHeader
                  label={t.paneEditor}
                  onPointerDown={(event) => handlePaneHeaderPointerDown(event, 'wysiwyg')}
                  onPointerMove={(event) => handlePaneHeaderPointerMove(event, 'wysiwyg')}
                  onPointerUp={(event)   => handlePaneHeaderPointerUp(event, 'wysiwyg')}
               />
            )}
            {isSplit && draggingPaneId === 'markdown' && (
               <DropZoneOverlay hoveredZone={hoveredDropZone} />
            )}
            <div className="flex-1 min-h-0 overflow-auto">
               {wysiwygPane}
            </div>
         </div>

         {/* ── Split divider ── */}
         <div
            style={getDividerStyle()}
            className="flex-none bg-border hover:bg-accent/60 transition-colors select-none touch-none"
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
         />

         {/* ── Markdown pane wrapper (always second in DOM) ── */}
         <div
            ref={markdownWrapperRef}
            style={getMarkdownStyle()}
            className="flex flex-col"
         >
            {isSplit && (
               <PaneHeader
                  label={t.paneMarkdown}
                  onPointerDown={(event) => handlePaneHeaderPointerDown(event, 'markdown')}
                  onPointerMove={(event) => handlePaneHeaderPointerMove(event, 'markdown')}
                  onPointerUp={(event)   => handlePaneHeaderPointerUp(event, 'markdown')}
               />
            )}
            {isSplit && draggingPaneId === 'wysiwyg' && (
               <DropZoneOverlay hoveredZone={hoveredDropZone} />
            )}
            <div className="flex-1 min-h-0 overflow-auto">
               {markdownPane}
            </div>
         </div>
      </div>
   )
}

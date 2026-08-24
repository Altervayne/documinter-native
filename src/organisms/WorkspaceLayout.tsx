import { useRef, useState, useEffect } from 'react'
import { GripVertical } from 'lucide-react'
import { useLang } from '../contexts/LangContext'
import type { PaneId, PaneLeaf, PaneSplit, PaneNode } from '../types'
import { countVisiblePanels, relocatePanel, setSplitRatio } from '../lib/paneTree'

// ##################
// # INTERNAL TYPES #
// ##################

type DropZone = 'left' | 'right' | 'top' | 'bottom'

// ################
// # PURE HELPERS #
// ################

/**
 * Returns which quadrant of `rect` the pointer falls in.
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

// ############################
// # PANEHEADER SUB-COMPONENT #
// ############################

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

// #################################
// # DROPZONEOVERLAY SUB-COMPONENT #
// #################################

const ZONE_STYLES: Record<DropZone, React.CSSProperties> = {
   left:   { position: 'absolute', left: 4,  top: 4,    bottom: 4,  width: 'calc(50% - 8px)' },
   right:  { position: 'absolute', right: 4, top: 4,    bottom: 4,  width: 'calc(50% - 8px)' },
   top:    { position: 'absolute', left: 4,  top: 4,    right: 4,   height: 'calc(50% - 8px)' },
   bottom: { position: 'absolute', left: 4,  bottom: 4, right: 4,   height: 'calc(50% - 8px)' },
}

function ZoneHighlight({ zone }: { zone: DropZone }) {
   const [isVisible, setIsVisible] = useState(false)

   useEffect(() => {
      const frameId = requestAnimationFrame(() => setIsVisible(true))
      return () => cancelAnimationFrame(frameId)
   }, [])

   return (
      <div
         className={[
            'absolute bg-accent/20 rounded-lg',
            'transition-opacity duration-150 ease-out motion-reduce:transition-none',
            isVisible ? 'opacity-100' : 'opacity-0',
         ].join(' ')}
         style={ZONE_STYLES[zone]}
      />
   )
}

function DropZoneOverlay({ hoveredZone }: { hoveredZone: DropZone | null }) {
   const [isVisible, setIsVisible] = useState(false)

   useEffect(() => {
      const frameId = requestAnimationFrame(() => setIsVisible(true))
      return () => cancelAnimationFrame(frameId)
   }, [])

   return (
      <div
         className={[
            'absolute inset-0 z-40 pointer-events-none',
            'transition-opacity duration-150 ease-out motion-reduce:transition-none',
            isVisible ? 'opacity-100' : 'opacity-0',
         ].join(' ')}
      >
         <div className="absolute inset-1 rounded-md border-2 border-dashed border-accent/40" />
         {hoveredZone !== null && <ZoneHighlight key={hoveredZone} zone={hoveredZone} />}
      </div>
   )
}

// #########
// # TYPES #
// #########

interface WorkspaceLayoutProps {
   paneLayout:         PaneNode
   onPaneLayoutChange: (layout: PaneNode) => void
   panels:             Record<PaneId, React.ReactNode>
}

// #############
// # COMPONENT #
// #############

/**
 * Renders the workspace as a recursive PaneNode tree.
 *
 * Each PaneSplit renders two children in a flex container separated by a
 * resizable divider. Each PaneLeaf renders the panel content with an optional
 * draggable PaneHeader (shown only when multiple panels are visible).
 *
 * Drag-to-reposition: grabbing a PaneHeader and releasing over a quadrant of
 * another panel calls `relocatePanel` to move the leaf to its new position.
 *
 * Divider resize: each split's divider handles its own pointer capture and
 * calls `setSplitRatio` to update only its own ratio.
 *
 * Panels are mounted and unmounted as their leaves appear and disappear from
 * the tree (not always-mounted). Components re-derive content from props on mount.
 */
export function WorkspaceLayout({
   paneLayout,
   onPaneLayoutChange,
   panels,
}: WorkspaceLayoutProps) {
   const { t } = useLang()

   // ===========
   //  Drag state
   // ===========
   const [draggingPaneId, setDraggingPaneId]   = useState<PaneId | null>(null)
   const [hoveredDropInfo, setHoveredDropInfo] = useState<{ paneId: PaneId; zone: DropZone } | null>(null)
   const [dragPosition, setDragPosition]       = useState<{ x: number; y: number } | null>(null)

   // Refs to each leaf wrapper div, used to compute drop zones during drag
   const leafRefsMap = useRef<Map<PaneId, HTMLDivElement | null>>(new Map())

   // Always-current paneLayout for pointer event handlers (avoids stale closures mid-drag)
   const paneLayoutRef = useRef(paneLayout)
   paneLayoutRef.current = paneLayout

   const totalPanels = countVisiblePanels(paneLayout)

   // ==================
   //  Pane label lookup
   // ==================

   function getPaneLabel(paneId: PaneId): string {
      switch (paneId) {
         case 'wysiwyg':  return t.paneEditor
         case 'markdown': return t.paneMarkdown
      }
   }

   // ==========================
   //  Pane-header drag handlers
   // ==========================

   function handlePaneHeaderPointerDown(
      event: React.PointerEvent<HTMLDivElement>,
      paneId: PaneId,
   ): void {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraggingPaneId(paneId)
      setDragPosition({ x: event.clientX, y: event.clientY })
      document.body.style.userSelect = 'none'
   }

   function handlePaneHeaderPointerMove(
      event: React.PointerEvent<HTMLDivElement>,
      paneId: PaneId,
   ): void {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      setDragPosition({ x: event.clientX, y: event.clientY })

      let foundDropInfo: { paneId: PaneId; zone: DropZone } | null = null
      for (const [leafPaneId, leafElement] of leafRefsMap.current) {
         if (leafPaneId === paneId || !leafElement) continue
         const zone = computeDropZone(event.clientX, event.clientY, leafElement.getBoundingClientRect())
         if (zone !== null) { foundDropInfo = { paneId: leafPaneId, zone }; break }
      }
      setHoveredDropInfo(foundDropInfo)
   }

   function handlePaneHeaderPointerUp(
      event: React.PointerEvent<HTMLDivElement>,
      paneId: PaneId,
   ): void {
      event.currentTarget.releasePointerCapture(event.pointerId)
      document.body.style.userSelect = ''

      if (hoveredDropInfo !== null) {
         onPaneLayoutChange(relocatePanel(paneLayoutRef.current, paneId, hoveredDropInfo.paneId, hoveredDropInfo.zone))
      }
      setDraggingPaneId(null)
      setHoveredDropInfo(null)
      setDragPosition(null)
   }

   // ========================
   //  Divider resize handlers
   // ========================

   function handleDividerPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
   }

   function handleDividerPointerMove(
      event:       React.PointerEvent<HTMLDivElement>,
      path:        number[],
      orientation: 'h' | 'v',
   ): void {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const rect     = event.currentTarget.parentElement!.getBoundingClientRect()
      const rawRatio = orientation === 'h'
         ? (event.clientX - rect.left) / rect.width
         : (event.clientY - rect.top)  / rect.height
      onPaneLayoutChange(setSplitRatio(paneLayoutRef.current, path, Math.max(0.15, Math.min(0.85, rawRatio))))
   }

   function handleDividerPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
      event.currentTarget.releasePointerCapture(event.pointerId)
   }

   // ========================
   //  Recursive tree renderer
   // ========================

   function renderNode(node: PaneNode, path: number[]): React.ReactElement {
      if (node.kind === 'leaf') return renderLeaf(node as PaneLeaf)
      return renderSplit(node as PaneSplit, path)
   }

   function renderLeaf(node: PaneLeaf): React.ReactElement {
      const isDragging      = draggingPaneId !== null
      const isBeingDragged  = draggingPaneId === node.paneId
      const isDragTarget    = isDragging && !isBeingDragged && hoveredDropInfo?.paneId === node.paneId

      return (
         <div
            ref={(element) => {
               if (element) { leafRefsMap.current.set(node.paneId, element) }
               else         { leafRefsMap.current.delete(node.paneId) }
            }}
            className="relative flex flex-col"
            style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
         >
            {totalPanels > 1 && (
               <PaneHeader
                  label={getPaneLabel(node.paneId)}
                  onPointerDown={(event) => handlePaneHeaderPointerDown(event, node.paneId)}
                  onPointerMove={(event) => handlePaneHeaderPointerMove(event, node.paneId)}
                  onPointerUp={(event)   => handlePaneHeaderPointerUp(event, node.paneId)}
               />
            )}
            {isDragging && !isBeingDragged && (
               <DropZoneOverlay hoveredZone={isDragTarget ? hoveredDropInfo!.zone : null} />
            )}
            <div className="flex-1 min-h-0 overflow-auto">
               {panels[node.paneId]}
            </div>
         </div>
      )
   }

   function renderSplit(node: PaneSplit, path: number[]): React.ReactElement {
      const isHorizontal = node.orientation === 'h'

      return (
         <div
            className="flex"
            style={{
               flexDirection: isHorizontal ? 'row' : 'column',
               flex:          '1 1 0',
               minWidth:      0,
               minHeight:     0,
               overflow:      'hidden',
            }}
         >
            <div
               className="flex flex-col"
               style={{ flex: `0 0 ${node.ratio * 100}%`, minWidth: 0, minHeight: 0, overflow: 'hidden' }}
            >
               {renderNode(node.children[0], [...path, 0])}
            </div>

            {/* Divider */}
            <div
               className="flex-none bg-border hover:bg-accent/60 transition-colors select-none touch-none"
               style={isHorizontal
                  ? { width: '4px', alignSelf: 'stretch', cursor: 'col-resize' }
                  : { height: '4px', alignSelf: 'stretch', cursor: 'row-resize' }
               }
               onPointerDown={handleDividerPointerDown}
               onPointerMove={(event) => handleDividerPointerMove(event, path, node.orientation)}
               onPointerUp={handleDividerPointerUp}
            />

            <div
               className="flex flex-col"
               style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
            >
               {renderNode(node.children[1], [...path, 1])}
            </div>
         </div>
      )
   }

   // =======
   //  Render
   // =======

   return (
      <>
         <div className="flex flex-1 min-h-0 overflow-hidden">
            {renderNode(paneLayout, [])}
         </div>

         {/* Drag ghost, follows cursor while a pane header is being dragged */}
         {draggingPaneId !== null && dragPosition !== null && (
            <div
               className="fixed z-50 pointer-events-none"
               style={{ left: dragPosition.x, top: dragPosition.y, transform: 'translate(-50%, -50%)' }}
            >
               <div className="flex items-center gap-2.5 px-3 h-9 bg-raised border border-border shadow-xl rounded-md select-none opacity-90">
                  <GripVertical size={14} className="text-muted/60 shrink-0" />
                  <span className="text-xs font-mono text-muted/70 uppercase tracking-wider whitespace-nowrap">
                     {getPaneLabel(draggingPaneId)}
                  </span>
               </div>
            </div>
         )}
      </>
   )
}

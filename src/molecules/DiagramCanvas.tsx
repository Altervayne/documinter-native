// -- React Imports --
import { useEffect, useRef } from 'react'
import type React from 'react'

// -- Library / Type Imports --
import { pointerToDiagramPoint, screenToFramePoint, nodeHandlePoints, nodePorts } from '../lib/diagram/edit'
import type { DiagramViewBox, AlignmentGuide, NodeResizeHandle, NodeBox } from '../lib/diagram/edit'
import type { SpacingBadge, Rect } from '../lib/diagram/align'
import type { DiagramNode } from '../lib/diagram'
import type { Point } from '../lib/diagram/geometry'

// #############
// # CONSTANTS #
// #############

/** Selection-handle square edge, in diagram units (scales with the canvas). */
const HANDLE_SIZE = 9

/** Connection-port dot radius, in diagram units. */
const PORT_RADIUS = 5

/** Selection accent, matching the image-markup editor's selection chrome. */
const SELECTION_COLOR = '#2563eb'

/** Connection accent (teal), for ports + the live connect preview, distinct from the selection. */
const CONNECT_COLOR = '#0d9488'

/** Alignment-guide accent (magenta), distinct from the selection. */
const GUIDE_COLOR = '#e0218a'

/** The directional CSS cursor to show while hovering each resize handle. */
const RESIZE_CURSORS: Record<NodeResizeHandle, string> = {
   nw: 'nwse-resize', se: 'nwse-resize',
   ne: 'nesw-resize', sw: 'nesw-resize',
   n:  'ns-resize',   s:  'ns-resize',
   e:  'ew-resize',   w:  'ew-resize',
}

// #########
// # TYPES #
// #########

/**
 * Everything a pointer interaction needs, derived from the raw event so the editor stays DOM-free:
 * the pointer in ABSOLUTE diagram units (through the viewport), the same pointer in transform-
 * INDEPENDENT frame space (for pan deltas + zoom anchors), and the on-screen pixels-per-diagram-unit
 * (to convert a constant screen-pixel snap threshold into diagram units).
 */
export interface CanvasPointerInfo {
   diagramPoint:         Point
   framePoint:           Point
   pixelsPerDiagramUnit: number
   /** Alt held on this event; a group drag reads it to bypass snapping. */
   altKey:               boolean
}

interface DiagramCanvasProps {
   /** The rendered diagram SVG (viewBox overridden to the viewport by the editor), or '' when blank. */
   svgMarkup: string
   /** The render VIEWPORT (diagram units) from the zoom/pan: the shared viewBox, and the space every
    *  pointer maps into. */
   viewport: DiagramViewBox
   /** The FIXED reference frame (0 0 W H): the space pan deltas and zoom anchors are measured in.
    *  Never clips content (the viewport does the windowing). */
   frame: DiagramViewBox
   /** The selected nodes (each draws an outline; resize handles only when exactly one). */
   selectedNodes: DiagramNode[]
   /** The combined bounding box when 2+ nodes are selected (a lighter group rect), else null. */
   groupBox: NodeBox | null
   /** The live marquee rectangle while an empty-canvas drag is selecting, or null. */
   marqueeRect: Rect | null
   /** The equal-spacing distance badges to draw while a group drags (empty otherwise). */
   spacingBadges: SpacingBadge[]
   /** The polyline of the currently selected edge (a highlight is drawn over it), or null. */
   selectedEdgePolyline: Point[] | null
   /** The node whose connection ports are revealed (the hovered node), or null. */
   portNode: DiagramNode | null
   /** The live edge-connect preview (a dashed line from a source port to the cursor), or null. */
   connectPreview: { start: Point; end: Point } | null
   /** The node currently under the cursor during a connect drag (outlined as the drop target), or null. */
   connectTargetNode: DiagramNode | null
   /** The node whose label is being typed in the edit-in-place overlay, or null. */
   editingLabelNode: DiagramNode | null
   /** Alignment guides to draw while a node is dragged (empty otherwise). */
   alignmentGuides: AlignmentGuide[]
   /** Pointer-down (the raw event rides along for pointer capture). */
   onPointerDownPoint: (info: CanvasPointerInfo, event: React.PointerEvent) => void
   /** Pointer-move (only meaningful mid-drag / mid-pan). */
   onPointerMovePoint: (info: CanvasPointerInfo) => void
   /** Pointer-up / cancel (ends a drag / pan). */
   onPointerUp: (event: React.PointerEvent) => void
   /** Double-click at a mapped diagram point (opens the label edit-in-place on a hit node). */
   onDoubleClickPoint: (point: Point) => void
   /** Right-click at a mapped diagram point (the raw event rides along so a hit can preventDefault the
    *  native menu + read the cursor's client coords for the node context menu). */
   onContextMenuPoint: (point: Point, event: React.MouseEvent) => void
   /** Commit the edit-in-place label (blur / Enter). */
   onLabelCommit: (value: string) => void
   /** Scroll-wheel zoom: the frame-space point under the cursor + the wheel delta (negative = zoom in). */
   onWheelZoom: (viewCursor: Point, deltaY: number) => void
   /** The user-resizable canvas HEIGHT (screen px). The container width is 100%; height is this value. */
   heightPx: number
   /** Reports the measured container size so the editor keeps the frame aspect matched to it (the
    *  pointer-mapping / clip correctness keystone). */
   onContainerResize: (size: { width: number; height: number }) => void
   /** CSS cursor for the interaction surface (e.g. 'default' vs 'grabbing'). */
   cursor: string
}

// #############
// # COMPONENT #
// #############

/**
 * The interactive 2D diagram canvas, hosted in the Block Editor Window. Full-width with a user-
 * resizable HEIGHT; a ResizeObserver reports its size so the editor keeps the frame aspect matched.
 * Three stacked layers, all sharing the viewport viewBox so they stay aligned:
 *   (1) the VISUAL layer, the same `renderDiagramToSvg` output the block + export use, viewBox
 *       overridden to the viewport. Nodes draw at absolute coords, so zoom/pan is pure viewBox math
 *       and nothing is clipped; any node is reachable by panning.
 *   (2) the INTERACTION overlay, a transparent surface capturing pointer events and drawing the
 *       selection chrome + guides at absolute coords (non-scaling strokes stay crisp at any zoom).
 *   (3) the LABEL overlay, a textarea positioned over a node while its label is typed.
 *
 * All hit-testing + geometry is pure (`lib/diagram/edit.ts`); this component is thin pointer glue.
 */
export function DiagramCanvas({
   svgMarkup, viewport, frame, selectedNodes, groupBox, marqueeRect, spacingBadges,
   selectedEdgePolyline, portNode,
   connectPreview, connectTargetNode, editingLabelNode, alignmentGuides,
   onPointerDownPoint, onPointerMovePoint, onPointerUp, onDoubleClickPoint, onContextMenuPoint,
   onLabelCommit, onWheelZoom, heightPx, onContainerResize, cursor,
}: DiagramCanvasProps) {
   const overlayRef = useRef<HTMLDivElement>(null)

   // Latest-value refs so the once-attached wheel / resize-observer listeners never read a stale
   // closure (React Compiler forbids hand-rolled useCallback).
   const frameRef = useRef(frame)
   frameRef.current = frame
   const onWheelZoomRef = useRef(onWheelZoom)
   onWheelZoomRef.current = onWheelZoom
   const onContainerResizeRef = useRef(onContainerResize)
   onContainerResizeRef.current = onContainerResize
   const lastReportedSizeRef = useRef({ width: 0, height: 0 })

   // A native, NON-PASSIVE wheel listener so it can preventDefault the page scroll (React's synthetic
   // onWheel is passive and cannot).
   useEffect(() => {
      const element = overlayRef.current
      if (!element) return
      function onWheel(event: WheelEvent): void {
         event.preventDefault()
         const rect = element!.getBoundingClientRect()
         const viewCursor = screenToFramePoint(event.clientX, event.clientY, rect, frameRef.current)
         onWheelZoomRef.current(viewCursor, event.deltaY)
      }
      element.addEventListener('wheel', onWheel, { passive: false })
      return () => element.removeEventListener('wheel', onWheel)
   }, [])

   // Measure the container and report its size up, so the editor keeps the frame aspect matched to it.
   // Guarded so an unchanged size never churns state.
   useEffect(() => {
      const element = overlayRef.current
      if (!element || typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(entries => {
         const rect = entries[0]?.contentRect
         if (!rect) return
         const last = lastReportedSizeRef.current
         if (Math.abs(rect.width - last.width) < 0.5 && Math.abs(rect.height - last.height) < 0.5) return
         lastReportedSizeRef.current = { width: rect.width, height: rect.height }
         onContainerResizeRef.current({ width: rect.width, height: rect.height })
      })
      observer.observe(element)
      return () => observer.disconnect()
   }, [])

   function pointerInfo(event: React.PointerEvent): CanvasPointerInfo {
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) {
         return {
            diagramPoint: { x: viewport.minX, y: viewport.minY },
            framePoint:   { x: frame.minX, y: frame.minY },
            pixelsPerDiagramUnit: 1,
            altKey:       event.altKey,
         }
      }
      return {
         // The viewport IS the viewBox, so a plain proportional map is exact.
         diagramPoint: pointerToDiagramPoint(event.clientX, event.clientY, rect, viewport),
         framePoint:   screenToFramePoint(event.clientX, event.clientY, rect, frame),
         pixelsPerDiagramUnit: rect.width > 0 && viewport.width > 0 ? rect.width / viewport.width : 1,
         altKey:       event.altKey,
      }
   }

   function diagramPointAt(event: React.MouseEvent): Point {
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) return { x: viewport.minX, y: viewport.minY }
      return pointerToDiagramPoint(event.clientX, event.clientY, rect, viewport)
   }

   const viewBoxString = `${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`

   return (
      <div
         className="diagram-canvas"
         style={{ height: `${heightPx}px` }}
      >
         {/* (1) Visual layer. */}
         {svgMarkup
            ? <div className="diagram-canvas-visual" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
            : <div className="diagram-canvas-visual diagram-canvas-blank" aria-hidden="true" />}

         {/* (2) Interaction + selection chrome + alignment guides. */}
         <div
            ref={overlayRef}
            className="diagram-canvas-interaction"
            style={{ cursor }}
            onPointerDown={event => {
               // Primary button: selection / move / marquee. Middle button: pan. Right button is left
               // for the context menu.
               if (event.button === 0 || event.button === 1) onPointerDownPoint(pointerInfo(event), event)
            }}
            onPointerMove={event => onPointerMovePoint(pointerInfo(event))}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={event => onDoubleClickPoint(diagramPointAt(event))}
            onContextMenu={event => onContextMenuPoint(diagramPointAt(event), event)}
         >
            <svg
               className="diagram-canvas-chrome"
               viewBox={viewBoxString}
               preserveAspectRatio="none"
            >
               {selectedEdgePolyline && <EdgeHighlight polyline={selectedEdgePolyline} />}
               {alignmentGuides.map((guide, index) => <GuideLine key={index} guide={guide} />)}
               {spacingBadges.map((badge, index) => <SpacingBadgeMarks key={`spacing-${index}`} badge={badge} />)}
               {groupBox && <GroupBoundsRect box={groupBox} />}
               {selectedNodes.map(node => (
                  <SelectionChrome key={node.id} node={node} showHandles={selectedNodes.length === 1} />
               ))}
               {marqueeRect && <MarqueeRect rect={marqueeRect} />}
               {portNode && <ConnectionPorts node={portNode} />}
               {connectTargetNode && <ConnectTargetOutline node={connectTargetNode} />}
               {connectPreview && <ConnectPreviewLine preview={connectPreview} />}
            </svg>
         </div>

         {/* (3) Edit-in-place label overlay. */}
         {editingLabelNode && (
            <textarea
               key={editingLabelNode.id}
               className="diagram-label-input"
               style={labelOverlayStyle(editingLabelNode, viewport)}
               defaultValue={editingLabelNode.label}
               autoFocus
               spellCheck={false}
               onFocus={event => event.currentTarget.select()}
               onBlur={event => onLabelCommit(event.target.value)}
               onKeyDown={event => {
                  event.stopPropagation()
                  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
                     event.preventDefault()
                     event.currentTarget.blur()
                  }
               }}
            />
         )}
      </div>
   )
}

// #########
// # CHROME #
// #########

/** An alignment guide line (constant x for vertical, constant y for horizontal), crisp at any zoom. */
function GuideLine({ guide }: { guide: AlignmentGuide }) {
   const isVertical = guide.orientation === 'vertical'
   return (
      <line
         x1={isVertical ? guide.position : guide.from}
         y1={isVertical ? guide.from     : guide.position}
         x2={isVertical ? guide.position : guide.to}
         y2={isVertical ? guide.to        : guide.position}
         stroke={GUIDE_COLOR} strokeWidth={1} strokeDasharray="4 3"
         vectorEffect="non-scaling-stroke"
      />
   )
}

/** The selected node's dashed outline + a square per resize handle. Handles only when `showHandles`. */
function SelectionChrome({ node, showHandles }: { node: DiagramNode; showHandles: boolean }) {
   const handles = showHandles ? nodeHandlePoints(node) : []
   return (
      <>
         <rect
            x={node.x} y={node.y} width={node.width} height={node.height}
            fill="none" stroke={SELECTION_COLOR} strokeWidth={1.5} strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
         />
         {handles.map(({ handle, point }) => (
            <rect
               key={handle}
               x={point.x - HANDLE_SIZE / 2}
               y={point.y - HANDLE_SIZE / 2}
               width={HANDLE_SIZE}
               height={HANDLE_SIZE}
               fill="#ffffff" stroke={SELECTION_COLOR} strokeWidth={1.5}
               vectorEffect="non-scaling-stroke"
               // Re-enable pointer events on the handle alone (the chrome SVG is pointer-events:none)
               // so the resize cursor shows on hover; the press still bubbles to the overlay.
               style={{ cursor: RESIZE_CURSORS[handle], pointerEvents: 'auto' }}
            />
         ))}
      </>
   )
}

/** The bounding box around a multi-node selection: a lighter dashed rect than the per-node outlines. */
function GroupBoundsRect({ box }: { box: NodeBox }) {
   return (
      <rect
         x={box.x} y={box.y} width={box.width} height={box.height}
         fill="none" stroke={SELECTION_COLOR} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6}
         vectorEffect="non-scaling-stroke"
      />
   )
}

/** The live marquee rectangle, normalized so a drag in any direction reads correctly. */
function MarqueeRect({ rect }: { rect: Rect }) {
   const left   = Math.min(rect.x, rect.x + rect.width)
   const top    = Math.min(rect.y, rect.y + rect.height)
   const width  = Math.abs(rect.width)
   const height = Math.abs(rect.height)
   return (
      <rect
         x={left} y={top} width={width} height={height}
         fill={SELECTION_COLOR} fillOpacity={0.08}
         stroke={SELECTION_COLOR} strokeWidth={1} strokeDasharray="4 3"
         vectorEffect="non-scaling-stroke"
      />
   )
}

/** A spacing badge's equal-gap markers: a capped line per matched gap. Horizontal gaps run along x,
 *  vertical along y. */
function SpacingBadgeMarks({ badge }: { badge: SpacingBadge }) {
   const CAP = 5
   return (
      <>
         {badge.segments.map((segment, index) => {
            if (badge.orientation === 'horizontal') {
               const y = segment.cross
               return (
                  <g key={index}>
                     <line
                        x1={segment.start} y1={y} x2={segment.end} y2={y}
                        stroke={GUIDE_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                     />
                     <line
                        x1={segment.start} y1={y - CAP} x2={segment.start} y2={y + CAP}
                        stroke={GUIDE_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                     />
                     <line
                        x1={segment.end} y1={y - CAP} x2={segment.end} y2={y + CAP}
                        stroke={GUIDE_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                     />
                  </g>
               )
            }
            const x = segment.cross
            return (
               <g key={index}>
                  <line
                     x1={x} y1={segment.start} x2={x} y2={segment.end}
                     stroke={GUIDE_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                  />
                  <line
                     x1={x - CAP} y1={segment.start} x2={x + CAP} y2={segment.start}
                     stroke={GUIDE_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                  />
                  <line
                     x1={x - CAP} y1={segment.end} x2={x + CAP} y2={segment.end}
                     stroke={GUIDE_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                  />
               </g>
            )
         })}
      </>
   )
}

/** The four connection ports of the hovered node, drawn just outside its border (drag one to link). */
function ConnectionPorts({ node }: { node: DiagramNode }) {
   return (
      <>
         {nodePorts(node).map(({ port, point }) => (
            <circle
               key={port}
               cx={point.x} cy={point.y} r={PORT_RADIUS}
               fill="#ffffff" stroke={CONNECT_COLOR} strokeWidth={1.5}
               vectorEffect="non-scaling-stroke"
               // Pointer-eventful so the crosshair shows on hover; the press bubbles to the overlay.
               style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
            />
         ))}
      </>
   )
}

/** The live connect preview: a dashed line from the source port toward the cursor. */
function ConnectPreviewLine({ preview }: { preview: { start: Point; end: Point } }) {
   return (
      <line
         x1={preview.start.x} y1={preview.start.y} x2={preview.end.x} y2={preview.end.y}
         stroke={CONNECT_COLOR} strokeWidth={1.5} strokeDasharray="5 4"
         vectorEffect="non-scaling-stroke"
      />
   )
}

/** A highlight outline around the node the connect drag would drop onto. */
function ConnectTargetOutline({ node }: { node: DiagramNode }) {
   return (
      <rect
         x={node.x} y={node.y} width={node.width} height={node.height}
         fill="none" stroke={CONNECT_COLOR} strokeWidth={2} strokeDasharray="4 3"
         vectorEffect="non-scaling-stroke"
      />
   )
}

/** A translucent accent halo over the selected edge's polyline, crisp at any zoom. */
function EdgeHighlight({ polyline }: { polyline: Point[] }) {
   const points = polyline.map(point => `${point.x},${point.y}`).join(' ')
   return (
      <polyline
         points={points}
         fill="none" stroke={SELECTION_COLOR} strokeWidth={5} strokeOpacity={0.4}
         strokeLinecap="round" strokeLinejoin="round"
         vectorEffect="non-scaling-stroke"
      />
   )
}

// ###########
// # HELPERS #
// ###########

/** A value as a percentage of `span` (guarding a zero span), for CSS positioning percentages. */
function percent(value: number, span: number): number {
   return span > 0 ? value / span * 100 : 0
}

/** Position the label textarea over a node's box as viewport percentages, so it tracks the node under
 *  zoom/pan (the container aspect equals the viewport aspect, so per-axis percentages are undistorted). */
function labelOverlayStyle(node: DiagramNode, viewport: DiagramViewBox): React.CSSProperties {
   const left   = percent(node.x - viewport.minX, viewport.width)
   const top    = percent(node.y - viewport.minY, viewport.height)
   const width  = percent(node.width,  viewport.width)
   const height = percent(node.height, viewport.height)
   return { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }
}

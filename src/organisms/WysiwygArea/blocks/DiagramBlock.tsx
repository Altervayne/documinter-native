/**
 * DiagramBlock, the diagram (nodes + links) block's in-app view + node editor.
 *
 * The block uses the Block Editor Window. Inline, it shows only its rendered diagram (read-only
 * `renderDiagramToSvg`, self-contained SVG, no runtime, theme baked from the doc theme) plus a
 * hover-reveal Edit pill; the full node editor, an interactive 2D `DiagramCanvas`, a `ShapePalette`,
 * and a `DiagramInspector`, lives in a floating, non-modal `BlockEditorWindow`. The window is APP
 * CHROME (`--color-*`); only the rendered diagram SVG follows the doc theme.
 *
 * The draft/commit model mirrors the graph + image-markup blocks: a local `working` spec (also
 * mirrored in `workingRef` so pointer handlers read the latest value mid-drag) keeps a drag smooth;
 * `draft()` on live drag (no doc mutation), `commit()` on discrete actions (add / delete / drop after
 * a drag / style change) writes `patch({ diagram })`. The inline block renders the live `working`, so
 * it updates behind the non-modal window as the canvas is edited.
 *
 * This component creates / selects / moves / resizes / relabels / styles / deletes NODES; the model
 * already carries edges (and the read-only renderer draws them), but there is no edge drawing/editing
 * UI here yet. Deleting a node cascades to its incident edges via the pure `removeNode`, so the model
 * never dangles.
 */

// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type React from 'react'

// -- Library Imports --
import {
   Workflow, Pencil, ZoomIn, ZoomOut, Maximize, Copy, Trash2,
   AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
   AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
   AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
} from 'lucide-react'

// -- Library / Hook Imports --
import { renderDiagramToSvg, LIGHT_DIAGRAM_THEME, DARK_DIAGRAM_THEME } from '../../../lib/diagram'
import {
   createNode, addNode, duplicateNode, removeNode, resizeNode, updateNodeLabel, updateNodeStyle,
   setNode, hitTestNode, hitTestNodeHandle, findNode, computeEditorCanvas,
   nodeBox, roundUnit, computeAlignmentSnaps, computeResizeSnaps, zoomViewToward, fitViewToContent,
   viewportViewBox, frameFromContainer, clampCanvasHeight, CANVAS_DEFAULT_HEIGHT,
   IDENTITY_VIEW_TRANSFORM, NODE_HANDLE_HIT_TOLERANCE,
   createEdge, addEdge, deleteEdge, findEdge, updateEdgeLabel, updateEdgeStyle,
   hitTestEdge, hitTestPort, PORT_HIT_TOLERANCE, PORT_GAP,
} from '../../../lib/diagram/edit'
import type {
   DiagramViewBox, NodeResizeHandle, NodeStylePatch, EdgeStylePatch, ViewTransform, AlignmentGuide,
   NodeBox,
} from '../../../lib/diagram/edit'
import {
   computeSpacingSnaps, nodesInRect, alignNodes, distributeNodes, translateNodes,
} from '../../../lib/diagram/align'
import type { SpacingBadge, AlignAxis, DistributeAxis, Rect } from '../../../lib/diagram/align'
import { edgePolyline, intersectNodeBoundary } from '../../../lib/diagram/geometry'
import type { Point } from '../../../lib/diagram/geometry'
import { ShapePalette } from '../../../molecules/ShapePalette'
import { DiagramInspector } from '../../../molecules/DiagramInspector'
import { DiagramCanvas } from '../../../molecules/DiagramCanvas'
import { ContextMenu } from '../../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../../molecules/ContextMenu'
import type { CanvasPointerInfo } from '../../../molecules/DiagramCanvas'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'
import { useBlockEditorWindow } from '../../../contexts/BlockEditorWindowContext'
import { useDocTheme } from '../../../contexts/DocThemeContext'
import { useLang } from '../../../contexts/LangContext'
import type { T } from '../../../lib/i18n'

// -- Type Imports --
import type { Block } from '../../../types'
import type { DiagramSpec, NodeShape } from '../../../lib/diagram'

// #############
// # CONSTANTS #
// #############

/** A safe fallback so the editor never operates on an undefined spec (mkBlock always sets one). */
const FALLBACK_SPEC: DiagramSpec = { nodes: [], edges: [], options: {} }

/** Per-node cascade offset (diagram units) so successively-added nodes don't stack exactly. */
const ADD_CASCADE_STEP = 16
const ADD_CASCADE_WRAP = 6

/**
 * How far (diagram units) a duplicated node is nudged from its source on both axes, so a right-click
 * "Duplicate node" lands visibly clear of the original rather than exactly on top.
 */
const DUPLICATE_OFFSET = 20

/** Zoom multipliers: a click of the +/- buttons, and one scroll-wheel notch. */
const ZOOM_BUTTON_STEP = 1.25
const WHEEL_ZOOM_STEP = 1.1

/** Alignment snap threshold in SCREEN pixels (converted to diagram units through the live zoom, so
 *  the snap feels the same on screen at any zoom level). */
const SNAP_THRESHOLD_PX = 7

/** How near (SCREEN pixels, converted through the live zoom) a click must be to an edge to select it. */
const EDGE_HIT_THRESHOLD_PX = 8

/** Arrow-key nudge amounts (diagram units): a plain tap, and the larger Shift+arrow step. */
const NUDGE_STEP = 1
const NUDGE_LARGE_STEP = 10

/** Which diagram-unit direction each arrow key nudges the whole selection. */
const ARROW_NUDGE: Record<string, { x: number; y: number }> = {
   ArrowLeft:  { x: -1, y:  0 },
   ArrowRight: { x:  1, y:  0 },
   ArrowUp:    { x:  0, y: -1 },
   ArrowDown:  { x:  0, y:  1 },
}

// ###########
// # HELPERS #
// ###########

/** The single node id when exactly one is selected, else null (resize / ports / inspector gate). */
function onlySelected(ids: ReadonlySet<string>): string | null {
   if (ids.size !== 1) return null
   return ids.values().next().value ?? null
}

/** The bounding box (x / y / width / height) enclosing every box in `boxes`; empty gives a zero box. */
function unionBox(boxes: NodeBox[]): NodeBox {
   let minX = Infinity
   let minY = Infinity
   let maxX = -Infinity
   let maxY = -Infinity
   for (const box of boxes) {
      if (box.x < minX) minX = box.x
      if (box.y < minY) minY = box.y
      if (box.x + box.width  > maxX) maxX = box.x + box.width
      if (box.y + box.height > maxY) maxY = box.y + box.height
   }
   if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
   return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Override the root `<svg>`'s viewBox on the (unchanged) renderer output so the EDITOR draws through
 * its current viewport instead of the renderer's autofit box. Editor-only + ephemeral: the renderer,
 * the stored spec, and the read-only/export SVG are untouched (they keep autofit), so serialization
 * stays byte-identical. Nodes are drawn at absolute coordinates regardless of the viewBox, so swapping
 * the window here is exactly the unbounded-canvas pan/zoom with no content-level clip.
 */
function overrideSvgViewBox(svgMarkup: string, viewBox: DiagramViewBox): string {
   const value = `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`
   return svgMarkup.replace(/viewBox="[^"]*"/, `viewBox="${value}"`)
}

/**
 * The drawn polyline of an edge (for the selection highlight), resolving its endpoint nodes and
 * reusing the SHARED {@link edgePolyline} so the highlight tracks exactly what the renderer draws.
 * Null when no edge is selected or an endpoint node is missing.
 */
function edgePolylineFor(spec: DiagramSpec, edge: DiagramSpec['edges'][number] | null): Point[] | null {
   if (!edge) return null
   const fromNode = findNode(spec, edge.from)
   const toNode = findNode(spec, edge.to)
   if (!fromNode || !toNode) return null
   return edgePolyline(edge, fromNode, toNode)
}

// #########
// # TYPES #
// #########

interface DiagramBlockProps {
   block:     Block
   patch:     (partial: Partial<Block>) => void
   readOnly?: boolean
}

/** A live pointer-drag session, kept in a ref (mutating it must not re-render). */
type Interaction =
   | { mode: 'move';    ids: ReadonlySet<string>; start: Point; originNodes: DiagramSpec['nodes'] }
   | { mode: 'resize';  id: string; handle: NodeResizeHandle }
   | { mode: 'connect'; from: string }
   | { mode: 'pan';     startFrame: Point; startView: ViewTransform }
   | { mode: 'marquee'; startPoint: Point; additive: boolean; baseIds: ReadonlySet<string> }

// #############
// # COMPONENT #
// #############

export function DiagramBlock({ block, patch, readOnly }: DiagramBlockProps) {
   const { t }          = useLang()
   const docTheme       = useDocTheme()
   const diagramTheme   = docTheme === 'dark' ? DARK_DIAGRAM_THEME : LIGHT_DIAGRAM_THEME
   const editorWindow   = useBlockEditorWindow()
   const isEditing      = !readOnly && editorWindow.isEditing(block.id)

   // ============
   //  Draft state (mirrors GraphBlock / ImageMarkupEditor): a working spec + refs so pointer
   //  handlers stay stale-closure-free mid-drag.
   // ============
   const [working, setWorking] = useState<DiagramSpec>(block.diagram ?? FALLBACK_SPEC)
   const workingRef = useRef(working)
   const editing = useRef(false)
   const patchRef = useRef(patch)
   useEffect(() => { patchRef.current = patch })

   // Node selection is a SET (marquee / shift-click can hold several); edge selection stays single.
   // The two are mutually exclusive: selecting nodes clears the edge and vice versa, so the inspector
   // shows exactly one context. A ref mirror keeps pointer handlers stale-closure-free mid-drag.
   const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
   const selectedIdsRef = useRef<ReadonlySet<string>>(selectedIds)
   const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
   const selectedEdgeIdRef = useRef<string | null>(null)
   const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
   const editingLabelIdRef = useRef<string | null>(null)

   // The hovered node (its connection ports show) + the live edge-connect drag (source node + the
   // cursor point the preview line tracks). All ephemeral editor state, never touches the document.
   const [hoveredId, setHoveredId] = useState<string | null>(null)
   const hoveredIdRef = useRef<string | null>(null)
   const [connectFromId, setConnectFromId] = useState<string | null>(null)
   const [connectCursor, setConnectCursor] = useState<Point | null>(null)
   const connectCursorRef = useRef<Point | null>(null)

   const [outputHovered, setOutputHovered] = useState(false)
   const [interacting, setInteracting] = useState(false)

   // The open node context menu (right-click on a node), at the cursor's client coords, or null.
   const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number } | null>(null)

   const rootRef = useRef<HTMLDivElement>(null)
   const interactionRef = useRef<Interaction | null>(null)
   const [anchorRect, setAnchorRect] = useState<DOMRect>(() => new DOMRect())

   // The fixed editor canvas extent (diagram units), captured on open so the coordinate frame stays
   // stable while nodes are dragged (unlike the read-only block, which autofits).
   const [editorCanvas, setEditorCanvas] = useState<{ width: number; height: number }>(
      () => computeEditorCanvas(block.diagram ?? FALLBACK_SPEC),
   )

   // Ephemeral view transform (zoom + pan), applied ON TOP of the fixed frame. Never persisted or
   // serialized, reset on window open. Alignment guides show only while a node is dragged.
   const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW_TRANSFORM)
   const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([])

   // Spacing badges (equal-gap distance ticks) show alongside the alignment guides while a group drags.
   const [spacingBadges, setSpacingBadges] = useState<SpacingBadge[]>([])

   // The live marquee rectangle (diagram units, possibly with a negative size while dragged up-left), or
   // null when no marquee is active. Mirrored in a ref so pointer-up reads the final rect synchronously.
   const [marqueeRect, setMarqueeRectState] = useState<Rect | null>(null)
   const marqueeRectRef = useRef<Rect | null>(null)
   function setMarqueeRect(rect: Rect | null): void {
      marqueeRectRef.current = rect
      setMarqueeRectState(rect)
   }

   // Whether Space is held (its keydown/keyup is tracked while the editor is open): while held, an
   // empty-canvas drag PANS instead of drawing a marquee, and the empty-canvas cursor reads "grab".
   const [spaceHeld, setSpaceHeld] = useState(false)
   const spaceHeldRef = useRef(false)

   // The user-resizable canvas height (screen px) + the measured on-screen container size. Both are
   // ephemeral editor state (never serialized). The frame's aspect is derived from the measured
   // container (see `currentFrame`), so a taller canvas gives a taller frame/viewport, more room to
   // work, while keeping the pointer mapping + the unbounded-canvas clip correct.
   const [canvasHeight, setCanvasHeight] = useState<number>(CANVAS_DEFAULT_HEIGHT)
   const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
   const resizeStartRef = useRef<{ pointerY: number; height: number } | null>(null)

   // External changes (undo, tab switch, load) sync in only when not actively editing.
   useEffect(() => {
      if (!editing.current) {
         const next = block.diagram ?? FALLBACK_SPEC
         workingRef.current = next
         setWorking(next)
      }
   }, [block.diagram])

   // ============
   //  Draft / commit levers
   // ============
   function setBoth(next: DiagramSpec): void {
      workingRef.current = next
      setWorking(next)
   }
   function draft(next: DiagramSpec): void {
      editing.current = true
      setBoth(next)
   }
   function commit(next: DiagramSpec): void {
      editing.current = false
      setBoth(next)
      patchRef.current({ diagram: next })
   }
   /**
    * Persist any pending inspector-field edit (a label typed into the node/edge field drafts into
    * `working` on each keystroke but is not written to the document until here). Called on the field's
    * blur AND, critically, at the top of a canvas pointer-down and on window close, so a click that
    * changes the selection (which unmounts the field, suppressing its blur) can never discard the
    * in-flight draft. `editing.current` is true exactly when such a draft is pending (a drag always
    * ends by committing on pointer-up), so this is a no-op otherwise.
    */
   function flushPendingEdit(): void {
      if (editing.current) commit(workingRef.current)
   }
   // Node + edge selection are mutually exclusive: selecting nodes clears the edge and vice versa, so the
   // inspector always shows exactly one context (or the empty hint). Every node-selection change routes
   // through selectNodes so the ref mirror + the edge-clear stay in lockstep.
   function selectNodes(ids: ReadonlySet<string>): void {
      selectedIdsRef.current = ids
      setSelectedIds(ids)
      selectedEdgeIdRef.current = null
      setSelectedEdgeId(null)
   }
   /** Select exactly this one node (a plain click replaces the whole set). */
   function selectSingleNode(id: string): void {
      selectNodes(new Set([id]))
   }
   /** Toggle a node in / out of the current selection (a shift-click). */
   function toggleNodeInSelection(id: string): void {
      const next = new Set(selectedIdsRef.current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectNodes(next)
   }
   /** Clear the node selection (click on empty canvas / after a delete). */
   function clearNodeSelection(): void {
      selectNodes(new Set())
   }
   function selectEdge(id: string | null): void {
      selectedEdgeIdRef.current = id
      setSelectedEdgeId(id)
      selectedIdsRef.current = new Set()
      setSelectedIds(new Set())
   }
   function setHovered(id: string | null): void {
      hoveredIdRef.current = id
      setHoveredId(id)
   }
   function setEditingLabel(id: string | null): void {
      editingLabelIdRef.current = id
      setEditingLabelId(id)
   }

   function openEditorWindow(): void {
      setAnchorRect(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      setEditorCanvas(computeEditorCanvas(workingRef.current))
      setView(IDENTITY_VIEW_TRANSFORM)
      setNodeMenu(null)
      setHovered(null)
      setConnectFromId(null)
      setConnectCursor(null)
      connectCursorRef.current = null
      setSpacingBadges([])
      setMarqueeRect(null)
      spaceHeldRef.current = false
      setSpaceHeld(false)
      editorWindow.openEditor(block.id)
   }

   /** Cancel any in-flight edge-connect drag + clear its preview state. */
   function endConnect(): void {
      setConnectFromId(null)
      setConnectCursor(null)
      connectCursorRef.current = null
   }

   // ============
   //  Canvas frame + height resize (the frame aspect FOLLOWS the measured container aspect, so the
   //  pointer mapping + unbounded-canvas clip stay correct at any user-chosen height)
   // ============
   // The fixed reference frame: `editorCanvas.width` is the stable scale-1 horizontal extent, and the
   // HEIGHT is derived so the frame aspect exactly matches the measured container (falls back to the
   // content extent as a first-frame default when unmeasured).
   function currentFrame(): DiagramViewBox {
      if (containerSize.width > 0 && containerSize.height > 0) {
         return frameFromContainer(editorCanvas.width, containerSize.width, containerSize.height)
      }
      return { minX: 0, minY: 0, width: editorCanvas.width, height: editorCanvas.height }
   }
   function handleContainerResize(size: { width: number; height: number }): void {
      setContainerSize(previous =>
         Math.abs(previous.width - size.width) < 0.5 && Math.abs(previous.height - size.height) < 0.5
            ? previous : size)
   }
   function onCanvasResizeStart(event: React.PointerEvent): void {
      resizeStartRef.current = { pointerY: event.clientY, height: canvasHeight }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
   }
   function onCanvasResizeMove(event: React.PointerEvent): void {
      const start = resizeStartRef.current
      if (!start) return
      setCanvasHeight(clampCanvasHeight(start.height + (event.clientY - start.pointerY)))
   }
   function onCanvasResizeEnd(event: React.PointerEvent): void {
      if (!resizeStartRef.current) return
      resizeStartRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
         event.currentTarget.releasePointerCapture(event.pointerId)
      }
   }

   // ============
   //  Zoom / pan levers (the view transform is ephemeral editor state, never touching the doc)
   // ============
   function zoomBy(factor: number): void {
      // Zoom toward the frame center (the +/- buttons have no cursor to zoom toward).
      const frame = currentFrame()
      const center: Point = { x: frame.width / 2, y: frame.height / 2 }
      setView(current => zoomViewToward(current, center, current.scale * factor))
   }
   function handleWheelZoom(viewCursor: Point, deltaY: number): void {
      const factor = deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      setView(current => zoomViewToward(current, viewCursor, current.scale * factor))
   }
   function handleFitView(): void {
      setView(fitViewToContent(workingRef.current, currentFrame()))
   }

   // ============
   //  Add a node (one-click from the palette, placed at the canvas center + a mild cascade)
   // ============
   function handleAddShape(shape: NodeShape): void {
      const current = workingRef.current
      const cascade = (current.nodes.length % ADD_CASCADE_WRAP) * ADD_CASCADE_STEP
      // Place the new node at the center of what's CURRENTLY visible (the viewport), so it lands in view
      // regardless of the zoom/pan or the resized canvas height, not off in a fixed frame corner.
      const visible = viewportViewBox(currentFrame(), view)
      const center: Point = {
         x: visible.minX + visible.width / 2 + cascade,
         y: visible.minY + visible.height / 2 + cascade,
      }
      const id = crypto.randomUUID()
      selectSingleNode(id)
      commit(addNode(current, createNode(shape, center, t.diagramDefaultNodeLabel, id)))
   }

   // ============
   //  Duplicate + the right-click node context menu
   // ============
   /** Duplicate the selected node in place with an offset (the right-click "Duplicate node" action). */
   function duplicateSelectedNode(): void {
      const id = onlySelected(selectedIdsRef.current)
      if (!id) return
      const node = findNode(workingRef.current, id)
      if (!node) return
      const newId = crypto.randomUUID()
      selectSingleNode(newId)
      commit(addNode(workingRef.current, duplicateNode(node, () => newId, DUPLICATE_OFFSET)))
   }

   /**
    * Right-click a node to select it and open the node context menu at the cursor. A right-click on
    * empty canvas falls through (no preventDefault), leaving the native menu, since there is no
    * empty-canvas action yet.
    */
   function onCanvasContextMenu(point: Point, event: React.MouseEvent): void {
      const hit = hitTestNode(workingRef.current, point)
      if (!hit) return
      event.preventDefault()
      flushPendingEdit()
      selectSingleNode(hit.id)
      setEditingLabel(null)
      setNodeMenu({ x: event.clientX, y: event.clientY })
   }

   /** Entries for the right-click node menu: Duplicate + Delete (Delete is destructive). */
   function nodeMenuEntries(): ContextMenuEntry[] {
      return [
         { label: t.diagramDuplicateNode, icon: <Copy size={14} />, onSelect: duplicateSelectedNode },
         { type: 'separator' },
         { label: t.diagramDeleteNode, icon: <Trash2 size={14} />, danger: true, onSelect: handleDeleteSelected },
      ]
   }

   // ============
   //  Canvas pointer interactions (info arrives already mapped: diagram point through the current
   //  zoom/pan, a transform-independent view-space point for panning, and the screen px/unit ratio)
   // ============
   function onCanvasPointerDown(info: CanvasPointerInfo, event: React.PointerEvent): void {
      // Persist any pending inspector-label draft BEFORE this click can change/clear the selection and
      // unmount the field (which would otherwise swallow its blur and lose the text).
      flushPendingEdit()

      const current = workingRef.current
      const point = info.diagramPoint

      // (1) A press on a handle of the SINGLE selected node begins a resize (checked before a body hit;
      // handles only exist when exactly one node is selected). The grab tolerance widens as we zoom OUT
      // so the handles stay grabbable on screen.
      const onlyId = onlySelected(selectedIdsRef.current)
      const selected = onlyId ? findNode(current, onlyId) : null
      if (selected) {
         const handle = hitTestNodeHandle(selected, point, NODE_HANDLE_HIT_TOLERANCE / view.scale)
         if (handle) {
            interactionRef.current = { mode: 'resize', id: selected.id, handle }
            event.currentTarget.setPointerCapture(event.pointerId)
            setInteracting(true)
            return
         }
      }

      // (2) A press on a connection port of the hovered node begins an edge-CONNECT drag (the ports
      // sit just outside the border, so this never shadows a body move). Tolerance scales with zoom.
      const hovered = hoveredIdRef.current ? findNode(current, hoveredIdRef.current) : null
      if (hovered && hitTestPort(hovered, point, PORT_HIT_TOLERANCE / view.scale)) {
         interactionRef.current = { mode: 'connect', from: hovered.id }
         setConnectFromId(hovered.id)
         setConnectCursor(point)
         connectCursorRef.current = point
         event.currentTarget.setPointerCapture(event.pointerId)
         setInteracting(true)
         return
      }

      // (3) A node body hit. A shift-click toggles it in / out of the set (a pure selection gesture, no
      // move). Otherwise, a hit INSIDE the current selection group-moves the whole set; a hit OUTSIDE it
      // first selects just that node, then moves it (the single-node move is the 1-element group case).
      const hit = hitTestNode(current, point)
      if (hit) {
         if (event.shiftKey) {
            toggleNodeInSelection(hit.id)
            return
         }
         let ids = selectedIdsRef.current
         if (!ids.has(hit.id)) {
            ids = new Set([hit.id])
            selectNodes(ids)
         }
         interactionRef.current = { mode: 'move', ids, start: point, originNodes: current.nodes }
         event.currentTarget.setPointerCapture(event.pointerId)
         setInteracting(true)
         return
      }

      // (4) Off every node: an edge close enough to the click selects it (a plain click-select; there
      // is no drag or waypoint editing yet). Waypoints/routing are honored by hitTestEdge.
      const edgeHit = hitTestEdge(current, point, EDGE_HIT_THRESHOLD_PX / info.pixelsPerDiagramUnit)
      if (edgeHit) {
         selectEdge(edgeHit.id)
         setEditingLabel(null)
         return
      }

      // (5) The empty background. With Space held OR the middle mouse button, begin a PAN; otherwise
      // begin a MARQUEE (its selection resolves on pointer-up, so a plain click just clears the set).
      if (spaceHeldRef.current || event.button === 1) {
         event.preventDefault()
         interactionRef.current = { mode: 'pan', startFrame: info.framePoint, startView: view }
         event.currentTarget.setPointerCapture(event.pointerId)
         setInteracting(true)
         return
      }
      interactionRef.current = {
         mode: 'marquee', startPoint: point, additive: event.shiftKey, baseIds: selectedIdsRef.current,
      }
      setMarqueeRect({ x: point.x, y: point.y, width: 0, height: 0 })
      event.currentTarget.setPointerCapture(event.pointerId)
      setInteracting(true)
   }

   function onCanvasPointerMove(info: CanvasPointerInfo): void {
      const interaction = interactionRef.current
      const current = workingRef.current

      // No active drag: track which node is hovered so its connection ports show. A generous tolerance
      // (covering the port ring just outside the border) keeps the node "hovered" while the pointer
      // travels out to a port, so the ports don't blink away as the author reaches for them.
      if (!interaction) {
         const hovered = hitTestNode(current, info.diagramPoint, PORT_GAP + PORT_HIT_TOLERANCE)
         setHovered(hovered ? hovered.id : null)
         return
      }

      // A live connect drag: the preview line + drop-target outline follow the cursor.
      if (interaction.mode === 'connect') {
         setConnectCursor(info.diagramPoint)
         connectCursorRef.current = info.diagramPoint
         return
      }

      if (interaction.mode === 'pan') {
         // Pan by the view-space delta (transform-independent), applied to the view captured at start.
         setView({
            scale:      interaction.startView.scale,
            translateX: interaction.startView.translateX + (info.framePoint.x - interaction.startFrame.x),
            translateY: interaction.startView.translateY + (info.framePoint.y - interaction.startFrame.y),
         })
         return
      }

      if (interaction.mode === 'marquee') {
         // Grow the marquee rectangle from its start toward the current point (any drag direction).
         const point = info.diagramPoint
         setMarqueeRect({
            x:      interaction.startPoint.x,
            y:      interaction.startPoint.y,
            width:  point.x - interaction.startPoint.x,
            height: point.y - interaction.startPoint.y,
         })
         return
      }

      if (interaction.mode === 'move') {
         const point = info.diagramPoint
         const deltaX = point.x - interaction.start.x
         const deltaY = point.y - interaction.start.y
         // Move the WHOLE selection from the ORIGIN nodes (captured at drag start), never accumulating.
         const movedNodes = translateNodes(interaction.originNodes, interaction.ids, deltaX, deltaY)

         // Alt held bypasses all snapping: free placement, no guides / badges.
         if (info.altKey) {
            setAlignmentGuides([])
            setSpacingBadges([])
            draft({ ...current, nodes: movedNodes })
            return
         }

         // Probe the selection's BOUNDING BOX against the NON-selected nodes only: run both alignment
         // (edge/center) and spacing (equal-gap) snaps, then apply the alignment snap on an axis if
         // present, else the spacing snap (alignment wins ties per axis). Shift the whole group by the
         // resulting per-axis delta, keeping the members' relative offsets.
         const groupBox = unionBox(movedNodes.filter(node => interaction.ids.has(node.id)).map(nodeBox))
         const otherBoxes = movedNodes.filter(node => !interaction.ids.has(node.id)).map(nodeBox)
         const threshold = SNAP_THRESHOLD_PX / info.pixelsPerDiagramUnit
         const align = computeAlignmentSnaps(groupBox, otherBoxes, threshold)
         const spacing = computeSpacingSnaps(groupBox, otherBoxes, threshold)
         const snapX = align.snapX ?? spacing.snapX
         const snapY = align.snapY ?? spacing.snapY
         const shiftX = snapX !== undefined ? roundUnit(snapX) - groupBox.x : 0
         const shiftY = snapY !== undefined ? roundUnit(snapY) - groupBox.y : 0
         const snappedNodes = shiftX !== 0 || shiftY !== 0
            ? translateNodes(movedNodes, interaction.ids, shiftX, shiftY)
            : movedNodes
         // Keep only the spacing badges for an axis alignment did NOT take (a horizontal badge marks an
         // x snap, a vertical badge a y snap), so the chrome never shows an equal-gap that was overridden.
         const shownBadges = spacing.spacingBadges.filter(badge =>
            badge.orientation === 'horizontal' ? align.snapX === undefined : align.snapY === undefined)
         setAlignmentGuides(align.guides)
         setSpacingBadges(shownBadges)
         draft({ ...current, nodes: snappedNodes })
      } else if (interaction.mode === 'resize') {
         // Resize: compute the raw resized box, then snap the MOVING edge(s) (per the active handle) to
         // neighbor edges/centers + show guides, the move-drag snap's sibling, holding the pinned edge.
         const resized = resizeNode(current, interaction.id, interaction.handle, info.diagramPoint)
         const resizedNode = findNode(resized, interaction.id)
         if (!resizedNode) return
         const others = current.nodes.filter(other => other.id !== interaction.id).map(nodeBox)
         const threshold = SNAP_THRESHOLD_PX / info.pixelsPerDiagramUnit
         const snap = computeResizeSnaps(nodeBox(resizedNode), interaction.handle, others, threshold)
         setAlignmentGuides(snap.guides)
         draft(setNode(current, {
            ...resizedNode,
            x:      roundUnit(snap.rect.x),
            y:      roundUnit(snap.rect.y),
            width:  roundUnit(snap.rect.width),
            height: roundUnit(snap.rect.height),
         }))
      }
   }

   function onCanvasPointerUp(event: React.PointerEvent): void {
      const interaction = interactionRef.current
      interactionRef.current = null
      setAlignmentGuides([])
      setSpacingBadges([])
      if (!interaction) { setMarqueeRect(null); return }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
         event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setInteracting(false)

      // A marquee resolves to the nodes it intersected; when Shift was held at start, the marquee UNIONs
      // with the prior selection, otherwise it replaces it. A zero-ish drag (a click) grabs nothing, so
      // a plain click clears the selection.
      if (interaction.mode === 'marquee') {
         const rect = marqueeRectRef.current
         setMarqueeRect(null)
         if (rect) {
            const hitIds = nodesInRect(workingRef.current.nodes, rect)
            const next = interaction.additive
               ? new Set([...interaction.baseIds, ...hitIds])
               : new Set(hitIds)
            selectNodes(next)
         }
         return
      }

      // A connect drag commits a new edge if it was released over a DIFFERENT node (self-loops are
      // out of scope, and a drop back on the source or on empty space simply cancels).
      if (interaction.mode === 'connect') {
         const dropPoint = connectCursorRef.current
         endConnect()
         if (dropPoint) {
            const target = hitTestNode(workingRef.current, dropPoint)
            if (target && target.id !== interaction.from) {
               const id = crypto.randomUUID()
               const next = addEdge(workingRef.current, createEdge(interaction.from, target.id, id))
               selectEdge(id)
               commit(next)
            }
         }
         return
      }

      // Only persist if the drag actually changed something (a draft ran): a plain select-click / a
      // pan sets an interaction but never drafts, so committing here would spray a no-op undo entry.
      if (editing.current) commit(workingRef.current)
   }

   // Double-click a node to edit its label in place (the primary path; the inspector field is the other).
   function onCanvasDoubleClick(point: Point): void {
      const hit = hitTestNode(workingRef.current, point)
      if (hit) {
         selectSingleNode(hit.id)
         setEditingLabel(hit.id)
      }
   }

   // Commit the edit-in-place label back to the node (blur / Enter).
   function commitLabelEdit(value: string): void {
      const id = editingLabelIdRef.current
      setEditingLabel(null)
      if (!id) return
      if (!findNode(workingRef.current, id)) return
      commit(updateNodeLabel(workingRef.current, id, value))
   }

   // ============
   //  Inspector levers
   // ============
   // Label fields draft LIVE into `working` on each keystroke (capturing the element id at draft time),
   // so the text is never trapped in an uncommitted, about-to-unmount field; the actual document write
   // happens via flushPendingEdit (blur / canvas-pointerdown / window-close).
   function handleLabelDraft(value: string): void {
      const id = onlySelected(selectedIdsRef.current)
      if (!id || !findNode(workingRef.current, id)) return
      draft(updateNodeLabel(workingRef.current, id, value))
   }
   function handleStyleChange(stylePatch: NodeStylePatch): void {
      const id = onlySelected(selectedIdsRef.current)
      if (!id || !findNode(workingRef.current, id)) return
      commit(updateNodeStyle(workingRef.current, id, stylePatch))
   }
   /** Delete EVERY selected node (each cascades its incident edges via removeNode). */
   function handleDeleteSelected(): void {
      const ids = selectedIdsRef.current
      if (ids.size === 0) return
      let next = workingRef.current
      for (const id of ids) next = removeNode(next, id)
      clearNodeSelection()
      setEditingLabel(null)
      commit(next)
   }

   // ============
   //  Align / distribute (applied to the whole selection, one undo entry per action)
   // ============
   function applyAlign(alignment: AlignAxis): void {
      const nodes = alignNodes(workingRef.current.nodes, selectedIdsRef.current, alignment)
      commit({ ...workingRef.current, nodes })
   }
   function applyDistribute(axis: DistributeAxis): void {
      const nodes = distributeNodes(workingRef.current.nodes, selectedIdsRef.current, axis)
      commit({ ...workingRef.current, nodes })
   }
   function handleEdgeLabelDraft(value: string): void {
      const id = selectedEdgeIdRef.current
      if (!id || !findEdge(workingRef.current, id)) return
      draft(updateEdgeLabel(workingRef.current, id, value))
   }
   function handleEdgeStyleChange(edgePatch: EdgeStylePatch): void {
      const id = selectedEdgeIdRef.current
      if (!id || !findEdge(workingRef.current, id)) return
      commit(updateEdgeStyle(workingRef.current, id, edgePatch))
   }
   function handleDeleteEdge(): void {
      const id = selectedEdgeIdRef.current
      if (!id) return
      selectEdge(null)
      commit(deleteEdge(workingRef.current, id))
   }

   // Keyboard while the editor is open: Space toggles pan-on-empty-drag, Delete/Backspace removes the
   // selection (nodes cascade their edges, else the selected edge), Escape clears the selection, the
   // arrow keys nudge the whole selection (Shift = a larger step), and Ctrl/Cmd+A selects every node.
   // Any form field with focus bails first, so typing a label / color hex is never hijacked.
   useEffect(() => {
      if (!isEditing) return
      function inFormField(event: KeyboardEvent): boolean {
         const target = event.target as HTMLElement | null
         return !!target?.closest('input, textarea, select, [contenteditable="true"]')
      }
      function onKeyDown(event: KeyboardEvent): void {
         if (inFormField(event)) return

         // Space held: pan-on-empty-drag. Swallow the key so it never scrolls the page or types.
         if (event.code === 'Space') {
            event.preventDefault()
            if (!spaceHeldRef.current) {
               spaceHeldRef.current = true
               setSpaceHeld(true)
            }
            return
         }

         if (event.key === 'Delete' || event.key === 'Backspace') {
            const ids = selectedIdsRef.current
            if (ids.size > 0) {
               event.preventDefault()
               let next = workingRef.current
               for (const id of ids) next = removeNode(next, id)
               clearNodeSelection()
               setEditingLabel(null)
               commit(next)
               return
            }
            const edgeId = selectedEdgeIdRef.current
            if (edgeId) {
               event.preventDefault()
               selectEdge(null)
               commit(deleteEdge(workingRef.current, edgeId))
            }
            return
         }

         if (event.key === 'Escape') {
            clearNodeSelection()
            selectedEdgeIdRef.current = null
            setSelectedEdgeId(null)
            setEditingLabel(null)
            return
         }

         if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
            event.preventDefault()
            selectNodes(new Set(workingRef.current.nodes.map(node => node.id)))
            return
         }

         const direction = ARROW_NUDGE[event.key]
         if (direction) {
            const ids = selectedIdsRef.current
            if (ids.size === 0) return
            event.preventDefault()
            const step = event.shiftKey ? NUDGE_LARGE_STEP : NUDGE_STEP
            const nodes = translateNodes(workingRef.current.nodes, ids, direction.x * step, direction.y * step)
            commit({ ...workingRef.current, nodes })
         }
      }
      function onKeyUp(event: KeyboardEvent): void {
         if (event.code === 'Space') {
            spaceHeldRef.current = false
            setSpaceHeld(false)
         }
      }
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('keyup', onKeyUp)
      return () => {
         document.removeEventListener('keydown', onKeyDown)
         document.removeEventListener('keyup', onKeyUp)
      }
      // commit / selectNodes read refs, so only the isEditing gate matters here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [isEditing])

   // ============
   //  Read-only view (the canonical export-consistent renderer)
   // ============
   if (readOnly) {
      const spec = block.diagram
      if (!spec || spec.nodes.length === 0) return null
      const svg = renderDiagramToSvg(spec, diagramTheme)
      return <div className="doc-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
   }

   // ============
   //  Inline output (live `working`): rendered diagram, or the empty-state invite. Updates behind
   //  the non-modal editor window.
   // ============
   const hasNodes = working.nodes.length > 0
   const inlineSvg = hasNodes ? renderDiagramToSvg(working, diagramTheme) : ''

   // ============
   //  Windowed editor: an UNBOUNDED canvas. Nodes render at their absolute diagram coordinates; the
   //  editor's viewBox is the VIEWPORT derived from the zoom/pan over those absolute coords, so no
   //  content is ever clipped to a fixed frame and any node is reachable by panning. `editorCanvas` is
   //  only the fixed reference frame (the scale-1 viewport size + the container aspect), never a
   //  content clip. The interaction overlay shares the same viewport viewBox, so its coordinates line
   //  up 1:1 with the drawn nodes at any zoom/pan.
   // ============
   const fixedFrame = currentFrame()
   const viewport = viewportViewBox(fixedFrame, view)
   const canvasSvg = working.nodes.length > 0
      ? overrideSvgViewBox(renderDiagramToSvg(working, diagramTheme), viewport)
      : ''
   // The selected nodes (chrome draws one SelectionChrome each; resize handles show only when the count
   // is exactly one). A single selected node also feeds the inspector's per-node panel; 2+ shows the
   // combined group bounding box + the "N nodes selected" inspector state instead.
   const selectedNodes = working.nodes.filter(node => selectedIds.has(node.id))
   const onlySelectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null
   const groupBox = selectedNodes.length >= 2 ? unionBox(selectedNodes.map(nodeBox)) : null
   const editingLabelNode = editingLabelId ? findNode(working, editingLabelId) : null

   // ============
   //  Edge editor chrome (all derived from the ephemeral selection / hover / connect state)
   // ============
   const selectedEdge = selectedEdgeId ? findEdge(working, selectedEdgeId) : null
   const selectedEdgePolyline = edgePolylineFor(working, selectedEdge)

   // Ports show on the hovered node while NOT mid-drag; a connect drag shows the preview instead.
   const portNode = !interacting && hoveredId ? findNode(working, hoveredId) : null

   let connectPreview: { start: Point; end: Point } | null = null
   let connectTargetNode = null
   if (connectFromId && connectCursor) {
      const fromNode = findNode(working, connectFromId)
      if (fromNode) {
         connectPreview = { start: intersectNodeBoundary(fromNode, connectCursor), end: connectCursor }
         const target = hitTestNode(working, connectCursor)
         connectTargetNode = target && target.id !== connectFromId ? target : null
      }
   }

   const inspectorLabel = selectedEdge ? t.diagramEdgeSection : t.diagramInspectorSection

   const editorBody = (
      <div className="diagram-editor">
         {/* ===== Add shape ===== */}
         <section className="diagram-section">
            <span className="diagram-section-label">{t.diagramShapesSection}</span>
            <ShapePalette onAddShape={handleAddShape} />
            <p className="diagram-hint">{t.diagramCanvasHint}</p>
         </section>

         {/* ===== Canvas ===== */}
         <section className="diagram-section diagram-section-canvas">
            <div className="diagram-canvas-wrap">
               <div className="diagram-canvas-stage">
                  <DiagramCanvas
                     svgMarkup={canvasSvg}
                     viewport={viewport}
                     frame={fixedFrame}
                     selectedNodes={selectedNodes}
                     groupBox={groupBox}
                     marqueeRect={marqueeRect}
                     spacingBadges={spacingBadges}
                     selectedEdgePolyline={selectedEdgePolyline}
                     portNode={portNode}
                     connectPreview={connectPreview}
                     connectTargetNode={connectTargetNode}
                     editingLabelNode={editingLabelNode}
                     alignmentGuides={alignmentGuides}
                     onPointerDownPoint={onCanvasPointerDown}
                     onPointerMovePoint={onCanvasPointerMove}
                     onPointerUp={onCanvasPointerUp}
                     onDoubleClickPoint={onCanvasDoubleClick}
                     onContextMenuPoint={onCanvasContextMenu}
                     onLabelCommit={commitLabelEdit}
                     onWheelZoom={handleWheelZoom}
                     heightPx={canvasHeight}
                     onContainerResize={handleContainerResize}
                     cursor={connectFromId ? 'crosshair' : interacting ? 'grabbing' : spaceHeld ? 'grab' : 'default'}
                  />
                  <AlignDistributeControls
                     count={selectedNodes.length}
                     onAlign={applyAlign}
                     onDistribute={applyDistribute}
                     t={t}
                  />
                  <div className="diagram-zoom-controls">
                     <button
                        type="button" className="diagram-zoom-btn"
                        aria-label={t.diagramZoomOut} title={t.diagramZoomOut}
                        onClick={() => zoomBy(1 / ZOOM_BUTTON_STEP)}
                     >
                        <ZoomOut size={14} />
                     </button>
                     <span className="diagram-zoom-readout">{Math.round(view.scale * 100)}%</span>
                     <button
                        type="button" className="diagram-zoom-btn"
                        aria-label={t.diagramZoomIn} title={t.diagramZoomIn}
                        onClick={() => zoomBy(ZOOM_BUTTON_STEP)}
                     >
                        <ZoomIn size={14} />
                     </button>
                     <button
                        type="button" className="diagram-zoom-btn"
                        aria-label={t.diagramFitView} title={t.diagramFitView}
                        onClick={handleFitView}
                     >
                        <Maximize size={14} />
                     </button>
                  </div>
               </div>
               {/* Drag the bottom handle to make the editing surface taller/shorter (like a textarea). */}
               <div
                  className="diagram-canvas-resize"
                  role="separator"
                  aria-orientation="horizontal"
                  onPointerDown={onCanvasResizeStart}
                  onPointerMove={onCanvasResizeMove}
                  onPointerUp={onCanvasResizeEnd}
                  onPointerCancel={onCanvasResizeEnd}
               >
                  <span className="diagram-canvas-resize-grip" aria-hidden="true" />
               </div>
            </div>
         </section>

         {/* ===== Inspector ===== */}
         <section className="diagram-section">
            <span className="diagram-section-label">{inspectorLabel}</span>
            <DiagramInspector
               node={onlySelectedNode}
               edge={selectedEdge}
               multiSelectCount={selectedNodes.length}
               theme={diagramTheme}
               onLabelDraft={handleLabelDraft}
               onLabelCommit={flushPendingEdit}
               onStyleChange={handleStyleChange}
               onDelete={handleDeleteSelected}
               onEdgeLabelDraft={handleEdgeLabelDraft}
               onEdgeLabelCommit={flushPendingEdit}
               onEdgeStyleChange={handleEdgeStyleChange}
               onEdgeDelete={handleDeleteEdge}
            />
         </section>
      </div>
   )

   return (
      <div className="diagram-block" ref={rootRef}>
         <div
            className="diagram-block-output"
            onMouseEnter={() => setOutputHovered(true)}
            onMouseLeave={() => setOutputHovered(false)}
         >
            {hasNodes ? (
               <div className="doc-diagram" dangerouslySetInnerHTML={{ __html: inlineSvg }} />
            ) : (
               <div className="doc-diagram doc-diagram-empty" role="img" aria-label={t.diagramEmpty}>
                  <Workflow size={22} className="doc-diagram-empty-icon" aria-hidden="true" />
                  <span>{t.diagramEmpty}</span>
               </div>
            )}

            {!isEditing && (
               <button
                  type="button"
                  className={`diagram-edit-btn${outputHovered ? ' diagram-edit-btn-visible' : ''}`}
                  aria-label={t.diagramEdit}
                  title={t.diagramEdit}
                  onClick={openEditorWindow}
               >
                  <Pencil size={13} />
                  <span>{t.diagramEdit}</span>
               </button>
            )}
         </div>

         {isEditing && (
            <BlockEditorWindow
               title={t.diagramWindowTitle}
               icon={<Workflow size={15} />}
               anchorRect={anchorRect}
               onClose={() => { flushPendingEdit(); setNodeMenu(null); editorWindow.closeEditor() }}
            >
               {editorBody}
            </BlockEditorWindow>
         )}

         {isEditing && nodeMenu && (
            <ContextMenu
               position={nodeMenu}
               entries={nodeMenuEntries()}
               onClose={() => setNodeMenu(null)}
            />
         )}
      </div>
   )
}

// ####################
// # ALIGN / DISTRIBUTE TOOLBAR #
// ####################

interface AlignDistributeControlsProps {
   /** How many nodes are selected: the align buttons enable at 2+, the distribute buttons at 3+. */
   count:        number
   onAlign:      (alignment: AlignAxis) => void
   onDistribute: (axis: DistributeAxis) => void
   t:            T
}

/**
 * The align + distribute cluster floated at the canvas top-left (mirroring the zoom cluster). The six
 * align buttons line every selected node up on the selection bounding box's edge / center; the two
 * distribute buttons even out the edge-to-edge gaps. Aligns need two selected nodes, distributes need
 * three, so below that count the buttons dim + disable. Each action commits one undo entry.
 */
function AlignDistributeControls({ count, onAlign, onDistribute, t }: AlignDistributeControlsProps) {
   const alignDisabled      = count < 2
   const distributeDisabled = count < 3
   return (
      <div className="diagram-align-controls">
         <button
            type="button" className="diagram-zoom-btn" disabled={alignDisabled}
            aria-label={t.diagramAlignLeft} title={t.diagramAlignLeft} onClick={() => onAlign('left')}
         >
            <AlignHorizontalJustifyStart size={14} />
         </button>
         <button
            type="button" className="diagram-zoom-btn" disabled={alignDisabled}
            aria-label={t.diagramAlignHCenter} title={t.diagramAlignHCenter} onClick={() => onAlign('hcenter')}
         >
            <AlignHorizontalJustifyCenter size={14} />
         </button>
         <button
            type="button" className="diagram-zoom-btn" disabled={alignDisabled}
            aria-label={t.diagramAlignRight} title={t.diagramAlignRight} onClick={() => onAlign('right')}
         >
            <AlignHorizontalJustifyEnd size={14} />
         </button>
         <button
            type="button" className="diagram-zoom-btn" disabled={alignDisabled}
            aria-label={t.diagramAlignTop} title={t.diagramAlignTop} onClick={() => onAlign('top')}
         >
            <AlignVerticalJustifyStart size={14} />
         </button>
         <button
            type="button" className="diagram-zoom-btn" disabled={alignDisabled}
            aria-label={t.diagramAlignVMiddle} title={t.diagramAlignVMiddle} onClick={() => onAlign('vmiddle')}
         >
            <AlignVerticalJustifyCenter size={14} />
         </button>
         <button
            type="button" className="diagram-zoom-btn" disabled={alignDisabled}
            aria-label={t.diagramAlignBottom} title={t.diagramAlignBottom} onClick={() => onAlign('bottom')}
         >
            <AlignVerticalJustifyEnd size={14} />
         </button>
         <span className="diagram-align-divider" aria-hidden="true" />
         <button
            type="button" className="diagram-zoom-btn" disabled={distributeDisabled}
            aria-label={t.diagramDistributeHorizontal} title={t.diagramDistributeHorizontal}
            onClick={() => onDistribute('horizontal')}
         >
            <AlignHorizontalSpaceAround size={14} />
         </button>
         <button
            type="button" className="diagram-zoom-btn" disabled={distributeDisabled}
            aria-label={t.diagramDistributeVertical} title={t.diagramDistributeVertical}
            onClick={() => onDistribute('vertical')}
         >
            <AlignVerticalSpaceAround size={14} />
         </button>
      </div>
   )
}

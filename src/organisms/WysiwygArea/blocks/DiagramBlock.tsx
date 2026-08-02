/**
 * DiagramBlock, the diagram (nodes + links) block's in-app view + node editor.
 *
 * NODE EDITOR PASS (phase 2): the block adopts the Block Editor Window (the next adopter after Graph
 * + Image-markup). Inline, the block shows only its rendered diagram (read-only `renderDiagramToSvg`,
 * self-contained SVG, no runtime, theme baked from the doc theme) plus a hover-reveal Edit pill; the
 * full node editor — an interactive 2D `DiagramCanvas`, a `ShapePalette`, and a `DiagramInspector` —
 * lives in a floating, non-modal `BlockEditorWindow`. The window is APP CHROME (`--color-*`); only
 * the rendered diagram SVG follows the doc theme.
 *
 * The draft/commit model mirrors the graph + image-markup blocks: a local `working` spec (also
 * mirrored in `workingRef` so pointer handlers read the latest value mid-drag) keeps a drag smooth;
 * `draft()` on live drag (no doc mutation), `commit()` on discrete actions (add / delete / drop after
 * a drag / style change) writes `patch({ diagram })`. The inline block renders the live `working`, so
 * it updates behind the non-modal window as the canvas is edited.
 *
 * EDGES ARE THE NEXT PASS. This component creates / selects / moves / resizes / relabels / styles /
 * deletes NODES; the model already carries edges (and the read-only renderer draws them), but there
 * is no edge drawing / editing UI here yet. Deleting a node cascades to its incident edges via the
 * pure `removeNode`, so the model never dangles.
 */

// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type React from 'react'

// -- Library Imports --
import { Workflow, Pencil, ZoomIn, ZoomOut, Maximize, Copy, Trash2 } from 'lucide-react'

// -- Library / Hook Imports --
import { renderDiagramToSvg, LIGHT_DIAGRAM_THEME, DARK_DIAGRAM_THEME } from '../../../lib/diagram'
import {
   createNode, addNode, duplicateNode, removeNode, resizeNode, updateNodeLabel, updateNodeStyle,
   translateNode, setNode, hitTestNode, hitTestNodeHandle, findNode, computeEditorCanvas,
   nodeBox, roundUnit, computeAlignmentSnaps, computeResizeSnaps, zoomViewToward, fitViewToContent,
   viewportViewBox, frameFromContainer, clampCanvasHeight, CANVAS_DEFAULT_HEIGHT,
   IDENTITY_VIEW_TRANSFORM, NODE_HANDLE_HIT_TOLERANCE,
   createEdge, addEdge, deleteEdge, findEdge, updateEdgeLabel, updateEdgeStyle,
   hitTestEdge, hitTestPort, PORT_HIT_TOLERANCE, PORT_GAP,
} from '../../../lib/diagram/edit'
import type {
   DiagramViewBox, NodeResizeHandle, NodeStylePatch, EdgeStylePatch, ViewTransform, AlignmentGuide,
} from '../../../lib/diagram/edit'
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

// -- Type Imports --
import type { Block } from '../../../types'
import type { DiagramSpec, DiagramNode, NodeShape } from '../../../lib/diagram'

// #############
// # CONSTANTS #
// #############

/** A safe fallback so the editor never operates on an undefined spec (mkBlock always sets one). */
const FALLBACK_SPEC: DiagramSpec = { nodes: [], edges: [], options: {} }

/** Per-node cascade offset (diagram units) so successively-added nodes don't stack exactly. */
const ADD_CASCADE_STEP = 16
const ADD_CASCADE_WRAP = 6

/**
 * How far (diagram units) a duplicated node is nudged from its source on both axes, so a Ctrl+V paste
 * or a right-click "Duplicate" lands visibly clear of the original. Repeated pastes re-offset from the
 * PREVIOUS copy (the clipboard is re-seeded with each paste), so stacked pastes cascade.
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

// ###########
// # HELPERS #
// ###########

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
   | { mode: 'move';    id: string; start: Point; origin: DiagramSpec['nodes'][number] }
   | { mode: 'resize';  id: string; handle: NodeResizeHandle }
   | { mode: 'connect'; from: string }
   | { mode: 'pan';     startFrame: Point; startView: ViewTransform }

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

   const [selectedId, setSelectedId] = useState<string | null>(null)
   const selectedIdRef = useRef<string | null>(null)
   const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
   const selectedEdgeIdRef = useRef<string | null>(null)
   const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
   const editingLabelIdRef = useRef<string | null>(null)

   // The hovered node (its connection ports show) + the live edge-connect drag (source node + the
   // cursor point the preview line tracks). All ephemeral editor state — never touches the document.
   const [hoveredId, setHoveredId] = useState<string | null>(null)
   const hoveredIdRef = useRef<string | null>(null)
   const [connectFromId, setConnectFromId] = useState<string | null>(null)
   const [connectCursor, setConnectCursor] = useState<Point | null>(null)
   const connectCursorRef = useRef<Point | null>(null)

   const [outputHovered, setOutputHovered] = useState(false)
   const [interacting, setInteracting] = useState(false)

   // The EPHEMERAL editor clipboard: a single copied node held only for this session (never persisted,
   // never the OS clipboard). Ctrl+C fills it; Ctrl+V pastes an offset duplicate + re-seeds it with the
   // copy so stacked pastes cascade. The right-click "Duplicate" shares the same insert path.
   const clipboardRef = useRef<DiagramNode | null>(null)

   // The open node context menu (right-click on a node), at the cursor's client coords, or null.
   const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number } | null>(null)

   // The editor body wrapper: keyboard copy/paste consults it to confirm the diagram editor is the
   // focused surface (so global Ctrl+C / Ctrl+V elsewhere in the app is never hijacked).
   const editorBodyRef = useRef<HTMLDivElement>(null)

   const rootRef = useRef<HTMLDivElement>(null)
   const interactionRef = useRef<Interaction | null>(null)
   const [anchorRect, setAnchorRect] = useState<DOMRect>(() => new DOMRect())

   // The fixed editor canvas extent (diagram units), captured on open so the coordinate frame stays
   // stable while nodes are dragged (unlike the read-only block, which autofits).
   const [editorCanvas, setEditorCanvas] = useState<{ width: number; height: number }>(
      () => computeEditorCanvas(block.diagram ?? FALLBACK_SPEC),
   )

   // Ephemeral view transform (zoom + pan), applied ON TOP of the fixed frame. Never persisted or
   // serialized — reset on window open. Alignment guides show only while a node is dragged.
   const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW_TRANSFORM)
   const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([])

   // The user-resizable canvas height (screen px) + the measured on-screen container size. Both are
   // ephemeral editor state (never serialized). The frame's aspect is derived from the measured
   // container (see `currentFrame`), so a taller canvas gives a taller frame/viewport — more room to
   // work — while keeping the pointer mapping + the unbounded-canvas clip correct.
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
    * blur AND — critically — at the top of a canvas pointer-down and on window close, so a click that
    * changes the selection (which unmounts the field, suppressing its blur) can never discard the
    * in-flight draft. `editing.current` is true exactly when such a draft is pending (a drag always
    * ends by committing on pointer-up), so this is a no-op otherwise.
    */
   function flushPendingEdit(): void {
      if (editing.current) commit(workingRef.current)
   }
   // Node + edge selection are mutually exclusive: selecting one clears the other, so the inspector
   // always shows exactly one element (or the empty hint). selectNode(null) clears both.
   function selectNode(id: string | null): void {
      selectedIdRef.current = id
      setSelectedId(id)
      selectedEdgeIdRef.current = null
      setSelectedEdgeId(null)
   }
   function selectEdge(id: string | null): void {
      selectedEdgeIdRef.current = id
      setSelectedEdgeId(id)
      selectedIdRef.current = null
      setSelectedId(null)
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
   // HEIGHT is derived so the frame aspect exactly matches the measured container (unmeasured → the
   // content extent as a first-frame fallback).
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
      // regardless of the zoom/pan or the resized canvas height — not off in a fixed frame corner.
      const visible = viewportViewBox(currentFrame(), view)
      const center: Point = {
         x: visible.minX + visible.width / 2 + cascade,
         y: visible.minY + visible.height / 2 + cascade,
      }
      const id = crypto.randomUUID()
      selectNode(id)
      commit(addNode(current, createNode(shape, center, t.diagramDefaultNodeLabel, id)))
   }

   // ============
   //  Duplicate / copy-paste (ephemeral clipboard) + the right-click node context menu
   // ============
   /**
    * Insert an offset duplicate of `source`, select the copy, and re-seed the clipboard WITH the copy so
    * a second paste offsets from the first (stacked pastes cascade rather than landing on top of each
    * other). Shared by the Ctrl+V paste and the right-click "Duplicate" action.
    */
   function insertDuplicate(source: DiagramNode): void {
      const newId = crypto.randomUUID()
      const copy = duplicateNode(source, () => newId, DUPLICATE_OFFSET)
      selectNode(newId)
      commit(addNode(workingRef.current, copy))
      clipboardRef.current = copy
   }

   /** Duplicate the selected node in place with an offset (the context-menu Duplicate = copy+paste-in-one). */
   function duplicateSelectedNode(): void {
      const id = selectedIdRef.current
      if (!id) return
      const node = findNode(workingRef.current, id)
      if (node) insertDuplicate(node)
   }

   /**
    * Right-click a node → select it + open the node context menu at the cursor. A right-click on empty
    * canvas FALLS THROUGH (no preventDefault), leaving the native menu, since there's no empty-canvas
    * action yet.
    */
   function onCanvasContextMenu(point: Point, event: React.MouseEvent): void {
      const hit = hitTestNode(workingRef.current, point)
      if (!hit) return
      event.preventDefault()
      flushPendingEdit()
      selectNode(hit.id)
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

      // (1) A press on a handle of the ALREADY-selected node begins a resize (checked before a body
      // hit). The grab tolerance is widened as we zoom OUT so the handles stay grabbable on screen.
      const selected = selectedIdRef.current ? findNode(current, selectedIdRef.current) : null
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

      // (3) A node body hit selects it + begins a move.
      const hit = hitTestNode(current, point)
      if (hit) {
         selectNode(hit.id)
         interactionRef.current = { mode: 'move', id: hit.id, start: point, origin: hit }
         event.currentTarget.setPointerCapture(event.pointerId)
         setInteracting(true)
         return
      }

      // (4) Off every node: an edge close enough to the click selects it (a plain click-select, no
      // drag this pass — waypoint drag is deferred). Waypoints/routing are honored by hitTestEdge.
      const edgeHit = hitTestEdge(current, point, EDGE_HIT_THRESHOLD_PX / info.pixelsPerDiagramUnit)
      if (edgeHit) {
         selectEdge(edgeHit.id)
         setEditingLabel(null)
         return
      }

      // (5) The empty background begins a PAN and clears the selection (prior deselect behavior).
      selectNode(null)
      interactionRef.current = { mode: 'pan', startFrame: info.framePoint, startView: view }
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

      if (interaction.mode === 'move') {
         const point = info.diagramPoint
         // Apply the delta to the ORIGIN node (captured at drag start), never accumulating rounding.
         const moved = translateNode(interaction.origin, point.x - interaction.start.x, point.y - interaction.start.y)
         // Probe the other nodes for edge/center alignment; snap + show guides while within threshold.
         const others = current.nodes.filter(other => other.id !== interaction.id).map(nodeBox)
         const threshold = SNAP_THRESHOLD_PX / info.pixelsPerDiagramUnit
         const snap = computeAlignmentSnaps(nodeBox(moved), others, threshold)
         const snapped = {
            ...moved,
            x: snap.snapX !== undefined ? roundUnit(snap.snapX) : moved.x,
            y: snap.snapY !== undefined ? roundUnit(snap.snapY) : moved.y,
         }
         setAlignmentGuides(snap.guides)
         draft(setNode(current, snapped))
      } else {
         // Resize: compute the raw resized box, then snap the MOVING edge(s) (per the active handle) to
         // neighbor edges/centers + show guides — the move-drag snap's sibling, holding the pinned edge.
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
      if (!interaction) return
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
         event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setInteracting(false)

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

   // Double-click a node → edit its label in place (reliable path #1; the inspector field is #2).
   function onCanvasDoubleClick(point: Point): void {
      const hit = hitTestNode(workingRef.current, point)
      if (hit) {
         selectNode(hit.id)
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
      const id = selectedIdRef.current
      if (!id || !findNode(workingRef.current, id)) return
      draft(updateNodeLabel(workingRef.current, id, value))
   }
   function handleStyleChange(stylePatch: NodeStylePatch): void {
      const id = selectedIdRef.current
      if (!id || !findNode(workingRef.current, id)) return
      commit(updateNodeStyle(workingRef.current, id, stylePatch))
   }
   function handleDeleteSelected(): void {
      const id = selectedIdRef.current
      if (!id) return
      selectNode(null)
      setEditingLabel(null)
      commit(removeNode(workingRef.current, id))
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

   // Delete / Backspace removes the selected node while the editor is open (unless a form field has
   // focus, so typing a label / color hex is never hijacked).
   useEffect(() => {
      if (!isEditing) return
      function onKeyDown(event: KeyboardEvent): void {
         if (event.key !== 'Delete' && event.key !== 'Backspace') return
         const target = event.target as HTMLElement | null
         if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
         const nodeId = selectedIdRef.current
         if (nodeId) {
            event.preventDefault()
            selectNode(null)
            setEditingLabel(null)
            commit(removeNode(workingRef.current, nodeId))
            return
         }
         const edgeId = selectedEdgeIdRef.current
         if (edgeId) {
            event.preventDefault()
            selectEdge(null)
            commit(deleteEdge(workingRef.current, edgeId))
         }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
      // commit / selectNode read refs, so only the isEditing gate matters here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [isEditing])

   // Ctrl/Cmd+C copies the selected node into the EPHEMERAL editor clipboard; Ctrl/Cmd+V pastes an
   // offset duplicate. SCOPED to this open editor so global copy/paste is never hijacked: the listener
   // attaches only while THIS diagram's editor window is open, and each keystroke additionally bails
   // when (a) a text field / editable region is focused, (b) a real (non-collapsed) text selection
   // exists anywhere, or (c) focus sits in another surface (the canvas isn't focusable, so a node click
   // leaves focus idle on <body> — allowed — but focus inside another block/editor is not). We
   // preventDefault ONLY when we actually handle the key.
   useEffect(() => {
      if (!isEditing) return
      function onKeyDown(event: KeyboardEvent): void {
         if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
         const key = event.key.toLowerCase()
         const isCopy = key === 'c'
         const isPaste = key === 'v'
         if (!isCopy && !isPaste) return

         const target = event.target as HTMLElement | null
         if (target?.closest('input, textarea, select, [contenteditable="true"]')) return

         const selection = window.getSelection?.()
         if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return

         const active = document.activeElement
         const focusOk = active === null || active === document.body
            || !!editorBodyRef.current?.contains(active)
         if (!focusOk) return

         if (isCopy) {
            const id = selectedIdRef.current
            if (!id) return
            const node = findNode(workingRef.current, id)
            if (!node) return
            event.preventDefault()
            clipboardRef.current = node
            return
         }
         // Paste: only when the clipboard holds a copied node.
         const source = clipboardRef.current
         if (!source) return
         event.preventDefault()
         insertDuplicate(source)
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
      // Handlers read refs, so only the isEditing gate matters here.
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
   //  now only the fixed reference frame (the scale-1 viewport size + the container aspect), never a
   //  content clip. The interaction overlay shares the same viewport viewBox, so its coordinates line
   //  up 1:1 with the drawn nodes at any zoom/pan.
   // ============
   const fixedFrame = currentFrame()
   const viewport = viewportViewBox(fixedFrame, view)
   const canvasSvg = working.nodes.length > 0
      ? overrideSvgViewBox(renderDiagramToSvg(working, diagramTheme), viewport)
      : ''
   const selectedNode = selectedId ? findNode(working, selectedId) : null
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
      <div className="diagram-editor" ref={editorBodyRef}>
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
                     selectedNode={selectedNode}
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
                     cursor={connectFromId ? 'crosshair' : interacting ? 'grabbing' : 'default'}
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
               node={selectedNode}
               edge={selectedEdge}
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

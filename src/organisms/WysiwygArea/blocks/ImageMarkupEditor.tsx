// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type React from 'react'

// -- Library Imports --
import {
   ImageUp, Trash2, Pencil,
   MousePointer2, Square, Circle, Minus, ArrowUpRight,
   Type, MessageSquare, PenLine,
   BringToFront, SendToBack, ArrowUp, ArrowDown,
} from 'lucide-react'

// -- Library / Hook Imports --
import {
   renderImageMarkupToSvg, renderMarkupOverlayToSvg, computeViewBox,
   MARKUP_DEFAULT_STROKE, MARKUP_DEFAULT_STROKE_WIDTH,
   MARKUP_DEFAULT_FONT_SIZE, MARKUP_DEFAULT_TEXT_COLOR,
   MARKUP_DEFAULT_STROKE_STYLE, MARKUP_DEFAULT_ARROWHEAD, MARKUP_DEFAULT_ARROWHEAD_POSITION,
} from '../../../lib/imageMarkup'
import {
   pointerToNormalized, createElementFromDrag, hitTest, hitTestHandle,
   moveElement, resizeElement, updateElementStyle, updateElementText,
   createTextElement, createCalloutFromDrag, createFreehandFromPoints, simplifyFreehand,
   bringForward, sendBackward, bringToFront, sendToBack, FREEHAND_SIMPLIFY_TOLERANCE,
   addElement, removeElement, replaceElement, getElementHandles, getBoundingBox,
   elementIsDegenerate,
   type GeometricTool, type MarkupDrawStyle, type NormalizedPoint, type ResizeHandle,
} from '../../../lib/imageMarkup/edit'
import { imageBlockToMarkupSpec } from '../../../lib/imageMarkupBlock'
import { downscaleImageToDataUrl } from '../../../lib/imageDownscale'
import { PlainEditable } from '../../../atoms/PlainEditable'
import { SegmentedIconToggle } from '../../../atoms/SegmentedIconToggle'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'
import { ColorSwatchField } from '../../../molecules/ColorSwatchField'
import { usePopAWindow } from 'react-pop-a-window'
import { useLang } from '../../../contexts/LangContext'

// -- Type Imports --
import type { SegmentedIconToggleOption } from '../../../atoms/SegmentedIconToggle'
import type {
   ImageMarkupSpec, MarkupElement, MarkupStrokeStyle, MarkupArrowhead, MarkupArrowheadPosition,
} from '../../../lib/imageMarkup'
import type { Block } from '../../../types'
import type { T } from '../../../lib/i18n'

// #############
// # CONSTANTS #
// #############

/** The base image is capped tighter than the 2048 default to bound the JSON/export weight. */
const IMAGE_MAX_EDGE = 1600

/** Selection-handle square size, in viewBox units (viewBox long edge = 1000, so ~1.4%). */
const HANDLE_SIZE = 14

/** The tool that is active: the passive `select`, the four geometric creators, plus text / callout /
 *  freehand (pen). `freehand` is the pen tool's internal id (its element kind), labelled "Pen". */
type ActiveTool = 'select' | GeometricTool | 'text' | 'callout' | 'freehand'

/** The tool palette, in display order. `select` first, then the shape creators, then text/callout/pen. */
const TOOLS: { tool: ActiveTool; Icon: typeof Square; labelKey:
   'imageMarkupToolSelect' | 'imageMarkupToolRect' | 'imageMarkupToolEllipse' | 'imageMarkupToolLine'
   | 'imageMarkupToolArrow' | 'imageMarkupToolText' | 'imageMarkupToolCallout' | 'imageMarkupToolPen' }[] = [
   { tool: 'select',   Icon: MousePointer2, labelKey: 'imageMarkupToolSelect' },
   { tool: 'rect',     Icon: Square,        labelKey: 'imageMarkupToolRect' },
   { tool: 'ellipse',  Icon: Circle,        labelKey: 'imageMarkupToolEllipse' },
   { tool: 'line',     Icon: Minus,         labelKey: 'imageMarkupToolLine' },
   { tool: 'arrow',    Icon: ArrowUpRight,  labelKey: 'imageMarkupToolArrow' },
   { tool: 'text',     Icon: Type,          labelKey: 'imageMarkupToolText' },
   { tool: 'callout',  Icon: MessageSquare, labelKey: 'imageMarkupToolCallout' },
   { tool: 'freehand', Icon: PenLine,       labelKey: 'imageMarkupToolPen' },
]

/** The kinds that carry an interior fill (so the fill controls apply to them). */
const FILLABLE_KINDS = new Set<string>(['rect', 'ellipse', 'callout'])

// ################
// # STYLE GLYPHS #
// ################
//
// Small inline-SVG glyphs for the line style, arrowhead shape, and arrowhead position controls,
// each drawn to read as the option rather than as a generic icon: the shapes mirror the actual
// renderer's look (dash/dot pattern, filled triangle vs open chevron, head at the tip vs
// mid-line) so the segmented toggle doubles as a tiny live legend. All glyphs share one
// viewBox/stroke width so the three rows line up visually; `currentColor` follows the button's
// own text color (muted when idle, accent when selected, set by the CSS, not the glyph).

const STYLE_GLYPH_VIEW_BOX = '0 0 28 16'

/** A short horizontal line rendered solid / dashed / dotted, the line-style option glyph. */
function StrokeStyleGlyph({ strokeStyle }: { strokeStyle: MarkupStrokeStyle }) {
   const dashArray = strokeStyle === 'dashed' ? '7 5' : strokeStyle === 'dotted' ? '0.1 6' : undefined
   return (
      <svg viewBox={STYLE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         <line
            x1={2} y1={8} x2={26} y2={8}
            stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeDasharray={dashArray}
         />
      </svg>
   )
}

/** An arrow ending in a filled triangle ("full") or an open two-leg chevron ("chevron"). */
function ArrowheadTypeGlyph({ arrowhead }: { arrowhead: MarkupArrowhead }) {
   return (
      <svg viewBox={STYLE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         <line x1={2} y1={8} x2={18} y2={8} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
         {arrowhead === 'chevron'
            ? (
               <polyline
                  points="17,3 26,8 17,13"
                  fill="none" stroke="currentColor" strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round"
               />
            )
            : <polygon points="18,4 26,8 18,12" fill="currentColor" />}
      </svg>
   )
}

/** A line whose arrowhead sits at the end of the segment ("end") or in the middle ("middle"),
 *  with the shaft carrying on past the head in the middle case, mirroring the actual render. */
function ArrowheadPositionGlyph({ arrowheadPosition }: { arrowheadPosition: MarkupArrowheadPosition }) {
   if (arrowheadPosition === 'middle') {
      return (
         <svg viewBox={STYLE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
            <line x1={2} y1={8} x2={26} y2={8} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
            <polygon points="11,4 19,8 11,12" fill="currentColor" />
         </svg>
      )
   }
   return (
      <svg viewBox={STYLE_GLYPH_VIEW_BOX} width="24" height="16" aria-hidden="true">
         <line x1={2} y1={8} x2={18} y2={8} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
         <polygon points="18,4 26,8 18,12" fill="currentColor" />
      </svg>
   )
}

/** Builds the three segmented-toggle option lists from the current UI strings. Kept as plain
 *  functions (not components) since the icons never need their own component identity. */
function buildStrokeStyleOptions(t: T): SegmentedIconToggleOption<MarkupStrokeStyle>[] {
   return [
      { value: 'solid',  label: t.imageMarkupStrokeStyleSolid,  icon: <StrokeStyleGlyph strokeStyle="solid" /> },
      { value: 'dashed', label: t.imageMarkupStrokeStyleDashed, icon: <StrokeStyleGlyph strokeStyle="dashed" /> },
      { value: 'dotted', label: t.imageMarkupStrokeStyleDotted, icon: <StrokeStyleGlyph strokeStyle="dotted" /> },
   ]
}
function buildArrowheadOptions(t: T): SegmentedIconToggleOption<MarkupArrowhead>[] {
   return [
      { value: 'full',    label: t.imageMarkupArrowheadFull,    icon: <ArrowheadTypeGlyph arrowhead="full" /> },
      { value: 'chevron', label: t.imageMarkupArrowheadChevron, icon: <ArrowheadTypeGlyph arrowhead="chevron" /> },
   ]
}
function buildArrowheadPositionOptions(t: T): SegmentedIconToggleOption<MarkupArrowheadPosition>[] {
   return [
      { value: 'end',    label: t.imageMarkupArrowheadPosEnd,    icon: <ArrowheadPositionGlyph arrowheadPosition="end" /> },
      { value: 'middle', label: t.imageMarkupArrowheadPosMiddle, icon: <ArrowheadPositionGlyph arrowheadPosition="middle" /> },
   ]
}

// #########
// # TYPES #
// #########

/** A live pointer-drag session, kept in a ref (mutating it must not re-render). */
type Interaction =
   | { mode: 'create';        tool: GeometricTool; id: string; start: NormalizedPoint; style: MarkupDrawStyle }
   | { mode: 'createCallout'; id: string; start: NormalizedPoint; style: MarkupDrawStyle }
   | { mode: 'pen';           id: string; style: MarkupDrawStyle }
   | { mode: 'move';   id: string; start: NormalizedPoint; origin: MarkupElement }
   | { mode: 'resize'; id: string; handle: ResizeHandle;   origin: MarkupElement }

interface ImageMarkupEditorProps {
   block:     Block
   patch:     (partial: Partial<Block>) => void
   readOnly?: boolean
}

/**
 * Image-markup (annotation) editor for an `image` block in markup mode. Rendered by `ImageBlock`
 * only when `block.imageMarkup` is present; the plain-image path stays byte-identical.
 *
 * The base image lives on the block's own `src`/`alt`/`caption`; the overlay dims + element stack
 * live on `block.imageMarkup`. The editor reconstructs an `ImageMarkupSpec` from the block
 * (`imageBlockToMarkupSpec`) for the pure renderer + edit helpers, then commits back as
 * `patch({ src, imageMarkup: { width, height, elements } })`. alt/caption are edited by their own
 * inline fields, not touched on commit.
 *
 * Read-only / export path: the reconstructed spec is turned into a self-contained inline SVG by
 * the pure `renderImageMarkupToSvg` and injected via `dangerouslySetInnerHTML`, no runtime,
 * byte-identical to the HTML export.
 *
 * Interactive editor: the annotation canvas edits inline at the block's full width, while the
 * tool palette + property controls live in a floating, non-modal `BlockEditorWindow`. The
 * draft/commit model mirrors the graph block: a local `working` spec (also mirrored in
 * `workingRef` so pointer handlers read the latest value mid-drag) keeps a drag smooth, committed
 * to the document on pointer-up / discrete change.
 *
 * Interactive-canvas architecture: while editing, the canvas is three stacked layers inside one
 * relative container: (1) a plain `<img>` of the base image (stable, so a live drag never
 * re-decodes the heavy base64) or a neutral placeholder box; (2) an element overlay
 * (`renderMarkupOverlayToSvg`, base64-free) re-parsed cheaply per draft; (3) a transparent
 * interaction layer capturing pointer events + drawing only the selection chrome. Every
 * interaction's geometry is pure and unit-tested in `lib/imageMarkup/edit.ts`; this component is
 * thin pointer glue over those helpers.
 */
export function ImageMarkupEditor({ block, patch, readOnly }: ImageMarkupEditorProps) {
   const { t }        = useLang()
   const editorWindow = usePopAWindow()
   const isEditing    = !readOnly && editorWindow.isOpen(block.id)

   // ============
   //  Draft state (mirrors GraphBlock): local working spec + refs for stale-closure-free handlers.
   // ============
   const [working, setWorking] = useState<ImageMarkupSpec>(() => imageBlockToMarkupSpec(block))
   const workingRef = useRef(working)
   const editing = useRef(false)
   // `patch` is mirrored in a ref so the keydown effect (which depends only on `isEditing`) never
   // calls a stale patch from an earlier render.
   const patchRef = useRef(patch)
   useEffect(() => { patchRef.current = patch })

   const [activeTool, setActiveTool]   = useState<ActiveTool>('select')
   const [selectedId, setSelectedId]   = useState<string | null>(null)
   const selectedIdRef = useRef<string | null>(null)
   const [currentStyle, setCurrentStyle] = useState<MarkupDrawStyle>({
      stroke: MARKUP_DEFAULT_STROKE, strokeWidth: MARKUP_DEFAULT_STROKE_WIDTH,
   })

   const [outputHovered, setOutputHovered] = useState(false)

   const rootRef     = useRef<HTMLDivElement>(null)
   const overlayRef  = useRef<HTMLDivElement>(null)
   const fileInputRef = useRef<HTMLInputElement>(null)
   const interactionRef = useRef<Interaction | null>(null)
   const [anchorRect, setAnchorRect] = useState<DOMRect>(() => new DOMRect())

   // Raw freehand pointer capture (accumulated during a pen drag, simplified on release).
   const rawPointsRef = useRef<NormalizedPoint[]>([])
   // The element whose label is being typed in the edit-in-place overlay (text / callout), or null.
   const [editingTextId, setEditingTextId] = useState<string | null>(null)
   const editingTextIdRef = useRef<string | null>(null)
   function setEditingText(id: string | null): void {
      editingTextIdRef.current = id
      setEditingTextId(id)
   }

   // External changes (undo, tab switch, load, alt/caption edits) sync in only when not actively
   // drawing. The spec is rebuilt from the block's fields (src + overlay dims/elements + alt/caption).
   useEffect(() => {
      if (!editing.current) {
         const next = imageBlockToMarkupSpec(block)
         workingRef.current = next
         setWorking(next)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [block.imageMarkup, block.src, block.alt, block.caption])

   // When the window is opened for THIS block from outside (e.g. the plain-image "Add markup"
   // affordance flips the block into markup mode and opens the window in the same gesture), capture
   // an anchor rect from the freshly-mounted root so the floating window lands beside the block.
   const didInitAnchor = useRef(false)
   useEffect(() => {
      if (isEditing && !didInitAnchor.current && rootRef.current) {
         didInitAnchor.current = true
         setAnchorRect(rootRef.current.getBoundingClientRect())
      }
      if (!isEditing) didInitAnchor.current = false
   }, [isEditing])

   // ============
   //  Draft / commit levers. Commit writes back the base image (src) + the overlay; alt/caption are
   //  owned by their own inline fields and deliberately left untouched here.
   // ============
   function setBoth(next: ImageMarkupSpec): void {
      workingRef.current = next
      setWorking(next)
   }
   function draft(next: ImageMarkupSpec): void {
      editing.current = true
      setBoth(next)
   }
   function commit(next: ImageMarkupSpec): void {
      editing.current = false
      setBoth(next)
      patchRef.current({
         src: next.src,
         imageMarkup: { width: next.width, height: next.height, elements: next.elements },
      })
   }
   function selectElement(id: string | null): void {
      selectedIdRef.current = id
      setSelectedId(id)
   }

   // ============
   //  Base-image replace / remove / drop-all-markup
   // ============
   async function handlePickFile(file: File | undefined): Promise<void> {
      if (!file || !file.type.startsWith('image/')) return
      const { src, width, height } = await downscaleImageToDataUrl(file, IMAGE_MAX_EDGE)
      commit({ ...workingRef.current, src, width, height })
   }
   function handleRemoveImage(): void {
      // Non-destructive of the annotations: only the base pixels drop; the overlay stack (and its
      // viewBox dims, so the aspect ratio survives) stays, rendered over the neutral placeholder.
      commit({ ...workingRef.current, src: '' })
   }
   function handleRemoveMarkup(): void {
      // Fold markup off entirely: clear the overlay so the block reverts to a plain image, keeping
      // the base pixels/alt/caption intact.
      editing.current = false
      editorWindow.close()
      patchRef.current({ imageMarkup: undefined })
   }

   // ============
   //  Pointer -> normalized, via the interaction layer's on-screen rect
   // ============
   function canvasPoint(event: React.PointerEvent): NormalizedPoint {
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return pointerToNormalized(event.clientX, event.clientY, rect)
   }

   // The current render viewBox, needed by hitTest to give a text label its estimated glyph box
   // (so a click near the text selects it) rather than its zero-size anchor point.
   function currentViewBox(): { vbWidth: number; vbHeight: number } {
      return computeViewBox(workingRef.current.width, workingRef.current.height)
   }

   function onPointerDown(event: React.PointerEvent): void {
      // Ignore secondary buttons; let the browser context menu / middle-click through.
      if (event.button !== 0) return
      const point = canvasPoint(event)

      if (activeTool === 'select') {
         const current = workingRef.current
         const selected = current.elements.find(element => element.id === selectedIdRef.current)
         if (selected) {
            const handle = hitTestHandle(selected, point)
            if (handle) {
               interactionRef.current = { mode: 'resize', id: selected.id, handle, origin: selected }
               overlayRef.current?.setPointerCapture(event.pointerId)
               return
            }
         }
         const hit = hitTest(current.elements, point, undefined, currentViewBox())
         if (hit) {
            selectElement(hit.id)
            interactionRef.current = { mode: 'move', id: hit.id, start: point, origin: hit }
            overlayRef.current?.setPointerCapture(event.pointerId)
         } else {
            selectElement(null)
         }
         return
      }

      // Text: CLICK-placed (no drag). Drop it, commit, then open the edit-in-place overlay to type.
      if (activeTool === 'text') {
         const textId = crypto.randomUUID()
         const element = createTextElement(point, t.imageMarkupDefaultText, currentStyle, textId)
         selectElement(textId)
         commit({ ...workingRef.current, elements: addElement(workingRef.current.elements, element) })
         setActiveTool('select')
         setEditingText(textId)
         return
      }

      // Callout: drag the box (the tail defaults to a nearby point). Same create-drag shape as boxes.
      if (activeTool === 'callout') {
         const calloutId = crypto.randomUUID()
         const element = createCalloutFromDrag(point, point, t.imageMarkupDefaultCalloutText, currentStyle, calloutId)
         selectElement(calloutId)
         draft({ ...workingRef.current, elements: addElement(workingRef.current.elements, element) })
         interactionRef.current = { mode: 'createCallout', id: calloutId, start: point, style: currentStyle }
         overlayRef.current?.setPointerCapture(event.pointerId)
         return
      }

      // Freehand (pen): start capturing the pointer path; simplify on release.
      if (activeTool === 'freehand') {
         const penId = crypto.randomUUID()
         rawPointsRef.current = [point]
         const element = createFreehandFromPoints([point], currentStyle, penId)
         selectElement(penId)
         draft({ ...workingRef.current, elements: addElement(workingRef.current.elements, element) })
         interactionRef.current = { mode: 'pen', id: penId, style: currentStyle }
         overlayRef.current?.setPointerCapture(event.pointerId)
         return
      }

      // A geometric shape tool (rect / ellipse / line / arrow): begin creating from a zero-size seed.
      const geometricTool = activeTool as GeometricTool
      const id = crypto.randomUUID()
      const style = currentStyle
      const element = createElementFromDrag(geometricTool, point, point, style, id)
      selectElement(id)
      draft({ ...workingRef.current, elements: addElement(workingRef.current.elements, element) })
      interactionRef.current = { mode: 'create', tool: geometricTool, id, start: point, style }
      overlayRef.current?.setPointerCapture(event.pointerId)
   }

   function onPointerMove(event: React.PointerEvent): void {
      const interaction = interactionRef.current
      if (!interaction) return
      const point = canvasPoint(event)
      const current = workingRef.current
      if (interaction.mode === 'create') {
         const element = createElementFromDrag(interaction.tool, interaction.start, point, interaction.style, interaction.id)
         draft({ ...current, elements: replaceElement(current.elements, element) })
      } else if (interaction.mode === 'createCallout') {
         const existing = current.elements.find(element => element.id === interaction.id)
         const text = existing && existing.kind === 'callout' ? existing.text : ''
         const element = createCalloutFromDrag(interaction.start, point, text, interaction.style, interaction.id)
         draft({ ...current, elements: replaceElement(current.elements, element) })
      } else if (interaction.mode === 'pen') {
         rawPointsRef.current = [...rawPointsRef.current, point]
         const element = createFreehandFromPoints(rawPointsRef.current, interaction.style, interaction.id)
         draft({ ...current, elements: replaceElement(current.elements, element) })
      } else if (interaction.mode === 'move') {
         const moved = moveElement(interaction.origin, point.x - interaction.start.x, point.y - interaction.start.y)
         draft({ ...current, elements: replaceElement(current.elements, moved) })
      } else {
         const resized = resizeElement(interaction.origin, interaction.handle, point)
         draft({ ...current, elements: replaceElement(current.elements, resized) })
      }
   }

   /** Revert to the last committed spec (no document mutation, so no stray undo entry). */
   function discardInteraction(): void {
      selectElement(null)
      editing.current = false
      setBoth(imageBlockToMarkupSpec(block))
   }

   function onPointerUp(event: React.PointerEvent): void {
      const interaction = interactionRef.current
      interactionRef.current = null
      if (!interaction) return
      if (overlayRef.current?.hasPointerCapture?.(event.pointerId)) {
         overlayRef.current.releasePointerCapture(event.pointerId)
      }

      if (interaction.mode === 'create' || interaction.mode === 'createCallout') {
         const created = workingRef.current.elements.find(element => element.id === interaction.id)
         if (!created || elementIsDegenerate(created)) {
            // A click, not a drag: discard the stray speck and stay on the shape tool.
            discardInteraction()
            return
         }
         // After drawing, drop into select so the fresh element can be adjusted / styled.
         setActiveTool('select')
         commit(workingRef.current)
         // A fresh callout opens the edit-in-place overlay so its label can be typed at once.
         if (interaction.mode === 'createCallout') setEditingText(interaction.id)
         return
      }

      if (interaction.mode === 'pen') {
         // Simplify the raw capture (RDP) into a lean point list before it becomes a real element.
         const simplified = simplifyFreehand(rawPointsRef.current, FREEHAND_SIMPLIFY_TOLERANCE)
         rawPointsRef.current = []
         if (simplified.length < 2) {
            discardInteraction()
            return
         }
         const element = createFreehandFromPoints(simplified, interaction.style, interaction.id)
         setActiveTool('select')
         commit({ ...workingRef.current, elements: replaceElement(workingRef.current.elements, element) })
         return
      }

      // move / resize: commit the dragged result.
      commit(workingRef.current)
   }

   // Double-click a text / callout element (in select mode) to edit its label in place.
   function onDoubleClick(event: React.MouseEvent): void {
      if (activeTool !== 'select') return
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) return
      const point = pointerToNormalized(event.clientX, event.clientY, rect)
      const hit = hitTest(workingRef.current.elements, point, undefined, currentViewBox())
      if (hit && (hit.kind === 'text' || hit.kind === 'callout')) {
         selectElement(hit.id)
         setEditingText(hit.id)
      }
   }

   // Commit the edit-in-place overlay's text back to the element on blur / Enter. An emptied TEXT
   // element is removed (a callout keeps its box even with no label).
   function commitTextEdit(value: string): void {
      const id = editingTextIdRef.current
      setEditingText(null)
      if (!id) return
      const target = workingRef.current.elements.find(element => element.id === id)
      if (!target) return
      if (target.kind === 'text' && value.trim() === '') {
         selectElement(null)
         commit({ ...workingRef.current, elements: removeElement(workingRef.current.elements, id) })
         return
      }
      commit({ ...workingRef.current, elements: replaceElement(workingRef.current.elements, updateElementText(target, value)) })
   }

   // Delete / Backspace removes the selected element while the editor is open (unless a form field
   // has focus, so typing a color hex / etc. is never hijacked).
   useEffect(() => {
      if (!isEditing) return
      function onKeyDown(event: KeyboardEvent): void {
         if (event.key !== 'Delete' && event.key !== 'Backspace') return
         const target = event.target as HTMLElement | null
         if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
         const id = selectedIdRef.current
         if (!id) return
         event.preventDefault()
         selectElement(null)
         commit({ ...workingRef.current, elements: removeElement(workingRef.current.elements, id) })
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
      // commit/selectElement read refs, so only the isEditing gate matters here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [isEditing])

   // ============
   //  Property controls
   // ============
   const selectedElement = working.elements.find(element => element.id === selectedId) ?? null

   // Apply a style patch to the selected element (if any) AND remember it as the default for the
   // next drawn shape, so the palette acts as both "edit selection" and "set future defaults".
   function applyStyle(stylePatch: MarkupDrawStyle): void {
      setCurrentStyle(previous => ({ ...previous, ...stylePatch }))
      const id = selectedIdRef.current
      if (!id) return
      const target = workingRef.current.elements.find(element => element.id === id)
      if (!target) return
      const next = updateElementStyle(target, stylePatch)
      commit({ ...workingRef.current, elements: replaceElement(workingRef.current.elements, next) })
   }
   function handleDeleteSelected(): void {
      const id = selectedIdRef.current
      if (!id) return
      selectElement(null)
      commit({ ...workingRef.current, elements: removeElement(workingRef.current.elements, id) })
   }

   // Set the selected text / callout element's label from the property-panel text field, a reliable
   // edit path independent of the in-canvas edit-in-place overlay. No-op unless a text / callout
   // element is selected.
   function applyTextContent(value: string): void {
      const id = selectedIdRef.current
      if (!id) return
      const target = workingRef.current.elements.find(element => element.id === id)
      if (!target || (target.kind !== 'text' && target.kind !== 'callout')) return
      if (target.text === value) return
      commit({ ...workingRef.current, elements: replaceElement(workingRef.current.elements, updateElementText(target, value)) })
   }

   // Z-order: reorder the selected element in the stack (array order = z-order) via a pure helper.
   function reorderSelected(reorder: (elements: MarkupElement[], id: string) => MarkupElement[]): void {
      const id = selectedIdRef.current
      if (!id) return
      commit({ ...workingRef.current, elements: reorder(workingRef.current.elements, id) })
   }

   function openEditorWindow(): void {
      setAnchorRect(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      editorWindow.open(block.id)
   }

   // ============
   //  Read-only view (the canonical export-consistent renderer, reconstructed from the block)
   // ============
   if (readOnly) {
      const spec = imageBlockToMarkupSpec(block)
      if (!spec.src && spec.elements.length === 0) return null
      const svg = renderImageMarkupToSvg(spec)
      if (!svg) return null
      return <div className="doc-image-markup" dangerouslySetInnerHTML={{ __html: svg }} />
   }

   // Hidden picker, shared by the window's replace button.
   const filePicker = (
      <input
         ref={fileInputRef}
         type="file"
         accept="image/*"
         style={{ display: 'none' }}
         onChange={event => { void handlePickFile(event.target.files?.[0]); event.target.value = '' }}
      />
   )

   // ============
   //  The inline canvas (base image + live element overlay + interaction chrome)
   // ============
   const { vbWidth, vbHeight } = computeViewBox(working.width, working.height)
   const overlayHtml = renderMarkupOverlayToSvg(working.elements, working.width, working.height)

   // The element whose label the edit-in-place overlay is currently editing (text / callout only).
   const editingElement = editingTextId
      ? working.elements.find(element => element.id === editingTextId) ?? null
      : null

   // The overlay's position, expressed as PERCENTAGES of the canvas (so it tracks any display size):
   // a text element sits at its anchor lifted one line height; a callout fills its box.
   function textOverlayStyle(element: MarkupElement): React.CSSProperties {
      const box = getBoundingBox(element)
      if (element.kind === 'text') {
         const fontSize = element.fontSize ?? MARKUP_DEFAULT_FONT_SIZE
         const lineFraction = vbHeight > 0 ? fontSize / vbHeight : 0
         return { left: `${box.x * 100}%`, top: `${Math.max(0, box.y - lineFraction) * 100}%` }
      }
      return {
         left: `${box.x * 100}%`, top: `${box.y * 100}%`,
         width: `${box.w * 100}%`, height: `${box.h * 100}%`,
      }
   }

   const canvas = (
      <div className="image-markup-canvas" style={{ position: 'relative', lineHeight: 0 }}>
         {working.src
            ? (
               <img
                  src={working.src}
                  alt={block.alt ?? ''}
                  draggable={false}
                  style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }}
               />
            )
            : (
               <div
                  aria-hidden="true"
                  style={{ width: '100%', aspectRatio: `${vbWidth} / ${vbHeight}`, background: '#e2e8f0', borderRadius: 4 }}
               />
            )}

         {/* Live element overlay (base64-free, cheap to re-parse during a drag). */}
         <div
            className="image-markup-elements"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{ __html: overlayHtml }}
         />

         {/* Interaction + selection chrome (only while the editor window is open). */}
         {isEditing && (
            <div
               ref={overlayRef}
               className="image-markup-interaction"
               style={{
                  position: 'absolute', inset: 0, touchAction: 'none',
                  cursor: activeTool === 'select' ? 'default' : 'crosshair',
               }}
               onPointerDown={onPointerDown}
               onPointerMove={onPointerMove}
               onPointerUp={onPointerUp}
               onPointerCancel={onPointerUp}
               onDoubleClick={onDoubleClick}
            >
               <svg
                  viewBox={`0 0 ${vbWidth} ${vbHeight}`}
                  preserveAspectRatio="none"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
               >
                  {selectedElement && <SelectionChrome element={selectedElement} vbWidth={vbWidth} vbHeight={vbHeight} />}
               </svg>
            </div>
         )}

         {/* Edit-in-place text overlay: an HTML textarea positioned over the text / callout element,
             NOT SVG-native text editing (fragile cross-browser). Commits on blur / Enter. */}
         {isEditing && editingElement && (editingElement.kind === 'text' || editingElement.kind === 'callout') && (
            <textarea
               key={editingElement.id}
               className="image-markup-text-input"
               style={{ position: 'absolute', ...textOverlayStyle(editingElement) }}
               defaultValue={editingElement.text}
               autoFocus
               spellCheck={false}
               onFocus={event => event.currentTarget.select()}
               onBlur={event => commitTextEdit(event.target.value)}
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

   // ============
   //  Property-control derived values
   // ============
   const styleKind = selectedElement ? selectedElement.kind : (activeTool === 'select' ? null : activeTool)
   const fillApplies   = styleKind !== null && FILLABLE_KINDS.has(styleKind)
   const strokeApplies = styleKind !== null && styleKind !== 'text' // text carries color via textColor, no stroke
   const textApplies   = styleKind === 'text' || styleKind === 'callout'
   const strokeValue = selectedElement?.stroke ?? currentStyle.stroke ?? MARKUP_DEFAULT_STROKE
   const strokeWidthValue = selectedElement?.strokeWidth ?? currentStyle.strokeWidth ?? MARKUP_DEFAULT_STROKE_WIDTH
   const strokeStyleValue = selectedElement?.strokeStyle ?? currentStyle.strokeStyle ?? MARKUP_DEFAULT_STROKE_STYLE
   const fillValue = selectedElement?.fill ?? currentStyle.fill
   const fillActive = fillValue !== undefined
   const fillColorValue = fillValue ?? '#ffffff'

   // Arrow-only options (arrowhead shape + placement), shown when an arrow is selected or the arrow
   // tool is active. Narrow to an arrow before reading its arrow-specific fields.
   const arrowApplies = styleKind === 'arrow'
   const selectedArrow = selectedElement?.kind === 'arrow' ? selectedElement : null
   const arrowheadValue = selectedArrow?.arrowhead ?? currentStyle.arrowhead ?? MARKUP_DEFAULT_ARROWHEAD
   const arrowheadPositionValue = selectedArrow?.arrowheadPosition ?? currentStyle.arrowheadPosition ?? MARKUP_DEFAULT_ARROWHEAD_POSITION

   // Text style (font size + color) is carried only by text / callout kinds; narrow before reading.
   const selectedTextStyled = selectedElement && (selectedElement.kind === 'text' || selectedElement.kind === 'callout')
      ? selectedElement
      : null
   const fontSizeValue  = selectedTextStyled?.fontSize ?? currentStyle.fontSize ?? MARKUP_DEFAULT_FONT_SIZE
   const textColorValue = selectedTextStyled?.textColor ?? currentStyle.textColor ?? MARKUP_DEFAULT_TEXT_COLOR

   // ============
   //  Windowed editor body (APP CHROME, app --color-* tokens, portaled under html[data-theme])
   // ============
   const editorBody = (
      <div className="image-markup-editor">
         {/* ===== Base image ===== */}
         <section className="image-markup-section">
            <span className="image-markup-section-label">{t.imageMarkupImageSection}</span>
            <div className="image-markup-btn-row">
               <button type="button" className="image-markup-btn" onClick={() => fileInputRef.current?.click()}>
                  <ImageUp size={13} />{t.imageMarkupReplaceImage}
               </button>
               {working.src && (
                  <button type="button" className="image-markup-btn image-markup-btn-danger" onClick={handleRemoveImage}>
                     <Trash2 size={13} />{t.imageMarkupRemoveImage}
                  </button>
               )}
            </div>
            <button type="button" className="image-markup-btn image-markup-btn-danger" onClick={handleRemoveMarkup}>
               <Trash2 size={13} />{t.imageMarkupRemove}
            </button>
         </section>

         {/* ===== Tools ===== */}
         <section className="image-markup-section">
            <span className="image-markup-section-label">{t.imageMarkupToolsSection}</span>
            <div className="image-markup-tool-palette" role="toolbar" aria-label={t.imageMarkupToolsSection}>
               {TOOLS.map(({ tool, Icon, labelKey }) => (
                  <button
                     key={tool}
                     type="button"
                     className={`image-markup-tool${activeTool === tool ? ' is-active' : ''}`}
                     aria-pressed={activeTool === tool}
                     aria-label={t[labelKey]}
                     title={t[labelKey]}
                     onClick={() => setActiveTool(tool)}
                  >
                     <Icon size={16} />
                  </button>
               ))}
            </div>
            <p className="image-markup-hint">{t.imageMarkupCanvasHint}</p>
         </section>

         {/* ===== Style ===== */}
         <section className="image-markup-section">
            <span className="image-markup-section-label">{t.imageMarkupStyleSection}</span>
            {!selectedElement && <p className="image-markup-hint">{t.imageMarkupNoSelection}</p>}

            {strokeApplies && (
               <>
                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupStroke}</span>
                     <ColorSwatchField
                        value={strokeValue}
                        title={t.imageMarkupStroke}
                        ariaLabel={t.imageMarkupStroke}
                        onChange={stroke => applyStyle({ stroke })}
                        className="image-markup-color"
                     />
                  </label>

                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupStrokeWidth}</span>
                     <div className="image-markup-range-row">
                        <input
                           type="range"
                           className="image-markup-range"
                           min={1}
                           max={24}
                           step={1}
                           value={strokeWidthValue}
                           onChange={event => applyStyle({ strokeWidth: Number(event.target.value) })}
                        />
                        <span className="image-markup-range-value">{strokeWidthValue}</span>
                     </div>
                  </label>

                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupStrokeStyle}</span>
                     <SegmentedIconToggle
                        options={buildStrokeStyleOptions(t)}
                        value={strokeStyleValue}
                        onChange={strokeStyle => applyStyle({ strokeStyle })}
                        ariaLabel={t.imageMarkupStrokeStyle}
                     />
                  </label>
               </>
            )}

            {arrowApplies && (
               <>
                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupArrowhead}</span>
                     <SegmentedIconToggle
                        options={buildArrowheadOptions(t)}
                        value={arrowheadValue}
                        onChange={arrowhead => applyStyle({ arrowhead })}
                        ariaLabel={t.imageMarkupArrowhead}
                     />
                  </label>

                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupArrowheadPosition}</span>
                     <SegmentedIconToggle
                        options={buildArrowheadPositionOptions(t)}
                        value={arrowheadPositionValue}
                        onChange={arrowheadPosition => applyStyle({ arrowheadPosition })}
                        ariaLabel={t.imageMarkupArrowheadPosition}
                     />
                  </label>
               </>
            )}

            {textApplies && (
               <>
                  {selectedTextStyled && (
                     <label className="image-markup-field">
                        <span className="image-markup-field-label">{t.imageMarkupTextContent}</span>
                        <textarea
                           key={selectedTextStyled.id}
                           className="image-markup-text-field"
                           rows={2}
                           spellCheck={false}
                           defaultValue={selectedTextStyled.text}
                           onBlur={event => applyTextContent(event.target.value)}
                        />
                     </label>
                  )}

                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupTextColor}</span>
                     <ColorSwatchField
                        value={textColorValue}
                        title={t.imageMarkupTextColor}
                        ariaLabel={t.imageMarkupTextColor}
                        onChange={textColor => applyStyle({ textColor })}
                        className="image-markup-color"
                     />
                  </label>

                  <label className="image-markup-field">
                     <span className="image-markup-field-label">{t.imageMarkupFontSize}</span>
                     <div className="image-markup-range-row">
                        <input
                           type="range"
                           className="image-markup-range"
                           min={10}
                           max={80}
                           step={1}
                           value={fontSizeValue}
                           onChange={event => applyStyle({ fontSize: Number(event.target.value) })}
                        />
                        <span className="image-markup-range-value">{fontSizeValue}</span>
                     </div>
                  </label>
               </>
            )}

            {fillApplies && (
               <>
                  <label className="image-markup-toggle">
                     <input
                        type="checkbox"
                        checked={fillActive}
                        onChange={event => applyStyle(event.target.checked
                           ? { fill: fillColorValue }
                           : { fill: undefined, fillOpacity: undefined })}
                     />
                     <span>{t.imageMarkupFill}</span>
                  </label>
                  {fillActive && (
                     <label className="image-markup-field">
                        <span className="image-markup-field-label">{t.imageMarkupFillColor}</span>
                        <ColorSwatchField
                           value={fillColorValue}
                           title={t.imageMarkupFillColor}
                           ariaLabel={t.imageMarkupFillColor}
                           onChange={fill => applyStyle({ fill })}
                           className="image-markup-color"
                        />
                     </label>
                  )}
               </>
            )}

            {selectedElement && (
               <div className="image-markup-arrange">
                  <span className="image-markup-field-label">{t.imageMarkupArrangeSection}</span>
                  <div className="image-markup-arrange-row">
                     <button
                        type="button" className="image-markup-tool"
                        aria-label={t.imageMarkupBringToFront} title={t.imageMarkupBringToFront}
                        onClick={() => reorderSelected(bringToFront)}
                     >
                        <BringToFront size={16} />
                     </button>
                     <button
                        type="button" className="image-markup-tool"
                        aria-label={t.imageMarkupBringForward} title={t.imageMarkupBringForward}
                        onClick={() => reorderSelected(bringForward)}
                     >
                        <ArrowUp size={16} />
                     </button>
                     <button
                        type="button" className="image-markup-tool"
                        aria-label={t.imageMarkupSendBackward} title={t.imageMarkupSendBackward}
                        onClick={() => reorderSelected(sendBackward)}
                     >
                        <ArrowDown size={16} />
                     </button>
                     <button
                        type="button" className="image-markup-tool"
                        aria-label={t.imageMarkupSendToBack} title={t.imageMarkupSendToBack}
                        onClick={() => reorderSelected(sendToBack)}
                     >
                        <SendToBack size={16} />
                     </button>
                  </div>
               </div>
            )}

            <button
               type="button"
               className="image-markup-btn image-markup-btn-danger"
               disabled={!selectedElement}
               onClick={handleDeleteSelected}
            >
               <Trash2 size={13} />{t.imageMarkupDeleteElement}
            </button>
         </section>
      </div>
   )

   // ============
   //  Inline: canvas + hover Edit pill; the controls live in the window. alt/caption edit inline
   //  below (same fields as a plain image), so a marked-up image keeps its accessible text editable.
   // ============
   return (
      <div className="image-markup-block" ref={rootRef}>
         {filePicker}
         <div
            className="image-markup-output"
            onMouseEnter={() => setOutputHovered(true)}
            onMouseLeave={() => setOutputHovered(false)}
         >
            {canvas}
            {!isEditing && (
               <button
                  type="button"
                  className={`image-markup-edit-btn${outputHovered ? ' image-markup-edit-btn-visible' : ''}`}
                  aria-label={t.imageMarkupEdit}
                  title={t.imageMarkupEdit}
                  onClick={openEditorWindow}
               >
                  <Pencil size={13} />
                  <span>{t.imageMarkupEdit}</span>
               </button>
            )}
         </div>

         <PlainEditable
            tag="p"
            className="image-field image-alt"
            content={block.alt ?? ''}
            onBlur={value => patch({ alt: value })}
            placeholder={t.imageAlt}
            singleLine
            spellCheck={false}
            readOnly={readOnly}
         />
         <PlainEditable
            tag="p"
            className="image-field image-caption"
            content={block.caption ?? ''}
            onBlur={value => patch({ caption: value })}
            placeholder={t.imageCaption}
            singleLine
            readOnly={readOnly}
         />

         {isEditing && (
            <BlockEditorWindow
               title={t.imageMarkupWindowTitle}
               icon={<Pencil size={15} />}
               anchorRect={anchorRect}
               onClose={editorWindow.close}
            >
               {editorBody}
            </BlockEditorWindow>
         )}
      </div>
   )
}

// #############
// # CHROME    #
// #############

interface SelectionChromeProps {
   element: MarkupElement
   vbWidth:  number
   vbHeight: number
}

/**
 * The selection overlay for the currently-selected element: a dashed bounding outline plus a small
 * square per resize handle. Drawn in viewBox units (the container's aspect ratio matches the
 * viewBox, so `preserveAspectRatio="none"` maps 1:1 with no distortion). Pure presentation, all hit
 * testing happens in JS against the pure `edit.ts` helpers, not against these nodes.
 */
function SelectionChrome({ element, vbWidth, vbHeight }: SelectionChromeProps) {
   // Pass the viewBox so a text element's estimated glyph box (not its zero-size anchor) is outlined,
   // giving the user a visible selection rectangle around the label.
   const box = getBoundingBox(element, { vbWidth, vbHeight })
   const handles = getElementHandles(element)
   return (
      <>
         <rect
            x={box.x * vbWidth}
            y={box.y * vbHeight}
            width={box.w * vbWidth}
            height={box.h * vbHeight}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
         />
         {handles.map(({ handle, point }) => (
            <rect
               key={handle}
               x={point.x * vbWidth - HANDLE_SIZE / 2}
               y={point.y * vbHeight - HANDLE_SIZE / 2}
               width={HANDLE_SIZE}
               height={HANDLE_SIZE}
               fill="#ffffff"
               stroke="#2563eb"
               strokeWidth={1.5}
               vectorEffect="non-scaling-stroke"
            />
         ))}
      </>
   )
}

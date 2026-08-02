// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import type React from 'react'

// -- Library Imports --
import {
   ImageUp, Trash2, Pencil,
   MousePointer2, Square, Circle, Minus, ArrowUpRight,
} from 'lucide-react'

// -- Library / Hook Imports --
import {
   renderImageMarkupToSvg, renderMarkupOverlayToSvg, computeViewBox,
   MARKUP_DEFAULT_STROKE, MARKUP_DEFAULT_STROKE_WIDTH,
} from '../../../lib/imageMarkup'
import {
   pointerToNormalized, createElementFromDrag, hitTest, hitTestHandle,
   moveElement, resizeElement, updateElementStyle,
   addElement, removeElement, replaceElement, getElementHandles, getBoundingBox,
   elementIsDegenerate,
   type GeometricTool, type MarkupDrawStyle, type NormalizedPoint, type ResizeHandle,
} from '../../../lib/imageMarkup/edit'
import { imageBlockToMarkupSpec } from '../../../lib/imageMarkupBlock'
import { downscaleImageToDataUrl } from '../../../lib/imageDownscale'
import { PlainEditable } from '../../../atoms/PlainEditable'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'
import { useBlockEditorWindow } from '../../../contexts/BlockEditorWindowContext'
import { useLang } from '../../../contexts/LangContext'

// -- Type Imports --
import type { ImageMarkupSpec, MarkupElement } from '../../../lib/imageMarkup'
import type { Block } from '../../../types'

// #############
// # CONSTANTS #
// #############

/** The base image is capped tighter than the 2048 default to bound the JSON/export weight (study Q7). */
const IMAGE_MAX_EDGE = 1600

/** Selection-handle square size, in viewBox units (viewBox long edge = 1000, so ~1.4%). */
const HANDLE_SIZE = 14

/** The tool that is active: the passive `select` plus the four geometric creators. */
type ActiveTool = 'select' | GeometricTool

/** The tool palette, in display order. `select` first, then the shape creators. */
const TOOLS: { tool: ActiveTool; Icon: typeof Square; labelKey:
   'imageMarkupToolSelect' | 'imageMarkupToolRect' | 'imageMarkupToolEllipse' | 'imageMarkupToolLine' | 'imageMarkupToolArrow' }[] = [
   { tool: 'select',  Icon: MousePointer2, labelKey: 'imageMarkupToolSelect' },
   { tool: 'rect',    Icon: Square,        labelKey: 'imageMarkupToolRect' },
   { tool: 'ellipse', Icon: Circle,        labelKey: 'imageMarkupToolEllipse' },
   { tool: 'line',    Icon: Minus,         labelKey: 'imageMarkupToolLine' },
   { tool: 'arrow',   Icon: ArrowUpRight,  labelKey: 'imageMarkupToolArrow' },
]

/** The kinds that carry an interior fill (so the fill controls apply to them). */
const FILLABLE_KINDS = new Set<string>(['rect', 'ellipse', 'callout'])

// #########
// # TYPES #
// #########

/** A live pointer-drag session, kept in a ref (mutating it must not re-render). */
type Interaction =
   | { mode: 'create'; tool: GeometricTool; id: string; start: NormalizedPoint; style: MarkupDrawStyle }
   | { mode: 'move';   id: string; start: NormalizedPoint; origin: MarkupElement }
   | { mode: 'resize'; id: string; handle: ResizeHandle;   origin: MarkupElement }

interface ImageMarkupEditorProps {
   block:     Block
   patch:     (partial: Partial<Block>) => void
   readOnly?: boolean
}

/**
 * Image-markup (annotation) editor for an `image` block in MARKUP MODE, re-homed verbatim from the
 * former standalone `image-markup` block's pass-1 editor (see docs/reference/image_markup_study.md
 * and docs/reports/2026-08-02-image-markup-editor-pass1.md). Rendered by `ImageBlock` only when
 * `block.imageMarkup` is present; the plain-image path stays byte-identical.
 *
 * The one difference from the standalone version is the data seam: the base image lives on the
 * block's own `src`/`alt`/`caption`, the overlay dims + element stack on `block.imageMarkup`. The
 * editor reconstructs an `ImageMarkupSpec` from the block (`imageBlockToMarkupSpec`) for the pure
 * renderer + edit helpers, then commits back as `patch({ src, imageMarkup: { width, height,
 * elements } })`. alt/caption are edited by their own inline fields, NOT clobbered on commit.
 *
 * READ-ONLY / EXPORT PATH: the reconstructed spec is turned into a self-contained inline SVG by the
 * pure `renderImageMarkupToSvg` and injected via `dangerouslySetInnerHTML`, no runtime, byte-identical
 * to the HTML export.
 *
 * INTERACTIVE EDITOR (block-editor-window adopter): the annotation canvas edits INLINE at the block's
 * full width, while the tool palette + property controls live in a floating, non-modal
 * `BlockEditorWindow`. The draft/commit model mirrors the graph block: a local `working` spec (also
 * mirrored in `workingRef` so pointer handlers read the latest value mid-drag) keeps a drag smooth,
 * committed to the document on pointer-up / discrete change.
 *
 * INTERACTIVE-CANVAS ARCHITECTURE. While editing, the canvas is three stacked layers inside one
 * relative container: (1) a plain `<img>` of the base image (stable, so a live drag never re-decodes
 * the heavy base64) or a neutral placeholder box; (2) an ELEMENT overlay (`renderMarkupOverlayToSvg`,
 * base64-free) re-parsed cheaply per draft; (3) a transparent INTERACTION layer capturing pointer
 * events + drawing only the selection chrome. Every interaction's geometry is pure + unit-tested in
 * `lib/imageMarkup/edit.ts`; this component is thin pointer glue over those helpers.
 */
export function ImageMarkupEditor({ block, patch, readOnly }: ImageMarkupEditorProps) {
   const { t }        = useLang()
   const editorWindow = useBlockEditorWindow()
   const isEditing    = !readOnly && editorWindow.isEditing(block.id)

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
      editorWindow.closeEditor()
      patchRef.current({ imageMarkup: undefined })
   }

   // ============
   //  Pointer → normalized, via the interaction layer's on-screen rect
   // ============
   function canvasPoint(event: React.PointerEvent): NormalizedPoint {
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return pointerToNormalized(event.clientX, event.clientY, rect)
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
         const hit = hitTest(current.elements, point)
         if (hit) {
            selectElement(hit.id)
            interactionRef.current = { mode: 'move', id: hit.id, start: point, origin: hit }
            overlayRef.current?.setPointerCapture(event.pointerId)
         } else {
            selectElement(null)
         }
         return
      }

      // A shape tool: begin creating a new element from a degenerate (zero-size) seed.
      const id = crypto.randomUUID()
      const style = currentStyle
      const element = createElementFromDrag(activeTool, point, point, style, id)
      selectElement(id)
      draft({ ...workingRef.current, elements: addElement(workingRef.current.elements, element) })
      interactionRef.current = { mode: 'create', tool: activeTool, id, start: point, style }
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
      } else if (interaction.mode === 'move') {
         const moved = moveElement(interaction.origin, point.x - interaction.start.x, point.y - interaction.start.y)
         draft({ ...current, elements: replaceElement(current.elements, moved) })
      } else {
         const resized = resizeElement(interaction.origin, interaction.handle, point)
         draft({ ...current, elements: replaceElement(current.elements, resized) })
      }
   }

   function onPointerUp(event: React.PointerEvent): void {
      const interaction = interactionRef.current
      interactionRef.current = null
      if (!interaction) return
      if (overlayRef.current?.hasPointerCapture?.(event.pointerId)) {
         overlayRef.current.releasePointerCapture(event.pointerId)
      }
      if (interaction.mode === 'create') {
         const created = workingRef.current.elements.find(element => element.id === interaction.id)
         if (!created || elementIsDegenerate(created)) {
            // A click, not a drag: discard the stray speck by reverting to the last committed spec
            // (no document mutation → no stray undo entry), and stay on the shape tool.
            selectElement(null)
            editing.current = false
            setBoth(imageBlockToMarkupSpec(block))
            return
         }
         // After drawing, drop into select so the fresh element can be adjusted / styled.
         setActiveTool('select')
      }
      commit(workingRef.current)
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

   function openEditorWindow(): void {
      setAnchorRect(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      editorWindow.openEditor(block.id)
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
      </div>
   )

   // ============
   //  Property-control derived values
   // ============
   const styleKind = selectedElement ? selectedElement.kind : (activeTool === 'select' ? null : activeTool)
   const fillApplies = styleKind !== null && FILLABLE_KINDS.has(styleKind)
   const strokeValue = selectedElement?.stroke ?? currentStyle.stroke ?? MARKUP_DEFAULT_STROKE
   const strokeWidthValue = selectedElement?.strokeWidth ?? currentStyle.strokeWidth ?? MARKUP_DEFAULT_STROKE_WIDTH
   const fillValue = selectedElement?.fill ?? currentStyle.fill
   const fillActive = fillValue !== undefined
   const fillColorValue = fillValue ?? '#ffffff'

   // ============
   //  Windowed editor body (APP CHROME — app --color-* tokens, portaled under html[data-theme])
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

            <label className="image-markup-field">
               <span className="image-markup-field-label">{t.imageMarkupStroke}</span>
               <input
                  type="color"
                  className="image-markup-color"
                  value={strokeValue}
                  onChange={event => applyStyle({ stroke: event.target.value })}
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
                        <input
                           type="color"
                           className="image-markup-color"
                           value={fillColorValue}
                           onChange={event => applyStyle({ fill: event.target.value })}
                        />
                     </label>
                  )}
               </>
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
               onClose={editorWindow.closeEditor}
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
 * viewBox, so `preserveAspectRatio="none"` maps 1:1 with no distortion). Pure presentation — all hit
 * testing happens in JS against the pure `edit.ts` helpers, not against these nodes.
 */
function SelectionChrome({ element, vbWidth, vbHeight }: SelectionChromeProps) {
   const box = getBoundingBox(element)
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

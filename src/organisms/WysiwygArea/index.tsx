// -- React Imports --
import { useState, useMemo, useId, useEffect, useLayoutEffect, useRef } from 'react'
import type React from 'react'

// -- Library Imports --
import { DndContext, DragOverlay, closestCenter, type CollisionDetection, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

const noopStrategy: SortingStrategy = () => null

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { DocumentHandlesProvider } from '../../contexts/DocumentHandlesContext'
import { DocumentTablesProvider, LinkableTablesProvider } from '../../contexts/DocumentTablesContext'
import { DocThemeProvider } from '../../contexts/DocThemeContext'
import { PopAWindowProvider, usePopAWindow } from 'react-pop-a-window'
import { ParagraphFocusProvider } from '../../contexts/ParagraphFocusContext'
import { PageBreaksContext, type PageBreaksApi } from '../../contexts/PageBreaksContext'
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { SquareDashed, Plus, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, EyeOff, Palette, SeparatorHorizontal, TriangleAlert, PaintRoller } from 'lucide-react'
import { PlainEditable } from '../../atoms/PlainEditable'
import { ContentEditable } from '../../atoms/ContentEditable'
import { BlankPageDropZone } from '../../atoms/BlankPageDropZone'
import { BottomDropZone } from '../../atoms/BottomDropZone'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { MetaFieldColorPopover } from '../../molecules/MetaFieldColorPopover'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'
import { OverflowNavigator } from '../../molecules/OverflowNavigator'
import { WysiwygSection } from './WysiwygSection'
import { WysiwygBlock } from './WysiwygBlock'
import { findBlockOnCanvas, relocateBlock, type BlockLoc } from '../../lib/document'
import { restoreSelectionRange } from '../../lib/inlineFormatting'

// -- Type Imports --
import { collectTableSources, collectLinkableTables } from '../../lib/graphTableData'
import { buildDocumentMenuEntries } from '../../lib/documentMenuEntries'
import { resolveWatermarkLayout, effectiveWatermarkOpacity, renderWatermarkPatternSvg, watermarkTransform, headerJustifyContent, resolveHeaderBesideLayout, type DocPresentationExtras } from '../../lib/presentation'
import { resolveDocumentSheetWidthPx, normalizeFormat, resolveHeader, DEFAULT_A4_MARGINS, type DocFormat, type PageBreak, type PageMargins } from '../../lib/format'
import { renderPageBandHtml } from '../../lib/pageBands'
import {
   reconcilePages, reanchorMovedBlocks, placeBlockOnBlankPage, millimetresToPx,
   hasPageBreakAfter, removePageBreak,
   canStartOnNewPage, canBreakAfter, blockStartsFreshPage, startBlockOnNewPage, mergeBlockWithPrevious,
   A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_WIDTH_PX, A4_LANDSCAPE_HEIGHT_PX,
   type Page, type PageSlice,
} from '../../lib/pageModel'
import { isAutoPageId, contentBoxWidthPx } from '../../lib/pageLayout'
import { TEMPLATE_DRAG_MIME, getDraggedTemplate } from '../../lib/templateDrag'
import type { DocumentTemplate } from '../../lib/documentTemplate'
import type { T } from '../../lib/i18n'
import type { Block, DocMeta, Mode, Section } from '../../types'

import './doc.css'

// A stable empty set, so a missing tooTallPageIds prop never allocates a fresh Set per render.
const EMPTY_TOO_TALL_PAGE_IDS: Set<string> = new Set()

// The corner caption naming how a paged sheet came to be, mirroring the Pages panel's wording. Page 1
// (origin 'first', or unstamped) has no particular type, so it gets none.
function pageTypeLabel(origin: Page['origin'], t: T): string | null {
   if (origin === 'manual')       return t.pageSorterManualBreak
   if (origin === 'continuation') return t.pageSorterContinuation
   if (origin === 'auto-start')   return t.pageSorterAutoPage
   return null
}

interface WysiwygAreaProps {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   /** Export-only / editor-only presentation extras (watermark, etc.); undefined means none set. */
   presentation?: DocPresentationExtras
   /** Document page format (infinite canvas width, later paged A4); undefined resolves to the
    *  default infinite / normal-width behavior. */
   format?: DocFormat
   /** Active tab key; a change closes any open block-editor window (it belongs to the outgoing tab). */
   activeTabKey?: string
   onUpdateMeta:  (patch: Partial<DocMeta>) => void
   onAddSection?: () => void
   readOnly?: boolean
   // ==========================================================
   //  Document-level actions, shared with HeaderMenuBar (the background context menu reuses these,
   //  it does not reimplement them).
   // ==========================================================
   onDocThemeChange?:  (theme: 'light' | 'dark') => void
   onDocAccentChange?: (hex: string) => void
   /** Commit the document's page format; undefined clears it. Records a 'format' undo entry. */
   onFormatChange?: (next: DocFormat | undefined) => void
   /** Commit a page-break-only change under its OWN undo kind, so a break toggle never coalesces into
    *  an adjacent margin / width / band edit. */
   onPageBreakChange?: (next: DocFormat | undefined) => void
   /** Non-recording format write for the reconcile pass: persists + autosaves but records NO history
    *  entry, since it follows an already-recorded delete. */
   onReconcileFormat?: (next: DocFormat | undefined) => void
   /** Commit sections AND format in ONE undo entry. Paged block DnD changes both the flow and the
    *  break markers, so it funnels here for a single-entry drag. */
   onCommitSectionsAndFormat?: (sections: Section[], format: DocFormat | undefined) => void
   onOpenExport?: () => void
   onManualSave?: () => void
   /** File -> Save As... (fork-and-switch to a copy). */
   onSaveAs?: () => void
   // ==========================================================
   //  Launchers for the document-editor dock panels (Presentation / Navigation / Page setup), shared
   //  with HeaderMenuBar. Each reveals its dockable panel.
   // ==========================================================
   onOpenPresentation?: () => void
   onOpenNav?:          () => void
   onOpenFormat?:       () => void
   /** Editor/preview toggle, for the background menu's "Toggle preview" item. */
   previewMode?: Mode
   onSetMode?:   (mode: Mode) => void
   // ==========================================================
   //  Deterministic paged layout (App-owned). App runs ONE offscreen paginator and feeds the result
   //  here, so canvas, Pages panel, Preview, and export render identical pages. The editor no longer
   //  measures anything.
   // ==========================================================
   /** The pages to render in paged mode (empty in infinite mode, one continuous sheet instead). */
   pages?:          Page[]
   /** Pages whose sole atomic block is taller than the sheet, computed alongside `pages` from the same
    *  measurement so the "too tall" note never disagrees with the layout it annotates. */
   tooTallPageIds?: Set<string>
   /** The paragraph held whole for editing through the out-of-flow overlay (App-owned so it survives a
    *  tab switch). Render-only: it never feeds pagination. */
   focusedParagraphId?: string | null
   /** A fragment press sets the focused paragraph, a blur clears it. */
   onParagraphFocusChange?: (blockId: string | null) => void
   /** The block whose editor window is open (or null), lifted from the single-mode PopAWindow so App can
    *  freeze pagination while it is open, a reflow would remount the block and close the window. */
   onBlockEditorOpenChange?: (blockId: string | null) => void
   /** Overwrite the active document's chrome with a dragged template's, keeping its content (the
    *  Templates panel drop-to-apply gesture). */
   onApplyTemplate?: (template: DocumentTemplate) => void
}

/** Reports the single-mode PopAWindow's currently open block id up to App. Must live INSIDE the provider
 *  to read usePopAWindow; renders nothing. App freezes pagination while a block editor is open, since a
 *  reflow (e.g. a diagram edit that stops overflowing a page) would remount the block and close it. */
function BlockEditorOpenReporter({ onChange }: { onChange?: (blockId: string | null) => void }) {
   const { topId } = usePopAWindow()
   useEffect(() => { onChange?.(topId ?? null) }, [topId, onChange])
   return null
}

export function WysiwygArea({
   meta, sections, docTheme, docAccent, presentation, format, activeTabKey, onUpdateMeta, onAddSection, readOnly,
   onDocThemeChange, onDocAccentChange, onFormatChange, onPageBreakChange, onReconcileFormat, onCommitSectionsAndFormat, onOpenExport, onManualSave, onSaveAs,
   onOpenPresentation, onOpenNav, onOpenFormat,
   previewMode, onSetMode,
   pages = [], tooTallPageIds = EMPTY_TOO_TALL_PAGE_IDS,
   focusedParagraphId = null, onParagraphFocusChange,
   onBlockEditorOpenChange,
   onApplyTemplate,
}: WysiwygAreaProps) {
   const { t } = useLang()
   const { reorderSections, moveBlockAcross, updateBlock } = useDocumentMutations()

   // Collision-free id for this sheet's tiled-watermark SVG <pattern> (useId, colons stripped since
   // it rides inside a raw `url(#...)`), so multiple watermarked sheets never clash in <defs>.
   const watermarkPatternId = `doc-watermark-pattern-${useId().replace(/:/g, '')}`

   const header = presentation?.header

   // ==========================================================
   //  Freeform metadata fields, whole-array patches to onUpdateMeta
   // ==========================================================
   // One flat, ordered array; each field's `position` ('above' | 'below') places it in the row above
   // or below the title. All handlers are id-based and compute the next whole array.
   const fields = meta.fields

   // Which field's color popover is open, plus the field rect that anchors it.
   const [colorPopover, setColorPopover] = useState<{ fieldId: string; rect: DOMRect } | null>(null)
   // The field whose right-click menu is open. `rect` is the field's box, reused to anchor the color
   // popover when the menu's Color... item is chosen.
   const [fieldMenu, setFieldMenu] = useState<{ fieldId: string; x: number; y: number; rect: DOMRect } | null>(null)
   // ==========================================================
   //  Document background context menu
   // ==========================================================
   // Catch-all bound high on the outer canvas container, firing for a right-click ANYWHERE on the
   // document background. It relies on propagation, not a target check: a block, section chrome, or a
   // metadata field already calls stopPropagation, so none reach here. Bound in BOTH editor and
   // preview mode (blocks/sections/fields self-disable their own menus under readOnly), so a
   // right-click in preview still reaches theme/accent/export/save/preview-toggle.
   const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null)
   // Custom is a genuine accent selection, on par with a preset swatch, not a disclosure toggle:
   // selecting it applies the current docAccent and reveals the inline ColorPicker under the swatch
   // grid, matching the top-bar Document dropdown.
   const [customAccentSelected, setCustomAccentSelected] = useState(false)

   function handleBackgroundContextMenu(event: React.MouseEvent) {
      event.preventDefault()
      setCustomAccentSelected(false)
      setBackgroundMenu({ x: event.clientX, y: event.clientY })
   }

   function closeBackgroundMenu() {
      setBackgroundMenu(null)
      setCustomAccentSelected(false)
   }

   // ==========================================================
   //  Drop-to-apply a template dragged from the Templates dock panel (native HTML5 DnD, separate from
   //  the dnd-kit block DndContext below, so the two never collide). Guarded on the custom MIME
   //  (lib/templateDrag.ts), so a file or block drag passes through untouched.
   // ==========================================================
   const templateDropEnabled = Boolean(onApplyTemplate) && !readOnly
   const [isTemplateDragOver, setIsTemplateDragOver] = useState(false)

   function handleTemplateDragOver(event: React.DragEvent) {
      if (!templateDropEnabled || !event.dataTransfer.types.includes(TEMPLATE_DRAG_MIME)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsTemplateDragOver(true)
   }

   function handleTemplateDragLeave(event: React.DragEvent) {
      if (!templateDropEnabled || !event.dataTransfer.types.includes(TEMPLATE_DRAG_MIME)) return
      // Native dragleave also fires when crossing between child elements; only clear when the cursor
      // has actually left the canvas container.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setIsTemplateDragOver(false)
   }

   function handleTemplateDrop(event: React.DragEvent) {
      if (!templateDropEnabled || !event.dataTransfer.types.includes(TEMPLATE_DRAG_MIME)) return
      event.preventDefault()
      setIsTemplateDragOver(false)
      const template = getDraggedTemplate()
      if (template) onApplyTemplate?.(template)
   }

   // Shares its entry list with the top-bar "Document" dropdown via buildDocumentMenuEntries, so the
   // two surfaces can't drift in label or order. Only the surface-specific openers differ here.
   function buildBackgroundMenuEntries(): ContextMenuEntry[] {
      return buildDocumentMenuEntries({
         t,
         docTheme,
         docAccent,
         previewMode,
         readOnly,
         onAddSection,
         onDocThemeChange,
         onDocAccentChange,
         customAccentSelected,
         onSelectCustomAccent: onDocAccentChange
            ? () => { setCustomAccentSelected(true); onDocAccentChange(docAccent) }
            : undefined,
         onDeselectCustomAccent: () => setCustomAccentSelected(false),
         onOpenPresentation,
         onOpenNavigation: onOpenNav,
         onOpenFormat,
         onOpenExport,
         onManualSave,
         onSaveAs,
         onTogglePreview: onSetMode ? () => onSetMode('preview') : undefined,
      })
   }

   function updateField(id: string, patch: Partial<{ label: string; value: string }>) {
      onUpdateMeta({ fields: fields.map(field => field.id === id ? { ...field, ...patch } : field) })
   }
   function addField(position: 'above' | 'below') {
      onUpdateMeta({ fields: [...fields, { id: crypto.randomUUID(), label: '', value: '', position }] })
   }
   // Insert a blank field at a zone-relative index, translated to the flat array. An index past the
   // zone's end appends after its last member; an empty zone lands at the end of the flat array.
   function addFieldAt(position: 'above' | 'below', zoneIndex: number) {
      const zoneFlatIndices = fields.reduce<number[]>((indices, field, flatIndex) => {
         if (field.position === position) indices.push(flatIndex)
         return indices
      }, [])
      const insertFlatIndex = zoneIndex < zoneFlatIndices.length
         ? zoneFlatIndices[zoneIndex]
         : zoneFlatIndices.length > 0
            ? zoneFlatIndices[zoneFlatIndices.length - 1] + 1
            : fields.length
      const nextFields = [...fields]
      nextFields.splice(insertFlatIndex, 0, { id: crypto.randomUUID(), label: '', value: '', position })
      onUpdateMeta({ fields: nextFields })
   }
   function removeField(id: string) {
      onUpdateMeta({ fields: fields.filter(field => field.id !== id) })
      setColorPopover(current => current?.fieldId === id ? null : current)
      setFieldMenu(current => current?.fieldId === id ? null : current)
   }
   function flipFieldZone(id: string) {
      onUpdateMeta({ fields: fields.map(field =>
         field.id === id ? { ...field, position: field.position === 'above' ? 'below' : 'above' } : field) })
   }
   // Flipping back to the default drops the showLabel key rather than storing true, keeping the model clean.
   function toggleFieldLabel(id: string) {
      onUpdateMeta({ fields: fields.map(field => {
         if (field.id !== id) return field
         if (field.showLabel === false) { const { showLabel: _dropped, ...rest } = field; return rest }
         return { ...field, showLabel: false }
      }) })
   }
   function setFieldColor(id: string, color: string | undefined) {
      onUpdateMeta({ fields: fields.map(field => {
         if (field.id !== id) return field
         if (color === undefined) { const { color: _dropped, ...rest } = field; return rest }
         return { ...field, color }
      }) })
   }
   // Swap the field with its nearest same-zone neighbor in the flat array, so the other zone's
   // fields keep their positions.
   function moveFieldWithinZone(id: string, direction: -1 | 1) {
      const current = fields.find(field => field.id === id)
      if (!current) return
      const zoneFlatIndices = fields.reduce<number[]>((indices, field, flatIndex) => {
         if (field.position === current.position) indices.push(flatIndex)
         return indices
      }, [])
      const zonePosition       = zoneFlatIndices.findIndex(flatIndex => fields[flatIndex].id === id)
      const targetZonePosition = zonePosition + direction
      if (targetZonePosition < 0 || targetZonePosition >= zoneFlatIndices.length) return
      const flatIndexA = zoneFlatIndices[zonePosition]
      const flatIndexB = zoneFlatIndices[targetZonePosition]
      const nextFields = [...fields]
      ;[nextFields[flatIndexA], nextFields[flatIndexB]] = [nextFields[flatIndexB], nextFields[flatIndexA]]
      onUpdateMeta({ fields: nextFields })
   }

   // undefined lets CSS supply the muted gray, 'accent' tracks the document accent, else a literal hex.
   function resolveFieldColor(color: string | undefined): string | undefined {
      if (color === undefined) return undefined
      if (color === 'accent')  return 'var(--doc-accent)'
      return color
   }

   const visibleFields = fields.filter(field => field.label.trim() || field.value.trim())
   const popoverField  = colorPopover ? fields.find(field => field.id === colorPopover.fieldId) : undefined
   const menuField     = fieldMenu ? fields.find(field => field.id === fieldMenu.fieldId) : undefined

   function buildFieldMenuEntries(field: typeof fields[number], fieldRect: DOMRect): ContextMenuEntry[] {
      const zoneFields = fields.filter(entry => entry.position === field.position)
      const zoneIndex  = zoneFields.findIndex(entry => entry.id === field.id)
      const isBelow    = field.position === 'below'
      const labelHidden = field.showLabel === false
      return [
         { label: t.addFieldBefore, icon: <Plus size={12} />,        onSelect: () => addFieldAt(field.position, zoneIndex) },
         { label: t.addFieldAfter,  icon: <Plus size={12} />,        onSelect: () => addFieldAt(field.position, zoneIndex + 1) },
         { type: 'separator' },
         { label: t.moveLeft,  icon: <ChevronLeft size={12} />,  onSelect: () => moveFieldWithinZone(field.id, -1), disabled: zoneIndex === 0 },
         { label: t.moveRight, icon: <ChevronRight size={12} />, onSelect: () => moveFieldWithinZone(field.id, 1),  disabled: zoneIndex === zoneFields.length - 1 },
         {
            label:    isBelow ? t.moveAboveTitle : t.moveBelowTitle,
            icon:     isBelow ? <ArrowUp size={12} /> : <ArrowDown size={12} />,
            onSelect: () => flipFieldZone(field.id),
         },
         {
            label:    labelHidden ? t.showFieldLabel : t.hideFieldLabel,
            icon:     labelHidden ? <Eye size={12} /> : <EyeOff size={12} />,
            onSelect: () => toggleFieldLabel(field.id),
         },
         { label: t.fieldColorMenu, icon: <Palette size={12} />, onSelect: () => setColorPopover({ fieldId: field.id, rect: fieldRect }) },
         { type: 'separator' },
         { label: t.deleteField, icon: <X size={12} />, danger: true, onSelect: () => removeField(field.id) },
      ]
   }

   // ==========================================================
   //  Metadata zone renderers (above / below the title)
   // ==========================================================
   function renderEditorZone(position: 'above' | 'below') {
      const zoneFields = fields.filter(field => field.position === position)
      return (
         <div className={`page-meta-editor page-meta-editor-${position}`}>
            {zoneFields.map(field => (
               <div
                  key={field.id}
                  className="page-meta-field"
                  style={{ color: resolveFieldColor(field.color) }}
                  onContextMenu={event => {
                     event.preventDefault()
                     // Stopped so the field menu takes precedence over the document-background
                     // catch-all; otherwise both menus would open at once.
                     event.stopPropagation()
                     const rect = event.currentTarget.getBoundingClientRect()
                     setFieldMenu({ fieldId: field.id, x: event.clientX, y: event.clientY, rect })
                  }}
               >
                  <PlainEditable
                     tag="span"
                     className={`page-meta-field-label${field.showLabel === false ? ' page-meta-field-label-hidden' : ''}`}
                     content={field.label}
                     placeholder={t.placeholderFieldLabel}
                     onBlur={value => updateField(field.id, { label: value.trim() })}
                     singleLine
                  />
                  <PlainEditable
                     tag="span"
                     className="page-meta-field-value"
                     content={field.value}
                     placeholder={t.placeholderFieldValue}
                     onBlur={value => updateField(field.id, { value: value.trim() })}
                     singleLine
                  />
               </div>
            ))}
            <button type="button" className="page-meta-add-field" onClick={() => addField(position)}>
               <Plus size={13} />
               {t.addFieldLabel}
            </button>
         </div>
      )
   }

   function renderReadonlyZone(position: 'above' | 'below') {
      const zoneFields = visibleFields.filter(field => field.position === position)
      if (zoneFields.length === 0) return null
      return (
         <div className={`page-meta page-meta-${position}`}>
            {zoneFields.map(field => {
               const label = field.label.trim()
               const value = field.value.trim()
               // showLabel === false renders the value only (no label, no colon).
               const text  = field.showLabel === false
                  ? value
                  : (label ? (value ? `${label}: ${value}` : label) : value)
               return <span key={field.id} style={{ color: resolveFieldColor(field.color) }}>{text}</span>
            })}
         </div>
      )
   }

   const allHandles = useMemo(() =>
      sections.flatMap(section =>
         section.blocks.flatMap(block => [
            block.handle,
            ...(block.left  ?? []).map(inner => inner.handle),
            ...(block.right ?? []).map(inner => inner.handle),
         ])
      ).filter((handle): handle is string => !!handle),
   [sections])

   // The document-wide `handle -> table cells` catalog a linked graph resolves against
   // (collectTableSources walks container columns too). Recomputes on any table edit.
   const documentTables = useMemo(
      () => collectTableSources(sections.flatMap(section => section.blocks)),
   [sections])

   // The full "Link to a table..." picker listing: every table, handled or not, with enough
   // addressing to route a link/handle-assignment back at a pick.
   const linkableTables = useMemo(() => collectLinkableTables(sections), [sections])

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   // One shared block+section DnD context lives on the canvas. `activeSectionId` drives the section
   // drop-indicator; `activeBlockId` + width drive the block drag ghost and the bottom drop zones.
   const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
   const [activeBlockId, setActiveBlockId]     = useState<string | null>(null)
   const [activeBlockWidth, setActiveBlockWidth] = useState<number | null>(null)

   // Infinite-canvas sheet width. Absent format, bare infinite, or 'normal' all resolve to the same
   // 860px, so an untouched document's editor renders unchanged.
   const sheetWidthPx = resolveDocumentSheetWidthPx(format)

   // ==========================================================
   //  The paged (A4) page model
   // ==========================================================
   // In paged mode the flat section/block flow is partitioned into A4 sheets at the break markers
   // (format.pages); infinite mode stays byte-identical. The model is never restructured, pages are
   // derived.
   const paged        = !!format && format.kind !== 'infinite'
   const pageBreaks   = useMemo<PageBreak[]>(() => format?.pages ?? [], [format])

   // ==========================================================
   //  Deterministic pagination (App-owned, offscreen)
   // ==========================================================
   // The canvas no longer measures its own sheets: App runs ONE offscreen paginator and feeds the
   // pages + too-tall ids in as props, so editor, Pages panel, Preview, and export render identical
   // pages. Infinite mode has no pages, so `derivedPages` is null and the canvas renders one sheet.
   const derivedPages: Page[] | null = paged ? pages : null

   // ==========================================================
   //  Paragraph focus: an out-of-flow edit overlay
   // ==========================================================
   // An overflowing paragraph stays split into read-only fragments across sheets AT ALL TIMES.
   // Pressing a fragment floats one contiguous editable holding the WHOLE paragraph, pinned over the
   // first fragment: typing / caret / backspace behave natively (a single element), and because the
   // overlay is position:absolute nothing in flow shifts on focus or blur. The focused id lives in
   // App so it survives a tab; here we drive the request / blur signals, geometry, and caret.
   //
   // `focusedParagraphIdRef` mirrors the prop but is written EAGERLY on request / clear, so the blur
   // firing synchronously when focus hands off between paragraphs reads the incoming id (not the
   // outgoing render's stale prop) and correctly skips clearing.
   const focusedParagraphIdRef = useRef<string | null>(focusedParagraphId)
   focusedParagraphIdRef.current = focusedParagraphId
   // The pending caret to place once the requested paragraph has reflowed whole into the DOM.
   const pendingParagraphCaretRef = useRef<{ blockId: string; caretOffset: number } | null>(null)

   function setFocusedParagraph(blockId: string): void {
      focusedParagraphIdRef.current = blockId
      onParagraphFocusChange?.(blockId)
   }

   function requestParagraphFocus(blockId: string, caretOffset: number): void {
      // A fragment was pressed: reflow whole and place the caret at the pressed offset once it mounts.
      pendingParagraphCaretRef.current = { blockId, caretOffset }
      setFocusedParagraph(blockId)
   }

   function notifyParagraphFocus(blockId: string): void {
      // Any paragraph editable gained focus. Holding it as the focused id freezes measurement while
      // it is edited, so a paragraph typed past a page boundary from scratch is protected too.
      setFocusedParagraph(blockId)
   }

   function notifyParagraphBlur(blockId: string): void {
      // Only clear when THIS paragraph is still focused: a press on another fragment has already moved
      // the focused id forward, so its blur must not undo it.
      if (focusedParagraphIdRef.current !== blockId) return
      focusedParagraphIdRef.current = null
      onParagraphFocusChange?.(null)
   }

   const paragraphFocusValue = {
      focusedParagraphId,
      requestFocus: requestParagraphFocus,
      notifyFocus:  notifyParagraphFocus,
      notifyBlur:   notifyParagraphBlur,
   }

   // Where the edit overlay pins, in the `.doc-pages` STACK coordinate space: top/left place the
   // whole-paragraph editable over the first fragment, `tailRects` are the later-sheet fragments whose
   // stale slice text a scrim covers. Stack-relative because the overlay must be a PEER of the sheets:
   // a child of the first sheet paints behind later sibling sheets and got clipped at the next sheet's
   // edge. null when no paragraph is focused or the focused one fits whole (that case edits in flow).
   const [paragraphOverlay, setParagraphOverlay] = useState<{
      blockId:   string
      topPx:     number
      leftPx:    number
      tailRects: Array<{ topPx: number; leftPx: number; widthPx: number; heightPx: number }>
   } | null>(null)

   // Measure the focused paragraph's fragments and derive the overlay geometry. useLayoutEffect (not
   // passive) so the mount lands BEFORE paint, which the rAF caret effect below relies on. A short,
   // unsplit paragraph has one [data-block-id] element and gets NO overlay; only a 2+ fragment split
   // floats one. Reads live rects because block heights vary, so on-stack positions can't be predicted.
   useLayoutEffect(() => {
      // `.doc-pages` is unique to the editor canvas (the Pages panel renders an HTML string, not these
      // [data-block-id] nodes). Reads the LIVE fragments, independent of where the pages came from.
      const container = document.querySelector<HTMLElement>('.doc-pages')
      if (!focusedParagraphId || !container) { setParagraphOverlay(null); return }
      const fragments = Array.from(container.querySelectorAll<HTMLElement>('[data-block-id]'))
         .filter(element => element.getAttribute('data-block-id') === focusedParagraphId)
      if (fragments.length < 2) { setParagraphOverlay(null); return }
      // Offsets taken against the `.doc-pages` box land in the stack's coordinate space. Both rects
      // are viewport-relative, so subtracting cancels the ancestor scroll: a stable layout offset, and
      // the absolute overlay scrolls with the sheets since it shares this space.
      const containerRect = container.getBoundingClientRect()
      // Measure the fragment's TEXT element (the bare p / h3 / h4), not its wrapper, so the overlay's
      // own text lands on the same baseline and nothing appears to jump.
      const rectOf = (wrapper: HTMLElement) => {
         const textElement = wrapper.querySelector<HTMLElement>('p, h3, h4') ?? wrapper
         const textRect    = textElement.getBoundingClientRect()
         return { topPx: textRect.top - containerRect.top, leftPx: textRect.left - containerRect.left, widthPx: textRect.width, heightPx: textRect.height }
      }
      const first     = rectOf(fragments[0])
      const tailRects = fragments.slice(1).map(rectOf)
      setParagraphOverlay({ blockId: focusedParagraphId, topPx: first.topPx, leftPx: first.leftPx, tailRects })
   }, [focusedParagraphId])

   // Looked up in the model so the overlay holds the WHOLE richText (not a fragment slice) and commits
   // back to the right section. A split paragraph is always a top-level block.
   const overlayParagraph: { sectionId: string; block: Block } | null = (() => {
      if (!paragraphOverlay) return null
      for (const section of sections) {
         const block = section.blocks.find(candidate => candidate.id === paragraphOverlay.blockId)
         if (block) return { sectionId: section.id, block }
      }
      return null
   })()

   // Once the overlay editable has mounted, focus it and drop the caret at the pressed offset. rAF
   // defers past the mount + innerHTML injection so the addressed text nodes are present. `caretOffset`
   // is already model-absolute, so no fragment math; the query targets the overlay's own editable.
   useEffect(() => {
      const pending = pendingParagraphCaretRef.current
      if (!pending || pending.blockId !== focusedParagraphId) return
      const frame = requestAnimationFrame(() => {
         const element = document.querySelector<HTMLElement>('[data-para-overlay] [data-rich]')
         if (element) {
            element.focus()
            restoreSelectionRange(element, pending.caretOffset, pending.caretOffset)
         }
         pendingParagraphCaretRef.current = null
      })
      return () => cancelAnimationFrame(frame)
   }, [focusedParagraphId])

   // Format for a new page-break list, preserving kind/width/margins. An empty list drops the `pages`
   // key entirely. Pure, so the DnD paths can fold it into a combined sections+format commit.
   function formatWithPageBreaks(nextPages: PageBreak[]): DocFormat | undefined {
      const base = normalizeFormat(format)
      if (nextPages.length === 0) {
         const { pages: _dropped, ...rest } = base
         return rest
      }
      return { ...base, pages: nextPages }
   }

   // Commit a page-break list under the shared 'format' undo kind (on-sheet remove button, reconcile
   // fallback).
   function commitPageBreaks(nextPages: PageBreak[]): void {
      if (!onFormatChange) return
      onFormatChange(formatWithPageBreaks(nextPages))
   }

   // Commit a block-menu break toggle under its own 'page-break' undo kind (falling back to 'format'),
   // so an explicit break is a discrete step that never merges into a nearby margin / width / band edit.
   function commitPageBreakEdit(nextPages: PageBreak[]): void {
      const commit = onPageBreakChange ?? onFormatChange
      if (!commit) return
      commit(formatWithPageBreaks(nextPages))
   }


   // Reconcile-on-change: re-anchor a break whose anchor block was deleted onto its surviving
   // predecessor (the boundary stays put, leaving a blank page) and refresh a stale sectionId. The
   // previous flow finds that predecessor, so it is tracked in a ref. Inlined so the effect's own
   // "only fire when the list differs" guard keeps it loop-free.
   const previousSectionsRef = useRef(sections)
   useEffect(() => {
      // A follow-on to whatever changed the flow, not a fresh user action, so it goes through the
      // NON-recording setter to persist without a second undo entry. Falls back to the recording one.
      const commitReconciled = onReconcileFormat ?? onFormatChange
      const previousSections = previousSectionsRef.current
      previousSectionsRef.current = sections
      // Preview must never mutate the model. Keep the ref fresh above so editing resumes with an
      // accurate previous flow, then bail before any reconcile write.
      if (readOnly) return
      const currentPages = format?.pages
      if (!commitReconciled || !currentPages || currentPages.length === 0) return
      const reconciled = reconcilePages(currentPages, sections, previousSections)
      const changed = reconciled.length !== currentPages.length
         || reconciled.some((entry, index) =>
               entry.id !== currentPages[index].id
            || (entry.after?.blockId ?? null) !== (currentPages[index].after?.blockId ?? null)
            || (entry.after?.sectionId ?? null) !== (currentPages[index].after?.sectionId ?? null))
      if (!changed) return
      const base = normalizeFormat(format)
      if (reconciled.length === 0) {
         const { pages: _dropped, ...rest } = base
         commitReconciled(rest)
      } else {
         commitReconciled({ ...base, pages: reconciled })
      }
   }, [sections, format, onFormatChange, onReconcileFormat, readOnly])

   // The page-break API the block context menu consumes, published via PageBreaksContext so the deep
   // WysiwygBlock subtree needn't be prop-drilled. Read-only surfaces still report `paged`, but the
   // mutating calls no-op.
   const pageBreaksApi: PageBreaksApi = {
      paged,
      canStartOnNewPage: blockId => canStartOnNewPage(sections, blockId),
      canBreakAfter:     blockId => canBreakAfter(sections, blockId),
      startsFreshPage:   blockId => blockStartsFreshPage(pageBreaks, sections, blockId),
      startOnNewPage:    blockId => commitPageBreakEdit(startBlockOnNewPage(pageBreaks, sections, blockId)),
      mergeWithPrevious: blockId => commitPageBreakEdit(mergeBlockWithPrevious(pageBreaks, sections, blockId)),
   }

   // Factored out so the "beside" logo placement can wrap it in the same flex row without duplicating
   // the PlainEditable props.
   const titleElement = (
      <PlainEditable
         tag="h1"
         content={meta.title || t.placeholderTitle}
         onBlur={value => onUpdateMeta({ title: value.trim() })}
         singleLine
         readOnly={readOnly}
         // Stop the right-click so it never bubbles into the background catch-all, but no
         // preventDefault, so the title keeps the native browser menu (copy/paste/spellcheck).
         onContextMenu={event => event.stopPropagation()}
      />
   )

   // Scope collisions to the active drag's kind: a section drag only sees section targets, a block
   // drag only block targets + bottom zones. Without this, closestCenter could resolve a section drop
   // onto a block (and vice versa), a no-op or a wrong move.
   const collisionDetection: CollisionDetection = args => {
      const activeType = args.active.data.current?.type
      const droppableContainers = args.droppableContainers.filter(container => {
         const targetType = container.data.current?.type
         return activeType === 'section'
            ? targetType === 'section' || targetType === 'section-zone'
            : targetType === 'block' || targetType === 'block-zone' || targetType === 'blank-page' || targetType === 'page-end'
      })
      return closestCenter({ ...args, droppableContainers })
   }

   function handleDragStart(event: DragStartEvent) {
      if (event.active.data.current?.type === 'block') {
         setActiveBlockId(String(event.active.id))
         setActiveBlockWidth(event.active.rect.current.initial?.width ?? null)
      } else {
         setActiveSectionId(String(event.active.id))
      }
   }

   function resetDrag() {
      setActiveSectionId(null)
      setActiveBlockId(null)
      setActiveBlockWidth(null)
   }

   function handleDragEnd(event: DragEndEvent) {
      const { active, over } = event
      resetDrag()
      if (!over || active.id === over.id) return

      // Section reorder: the collision filter guarantees `over` is a section or the end zone.
      if (active.data.current?.type === 'section') {
         const oldIdx = sections.findIndex(section => section.id === active.id)
         if (oldIdx === -1) return
         // The end zone drops the section at the very last slot (otherwise unreachable by drag).
         if (over.data.current?.type === 'section-zone') {
            if (oldIdx !== sections.length - 1) reorderSections(oldIdx, sections.length - 1)
            return
         }
         const newIdx = sections.findIndex(section => section.id === over.id)
         if (newIdx !== -1) {
            const adjustedIdx = oldIdx < newIdx ? newIdx - 1 : newIdx
            reorderSections(oldIdx, adjustedIdx)
         }
         return
      }

      // Drop onto a blank page: the dragged block becomes that page's only content, sections + breaks
      // in ONE undo entry. Handled before the normal move since a blank page carries no BlockLoc.
      if (over.data.current?.type === 'blank-page' && paged && onCommitSectionsAndFormat && derivedPages) {
         const pageId = String(over.data.current.pageId)
         const targetIndex = derivedPages.findIndex(page => page.id === pageId)
         if (targetIndex !== -1) {
            const result = placeBlockOnBlankPage(sections, pageBreaks, targetIndex, String(active.id))
            if (result.sections !== sections) {
               onCommitSectionsAndFormat(result.sections, formatWithPageBreaks(result.pages))
            }
         }
         return
      }

      // Block move: read the source location off the dragged block.
      const from = active.data.current?.loc as BlockLoc | undefined
      if (!from) return
      const overType = over.data.current?.type
      const movedBlockId = String(active.id)

      // Drop onto a page-end zone: append the block after that page's last block, and move the page
      // boundary onto it so it stays on THIS page. The only append target for a page ending mid-section.
      if (overType === 'page-end' && paged && onCommitSectionsAndFormat && derivedPages) {
         const pageId     = String(over.data.current?.pageId)
         const targetPage = derivedPages.find(page => page.id === pageId)
         let anchorBlockId: string | null = null
         let anchorSectionId: string | null = null
         for (let index = (targetPage?.slices.length ?? 0) - 1; index >= 0 && anchorBlockId === null; index--) {
            const slice = targetPage!.slices[index]
            if (slice.blocks.length > 0) {
               anchorBlockId   = slice.blocks[slice.blocks.length - 1].id
               anchorSectionId = slice.section.id
            }
         }
         if (anchorBlockId && anchorSectionId && anchorBlockId !== movedBlockId) {
            const anchorSection = sections.find(section => section.id === anchorSectionId)
            const anchorIndex   = anchorSection ? anchorSection.blocks.findIndex(block => block.id === anchorBlockId) : -1
            // Insert right after the page's last block (before its section successor, or appended).
            const successorId = anchorSection && anchorIndex >= 0 && anchorIndex < anchorSection.blocks.length - 1
               ? anchorSection.blocks[anchorIndex + 1].id : null
            let nextPages = reanchorMovedBlocks(pageBreaks, sections, [movedBlockId])
            if (hasPageBreakAfter(nextPages, anchorBlockId)) {
               nextPages = nextPages.map(pageBreak =>
                  pageBreak.after && pageBreak.after.blockId === anchorBlockId
                     ? { ...pageBreak, after: { sectionId: anchorSectionId!, blockId: movedBlockId } }
                     : pageBreak)
            }
            // Move + re-anchor commit together as a single undo entry. relocateBlock is the same pure
            // transform moveBlockAcross runs, computed here so it can join the format write.
            const nextSections = relocateBlock(sections, from, movedBlockId, { kind: 'section', sectionId: anchorSectionId }, successorId)
            onCommitSectionsAndFormat(nextSections, formatWithPageBreaks(nextPages))
         }
         return
      }

      // A block means insert before it; a bottom zone means append to that array.
      const to = over.data.current?.loc as BlockLoc | undefined
      if (!to) return
      // Containers are one level deep: never drop a container block into a container column.
      if (active.data.current?.blockType === 'container' && to.kind === 'column') return
      const beforeBlockId = overType === 'block' ? String(over.id) : null
      // Paged: keep a boundary where the page ended when its anchor block is dragged away, and commit
      // the move + re-anchor as ONE undo entry. Infinite: a plain sections-only move.
      if (paged && onCommitSectionsAndFormat) {
         const reanchored   = reanchorMovedBlocks(pageBreaks, sections, [movedBlockId])
         const nextSections = relocateBlock(sections, from, movedBlockId, to, beforeBlockId)
         onCommitSectionsAndFormat(nextSections, formatWithPageBreaks(reanchored))
      } else {
         moveBlockAcross(from, movedBlockId, to, beforeBlockId)
      }
   }

   // ==========================================================
   //  Render helpers (shared by the infinite single sheet + the paged A4 sheets)
   // ==========================================================
   // Background watermark layer, parametrized by <pattern> id so each paged sheet gets its own. The
   // tiled and single branches match export.ts (shared string builders), so editor + export can't drift.
   function renderWatermarkLayer(patternId: string): React.ReactNode {
      if (!presentation?.watermark?.src) return null
      const watermark = presentation.watermark
      // The clip wrapper is NOT transformed, so it clips the rotated inner .doc-watermark (or tiled
      // pattern svg) to the sheet box; the sheet's own overflow can't (see doc-watermark-clip in doc.css).
      if (watermark.tile) {
         return (
            <div className="doc-watermark-clip" aria-hidden="true">
               <div
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: renderWatermarkPatternSvg(watermark, docTheme, patternId) }}
               />
            </div>
         )
      }
      const layout = resolveWatermarkLayout(watermark)
      return (
         <div className="doc-watermark-clip" aria-hidden="true">
            <div
               className="doc-watermark"
               aria-hidden="true"
               style={{
                  backgroundImage:    `url("${watermark.src}")`,
                  backgroundRepeat:   layout.repeat,
                  backgroundSize:     layout.size,
                  backgroundPosition: layout.position,
                  opacity:            effectiveWatermarkOpacity(watermark.opacity, docTheme),
                  transform:          watermarkTransform(watermark),
               }}
            />
         </div>
      )
   }

   // Title / metadata zones / logo + the field color popover and menu. Renders once: on the single
   // infinite sheet, or on page 1 only in paged mode.
   function renderPageHeader(): React.ReactNode {
      return (
         <div className="page-header">
            {readOnly ? renderReadonlyZone('above') : renderEditorZone('above')}
            {header?.src && header.placement === 'above' && (
               <div className="page-logo-row" style={{ justifyContent: headerJustifyContent(header.align) }}>
                  <img className="page-logo" src={header.src} alt="" style={{ maxHeight: `${header.maxHeight}px` }} />
               </div>
            )}
            {header?.src && header.placement === 'beside' ? (() => {
               const besideLayout = resolveHeaderBesideLayout(header)
               const logoElement = (
                  <img className="page-logo" src={header.src} alt="" style={{ maxHeight: `${header.maxHeight}px` }} />
               )
               return (
                  <div className="page-logo-row page-logo-row-beside" style={{ justifyContent: besideLayout.justifyContent }}>
                     {besideLayout.logoFirst ? (<>{logoElement}{titleElement}</>) : (<>{titleElement}{logoElement}</>)}
                  </div>
               )
            })() : titleElement}
            {readOnly ? renderReadonlyZone('below') : renderEditorZone('below')}
            {!readOnly && colorPopover && popoverField && (
               <MetaFieldColorPopover
                  activeColor={popoverField.color}
                  anchorRect={colorPopover.rect}
                  title={t.fieldColorLabel}
                  accentLabel={t.colorAccentLabel}
                  defaultLabel={t.colorDefaultLabel}
                  onPickAccent={() => setFieldColor(popoverField.id, 'accent')}
                  onPickColor={hex => setFieldColor(popoverField.id, hex)}
                  onClear={() => setFieldColor(popoverField.id, undefined)}
                  onClose={() => setColorPopover(null)}
               />
            )}
            {!readOnly && menuField && fieldMenu && (
               <ContextMenu
                  position={{ x: fieldMenu.x, y: fieldMenu.y }}
                  entries={buildFieldMenuEntries(menuField, fieldMenu.rect)}
                  onClose={() => setFieldMenu(null)}
                  className="min-w-[190px]"
               />
            )}
         </div>
      )
   }

   // The empty-document state (no sections), on the single sheet or the last paged sheet.
   function renderEmptyDocState(): React.ReactNode {
      if (sections.length !== 0) return null
      return !readOnly && onAddSection ? (
         <div
            onClick={onAddSection}
            className="doc-empty-section w-full flex flex-col items-center gap-3 py-16 px-6 rounded-xl border border-dashed text-center mt-4 cursor-pointer select-none"
         >
            <SquareDashed size={32} style={{ color: 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 30%, transparent)' }} />
            <div className="flex flex-col gap-1">
               <p className="text-sm font-medium opacity-60">{t.panelNoSections}</p>
               <p className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 60%, transparent)' }}>{t.panelNoSectionsHint}</p>
            </div>
         </div>
      ) : (
         <div className="wysiwyg-empty">
            <strong>{t.nothingYet}</strong>
            <code style={{ background: `color-mix(in srgb, ${docAccent} 10%, var(--doc-canvas-bg))`, color: docAccent, padding: '0.1em 0.35em', borderRadius: 3, fontSize: '0.85em' }}>+ {t.addSection}</code> {t.nothingYetHint}
         </div>
      )
   }

   // The new-section affordance at the document tail, on the single sheet or the last paged sheet.
   function renderTailAddSection(): React.ReactNode {
      if (readOnly || !onAddSection || sections.length === 0) return null
      return (
         <div className="pt-2 mt-1.5">
            <button
               type="button"
               onClick={onAddSection}
               className="doc-add-btn w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm border border-dashed cursor-pointer"
            >
               <Plus size={15} />
               <span>{t.newSection}</span>
            </button>
         </div>
      )
   }

   // Infinite mode: the whole section flow. The DnD context is the shared one on the canvas, so this
   // only owns the section SortableContext; readOnly renders a plain map.
   function renderInfiniteSections(): React.ReactNode {
      if (readOnly) {
         return (
            <>
               {sections.map((sec, index) => (
                  <div key={sec.id}>
                     <WysiwygSection section={sec} index={index} isLastSection={index === sections.length - 1} activeSectionId={null} readOnly />
                  </div>
               ))}
            </>
         )
      }
      return (
         <SortableContext items={sections.map(section => section.id)} strategy={noopStrategy}>
            {sections.map((sec, index) => (
               <div key={sec.id}>
                  <WysiwygSection section={sec} index={index} isLastSection={index === sections.length - 1} activeSectionId={activeSectionId} activeBlockId={activeBlockId} />
               </div>
            ))}
            {/* Last-slot reorder target: without it the noopStrategy + newIdx-1 compensation can only
                land a dragged section BEFORE the last one. */}
            {activeSectionId != null && sections.length > 1 && (
               <BottomDropZone id="section-end-zone" data={{ type: 'section-zone' }} />
            )}
         </SortableContext>
      )
   }

   // A section's contribution to a page becomes a WysiwygSection over the subset. A unique sortableId
   // + sectionDragDisabled keep a split section's two slices from clashing dnd ids.
   function renderPageSlice(slice: PageSlice, page: Page): React.ReactNode {
      const sectionIndex = sections.findIndex(candidate => candidate.id === slice.section.id)
      return (
         <WysiwygSection
            key={`${slice.section.id}::${page.id}`}
            section={slice.section}
            index={sectionIndex}
            isLastSection={sectionIndex === sections.length - 1}
            activeSectionId={null}
            activeBlockId={activeBlockId}
            readOnly={readOnly}
            renderBlocks={slice.blocks}
            showTitle={slice.isSectionStart}
            showAddRow={slice.isSectionEnd}
            sortableId={`${slice.section.id}::${page.id}`}
            sectionDragDisabled
            suppressEndDropZone
         />
      )
   }

   // The header / footer bands for one sheet: absolutely positioned rows in the margin band, on every
   // page. Rendered from the SAME `renderPageBandHtml` the export uses, so editor and export can't drift.
   function renderBands(pageIndex: number, total: number, margins: PageMargins): React.ReactNode {
      const bandCtx = { pageIndex, pageCount: total, madeWith: t.madeWithDocuminter, pageWord: t.pageNumberWordPage, ofWord: t.pageNumberWordOf }
      const headerHtml = renderPageBandHtml(resolveHeader(format), bandCtx)
      // The editor reads the raw stored footer; the Documinter credit is stamped in on export only.
      const footerHtml = renderPageBandHtml(format?.footer ?? {}, bandCtx)
      const bandStyle = (edge: 'header' | 'footer'): React.CSSProperties => {
         const style: React.CSSProperties = { position: 'absolute', left: millimetresToPx(margins.left), right: millimetresToPx(margins.right) }
         if (edge === 'header') { style.top = millimetresToPx(margins.top) / 2; style.transform = 'translateY(-50%)' }
         else { style.bottom = millimetresToPx(margins.bottom) / 2; style.transform = 'translateY(50%)' }
         return style
      }
      return (
         <>
            {headerHtml && <div className="doc-band doc-band-header" style={bandStyle('header')} dangerouslySetInnerHTML={{ __html: headerHtml }} />}
            {footerHtml && <div className="doc-band doc-band-footer" style={bandStyle('footer')} dangerouslySetInnerHTML={{ __html: footerHtml }} />}
         </>
      )
   }

   // The out-of-flow edit surface for the focused split paragraph, rendered ONCE at the `.doc-pages`
   // stack level (a peer of the sheets) so it floats above every sheet it spans; a child of the first
   // sheet got clipped at the next sheet's top edge. Absolute against the relative `.doc-pages`, pinned
   // over the first fragment, opaque so the read-only fragment stays covered. Each later fragment gets a
   // scrim hiding its stale slice text. The editable sits in a padding-less inner `.doc-render` so it
   // keeps document typography now that it no longer lives inside a sheet's `.doc-render`.
   function renderParagraphEditOverlay(): React.ReactNode {
      if (!paragraphOverlay || !overlayParagraph) return null
      const darkClass = docTheme === 'dark' ? 'doc-dark' : ''
      return (
         <>
            {paragraphOverlay.tailRects.map((rect, index) => (
               <div
                  key={`para-scrim-${index}`}
                  className={`doc-para-edit-scrim ${darkClass}`}
                  style={{ top: `${rect.topPx}px`, left: `${rect.leftPx}px`, width: `${rect.widthPx}px`, height: `${rect.heightPx}px` }}
               />
            ))}
            <div
               data-para-overlay
               className={`doc-para-edit-overlay ${darkClass}`}
               style={{ top: `${paragraphOverlay.topPx}px`, left: `${paragraphOverlay.leftPx}px`, width: `${contentBoxWidthPx(format)}px`, '--doc-accent': docAccent } as React.CSSProperties}
               // Keep a right-click on the native browser menu instead of the background one. Stop
               // propagation only, no preventDefault (same as the title).
               onContextMenu={event => event.stopPropagation()}
            >
               <div className="doc-render" style={{ padding: 0 }}>
                  <ContentEditable
                     tag={overlayParagraph.block.type as 'p' | 'h3' | 'h4'}
                     content={overlayParagraph.block.richText ?? []}
                     onCommit={richText => updateBlock(overlayParagraph.sectionId, overlayParagraph.block.id, { richText })}
                     onFocus={() => notifyParagraphFocus(overlayParagraph.block.id)}
                     onBlur={() => notifyParagraphBlur(overlayParagraph.block.id)}
                  />
               </div>
            </div>
         </>
      )
   }

   // One paged A4 sheet: sized to the kind's px, inset by the margins, with a page label and (for
   // pages 2..N) a remove-break affordance. Page 1 carries the header; the last page the empty-state.
   function renderPageSheet(page: Page, pageIndex: number, total: number): React.ReactNode {
      const margins     = format?.margins ?? DEFAULT_A4_MARGINS
      const isLandscape = format?.kind === 'a4-landscape'
      const sheetWidth  = isLandscape ? A4_LANDSCAPE_WIDTH_PX  : A4_PORTRAIT_WIDTH_PX
      const sheetHeight = isLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX
      const isLastPage  = pageIndex === total - 1
      // A slice-less page is an intentional blank page (stacked / trailing break), EXCEPT the empty
      // document's sole page, which keeps its add-section empty state. So it shows the blank-page drop
      // target whenever the document holds content or there is more than one page.
      const hasContent    = sections.some(section => section.blocks.length > 0)
      const showBlankDrop = page.slices.length === 0 && (hasContent || total > 1) && !readOnly && !!onFormatChange
      // The one overflow auto-reflow cannot resolve: a single atomic block taller than the sheet.
      // Surfaced only in edit mode, as a note, never a break.
      const showTooTall = !readOnly && !!onFormatChange && tooTallPageIds.has(page.id)
      // A corner label naming HOW this sheet came to be. Page 1 has no meaningful type, so none.
      const typeLabel = pageTypeLabel(page.origin, t)
      return (
         <div
            key={page.id}
            data-page-id={page.id}
            className={`doc-page relative shadow-lg rounded-sm border-t-4 ${docTheme === 'dark' ? 'doc-dark' : ''}`}
            style={{
               width:          `${sheetWidth}px`,
               minHeight:      `${sheetHeight}px`,
               background:     'var(--doc-canvas-bg)',
               borderTopColor: docAccent,
               '--doc-accent': docAccent,
            } as React.CSSProperties}
         >
            {renderWatermarkLayer(`${watermarkPatternId}-${pageIndex}`)}
            <div className="doc-page-corner">
               {typeLabel && <span className="doc-page-type-label">{typeLabel}</span>}
               <span className="doc-page-label">{t.formatPageLabel} {pageIndex + 1} / {total}</span>
            </div>
            {renderBands(pageIndex, total, margins)}
            {pageIndex > 0 && !readOnly && onFormatChange && !isAutoPageId(page.id) && (
               <button
                  type="button"
                  className="doc-page-break-remove"
                  title={t.formatRemovePageBreak}
                  onClick={() => commitPageBreaks(removePageBreak(pageBreaks, page.id))}
               >
                  <SeparatorHorizontal size={13} />
                  <span>{t.formatRemovePageBreak}</span>
               </button>
            )}
            <div
               className="doc-render"
               style={{
                  paddingTop:    `${millimetresToPx(margins.top)}px`,
                  paddingRight:  `${millimetresToPx(margins.right)}px`,
                  paddingBottom: `${millimetresToPx(margins.bottom)}px`,
                  paddingLeft:   `${millimetresToPx(margins.left)}px`,
               }}
            >
               {pageIndex === 0 && renderPageHeader()}
               {showBlankDrop
                  ? <BlankPageDropZone
                       id={`blank-${page.id}`}
                       pageId={page.id}
                       label={t.blankPageLabel}
                       hint={t.blankPageDropHint}
                       dragging={activeBlockId != null}
                    />
                  : page.slices.map(slice => renderPageSlice(slice, page))}
               {/* Append target: drops a block at the end of THIS page even when it ends inside a
                   section (the section bottom zone is suppressed in paged mode). Mounted mid-drag only. */}
               {!showBlankDrop && !readOnly && onFormatChange && activeBlockId != null
                  && page.slices.some(slice => slice.blocks.length > 0) && (
                  <BottomDropZone id={`page-end-${page.id}`} data={{ type: 'page-end', pageId: page.id }} />
               )}
               {isLastPage && !showBlankDrop && (<>{renderEmptyDocState()}{renderTailAddSection()}</>)}
            </div>
            {/* A single atomic block taller than the sheet, the one overflow auto-reflow can't resolve.
                A hatched shade covers the part spilling past the bottom-margin line so it is obvious
                WHICH slice overflows, topped by a note pill. Both absolute, so they never alter flow. */}
            {showTooTall && (
               <>
                  <div
                     className="doc-page-overflow-shade"
                     style={{
                        top:    `${sheetHeight - millimetresToPx(margins.bottom)}px`,
                        left:   `${millimetresToPx(margins.left)}px`,
                        right:  `${millimetresToPx(margins.right)}px`,
                        bottom: 0,
                     }}
                  />
                  <div
                     className="doc-page-overflow"
                     style={{
                        top:   `${sheetHeight - millimetresToPx(margins.bottom)}px`,
                        left:  `${millimetresToPx(margins.left)}px`,
                        right: `${millimetresToPx(margins.right)}px`,
                     }}
                  >
                     <div className="doc-page-overflow-pill doc-page-overflow-pill-note">
                        <TriangleAlert size={13} />
                        <span>{t.formatOverflowTooTall}</span>
                     </div>
                  </div>
               </>
            )}
         </div>
      )
   }

   // The document background context menu, rendered ONCE, not per paged sheet. The document editors
   // live as dockable panels now, so no per-document windows mount here.
   function renderDocWindowsAndMenus(): React.ReactNode {
      return (
         <>
            {backgroundMenu && (
               <ContextMenu
                  position={backgroundMenu}
                  entries={buildBackgroundMenuEntries()}
                  onClose={closeBackgroundMenu}
               />
            )}
         </>
      )
   }

   return (
      <DocumentHandlesProvider handles={allHandles}>
       <DocumentTablesProvider tables={documentTables}>
       <LinkableTablesProvider tables={linkableTables}>
       <DocThemeProvider theme={docTheme}>
        <PopAWindowProvider mode="single" resetKey={activeTabKey}>
         <BlockEditorOpenReporter onChange={onBlockEditorOpenChange} />
         <ParagraphFocusProvider value={paragraphFocusValue}>
         <PageBreaksContext.Provider value={pageBreaksApi}>
         <div className="flex flex-col h-full min-h-0 w-full">
         {!readOnly && <FormatToolbar sections={sections} />}
         <div className="flex-1 min-h-0 w-full flex relative">
         <div
            className="relative flex-1 h-full overflow-y-auto px-6"
            style={{ background: 'var(--color-canvas)' }}
            onContextMenu={handleBackgroundContextMenu}
            onDragOver={handleTemplateDragOver}
            onDragLeave={handleTemplateDragLeave}
            onDrop={handleTemplateDrop}
         >
            {(() => {
               // Paged sheets or the single infinite sheet. Both render blocks through WysiwygSection,
               // whose SortableContexts all live under the ONE shared DnD context below, so a drag can
               // cross sections and, in paged mode, sheets.
               const canvasBody = paged && derivedPages ? (
                  // Paged (A4) mode: the flat flow partitioned into stacked A4 sheets.
                  <div className="doc-pages">
                     {derivedPages.map((page, pageIndex) => renderPageSheet(page, pageIndex, derivedPages.length))}
                     {/* Mounted as a peer of the sheets (not inside one) so it floats above every sheet
                         it spans instead of being clipped behind the next. Absolute against the stack. */}
                     {!readOnly && renderParagraphEditOverlay()}
                  </div>
               ) : (
                  // Infinite mode: one centered sheet at the chosen width. The watermark rides behind
                  // .doc-render (z-index in doc.css); an absent watermark changes nothing.
                  <div
                     className={`relative mx-auto min-h-[92%] my-8 shadow-lg rounded-sm border-t-4 ${docTheme === 'dark' ? 'doc-dark' : ''}`}
                     style={{
                        background: 'var(--doc-canvas-bg)',
                        borderTopColor: docAccent,
                        maxWidth: `${sheetWidthPx}px`,
                        '--doc-accent': docAccent,
                     } as React.CSSProperties}
                  >
                     {renderWatermarkLayer(watermarkPatternId)}
                     <div className="doc-render">
                        {renderPageHeader()}
                        {renderEmptyDocState()}
                        {renderInfiniteSections()}
                        {renderTailAddSection()}
                     </div>
                  </div>
               )
               if (readOnly) return canvasBody
               return (
                  <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={resetDrag}>
                     {canvasBody}
                     {/* Shared block drag ghost (sections use an opacity dim + insertion bar, no ghost).
                         Hoisted out of the .doc-render sheet, so it re-establishes the doc theme scope
                         itself; otherwise the ghost text would render in the app theme, unreadable on a
                         dark doc. */}
                     <DragOverlay>
                        {activeBlockId && (() => {
                           // Across section bodies AND container columns (an inner block isn't in
                           // section.blocks), so the ghost renders for both.
                           const found = findBlockOnCanvas(sections, activeBlockId)
                           const sourceSection = found?.section
                           const activeBlock   = found?.block
                           return sourceSection && activeBlock ? (
                              <div
                                 className={docTheme === 'dark' ? 'doc-dark' : ''}
                                 style={{ width: activeBlockWidth ?? undefined, pointerEvents: 'none', opacity: 0.9, '--doc-accent': docAccent } as React.CSSProperties}
                              >
                                 <div className="doc-render" style={{ padding: 0 }}>
                                    <WysiwygBlock secId={sourceSection.id} block={activeBlock} inner onUpdate={() => {}} onRemove={() => {}} />
                                 </div>
                              </div>
                           ) : null
                        })()}
                     </DragOverlay>
                  </DndContext>
               )
            })()}
            {renderDocWindowsAndMenus()}
         </div>
         {/* Pinned to the relative flex row (not the scroll area) so it stays centered in the visible
             canvas while a long document scrolls, instead of riding the content off the top. */}
         {isTemplateDragOver && (
            <div className="absolute inset-3 z-20 pointer-events-none flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-accent/60 bg-accent/10 text-accent">
               {/* White shadow so the accent-tinted text keeps contrast over the content below. */}
               <div
                  className="flex flex-col items-center gap-2.5"
                  style={{ filter: 'drop-shadow(0 1px 2px rgba(255, 255, 255, 0.9))' }}
               >
                  <PaintRoller size={34} />
                  <span className="text-sm font-medium">{t.templateDropToApply}</span>
               </div>
            </div>
         )}
         {/* Find-bar-style pill naming how many blocks overflow their sheet and stepping through them.
             Pinned to the relative flex row so it stays put while the canvas scrolls. Editor + paged only. */}
         {!readOnly && derivedPages && (
            <OverflowNavigator pageIds={derivedPages.filter(page => tooTallPageIds.has(page.id)).map(page => page.id)} />
         )}
         </div>
         </div>
         </PageBreaksContext.Provider>
         </ParagraphFocusProvider>
        </PopAWindowProvider>
       </DocThemeProvider>
       </LinkableTablesProvider>
       </DocumentTablesProvider>
      </DocumentHandlesProvider>
   )
}

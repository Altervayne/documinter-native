// -- React Imports --
import { useState, useMemo, useId, useEffect, useRef } from 'react'
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
import { BlockEditorWindowProvider } from '../../contexts/BlockEditorWindowContext'
import { ParagraphFocusProvider } from '../../contexts/ParagraphFocusContext'
import { PageBreaksContext, type PageBreaksApi } from '../../contexts/PageBreaksContext'
import { useLang } from '../../contexts/LangContext'
import { usePagedLayout } from '../../hooks/usePagedLayout'

// -- Component Imports --
import { SquareDashed, Plus, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, EyeOff, Palette, SeparatorHorizontal, TriangleAlert } from 'lucide-react'
import { PlainEditable } from '../../atoms/PlainEditable'
import { BlankPageDropZone } from '../../atoms/BlankPageDropZone'
import { BottomDropZone } from '../../atoms/BottomDropZone'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { MetaFieldColorPopover } from '../../molecules/MetaFieldColorPopover'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'
import { PresentationWindow } from '../../molecules/PresentationWindow'
import { NavWindow } from '../../molecules/NavWindow'
import { FormatWindow } from '../../molecules/FormatWindow'
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
   canStartOnNewPage, blockStartsFreshPage, startBlockOnNewPage, mergeBlockWithPrevious,
   A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_WIDTH_PX, A4_LANDSCAPE_HEIGHT_PX,
   type Page, type PageSlice,
} from '../../lib/pageModel'
import { EMPTY_HEIGHTS, isAutoPageId, type MeasuredHeights } from '../../lib/pageLayout'
import type { DocMeta, Mode, Section } from '../../types'

import './doc.css'

// A stable empty set for the atomic-ids fallback, so a missing prop never allocates a fresh Set per
// render (which would churn the pagination memo needlessly).
const EMPTY_ATOMIC_BLOCK_IDS: Set<string> = new Set()

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
   //  Document-level actions, reused (not reimplemented) by the background context menu, the
   //  exact same handlers App.tsx already threads into HeaderMenuBar.
   // ==========================================================
   onDocThemeChange?:  (theme: 'light' | 'dark') => void
   onDocAccentChange?: (hex: string) => void
   /** Commit the document's presentation extras (watermark, etc.); undefined clears them. */
   onPresentationChange?: (next: DocPresentationExtras | undefined) => void
   /** Commit the document's page format (infinite width, later paged A4); undefined clears it. Records a
    *  'format' undo entry: used by the Page setup window, margins, bands, and the on-sheet remove button. */
   onFormatChange?: (next: DocFormat | undefined) => void
   /** Commit a page-break-only format change under its OWN undo kind, so a block-menu break toggle never
    *  coalesces into an adjacent margin / width / band edit. The block context menu's break path uses this. */
   onPageBreakChange?: (next: DocFormat | undefined) => void
   /** Non-recording format write for the reconcile pass (re-anchor a break whose anchor was deleted): it
    *  persists + autosaves but records NO history entry, since it follows an already-recorded delete. */
   onReconcileFormat?: (next: DocFormat | undefined) => void
   /** Commit sections AND format in ONE undo entry. Paged block DnD (blank-page drop, cross-page moves)
    *  changes both the flow and the break markers, so it funnels here for a single-entry drag. */
   onCommitSectionsAndFormat?: (sections: Section[], format: DocFormat | undefined) => void
   /** Opens the same File -> Export... / Ctrl+E dialog owned by App.tsx. */
   onOpenExport?: () => void
   onManualSave?: () => void
   /** Opens the same File -> Save As... dialog owned by App.tsx (fork-and-switch to a copy). */
   onSaveAs?: () => void
   // ==========================================================
   //  Presentation window (document-level, non-modal), open-state lifted to App.tsx like the export
   //  modal. Opened from the background context menu here AND the Export dialog's HTML branch.
   // ==========================================================
   presentationOpen?:    boolean
   onOpenPresentation?:  () => void
   onClosePresentation?: () => void
   // ==========================================================
   //  Navigation window (document-level, non-modal), open-state lifted to App.tsx like the
   //  presentation window. Opened from the background context menu here AND the Document top-bar menu.
   // ==========================================================
   navOpen?:      boolean
   onOpenNav?:    () => void
   onCloseNav?:   () => void
   // ==========================================================
   //  Page setup window (document-level, non-modal), open-state lifted to App.tsx like the
   //  presentation / navigation windows. Opened from the background context menu here AND the
   //  Document top-bar menu. Only the infinite-width control is exposed here (kind is implicitly
   //  infinite).
   // ==========================================================
   formatOpen?:      boolean
   onOpenFormat?:    () => void
   onCloseFormat?:   () => void
   /** Editor/preview toggle, for the background menu's optional "Toggle preview" item. */
   previewMode?: Mode
   onSetMode?:   (mode: Mode) => void
   // ==========================================================
   //  Measured paged layout (App-owned). The editor measures its rendered sheets and reports the
   //  heights up so the Pages panel and export paginate from the identical source.
   // ==========================================================
   measuredHeights?:   MeasuredHeights
   onMeasuredHeights?: (heights: MeasuredHeights) => void
   /** Block ids kept whole during pagination. App feeds the single focused paragraph's id (or none), so
    *  overflowing paragraphs split at rest and the focused one reflows whole; the Pages panel paginates
    *  from the same set. */
   atomicBlockIds?:    Set<string>
   /** The paragraph currently held whole for editing (App-owned so editor + Pages panel agree). */
   focusedParagraphId?: string | null
   /** Set / clear the focused paragraph: a fragment press sets it, a blur clears it. */
   onParagraphFocusChange?: (blockId: string | null) => void
}

export function WysiwygArea({
   meta, sections, docTheme, docAccent, presentation, format, activeTabKey, onUpdateMeta, onAddSection, readOnly,
   onDocThemeChange, onDocAccentChange, onPresentationChange, onFormatChange, onPageBreakChange, onReconcileFormat, onCommitSectionsAndFormat, onOpenExport, onManualSave, onSaveAs,
   presentationOpen, onOpenPresentation, onClosePresentation,
   navOpen, onOpenNav, onCloseNav,
   formatOpen, onOpenFormat, onCloseFormat,
   previewMode, onSetMode,
   measuredHeights, onMeasuredHeights, atomicBlockIds,
   focusedParagraphId = null, onParagraphFocusChange,
}: WysiwygAreaProps) {
   const { t } = useLang()
   const { reorderSections, moveBlockAcross } = useDocumentMutations()

   // A stable, collision-free id for this sheet's tiled-watermark SVG <pattern> (React's useId,
   // unique per component instance, colons stripped since the id rides inside a raw `url(#...)`
   // string), guards against <defs> id clashes if multiple watermarked sheets are ever mounted
   // at once.
   const watermarkPatternId = `doc-watermark-pattern-${useId().replace(/:/g, '')}`

   // Header logo (presentation): rendered in .page-header, above or beside the title. undefined
   // means no logo renders.
   const header = presentation?.header

   // ==========================================================
   //  Freeform metadata fields, whole-array patches to onUpdateMeta
   // ==========================================================
   // Fields live in one flat, ordered array; each carries a `position` ('above' | 'below') that
   // places it in the row above or below the title. All handlers are id-based and compute the next
   // whole array, keeping the existing onUpdateMeta({ fields }) merge pattern.
   const fields = meta.fields

   // Which field's color popover is open, plus the field rect that anchors it.
   const [colorPopover, setColorPopover] = useState<{ fieldId: string; rect: DOMRect } | null>(null)
   // The field whose right-click context menu is open, at the cursor. `rect` is the field's box,
   // reused to anchor the color popover when the menu's Color... item is chosen.
   const [fieldMenu, setFieldMenu] = useState<{ fieldId: string; x: number; y: number; rect: DOMRect } | null>(null)
   // ==========================================================
   //  Document background context menu (document-level actions)
   // ==========================================================
   // Catch-all: bound high on the outer canvas container (below), so it fires for a right-click
   // ANYWHERE on the document background, the gutter around the sheet, the sheet's own padding,
   // gaps between/around/below sections, and empty space inside a section. It relies on
   // propagation, not a target check: a right-click on a block (useBlockContextMenu's
   // openContextMenu) or on section chrome (WysiwygSection's handleSectionContextMenu) already
   // calls stopPropagation, so those never reach this handler, see the field-menu stopPropagation
   // just below for the third source that needed the same guard added. Bound in BOTH editor and
   // preview (readOnly) mode, it's the one menu preview keeps reachable (blocks/sections/fields
   // already self-disable their own context menus under readOnly, see WysiwygSection.tsx /
   // WysiwygBlock.tsx), so a right-click still reaches theme/accent/export/save/preview-toggle.
   const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null)
   // Whether Custom is the background menu's selected accent choice, a genuine selection, on par
   // with clicking a preset swatch, NOT a disclosure toggle. Selecting it applies the current
   // docAccent (smooth hand-off) and reveals the inline ColorPicker directly under the accent
   // swatch grid (AccentSwatchGrid) rather than a detached popover, the same inline-under-the-entry
   // pattern the top-bar Document dropdown uses (DocumentMenu's own customAccentSelected). The
   // context menu's own viewport-clamped positioning (useViewportClampedPosition, re-measured via
   // ResizeObserver) re-clamps as the menu grows.
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

   // The document-background context menu shares its entry list with the top-bar "Document" dropdown
   // (HeaderMenuBar) via the single buildDocumentMenuEntries source of truth, so the two surfaces can
   // never drift in label or order. Only the surface-specific openers differ: here selecting "Custom
   // accent..." sets this surface's own selected-flag (and clicking a preset clears it), and the
   // preview toggle routes through onSetMode.
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
   // Insert a blank field into a zone at a zone-relative index (translated to the flat array), for
   // the context menu's "Add field before / after". An index past the zone's end appends after its
   // last member; an empty zone lands at the end of the flat array.
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
   // Toggle whether the label renders in the read view + export. Flipping back to the default
   // (absent/true) drops the showLabel key rather than storing it explicitly, keeping the model clean.
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
   // Reorder a field left/right within its own zone: swap it with the nearest same-zone neighbor
   // in the flat array, so the other zone's fields keep their positions.
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

   // Resolve a field color to an inline `color` value: undefined lets CSS supply the muted gray,
   // 'accent' tracks the document accent live, any other string is a literal hex.
   function resolveFieldColor(color: string | undefined): string | undefined {
      if (color === undefined) return undefined
      if (color === 'accent')  return 'var(--doc-accent)'
      return color
   }

   const visibleFields = fields.filter(field => field.label.trim() || field.value.trim())
   const popoverField  = colorPopover ? fields.find(field => field.id === colorPopover.fieldId) : undefined
   const menuField     = fieldMenu ? fields.find(field => field.id === fieldMenu.fieldId) : undefined

   // Build the right-click context-menu entries for a field: insert before/after, reorder within the
   // zone (disabled at the ends), flip zone (label reflects the current side), toggle the label,
   // open the color popover (anchored to the field's rect), and delete.
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
                     // Stopped so the field menu takes precedence over the new document-background
                     // catch-all context menu (bound higher up, on the outer canvas container),
                     // otherwise both menus would open at once.
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

   // The document-wide `handle -> table cells` catalog a linked graph resolves against. Same
   // `useMemo`-over-`sections` seam as `allHandles`, one axis over; `collectTableSources` walks
   // container columns too. Recomputes on any table edit -> every linked GraphBlock re-resolves.
   const documentTables = useMemo(
      () => collectTableSources(sections.flatMap(section => section.blocks)),
   [sections])

   // The full "Link to a table..." picker listing (the editor UX): every table, handled or
   // not, with enough addressing to route a link/handle-assignment mutation back at a pick. Same
   // `useMemo`-over-`sections` seam as `documentTables`, one axis over (see `LinkableTable`).
   const linkableTables = useMemo(() => collectLinkableTables(sections), [sections])

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   // One shared block+section DnD context lives on the canvas (see the render). `activeSectionId`
   // drives the section drop-indicator; `activeBlockId` + width drive the block drag ghost and the
   // per-section bottom drop zones. Both are set from the merged handlers below, keyed by drag type.
   const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
   const [activeBlockId, setActiveBlockId]     = useState<string | null>(null)
   const [activeBlockWidth, setActiveBlockWidth] = useState<number | null>(null)

   // The infinite-canvas sheet width. Absent format, bare infinite, or an explicit 'normal' width
   // all resolve to the same 860px (see resolveDocumentSheetWidthPx), so an untouched document's
   // editor renders unchanged.
   const sheetWidthPx = resolveDocumentSheetWidthPx(format)

   // ==========================================================
   //  The paged (A4) page model
   // ==========================================================
   // `paged` = a non-infinite kind. In paged mode the flat section/block flow is partitioned into
   // discrete A4 sheets at the break markers (format.pages); infinite mode stays untouched and
   // byte-identical. The Section/Block model is never restructured, pages are derived.
   const paged        = !!format && format.kind !== 'infinite'
   const pageBreaks   = useMemo<PageBreak[]>(() => format?.pages ?? [], [format])

   // ==========================================================
   //  Measured pagination: automatic reflow of splittable blocks
   // ==========================================================
   // Paged geometry (the per-sheet render below resolves the same values locally). The available
   // content height is the A4 sheet height minus the top + bottom margins (uniform across pages). The
   // hook measures the rendered sheets and reflows the layout so a list runs across sheets at an item
   // boundary instead of jumping whole to the next page. MEASURED from the DOM, never predicted; the
   // reflow is a pure render derivation that never touches the serialized model.
   const pagedMargins            = format?.margins ?? DEFAULT_A4_MARGINS
   const pagedIsLandscape        = format?.kind === 'a4-landscape'
   const pagedSheetHeightPx      = pagedIsLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX
   const availableContentHeightPx = pagedSheetHeightPx
      - millimetresToPx(pagedMargins.top)
      - millimetresToPx(pagedMargins.bottom)

   const { containerRef: pagesContainerRef, pages: laidOutPages, tooTallPageIds } = usePagedLayout({
      enabled:         paged && !readOnly && !!onFormatChange,
      sections,
      forcedBreaks:    pageBreaks,
      availableHeight: availableContentHeightPx,
      heights:         measuredHeights ?? EMPTY_HEIGHTS,
      onHeightsChange: onMeasuredHeights ?? (() => {}),
      atomicBlockIds:  atomicBlockIds ?? EMPTY_ATOMIC_BLOCK_IDS,
      focusedParagraphId,
   })
   const derivedPages: Page[] | null = paged ? laidOutPages : null

   // ==========================================================
   //  Paragraph focus: "split at rest, whole when focused"
   // ==========================================================
   // An overflowing paragraph renders as read-only fragments across sheets; pressing one reflows it
   // whole (App holds it atomic) and places the caret where the press landed. The focused id lives in
   // App so the Pages panel agrees; here we drive the request / blur signals and the caret placement.
   //
   // `focusedParagraphIdRef` mirrors the prop but is written EAGERLY on request / clear, so the blur
   // that fires synchronously when focus hands off from one paragraph to another reads the incoming id
   // (not the outgoing render's stale prop) and correctly skips clearing.
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
      // Any paragraph editable gained focus (a direct click on a whole paragraph, or the reflowed
      // fragment once it mounts). Holding it as the focused id freezes measurement while it is edited, so
      // a paragraph typed past a page boundary from scratch is protected too, not only fragment reflows.
      setFocusedParagraph(blockId)
   }

   function notifyParagraphBlur(blockId: string): void {
      // Only clear when THIS paragraph is still the focused one: a press on another paragraph's fragment
      // (or a focus hand-off) has already moved the focused id forward, so its blur must not undo it.
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

   // Once the requested paragraph has reflowed to its single whole editable, focus it and drop the caret
   // at the pressed offset. rAF defers past the readOnly -> editable innerHTML re-injection so the text
   // nodes the caret addresses are present.
   useEffect(() => {
      const pending = pendingParagraphCaretRef.current
      if (!pending || pending.blockId !== focusedParagraphId) return
      const frame = requestAnimationFrame(() => {
         const element = document.querySelector<HTMLElement>(`[data-block-id="${pending.blockId}"] [data-rich]`)
         if (element) {
            element.focus()
            restoreSelectionRange(element, pending.caretOffset, pending.caretOffset)
         }
         pendingParagraphCaretRef.current = null
      })
      return () => cancelAnimationFrame(frame)
   }, [focusedParagraphId])

   // Build the format for a new page-break list, preserving kind/width/margins. An empty list drops the
   // `pages` key entirely (an untouched, non-default format stays clean). Pure, so the DnD paths can fold
   // it into a combined sections+format commit.
   function formatWithPageBreaks(nextPages: PageBreak[]): DocFormat | undefined {
      const base = normalizeFormat(format)
      if (nextPages.length === 0) {
         const { pages: _dropped, ...rest } = base
         return rest
      }
      return { ...base, pages: nextPages }
   }

   // Commit a new page-break list as a 'format' edit (the on-sheet remove button and the reconcile
   // fallback). Records under the shared 'format' undo kind.
   function commitPageBreaks(nextPages: PageBreak[]): void {
      if (!onFormatChange) return
      onFormatChange(formatWithPageBreaks(nextPages))
   }

   // Commit a block-menu break toggle under its own 'page-break' undo kind (falling back to 'format' if the
   // dedicated lever is absent), so an explicit break is a discrete step that never merges into a nearby
   // margin / width / band edit.
   function commitPageBreakEdit(nextPages: PageBreak[]): void {
      const commit = onPageBreakChange ?? onFormatChange
      if (!commit) return
      commit(formatWithPageBreaks(nextPages))
   }


   // Reconcile-on-change: re-anchor a break whose anchor block was deleted to its surviving
   // predecessor (a boundary stays put, leaving a blank page where its content is gone) and refresh a
   // stale sectionId. The previous flow is needed to find that predecessor, so it is tracked in a ref.
   // Inlined (not via commitPageBreaks) so the effect's own guard, only fire when the reconciled list
   // actually differs, keeps it loop-free.
   const previousSectionsRef = useRef(sections)
   useEffect(() => {
      // The reconcile write is a follow-on to whatever changed the flow (usually a block delete), not a
      // fresh user action, so it goes through the NON-recording setter to persist without a second undo
      // entry. Falls back to the recording committer only if the dedicated lever is not wired.
      const commitReconciled = onReconcileFormat ?? onFormatChange
      const previousSections = previousSectionsRef.current
      previousSectionsRef.current = sections
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
   }, [sections, format, onFormatChange, onReconcileFormat])

   // The page-break API the block context menu consumes (published via PageBreaksContext so the deep
   // WysiwygBlock subtree needn't be prop-drilled). Read-only surfaces (no onFormatChange) still
   // report `paged` for rendering but the mutating calls no-op.
   const pageBreaksApi: PageBreaksApi = {
      paged,
      canStartOnNewPage: blockId => canStartOnNewPage(sections, blockId),
      startsFreshPage:   blockId => blockStartsFreshPage(pageBreaks, sections, blockId),
      startOnNewPage:    blockId => commitPageBreakEdit(startBlockOnNewPage(pageBreaks, sections, blockId)),
      mergeWithPrevious: blockId => commitPageBreakEdit(mergeBlockWithPrevious(pageBreaks, sections, blockId)),
   }

   // The title element, factored out so the "beside" logo placement can wrap it inside the same
   // flex row without duplicating the PlainEditable props.
   const titleElement = (
      <PlainEditable
         tag="h1"
         content={meta.title || t.placeholderTitle}
         onBlur={value => onUpdateMeta({ title: value.trim() })}
         singleLine
         readOnly={readOnly}
         // Carve-out from the document background catch-all (bound on the outer canvas container):
         // stop the right-click here so it never bubbles into the document menu, WITHOUT
         // preventDefault, the title keeps the native browser context menu (copy/paste/spellcheck).
         onContextMenu={event => event.stopPropagation()}
      />
   )

   // Scope collisions to the active drag's kind: a section drag only sees section targets; a block
   // drag only sees block targets + the per-section bottom zones. Without this, closestCenter would
   // let a section drop resolve onto a block (and vice versa), producing a no-op or a wrong move.
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

      // Drop onto a blank page: the dragged block becomes that page's only content. Sections + breaks
      // commit together in ONE undo entry. Handled before the normal move since a blank page carries no
      // BlockLoc.
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

      // Drop onto a page-end zone: append the block after that page's last block (whether the page ends
      // mid-section or at a section end), and move the page boundary onto the appended block so it stays
      // on THIS page. This is the only append target for a page that ends inside a section.
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
            // Insert right after the page's last block (before its section successor, or appended when
            // the block ends the section).
            const successorId = anchorSection && anchorIndex >= 0 && anchorIndex < anchorSection.blocks.length - 1
               ? anchorSection.blocks[anchorIndex + 1].id : null
            let nextPages = reanchorMovedBlocks(pageBreaks, sections, [movedBlockId])
            if (hasPageBreakAfter(nextPages, anchorBlockId)) {
               nextPages = nextPages.map(pageBreak =>
                  pageBreak.after && pageBreak.after.blockId === anchorBlockId
                     ? { ...pageBreak, after: { sectionId: anchorSectionId!, blockId: movedBlockId } }
                     : pageBreak)
            }
            // Move + re-anchor commit together, so the whole drag is a single undo entry. relocateBlock is
            // the same pure transform moveBlockAcross runs, computed here so it can join the format write.
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
      // Paged: keep a boundary where the page ended when its own anchor block is dragged away (the moved
      // block that STARTS a page is not an anchor, so it needs no handling here), and commit the move +
      // the re-anchor together as ONE undo entry. Infinite: a plain sections-only move.
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
   // Background watermark layer, parametrized by <pattern> id so each paged sheet gets its own
   // collision-free id. Guarded on the optional field (an absent watermark means nothing renders).
   // The tiled and single branches match export.ts exactly (shared string builders), so editor +
   // export never drift.
   function renderWatermarkLayer(patternId: string): React.ReactNode {
      if (!presentation?.watermark?.src) return null
      const watermark = presentation.watermark
      if (watermark.tile) {
         return (
            <div
               aria-hidden="true"
               dangerouslySetInnerHTML={{ __html: renderWatermarkPatternSvg(watermark, docTheme, patternId) }}
            />
         )
      }
      const layout = resolveWatermarkLayout(watermark)
      return (
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
      )
   }

   // The page header (title / metadata zones / logo + the field color popover & menu). Renders once:
   // on the single infinite sheet, or on page 1 only in paged mode (matching a real document's first
   // page).
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

   // The empty-document state (no sections). Renders on the single sheet, or the last paged sheet.
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

   // The new-section affordance at the document tail (mirrors each section's add-block row). Renders on
   // the single sheet, or the last paged sheet.
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

   // Infinite mode: the whole section flow. The DnD context is the shared one on the canvas (see the
   // render), so this only owns the section SortableContext; readOnly renders a plain map (no DnD).
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
            {/* The last-slot target for section reorder: without it the noopStrategy + newIdx-1
                compensation can only land a dragged section BEFORE the last one. */}
            {activeSectionId != null && sections.length > 1 && (
               <BottomDropZone id="section-end-zone" data={{ type: 'section-zone' }} />
            )}
         </SortableContext>
      )
   }

   // One page slice (a section's contribution to a page) becomes a WysiwygSection over the subset.
   // A unique sortableId + sectionDragDisabled keep a split section's two slices from clashing dnd ids.
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

   // The running header / footer bands for one sheet: absolutely positioned rows in the top / bottom
   // margin band, on every page. Rendered from the SAME `renderPageBandHtml` the export uses (via
   // dangerouslySetInnerHTML) so editor and export never drift; the per-doc margin positions are inline.
   function renderBands(pageIndex: number, total: number, margins: PageMargins): React.ReactNode {
      const bandCtx = { pageIndex, pageCount: total, madeWith: t.madeWithDocuminter, pageWord: t.pageNumberWordPage, ofWord: t.pageNumberWordOf }
      const headerHtml = renderPageBandHtml(resolveHeader(format), bandCtx)
      // The editor shows only what the author placed (the optional footer page number); the Documinter
      // credit is stamped in on export only, so the editor reads the raw stored footer, not the derived
      // band that injects the credit.
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

   // One paged A4 sheet: sized to the kind's portrait/landscape px, inset by the margins, with a page
   // label and (for pages 2..N) a remove-break affordance. Page 1 carries the document header; the
   // last page carries the empty-state / tail add-section.
   function renderPageSheet(page: Page, pageIndex: number, total: number): React.ReactNode {
      const margins     = format?.margins ?? DEFAULT_A4_MARGINS
      const isLandscape = format?.kind === 'a4-landscape'
      const sheetWidth  = isLandscape ? A4_LANDSCAPE_WIDTH_PX  : A4_PORTRAIT_WIDTH_PX
      const sheetHeight = isLandscape ? A4_LANDSCAPE_HEIGHT_PX : A4_PORTRAIT_HEIGHT_PX
      const isLastPage  = pageIndex === total - 1
      // A page with no slices is an intentional blank page (a stacked / trailing break), EXCEPT the
      // empty document's sole page, which keeps its add-section empty state. So a slice-less page shows
      // the blank-page drop target whenever the document holds content or there is more than one page.
      const hasContent    = sections.some(section => section.blocks.length > 0)
      const showBlankDrop = page.slices.length === 0 && (hasContent || total > 1) && !readOnly && !!onFormatChange
      // The one overflow auto-reflow cannot resolve: a single atomic block taller than the whole sheet.
      // Surfaced only in edit mode (matching the hook's `enabled` gate) as a note, never a break.
      const showTooTall = !readOnly && !!onFormatChange && tooTallPageIds.has(page.id)
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
            <div className="doc-page-label">{t.formatPageLabel} {pageIndex + 1} / {total}</div>
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
               {/* The page's append target: dropping a block here puts it at the end of THIS page, even
                   when the page ends inside a section (the section bottom zone is suppressed in paged
                   mode). Only mounted mid block-drag on a page that holds content. */}
               {!showBlankDrop && !readOnly && onFormatChange && activeBlockId != null
                  && page.slices.some(slice => slice.blocks.length > 0) && (
                  <BottomDropZone id={`page-end-${page.id}`} data={{ type: 'page-end', pageId: page.id }} />
               )}
               {isLastPage && !showBlankDrop && (<>{renderEmptyDocState()}{renderTailAddSection()}</>)}
            </div>
            {/* The one overflow auto-reflow cannot resolve: a single atomic block (figure, table, code)
                taller than the whole sheet. Pinned to the bottom-margin line and absolutely positioned
                so it never alters page flow. Splittable blocks (paragraphs, lists) reflow automatically
                and never reach here. */}
            {showTooTall && (
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
            )}
         </div>
      )
   }

   // The document-level windows + the background context menu. Rendered ONCE (portaled / fixed), not
   // per paged sheet.
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
            {presentationOpen && onPresentationChange && onClosePresentation && (
               <PresentationWindow
                  presentation={presentation}
                  anchorRect={new DOMRect()}
                  onChange={onPresentationChange}
                  onClose={onClosePresentation}
               />
            )}
            {navOpen && onPresentationChange && onCloseNav && (
               <NavWindow
                  presentation={presentation}
                  sections={sections}
                  anchorRect={new DOMRect()}
                  onChange={onPresentationChange}
                  onClose={onCloseNav}
               />
            )}
            {formatOpen && onFormatChange && onCloseFormat && (
               <FormatWindow
                  format={format}
                  anchorRect={new DOMRect()}
                  onChange={onFormatChange}
                  onClose={onCloseFormat}
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
        <BlockEditorWindowProvider resetKey={activeTabKey}>
         <ParagraphFocusProvider value={paragraphFocusValue}>
         <PageBreaksContext.Provider value={pageBreaksApi}>
         <div className="flex flex-col h-full min-h-0 w-full">
         {!readOnly && <FormatToolbar sections={sections} />}
         <div className="flex-1 min-h-0 w-full flex">
         <div
            className="flex-1 h-full overflow-y-auto px-6"
            style={{ background: 'var(--color-canvas)' }}
            onContextMenu={handleBackgroundContextMenu}
         >
            {(() => {
               // The canvas body: paged sheets or the single infinite sheet. Both modes render blocks
               // through WysiwygSection, whose block SortableContexts all live under the ONE shared DnD
               // context below (so a drag can cross sections and, in paged mode, sheets).
               const canvasBody = paged && derivedPages ? (
                  // Paged (A4) mode: the flat flow partitioned into stacked A4 sheets.
                  <div className="doc-pages" ref={pagesContainerRef}>
                     {derivedPages.map((page, pageIndex) => renderPageSheet(page, pageIndex, derivedPages.length))}
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
                         The overlay is hoisted out of the .doc-render sheet, so it re-establishes the
                         doc theme scope (.doc-dark + --doc-accent + a padding-less .doc-render) itself;
                         otherwise the ghost text would render in the app theme, unreadable on a dark doc. */}
                     <DragOverlay>
                        {activeBlockId && (() => {
                           // Find the dragged block across section bodies AND container columns (an inner
                           // block isn't in section.blocks) so the ghost renders for both.
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
         </div>
         </div>
         </PageBreaksContext.Provider>
         </ParagraphFocusProvider>
        </BlockEditorWindowProvider>
       </DocThemeProvider>
       </LinkableTablesProvider>
       </DocumentTablesProvider>
      </DocumentHandlesProvider>
   )
}

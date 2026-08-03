// -- React Imports --
import { useState, useMemo, useId, useEffect } from 'react'
import type React from 'react'

// -- Library Imports --
import { DndContext, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

const noopStrategy: SortingStrategy = () => null

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { DocumentHandlesProvider } from '../../contexts/DocumentHandlesContext'
import { DocumentTablesProvider, LinkableTablesProvider } from '../../contexts/DocumentTablesContext'
import { DocThemeProvider } from '../../contexts/DocThemeContext'
import { BlockEditorWindowProvider } from '../../contexts/BlockEditorWindowContext'
import { PageBreaksContext, type PageBreaksApi } from '../../contexts/PageBreaksContext'
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { SquareDashed, Plus, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, EyeOff, Palette, Scissors } from 'lucide-react'
import { PlainEditable } from '../../atoms/PlainEditable'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { MetaFieldColorPopover } from '../../molecules/MetaFieldColorPopover'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'
import { PresentationWindow } from '../../molecules/PresentationWindow'
import { NavWindow } from '../../molecules/NavWindow'
import { FormatWindow } from '../../molecules/FormatWindow'
import { WysiwygSection } from './WysiwygSection'

// -- Type Imports --
import { collectTableSources, collectLinkableTables } from '../../lib/graphTableData'
import { buildDocumentMenuEntries } from '../../lib/documentMenuEntries'
import { resolveWatermarkLayout, effectiveWatermarkOpacity, renderWatermarkPatternSvg, watermarkTransform, headerJustifyContent, resolveHeaderBesideLayout, type DocPresentationExtras } from '../../lib/presentation'
import { resolveDocumentSheetWidthPx, normalizeFormat, DEFAULT_A4_MARGINS, type DocFormat, type PageBreak } from '../../lib/format'
import {
   partitionIntoPages, reconcilePages, millimetresToPx,
   canBreakAfter, hasPageBreakAfter, addPageBreakAfter, removePageBreakAfter, removePageBreak,
   A4_PORTRAIT_WIDTH_PX, A4_PORTRAIT_HEIGHT_PX, A4_LANDSCAPE_WIDTH_PX, A4_LANDSCAPE_HEIGHT_PX,
   type Page, type PageSlice,
} from '../../lib/pageModel'
import type { DocMeta, Mode, Section } from '../../types'

import './doc.css'

interface WysiwygAreaProps {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   /** Export-only / editor-only presentation extras (watermark, …); undefined = none set. */
   presentation?: DocPresentationExtras
   /** Document page format (infinite canvas width, later paged A4); undefined = today's infinite/
    *  normal-width behavior. */
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
   /** Commit the document's presentation extras (watermark, …); undefined clears them. */
   onPresentationChange?: (next: DocPresentationExtras | undefined) => void
   /** Commit the document's page format (infinite width, later paged A4); undefined clears it. */
   onFormatChange?: (next: DocFormat | undefined) => void
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
   //  Document top-bar menu. Phase 1: infinite-width control only (kind is implicitly infinite).
   // ==========================================================
   formatOpen?:      boolean
   onOpenFormat?:    () => void
   onCloseFormat?:   () => void
   /** Editor/preview toggle, for the background menu's optional "Toggle preview" item. */
   previewMode?: Mode
   onSetMode?:   (mode: Mode) => void
}

export function WysiwygArea({
   meta, sections, docTheme, docAccent, presentation, format, activeTabKey, onUpdateMeta, onAddSection, readOnly,
   onDocThemeChange, onDocAccentChange, onPresentationChange, onFormatChange, onOpenExport, onManualSave, onSaveAs,
   presentationOpen, onOpenPresentation, onClosePresentation,
   navOpen, onOpenNav, onCloseNav,
   formatOpen, onOpenFormat, onCloseFormat,
   previewMode, onSetMode,
}: WysiwygAreaProps) {
   const { t } = useLang()
   const { reorderSections } = useDocumentMutations()

   // A stable, collision-free id for this sheet's tiled-watermark SVG <pattern> (React's useId,
   // unique per component instance, colons stripped since the id rides inside a raw `url(#…)`
   // string), guards against <defs> id clashes if multiple watermarked sheets are ever mounted
   // at once.
   const watermarkPatternId = `doc-watermark-pattern-${useId().replace(/:/g, '')}`

   // Header logo (presentation): rendered in .page-header, above or beside the title. undefined ⇒
   // no logo, today's behavior.
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
   // reused to anchor the color popover when the menu's Color… item is chosen.
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
   // accent…" sets this surface's own selected-flag (and clicking a preset clears it), and the
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
   // Toggle whether the label renders in the read view + export. Default (absent/true) → false
   // drops the label key back to the default when it flips true again, keeping the model clean.
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

   // The full "Link to a table…" picker listing (stage 2b, the editor UX): every table, handled or
   // not, with enough addressing to route a link/handle-assignment mutation back at a pick. Same
   // `useMemo`-over-`sections` seam as `documentTables`, one axis over (see `LinkableTable`).
   const linkableTables = useMemo(() => collectLinkableTables(sections), [sections])

   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
   const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

   // Document Formats Phase 1: the infinite-canvas sheet width. Absent format / bare infinite / an
   // explicit 'normal' width all resolve to the SAME 860px this sheet already rendered at before the
   // feature existed (see resolveDocumentSheetWidthPx), so an untouched document's editor is visually
   // unchanged.
   const sheetWidthPx = resolveDocumentSheetWidthPx(format)

   // ==========================================================
   //  Document Formats Phase 2: the paged (A4) page model
   // ==========================================================
   // `paged` = a non-infinite kind. In paged mode the flat section/block flow is partitioned into
   // discrete A4 sheets at the break markers (format.pages); infinite mode is untouched (byte-
   // identical to Phase 1). The Section/Block model is never restructured, pages are derived.
   const paged        = !!format && format.kind !== 'infinite'
   const pageBreaks   = useMemo<PageBreak[]>(() => format?.pages ?? [], [format])
   const derivedPages = useMemo<Page[] | null>(
      () => paged ? partitionIntoPages(sections, pageBreaks) : null,
      [paged, sections, pageBreaks],
   )

   // Commit a new page-break list back through onFormatChange, preserving kind/width/margins. An empty
   // list drops the `pages` key entirely (an untouched, non-default format stays clean).
   function commitPageBreaks(nextPages: PageBreak[]): void {
      if (!onFormatChange) return
      const base = normalizeFormat(format)
      if (nextPages.length === 0) {
         const { pages: _dropped, ...rest } = base
         onFormatChange(rest)
      } else {
         onFormatChange({ ...base, pages: nextPages })
      }
   }

   // Reconcile-on-change: drop any break whose anchor block was deleted/undone (mirrors reconcileNav),
   // so a dangling marker can never leave a phantom cut. Inlined (not via commitPageBreaks) so the
   // effect's own guard, only fire when the reconciled list actually differs, keeps it loop-free.
   useEffect(() => {
      const currentPages = format?.pages
      if (!onFormatChange || !currentPages || currentPages.length === 0) return
      const reconciled = reconcilePages(currentPages, sections)
      const changed = reconciled.length !== currentPages.length
         || reconciled.some((entry, index) =>
               entry.id !== currentPages[index].id
            || entry.before.blockId !== currentPages[index].before.blockId
            || entry.before.sectionId !== currentPages[index].before.sectionId)
      if (!changed) return
      const base = normalizeFormat(format)
      if (reconciled.length === 0) {
         const { pages: _dropped, ...rest } = base
         onFormatChange(rest)
      } else {
         onFormatChange({ ...base, pages: reconciled })
      }
   }, [sections, format, onFormatChange])

   // The page-break API the block context menu consumes (published via PageBreaksContext so the deep
   // WysiwygBlock subtree needn't be prop-drilled). Read-only surfaces (no onFormatChange) still
   // report `paged` for rendering but the mutating calls no-op.
   const pageBreaksApi: PageBreaksApi = {
      paged,
      canBreakAfter:    blockId => canBreakAfter(sections, blockId),
      hasBreakAfter:    blockId => hasPageBreakAfter(pageBreaks, sections, blockId),
      insertBreakAfter: blockId => commitPageBreaks(addPageBreakAfter(pageBreaks, sections, blockId)),
      removeBreakAfter: blockId => commitPageBreaks(removePageBreakAfter(pageBreaks, sections, blockId)),
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

   function handleDragStart(event: DragStartEvent) {
      setActiveSectionId(String(event.active.id))
   }

   function handleDragEnd(event: DragEndEvent) {
      setActiveSectionId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = sections.findIndex(section => section.id === active.id)
      const newIdx = sections.findIndex(section => section.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1) {
         const adjustedIdx = oldIdx < newIdx ? newIdx - 1 : newIdx
         reorderSections(oldIdx, adjustedIdx)
      }
   }

   // ==========================================================
   //  Render helpers (shared by the infinite single sheet + the paged A4 sheets)
   // ==========================================================
   // Background watermark layer, parametrized by <pattern> id so each paged sheet gets its own
   // collision-free id. Guarded on the optional field (absent watermark ⇒ nothing renders). The tiled
   // and single branches match export.ts exactly (shared string builders), so editor + export never
   // drift.
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

   // Infinite mode: the whole section flow (readOnly plain map, else the section-reorder DndContext),
   // exactly as before this phase.
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
         <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveSectionId(null)}>
            <SortableContext items={sections.map(section => section.id)} strategy={noopStrategy}>
               {sections.map((sec, index) => (
                  <div key={sec.id}>
                     <WysiwygSection section={sec} index={index} isLastSection={index === sections.length - 1} activeSectionId={activeSectionId} />
                  </div>
               ))}
            </SortableContext>
         </DndContext>
      )
   }

   // One page slice (a section's contribution to a page) → a WysiwygSection over the subset. A unique
   // sortableId + sectionDragDisabled keep a split section's two slices from clashing dnd ids.
   function renderPageSlice(slice: PageSlice, page: Page): React.ReactNode {
      const sectionIndex = sections.findIndex(candidate => candidate.id === slice.section.id)
      return (
         <WysiwygSection
            key={`${slice.section.id}::${page.id}`}
            section={slice.section}
            index={sectionIndex}
            isLastSection={sectionIndex === sections.length - 1}
            activeSectionId={null}
            readOnly={readOnly}
            renderBlocks={slice.blocks}
            showTitle={slice.isSectionStart}
            showAddRow={slice.isSectionEnd}
            sortableId={`${slice.section.id}::${page.id}`}
            sectionDragDisabled
         />
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
      return (
         <div
            key={page.id}
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
            {pageIndex > 0 && !readOnly && onFormatChange && (
               <button
                  type="button"
                  className="doc-page-break-remove"
                  title={t.formatRemovePageBreak}
                  onClick={() => commitPageBreaks(removePageBreak(pageBreaks, page.id))}
               >
                  <Scissors size={13} />
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
               {page.slices.map(slice => renderPageSlice(slice, page))}
               {isLastPage && (<>{renderEmptyDocState()}{renderTailAddSection()}</>)}
            </div>
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
         <PageBreaksContext.Provider value={pageBreaksApi}>
         {!readOnly && <FormatToolbar sections={sections} />}
         <div
            className="flex-1 h-full w-full overflow-y-auto px-6"
            style={{ background: 'var(--color-canvas)' }}
            onContextMenu={handleBackgroundContextMenu}
         >
            {paged && derivedPages ? (
               // Paged (A4) mode: the flat flow partitioned into stacked A4 sheets. Infinite mode
               // (below) is untouched, byte-identical to Phase 1.
               <div className="doc-pages">
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
            )}
            {renderDocWindowsAndMenus()}
         </div>
         </PageBreaksContext.Provider>
        </BlockEditorWindowProvider>
       </DocThemeProvider>
       </LinkableTablesProvider>
       </DocumentTablesProvider>
      </DocumentHandlesProvider>
   )
}

// -- React Imports --
import { useState, useMemo, useEffect } from 'react'
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
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { SquareDashed, Plus, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, EyeOff, Palette, Sun, Moon, Download, Save, FileDown } from 'lucide-react'
import { ColorPicker } from 'react-piqua-color'
import { createPortal } from 'react-dom'
import { PlainEditable } from '../../atoms/PlainEditable'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { MetaFieldColorPopover } from '../../molecules/MetaFieldColorPopover'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'
import { WysiwygSection } from './WysiwygSection'

// -- Hook Imports --
import { useViewportClampedPosition } from '../../hooks/useViewportClampedPosition'

// -- Type Imports --
import { collectTableSources, collectLinkableTables } from '../../lib/graphTableData'
import { ACCENT_PRESETS, accentPresetName } from '../../lib/constants'
import type { DocMeta, Mode, Section } from '../../types'

import './doc.css'

interface WysiwygAreaProps {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   /** Active tab key; a change closes any open block-editor window (it belongs to the outgoing tab). */
   activeTabKey?: string
   onUpdateMeta:  (patch: Partial<DocMeta>) => void
   onAddSection?: () => void
   readOnly?: boolean
   // ==========================================================
   //  Document-level actions, reused (not reimplemented) by the background context menu — the
   //  exact same handlers App.tsx already threads into HeaderMenuBar.
   // ==========================================================
   onDocThemeChange?:  (theme: 'light' | 'dark') => void
   onDocAccentChange?: (hex: string) => void
   /** Opens the same File -> Export... / Ctrl+E dialog owned by App.tsx. */
   onOpenExport?: () => void
   onManualSave?: () => void
   /** Opens the same File -> Save As... dialog owned by App.tsx (fork-and-switch to a copy). */
   onSaveAs?: () => void
   /** Editor/preview toggle, for the background menu's optional "Toggle preview" item. */
   previewMode?: Mode
   onSetMode?:   (mode: Mode) => void
}

export function WysiwygArea({
   meta, sections, docTheme, docAccent, activeTabKey, onUpdateMeta, onAddSection, readOnly,
   onDocThemeChange, onDocAccentChange, onOpenExport, onManualSave, onSaveAs, previewMode, onSetMode,
}: WysiwygAreaProps) {
   const { t } = useLang()
   const { reorderSections } = useDocumentMutations()

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
   // ANYWHERE on the document background — the gutter around the sheet, the sheet's own padding,
   // gaps between/around/below sections, and empty space inside a section. It relies on
   // propagation, not a target check: a right-click on a block (useBlockContextMenu's
   // openContextMenu) or on section chrome (WysiwygSection's handleSectionContextMenu) already
   // calls stopPropagation, so those never reach this handler — see the field-menu stopPropagation
   // just below for the third source that needed the same guard added. Bound in BOTH editor and
   // preview (readOnly) mode — it's the one menu preview keeps reachable (blocks/sections/fields
   // already self-disable their own context menus under readOnly, see WysiwygSection.tsx /
   // WysiwygBlock.tsx), so a right-click still reaches theme/accent/export/save/preview-toggle.
   const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null)
   // The document accent's custom-color popover, opened as a follow-on state once the background
   // menu's "Custom accent…" item is picked (the ContextMenu already closed itself by then — same
   // follow-on pattern CalloutStylePicker's custom-color swatch uses). Anchored at the same click
   // point the background menu itself opened at.
   const [accentPopover, setAccentPopover] = useState<{ x: number; y: number } | null>(null)

   function handleBackgroundContextMenu(event: React.MouseEvent) {
      event.preventDefault()
      setBackgroundMenu({ x: event.clientX, y: event.clientY })
   }

   function buildBackgroundMenuEntries(): ContextMenuEntry[] {
      const entries: ContextMenuEntry[] = []

      if (onAddSection) {
         // Nonsensical in preview (nothing to insert into an inert, read-only render) — kept in
         // the menu but disabled, rather than removed, per the task's explicit guidance.
         entries.push({ label: t.bgMenuAddSection, icon: <Plus size={13} />, onSelect: onAddSection, disabled: !!readOnly })
      }

      if (onDocThemeChange) {
         if (entries.length > 0) entries.push({ type: 'separator' })
         entries.push({
            label:    docTheme === 'dark' ? t.toLightMode : t.toDarkMode,
            icon:     docTheme === 'dark' ? <Sun size={13} /> : <Moon size={13} />,
            onSelect: () => onDocThemeChange(docTheme === 'dark' ? 'light' : 'dark'),
         })
      }

      if (onDocAccentChange) {
         entries.push({ type: 'header', label: t.accent })
         for (const color of ACCENT_PRESETS) {
            entries.push({
               label:    accentPresetName(color, t),
               icon:     <span className="inline-block w-3 h-3 rounded-full border border-border" style={{ background: color }} />,
               onSelect: () => onDocAccentChange(color),
            })
         }
         entries.push({
            label:    t.bgMenuCustomAccent,
            icon:     <Palette size={13} />,
            onSelect: () => { if (backgroundMenu) setAccentPopover(backgroundMenu) },
         })
      }

      const hasActions = !!onOpenExport || !!onManualSave || !!onSaveAs || !!onSetMode
      if (hasActions && entries.length > 0) entries.push({ type: 'separator' })
      if (onOpenExport) entries.push({ label: t.menuExport,  icon: <Download size={13} />, onSelect: onOpenExport })
      if (onManualSave) entries.push({ label: t.fileSave,    icon: <Save size={13} />,     onSelect: onManualSave })
      if (onSaveAs)     entries.push({ label: t.fileSaveAs,  icon: <FileDown size={13} />, onSelect: onSaveAs })
      if (onSetMode) {
         entries.push({
            label:    t.previewMode,
            icon:     previewMode === 'preview' ? <EyeOff size={13} /> : <Eye size={13} />,
            onSelect: () => onSetMode('preview'),
         })
      }

      return entries
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
                     // catch-all context menu (bound higher up, on the outer canvas container) —
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

   return (
      <DocumentHandlesProvider handles={allHandles}>
       <DocumentTablesProvider tables={documentTables}>
       <LinkableTablesProvider tables={linkableTables}>
       <DocThemeProvider theme={docTheme}>
        <BlockEditorWindowProvider resetKey={activeTabKey}>
         {!readOnly && <FormatToolbar sections={sections} />}
         <div
            className="flex-1 h-full w-full overflow-y-auto px-6"
            style={{ background: 'var(--color-canvas)' }}
            onContextMenu={handleBackgroundContextMenu}
         >
            <div
               className={`max-w-215 mx-auto min-h-[92%] my-8 shadow-lg rounded-sm border-t-4 ${docTheme === 'dark' ? 'doc-dark' : ''}`}
               style={{
                  background: 'var(--doc-canvas-bg)',
                  borderTopColor: docAccent,
                  '--doc-accent': docAccent,
               } as React.CSSProperties}
            >
            <div className="doc-render">
               <div className="page-header">
                  {readOnly ? renderReadonlyZone('above') : renderEditorZone('above')}
                  <PlainEditable
                     tag="h1"
                     content={meta.title || t.placeholderTitle}
                     onBlur={value => onUpdateMeta({ title: value.trim() })}
                     singleLine
                     readOnly={readOnly}
                     // Carve-out from the document background catch-all (bound on the outer canvas
                     // container): stop the right-click here so it never bubbles into the document
                     // menu, WITHOUT preventDefault — the title keeps the native browser context
                     // menu (copy/paste/spellcheck) instead.
                     onContextMenu={event => event.stopPropagation()}
                  />
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

               {sections.length === 0 && (
                  !readOnly && onAddSection ? (
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
               )}

               {readOnly ? (
                  <>
                     {sections.map((sec, index) => (
                        <div key={sec.id}>
                           <WysiwygSection section={sec} index={index} isLastSection={index === sections.length - 1} activeSectionId={null} readOnly />
                        </div>
                     ))}
                  </>
               ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveSectionId(null)}>
                     <SortableContext items={sections.map(section => section.id)} strategy={noopStrategy}>
                        {sections.map((sec, index) => (
                           <div key={sec.id}>
                              <WysiwygSection section={sec} index={index} isLastSection={index === sections.length - 1} activeSectionId={activeSectionId} />
                           </div>
                        ))}
                     </SortableContext>
                  </DndContext>
               )}

               {/* New-section affordance at the document tail, mirrors each section's add-block row */}
               {!readOnly && onAddSection && sections.length > 0 && (
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
               )}

               {backgroundMenu && (
                  <ContextMenu
                     position={backgroundMenu}
                     entries={buildBackgroundMenuEntries()}
                     onClose={() => setBackgroundMenu(null)}
                  />
               )}

               {accentPopover && onDocAccentChange && (
                  <DocumentAccentPopover
                     anchorPoint={accentPopover}
                     value={docAccent}
                     title={t.bgMenuCustomAccentTitle}
                     onPick={onDocAccentChange}
                     onClose={() => setAccentPopover(null)}
                  />
               )}
            </div>
            </div>
         </div>
        </BlockEditorWindowProvider>
       </DocThemeProvider>
       </LinkableTablesProvider>
       </DocumentTablesProvider>
      </DocumentHandlesProvider>
   )
}

// #####################################
// # DOCUMENT ACCENT CUSTOM COLOR POPOVER #
// #####################################

interface DocumentAccentPopoverProps {
   /** Viewport point to anchor at — the same click point the background menu itself opened at. */
   anchorPoint: { x: number; y: number }
   value:       string
   title:       string
   onPick:      (hex: string) => void
   onClose:     () => void
}

/**
 * Floating color popover for the document background menu's "Custom accent…" item. Mirrors
 * CalloutStylePicker's CalloutColorPopover shell (same react-piqua-color ColorPicker, same
 * portal + outside-pointerdown/Escape dismissal) but anchors at a viewport point rather than a
 * trigger element's rect, since the menu item that opened it no longer exists in the DOM by the
 * time this renders (ContextMenu closes itself on select).
 */
function DocumentAccentPopover({ anchorPoint, value, title, onPick, onClose }: DocumentAccentPopoverProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({ type: 'point', x: anchorPoint.x, y: anchorPoint.y })

   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         if (ref.current?.contains(event.target as Node)) return
         onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      return () => document.removeEventListener('pointerdown', handlePointerDown)
   }, [onClose, ref])

   return createPortal(
      <div
         ref={ref}
         className="fixed z-[9999] w-62 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         <div className="px-2 pt-2 pb-1.5">
            <span className="text-[0.7rem] uppercase tracking-wider text-muted/70 font-semibold select-none">{title}</span>
         </div>
         <div className="p-2 border-t border-border">
            <ColorPicker value={value} onChange={onPick} />
         </div>
      </div>,
      document.body,
   )
}

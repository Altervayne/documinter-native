// -- React Imports --
import { useState, useMemo } from 'react'
import type React from 'react'

// -- Library Imports --
import { DndContext, closestCenter, type DragEndEvent, type DragStartEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable'

const noopStrategy: SortingStrategy = () => null

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { DocumentHandlesProvider } from '../../contexts/DocumentHandlesContext'
import { DocThemeProvider } from '../../contexts/DocThemeContext'
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { SquareDashed, Plus, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, EyeOff, Palette } from 'lucide-react'
import { PlainEditable } from '../../atoms/PlainEditable'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { MetaFieldColorPopover } from '../../molecules/MetaFieldColorPopover'
import { ContextMenu } from '../../molecules/ContextMenu'
import type { ContextMenuEntry } from '../../molecules/ContextMenu'
import { WysiwygSection } from './WysiwygSection'

// -- Type Imports --
import type { DocMeta, Section } from '../../types'

import './doc.css'

interface WysiwygAreaProps {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   onUpdateMeta:  (patch: Partial<DocMeta>) => void
   onAddSection?: () => void
   readOnly?: boolean
}

export function WysiwygArea({ meta, sections, docTheme, docAccent, onUpdateMeta, onAddSection, readOnly }: WysiwygAreaProps) {
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
       <DocThemeProvider theme={docTheme}>
         {!readOnly && <FormatToolbar sections={sections} />}
         <div className="flex-1 h-full w-full overflow-y-auto px-6" style={{ background: 'var(--color-canvas)' }}>
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
                           <WysiwygSection section={sec} index={index} activeSectionId={null} readOnly />
                        </div>
                     ))}
                  </>
               ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveSectionId(null)}>
                     <SortableContext items={sections.map(section => section.id)} strategy={noopStrategy}>
                        {sections.map((sec, index) => (
                           <div key={sec.id}>
                              <WysiwygSection section={sec} index={index} activeSectionId={activeSectionId} />
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
            </div>
            </div>
         </div>
       </DocThemeProvider>
      </DocumentHandlesProvider>
   )
}

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
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { SquareDashed, Plus, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Eye, EyeOff } from 'lucide-react'
import { PlainEditable } from '../../atoms/PlainEditable'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { MetaFieldColorPopover } from '../../molecules/MetaFieldColorPopover'
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

   // Which field's color popover is open, plus the swatch rect that anchors it.
   const [colorPopover, setColorPopover] = useState<{ fieldId: string; rect: DOMRect } | null>(null)

   function updateField(id: string, patch: Partial<{ label: string; value: string }>) {
      onUpdateMeta({ fields: fields.map(field => field.id === id ? { ...field, ...patch } : field) })
   }
   function addField(position: 'above' | 'below') {
      onUpdateMeta({ fields: [...fields, { id: crypto.randomUUID(), label: '', value: '', position }] })
   }
   function removeField(id: string) {
      onUpdateMeta({ fields: fields.filter(field => field.id !== id) })
      setColorPopover(current => current?.fieldId === id ? null : current)
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

   // ==========================================================
   //  Metadata zone renderers (above / below the title)
   // ==========================================================
   function renderEditorZone(position: 'above' | 'below') {
      const zoneFields = fields.filter(field => field.position === position)
      return (
         <div className={`page-meta-editor page-meta-editor-${position}`}>
            {zoneFields.map((field, zoneIndex) => (
               <div key={field.id} className="page-meta-field" style={{ color: resolveFieldColor(field.color) }}>
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
                  <span className="page-meta-field-controls" contentEditable={false}>
                     <button
                        type="button"
                        data-meta-color-trigger
                        className="page-meta-field-swatch"
                        aria-label={t.fieldColorLabel}
                        style={{ background: resolveFieldColor(field.color) ?? '#9ca3af' }}
                        onClick={event => {
                           const rect = event.currentTarget.getBoundingClientRect()
                           setColorPopover(current => current?.fieldId === field.id ? null : { fieldId: field.id, rect })
                        }}
                     />
                     <button
                        type="button"
                        aria-label={field.showLabel === false ? t.showFieldLabel : t.hideFieldLabel}
                        onClick={() => toggleFieldLabel(field.id)}
                     >
                        {field.showLabel === false ? <EyeOff size={13} /> : <Eye size={13} />}
                     </button>
                     <button
                        type="button"
                        aria-label={t.moveLeft}
                        disabled={zoneIndex === 0}
                        onClick={() => moveFieldWithinZone(field.id, -1)}
                     >
                        <ChevronLeft size={13} />
                     </button>
                     <button
                        type="button"
                        aria-label={t.moveRight}
                        disabled={zoneIndex === zoneFields.length - 1}
                        onClick={() => moveFieldWithinZone(field.id, 1)}
                     >
                        <ChevronRight size={13} />
                     </button>
                     <button
                        type="button"
                        aria-label={t.flipFieldZone}
                        onClick={() => flipFieldZone(field.id)}
                     >
                        {position === 'above' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                     </button>
                     <button
                        type="button"
                        aria-label={t.deleteField}
                        onClick={() => removeField(field.id)}
                     >
                        <X size={13} />
                     </button>
                  </span>
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
            </div>
            </div>
         </div>
      </DocumentHandlesProvider>
   )
}

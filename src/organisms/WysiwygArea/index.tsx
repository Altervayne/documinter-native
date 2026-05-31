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
import { ContentEditable } from '../../atoms/ContentEditable'
import { FormatToolbar } from '../../molecules/FormatToolbar'
import { WysiwygSection } from './WysiwygSection'

// -- Type Imports --
import type { DocMeta, Section } from '../../types'

import './doc.css'

interface WysiwygAreaProps {
   meta:      DocMeta
   sections:  Section[]
   docTheme:  'light' | 'dark'
   docAccent: string
   onUpdateMeta: (patch: Partial<DocMeta>) => void
   readOnly?: boolean
}

export function WysiwygArea({ meta, sections, docTheme, docAccent, onUpdateMeta, readOnly }: WysiwygAreaProps) {
   const { t } = useLang()
   const { reorderSections } = useDocumentMutations()

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
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-canvas)' }}>
         <div
            className={`max-w-215 mx-auto my-8 shadow-lg rounded-sm border-t-4 ${docTheme === 'dark' ? 'doc-dark' : ''}`}
            style={{
               background: docTheme === 'dark' ? '#161b22' : '#ffffff',
               borderTopColor: docAccent,
               '--doc-accent': docAccent,
            } as React.CSSProperties}
         >
         <div className="doc-render">
            {/* Page header */}
            <div className="page-header">
               <ContentEditable
                  tag="div"
                  className="page-module"
                  content={meta.module || t.placeholderModule}
                  onBlur={value => onUpdateMeta({ module: value.trim() })}
                  singleLine
                  readOnly={readOnly}
               />
               <ContentEditable
                  tag="h1"
                  content={meta.title || t.placeholderTitle}
                  onBlur={value => onUpdateMeta({ title: value.trim() })}
                  singleLine
                  readOnly={readOnly}
               />
               <div className="page-meta">
                  <ContentEditable
                     tag="span"
                     content={meta.env || t.placeholderEnv}
                     onBlur={value => onUpdateMeta({ env: value.trim() })}
                     singleLine
                     readOnly={readOnly}
                  />
                  <ContentEditable
                     tag="span"
                     content={meta.date ? `${t.prefixUpdated} ${meta.date}` : t.placeholderDate}
                     onBlur={value => {
                        const stripped = value.startsWith(t.prefixUpdated)
                           ? value.slice(t.prefixUpdated.length).trim()
                           : value.replace(/^[^:]+:\s*/, '').trim() || value.trim()
                        onUpdateMeta({ date: stripped })
                     }}
                     singleLine
                     readOnly={readOnly}
                  />
                  <ContentEditable
                     tag="span"
                     content={meta.author ? `${t.prefixAuthor} ${meta.author}` : t.placeholderAuthor}
                     onBlur={value => {
                        const stripped = value.startsWith(t.prefixAuthor)
                           ? value.slice(t.prefixAuthor.length).trim()
                           : value.replace(/^[^:]+:\s*/, '').trim() || value.trim()
                        onUpdateMeta({ author: stripped })
                     }}
                     singleLine
                     readOnly={readOnly}
                  />
               </div>
            </div>

            {/* Empty state */}
            {sections.length === 0 && (
               <div className="wysiwyg-empty">
                  <strong>{t.nothingYet}</strong>
                  <code style={{ background: `color-mix(in srgb, ${docAccent} 10%, ${docTheme === 'dark' ? '#161b22' : '#fff'})`, color: docAccent, padding: '0.1em 0.35em', borderRadius: 3, fontSize: '0.85em' }}>+ {t.addSection}</code> {t.nothingYetHint}
               </div>
            )}

            {/* Sections */}
            {readOnly ? (
               <>
                  {sections.map((sec, index) => (
                     <div key={sec.id}>
                        <WysiwygSection section={sec} index={index} activeSectionId={null} readOnly />
                        {index < sections.length - 1 && <hr />}
                     </div>
                  ))}
               </>
            ) : (
               <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveSectionId(null)}>
                  <SortableContext items={sections.map(section => section.id)} strategy={noopStrategy}>
                     {sections.map((sec, index) => (
                        <div key={sec.id}>
                           <WysiwygSection section={sec} index={index} activeSectionId={activeSectionId} />
                           {index < sections.length - 1 && <hr />}
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

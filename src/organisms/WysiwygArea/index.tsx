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
import { SquareDashed } from 'lucide-react'
import { PlainEditable } from '../../atoms/PlainEditable'
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
   onUpdateMeta:  (patch: Partial<DocMeta>) => void
   onAddSection?: () => void
   readOnly?: boolean
}

export function WysiwygArea({ meta, sections, docTheme, docAccent, onUpdateMeta, onAddSection, readOnly }: WysiwygAreaProps) {
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
                  <PlainEditable
                     tag="div"
                     className="page-module"
                     content={meta.module || t.placeholderModule}
                     onBlur={value => onUpdateMeta({ module: value.trim() })}
                     singleLine
                     readOnly={readOnly}
                  />
                  <PlainEditable
                     tag="h1"
                     content={meta.title || t.placeholderTitle}
                     onBlur={value => onUpdateMeta({ title: value.trim() })}
                     singleLine
                     readOnly={readOnly}
                  />
                  <div className="page-meta">
                     <PlainEditable
                        tag="span"
                        content={meta.env || t.placeholderEnv}
                        onBlur={value => onUpdateMeta({ env: value.trim() })}
                        singleLine
                        readOnly={readOnly}
                     />
                     <PlainEditable
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
                     <PlainEditable
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

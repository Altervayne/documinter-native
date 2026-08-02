// -- React Imports --
import type React from 'react'

// -- Library Imports --
import { Trash2, GripVertical, Eye, EyeOff, Link2, Globe, Minus, RotateCcw, PanelLeft } from 'lucide-react'

// -- DnD Imports --
import {
   DndContext, closestCenter,
   PointerSensor, useSensor, useSensors,
   type DragEndEvent, type Modifier,
} from '@dnd-kit/core'
import {
   SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Component / Hook Imports --
import { BlockEditorWindow } from './BlockEditorWindow'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import type { Section } from '../types'
import {
   reconcileNavEntries,
   type DocPresentationExtras,
   type NavModel,
   type NavEntry,
   type NavAutoEntry,
   type NavCustomEntry,
   type NavDivider,
} from '../lib/presentation'

// #########
// # TYPES #
// #########

interface NavWindowProps {
   /** The active document's presentation extras (undefined = none set yet). */
   presentation?: DocPresentationExtras
   /** The live section list — the nav editor reconciles + mirrors it (renames, new/deleted sections). */
   sections: Section[]
   /** The anchor rect the window opens offset from (a degenerate rect = viewport-centered). */
   anchorRect: DOMRect
   /** Commit a new extras object (or undefined to clear all extras) — a real document change. */
   onChange: (next: DocPresentationExtras | undefined) => void
   /** Close the window. */
   onClose: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * The document-level Navigation editor: a NON-MODAL draggable window (reusing BlockEditorWindow /
 * useDraggableWindow) whose controls mutate the document's `presentation.nav` object. Split out of
 * PresentationWindow so navigation gets its own launcher (Document → Navigation…) and its own window;
 * the window itself is APP CHROME (app --color-* tokens, html[data-theme]).
 *
 * The editor bakes the EXPORTED sidebar nav only — it has no effect on the live editor sheet (the nav
 * is an export-only surface).
 */
export function NavWindow({ presentation, sections, anchorRect, onChange, onClose }: NavWindowProps) {
   const { t } = useLang()

   // Patch the nav field, collapsing an emptied extras object back to undefined so no empty shell
   // lingers in storage / export. Passing undefined resets the nav back to the zero-config default
   // (today's derivation) AND, if it was the only extra, drops the whole extras object.
   function updateNav(nextNav: NavModel | undefined): void {
      const nextExtras: DocPresentationExtras = { ...presentation, nav: nextNav }
      if (!nextExtras.nav) delete nextExtras.nav
      onChange(Object.keys(nextExtras).length === 0 ? undefined : nextExtras)
   }

   return (
      <BlockEditorWindow
         title={t.navigationWindowTitle}
         icon={<PanelLeft size={15} />}
         anchorRect={anchorRect}
         onClose={onClose}
      >
         <div className="presentation-editor">
            <NavSection nav={presentation?.nav} sections={sections} onChange={updateNav} />
         </div>
      </BlockEditorWindow>
   )
}

// ###############
// # NAV SECTION #
// ###############

/** A single-axis lock: every nav-entry drag glides vertically only (x pinned), without depending on
 *  `@dnd-kit/modifiers` (not installed) — mirrors the graph editors' sortable lock. */
const LOCK_VERTICAL_MODIFIER: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/** The drag-handle wiring a sortable nav row hands to its grip (mirrors ScatterEditor/GraphDataGrid). */
type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'>

/** A stable, collision-free sortable id per entry: an auto entry keys off its (unique) sectionId; a
 *  custom / divider entry keys off its own generated id. */
function navEntryDomId(entry: NavEntry): string {
   return entry.kind === 'auto' ? `nav-auto-${entry.sectionId}` : `nav-${entry.id}`
}

interface SortableNavEntryProps {
   entry:    NavEntry
   /** Render the row body; receives the grip wiring to place on the leading drag handle. */
   children: (handle: DragHandleProps) => React.ReactNode
}

/**
 * One nav entry made vertically sortable. The row is the sortable NODE; only the leading grip carries
 * the drag listeners (render-prop `handle`), so typing in a label / URL field never starts a reorder
 * (same pattern as SortableScatterPoint).
 */
function SortableNavEntry({ entry, children }: SortableNavEntryProps) {
   const { setNodeRef, transform, transition, isDragging, attributes, listeners, setActivatorNodeRef } =
      useSortable({ id: navEntryDomId(entry) })
   const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      zIndex:  isDragging ? 5 : undefined,
   }
   const kindClass = entry.kind === 'divider' ? ' presentation-nav-row-divider' : ''
   return (
      <div ref={setNodeRef} style={style} className={`presentation-nav-row${kindClass}`}>
         {children({ attributes, listeners, setActivatorNodeRef })}
      </div>
   )
}

interface NavSectionProps {
   nav:      NavModel | undefined
   sections: Section[]
   onChange: (next: NavModel | undefined) => void
}

/**
 * The sidebar-nav editor: a reorderable list over the reconciled nav entries (one per section by
 * default, plus any custom links / dividers). It edits the model that bakes the EXPORTED sidebar nav
 * (this list has no effect on the live editor sheet — the nav is an export-only surface). Every commit
 * writes the full reconciled entry array, so the first touch seeds `nav` from today's derivation and
 * then customizes it; "Reset" clears the model back to that zero-config default.
 */
function NavSection({ nav, sections, onChange }: NavSectionProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   // The working, reconciled entry list — the exact list the export consumes (before resolution).
   const entries = reconcileNavEntries(nav, sections)
   const titleBySectionId = new Map(sections.map(section => [section.id, section.title]))
   const isCustomized = nav !== undefined

   function commit(nextEntries: NavEntry[]): void {
      onChange({ entries: nextEntries })
   }

   function updateEntryAt(index: number, nextEntry: NavEntry): void {
      const next = entries.slice()
      next[index] = nextEntry
      commit(next)
   }

   function removeEntryAt(index: number): void {
      const next = entries.slice()
      next.splice(index, 1)
      commit(next)
   }

   function handleDragEnd(event: DragEndEvent): void {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const ids = entries.map(navEntryDomId)
      const fromIndex = ids.indexOf(String(active.id))
      const toIndex   = ids.indexOf(String(over.id))
      if (fromIndex < 0 || toIndex < 0) return
      commit(arrayMove(entries, fromIndex, toIndex))
   }

   // ================
   //  Adders (append to the reconciled list, then edit inline)
   // ================
   function addSectionLink(): void {
      const sectionId = sections[0]?.id
      if (!sectionId) return
      const entry: NavCustomEntry = { kind: 'custom', id: crypto.randomUUID(), label: '', target: { type: 'section', sectionId } }
      commit([...entries, entry])
   }

   function addExternalLink(): void {
      const entry: NavCustomEntry = { kind: 'custom', id: crypto.randomUUID(), label: '', target: { type: 'url', href: '' } }
      commit([...entries, entry])
   }

   function addDivider(): void {
      const entry: NavDivider = { kind: 'divider', id: crypto.randomUUID() }
      commit([...entries, entry])
   }

   function dragGrip(handle: DragHandleProps): React.ReactNode {
      return (
         <span
            className="presentation-nav-grip"
            ref={handle.setActivatorNodeRef}
            {...handle.attributes}
            {...handle.listeners}
            aria-label={t.presentationNavReorder}
            title={t.presentationNavReorder}
         >
            <GripVertical size={13} />
         </span>
      )
   }

   // ================
   //  Row bodies (auto / custom / divider)
   // ================
   function autoRow(entry: NavAutoEntry, index: number, handle: DragHandleProps): React.ReactNode {
      const title  = titleBySectionId.get(entry.sectionId) ?? ''
      const hidden = entry.hidden === true
      return (
         <>
            {dragGrip(handle)}
            <button
               type="button"
               className="presentation-nav-icon-btn"
               onClick={() => updateEntryAt(index, hidden ? { ...entry, hidden: undefined } : { ...entry, hidden: true })}
               aria-label={hidden ? t.presentationNavShow : t.presentationNavHide}
               title={hidden ? t.presentationNavShow : t.presentationNavHide}
            >
               {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <input
               className={`presentation-input presentation-nav-label${hidden ? ' presentation-nav-label-hidden' : ''}`}
               type="text"
               value={entry.label ?? ''}
               placeholder={title}
               aria-label={t.presentationNavLabel}
               onChange={event => updateEntryAt(index, { ...entry, label: event.target.value === '' ? undefined : event.target.value })}
            />
         </>
      )
   }

   function customRow(entry: NavCustomEntry, index: number, handle: DragHandleProps): React.ReactNode {
      const isSection = entry.target.type === 'section'
      return (
         <>
            {dragGrip(handle)}
            <span className="presentation-nav-kind-icon" aria-hidden="true">
               {isSection ? <Link2 size={13} /> : <Globe size={13} />}
            </span>
            <input
               className="presentation-input presentation-nav-label"
               type="text"
               value={entry.label}
               placeholder={t.presentationNavLabel}
               aria-label={t.presentationNavLabel}
               onChange={event => updateEntryAt(index, { ...entry, label: event.target.value })}
            />
            {entry.target.type === 'section' ? (
               <select
                  className="presentation-select presentation-nav-target"
                  value={entry.target.sectionId}
                  aria-label={t.presentationNavTargetSection}
                  onChange={event => updateEntryAt(index, { ...entry, target: { type: 'section', sectionId: event.target.value } })}
               >
                  {sections.map(section => (
                     <option key={section.id} value={section.id}>{section.title || t.presentationNavUntitledSection}</option>
                  ))}
               </select>
            ) : (
               <input
                  className="presentation-input presentation-nav-target"
                  type="url"
                  value={entry.target.href}
                  placeholder={t.presentationNavExternalUrlPlaceholder}
                  aria-label={t.presentationNavTargetUrl}
                  onChange={event => updateEntryAt(index, { ...entry, target: { type: 'url', href: event.target.value } })}
               />
            )}
            <button
               type="button"
               className="presentation-nav-icon-btn presentation-nav-icon-btn-danger"
               onClick={() => removeEntryAt(index)}
               aria-label={t.presentationNavRemove}
               title={t.presentationNavRemove}
            ><Trash2 size={13} /></button>
         </>
      )
   }

   function dividerRow(entry: NavDivider, index: number, handle: DragHandleProps): React.ReactNode {
      return (
         <>
            {dragGrip(handle)}
            <span className="presentation-nav-kind-icon" aria-hidden="true"><Minus size={13} /></span>
            <input
               className="presentation-input presentation-nav-label"
               type="text"
               value={entry.label ?? ''}
               placeholder={t.presentationNavDividerCaption}
               aria-label={t.presentationNavDividerCaption}
               onChange={event => updateEntryAt(index, { ...entry, label: event.target.value === '' ? undefined : event.target.value })}
            />
            <button
               type="button"
               className="presentation-nav-icon-btn presentation-nav-icon-btn-danger"
               onClick={() => removeEntryAt(index)}
               aria-label={t.presentationNavRemove}
               title={t.presentationNavRemove}
            ><Trash2 size={13} /></button>
         </>
      )
   }

   function navRow(entry: NavEntry, index: number, handle: DragHandleProps): React.ReactNode {
      if (entry.kind === 'auto')    return autoRow(entry, index, handle)
      if (entry.kind === 'divider') return dividerRow(entry, index, handle)
      return customRow(entry, index, handle)
   }

   const ids = entries.map(navEntryDomId)

   return (
      <section className="presentation-section">
         <div className="presentation-nav-head">
            <span className="presentation-section-label">{t.presentationNavSection}</span>
            {isCustomized && (
               <button
                  type="button"
                  className="presentation-nav-reset"
                  onClick={() => onChange(undefined)}
                  title={t.presentationNavReset}
               >
                  <RotateCcw size={12} />{t.presentationNavReset}
               </button>
            )}
         </div>
         <p className="presentation-hint">{t.presentationNavHint}</p>

         <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[LOCK_VERTICAL_MODIFIER]}
            onDragEnd={handleDragEnd}
         >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
               <div className="presentation-nav-list">
                  {entries.map((entry, index) => (
                     <SortableNavEntry key={navEntryDomId(entry)} entry={entry}>
                        {handle => navRow(entry, index, handle)}
                     </SortableNavEntry>
                  ))}
               </div>
            </SortableContext>
         </DndContext>

         <div className="presentation-nav-adders">
            <button type="button" className="presentation-btn" onClick={addSectionLink} disabled={sections.length === 0}>
               <Link2 size={13} />{t.presentationNavAddSectionLink}
            </button>
            <button type="button" className="presentation-btn" onClick={addExternalLink}>
               <Globe size={13} />{t.presentationNavAddExternalLink}
            </button>
            <button type="button" className="presentation-btn" onClick={addDivider}>
               <Minus size={13} />{t.presentationNavAddDivider}
            </button>
         </div>
      </section>
   )
}

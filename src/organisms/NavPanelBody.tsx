// -- React Imports --
import type React from 'react'

// -- Library Imports --
import { Trash2, GripVertical, Eye, EyeOff, Link2, Globe, Hash, Minus, RotateCcw } from 'lucide-react'

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
import { useLang } from '../contexts/LangContext'
import { getAnchoredBlocks } from '../hooks/useLinkMode'

// -- Lib Imports --
import type { Block, Section } from '../types'
import { blkPreview } from '../lib/document'
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

interface NavPanelBodyProps {
   /** The active document's presentation extras (undefined = none set yet). */
   presentation?: DocPresentationExtras
   /** The live section list, the nav editor reconciles + mirrors it (renames, new/deleted sections). */
   sections: Section[]
   /** Commit a new extras object (or undefined to clear all extras), a real document change. */
   onChange: (next: DocPresentationExtras | undefined) => void
}

// #############
// # COMPONENT #
// #############

/**
 * The document-level Navigation editor body, chrome-free so the same form serves the floating NavWindow
 * (Document -> Navigation...) and a docked side panel. Its controls mutate `presentation.nav`, which
 * bakes the exported sidebar nav only (no effect on the live editor sheet, an export-only surface).
 * `.doc-settings-panel` owns the scroll + padding so the body fills its host (padding neutralized in doc.css).
 */
export function NavPanelBody({ presentation, sections, onChange }: NavPanelBodyProps) {
   // Patch the nav field, collapsing an emptied extras object back to undefined so no empty shell lingers.
   // Passing undefined resets nav to the zero-config default (reconciled fresh from the sections).
   function updateNav(nextNav: NavModel | undefined): void {
      const nextExtras: DocPresentationExtras = { ...presentation, nav: nextNav }
      if (!nextExtras.nav) delete nextExtras.nav
      onChange(Object.keys(nextExtras).length === 0 ? undefined : nextExtras)
   }

   return (
      <div className="doc-settings-panel flex-1 min-h-0 overflow-y-auto" style={{ padding: '0.85rem 0.95rem' }}>
         <div className="presentation-editor">
            <NavSection nav={presentation?.nav} sections={sections} onChange={updateNav} />
         </div>
      </div>
   )
}

// ###############
// # NAV SECTION #
// ###############

/** A single-axis lock: every nav-entry drag glides vertically only (x pinned), without depending on
 *  `@dnd-kit/modifiers` (not installed). */
const LOCK_VERTICAL_MODIFIER: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/** The drag-handle wiring a sortable nav row hands to its grip. */
type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'>

/** A stable, collision-free sortable id per entry: an auto entry keys off its sectionId, a custom /
 *  divider entry off its own generated id. */
function navEntryDomId(entry: NavEntry): string {
   return entry.kind === 'auto' ? `nav-auto-${entry.sectionId}` : `nav-${entry.id}`
}

interface SortableNavEntryProps {
   entry:    NavEntry
   /** Render the row body; receives the grip wiring to place on the leading drag handle. */
   children: (handle: DragHandleProps) => React.ReactNode
}

/** One nav entry made vertically sortable. The row is the sortable NODE; only the leading grip carries
 *  the drag listeners (render-prop `handle`), so typing in a label / URL field never starts a reorder. */
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

/** The sidebar-nav editor: a reorderable list over the reconciled entries (one per section by default,
 *  plus custom links / dividers). Every commit writes the full reconciled array, so the first touch
 *  seeds `nav` from the zero-config derivation; "Reset" clears it back to that default. */
function NavSection({ nav, sections, onChange }: NavSectionProps) {
   const { t } = useLang()
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   // The working, reconciled entry list: the exact list the export consumes (before resolution).
   const entries = reconcileNavEntries(nav, sections)
   const titleBySectionId = new Map(sections.map(section => [section.id, section.title]))
   const isCustomized = nav !== undefined

   // Every block carrying a deep-link handle: the anchor-link target universe. No anchors disables the adder.
   const anchoredBlocks = getAnchoredBlocks(sections)

   /** A readable option label for an anchored block: its content preview plus the `#handle`. */
   function anchorOptionLabel(block: Block): string {
      const handle = block.handle ?? ''
      const preview = blkPreview(block).trim()
      return preview ? `${preview}, #${handle}` : `#${handle}`
   }

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

   function addAnchorLink(): void {
      const firstAnchor = anchoredBlocks[0]?.block
      const handle = firstAnchor?.handle
      if (!handle) return
      // Seed the label from the block's content preview, falling back to the raw handle.
      const label = blkPreview(firstAnchor).trim() || handle
      const entry: NavCustomEntry = { kind: 'custom', id: crypto.randomUUID(), label, target: { type: 'anchor', handle } }
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
      const targetType = entry.target.type
      return (
         <>
            {dragGrip(handle)}
            <span className="presentation-nav-kind-icon" aria-hidden="true">
               {targetType === 'section' ? <Link2 size={13} /> : targetType === 'anchor' ? <Hash size={13} /> : <Globe size={13} />}
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
            ) : entry.target.type === 'anchor' ? (
               <select
                  className="presentation-select presentation-nav-target"
                  value={entry.target.handle}
                  aria-label={t.presentationNavTargetAnchor}
                  onChange={event => updateEntryAt(index, { ...entry, target: { type: 'anchor', handle: event.target.value } })}
               >
                  {anchoredBlocks.map(({ block }) => (
                     <option key={block.id} value={block.handle ?? ''}>{anchorOptionLabel(block)}</option>
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
            <button
               type="button"
               className="presentation-btn"
               onClick={addAnchorLink}
               disabled={anchoredBlocks.length === 0}
               title={anchoredBlocks.length === 0 ? t.presentationNavNoAnchorsHint : undefined}
            >
               <Hash size={13} />{t.presentationNavAddAnchorLink}
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

// -- React Imports --
import { useState } from 'react'
import type React from 'react'

// -- DnD Imports --
import {
   DndContext, closestCenter,
   PointerSensor, useSensor, useSensors,
   type DragEndEvent, type Modifier,
} from '@dnd-kit/core'
import {
   SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Library Imports --
import { GripVertical, X } from 'lucide-react'

// -- Lib Imports --
import type { GraphSpec, GraphTheme, FunctionPlot } from '../lib/graph'
import {
   resolveSeriesColor,
   MAX_SERIES,
   compileExpression,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
} from '../lib/graph'
import {
   addEquation,
   removeEquation,
   insertEquationAt,
   moveEquation,
   setEquationField,
   setEquationColor,
   setDomain,
   setOption,
} from '../lib/graphEdit'
import type { T } from '../lib/i18n'

// -- Molecule Imports --
import { GraphSeriesColorPopover } from './GraphDataGrid'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'

// #############
// # CONSTANTS #
// #############

/** Positional sortable id prefix: an equation has no stable model id, so each row carries an
 *  `equation-<index>` id that onDragEnd parses back into the reorder helper. */
const EQUATION_ID_PREFIX = 'equation-'

/** Locks every equation drag to VERTICAL only (x pinned), without needing `@dnd-kit/modifiers`. */
const LOCK_VERTICAL_MODIFIER: Modifier = ({ transform }) => ({ ...transform, x: 0 })

// #########
// # TYPES #
// #########

/** The drag-handle wiring a sortable row hands to the grip: the activator ref + dnd-kit's ARIA/listener props. */
type DragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'>

/** The open equation row right-click menu: which equation it targets, anchored at the click. */
interface EquationContextMenu {
   index: number
   x:     number
   y:     number
}

interface EquationEditorProps {
   /** The live working spec (GraphBlock's local draft); the editor renders from + edits this. */
   spec:  GraphSpec
   /** Resolved chart theme, so a swatch shows the real palette slot color a curve draws in. */
   theme: GraphTheme
   /** UI strings. */
   t:     T
   /** Mark an edit in progress (guards GraphBlock's external-sync from clobbering typing). */
   onEditStart:   () => void
   /** Apply a spec edit to the live draft WITHOUT committing to the document (text/number typing). */
   onDraft:       (next: GraphSpec) => void
   /** Apply a spec edit AND commit it to the document (discrete: add/remove/color). */
   onCommit:      (next: GraphSpec) => void
   /** Commit the current working spec to the document (fired on a text/number input blur). */
   onCommitField: () => void
}

/** Defensive-only backstop so the editor never operates on an undefined functionPlot; `setType`
 *  seeds a real one whenever a spec switches to `function`. */
const FALLBACK_FUNCTION_PLOT: FunctionPlot = {
   domain: { xMin: FUNCTION_DEFAULT_X_MIN, xMax: FUNCTION_DEFAULT_X_MAX, samples: FUNCTION_DEFAULT_SAMPLES },
   equations: [{ name: 'f', expression: '' }],
}

/** The field being typed into, holding its raw text so an unparseable intermediate ("-", "1.") stays
 *  on screen without corrupting the stored value. `yMin`/`yMax` treat a blank as valid (autoscale),
 *  unlike the required `xMin`/`xMax`/`samples`. */
interface EditingDomainField {
   field:   'xMin' | 'xMax' | 'samples' | 'yMin' | 'yMax'
   text:    string
   invalid: boolean
}

/** The y-range fields route through `setOption` (they live on GraphOptions, not FunctionDomain). */
const Y_RANGE_FIELDS = new Set<EditingDomainField['field']>(['yMin', 'yMax'])

/** Which equation's color popover is open, and the swatch rect that anchors it. */
interface EquationColorTarget {
   index: number
   rect:  DOMRect
}

// #####################
// # SORTABLE WRAPPER   #
// #####################

interface SortableEquationRowProps {
   equationIndex: number
   /** Right-click opens the equation context menu. */
   onContextMenu: (event: React.MouseEvent) => void
   /** Render the row's content; receives the grip wiring to place on the leading drag handle. */
   children:      (handle: DragHandleProps) => React.ReactNode
}

/** One equation row made vertically sortable. The row is the sortable node, but only the grip (wired
 *  via the render-prop `handle`) carries the drag listeners, so typing in a field never starts a drag. */
function SortableEquationRow({ equationIndex, onContextMenu, children }: SortableEquationRowProps) {
   const { setNodeRef, transform, transition, isDragging, attributes, listeners, setActivatorNodeRef } =
      useSortable({ id: `${EQUATION_ID_PREFIX}${equationIndex}` })
   const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
   }
   return (
      <div
         ref={setNodeRef}
         style={style}
         className={`graph-equation-row${isDragging ? ' graph-row-dragging' : ''}`}
         onContextMenu={onContextMenu}
      >
         {children({ attributes, listeners, setActivatorNodeRef })}
      </div>
   )
}

// #############
// # COMPONENT #
// #############

/**
 * The Data-tab editor for a `function` chart: a shared domain (x-range + sample count + optional
 * pinned y-range) then one row per equation, replacing `GraphDataGrid` for this type.
 *
 * Draft/commit like `GraphDataGrid`: text typing drafts every keystroke and commits on blur;
 * add/remove/color commit immediately. An expression that fails `compileExpression` gets a live
 * invalid ring but is never blocked; the renderer already draws nothing for such a curve.
 */
export function EquationEditor({ spec, theme, t, onEditStart, onDraft, onCommit, onCommitField }: EquationEditorProps) {
   const functionPlot = spec.functionPlot ?? FALLBACK_FUNCTION_PLOT
   const { domain, equations } = functionPlot
   const { yMin, yMax } = spec.options

   // The one domain/y-range field mid-edit (see EditingDomainField above).
   const [editingField, setEditingField] = useState<EditingDomainField | null>(null)
   // Which equation's swatch color popover is open.
   const [colorPopover, setColorPopover] = useState<EquationColorTarget | null>(null)
   // Which equation's right-click menu is open (null = none), and where it was invoked.
   const [contextMenu, setContextMenu] = useState<EquationContextMenu | null>(null)

   // 5px activation threshold, so a click on the grip that doesn't move never registers as a drag.
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

   // ================
   //  Domain + y-range fields
   // ================
   function fieldText(field: EditingDomainField['field'], value: number | undefined): string {
      if (editingField && editingField.field === field) return editingField.text
      return value === undefined ? '' : String(value)
   }

   function fieldIsInvalid(field: EditingDomainField['field']): boolean {
      return !!editingField && editingField.field === field && editingField.invalid
   }

   /** Apply a parsed domain field to the draft. Split by field so `setDomain` needs no computed-key cast. */
   function draftDomainField(field: 'xMin' | 'xMax' | 'samples', parsed: number): void {
      if (field === 'xMin') onDraft(setDomain(spec, { xMin: parsed }))
      else if (field === 'xMax') onDraft(setDomain(spec, { xMax: parsed }))
      else onDraft(setDomain(spec, { samples: parsed }))
   }

   /** Apply a parsed (or cleared) y-range field to the draft, same reasoning as {@link draftDomainField}. */
   function draftYRangeField(field: 'yMin' | 'yMax', parsed: number | undefined): void {
      if (field === 'yMin') onDraft(setOption(spec, 'yMin', parsed))
      else onDraft(setOption(spec, 'yMax', parsed))
   }

   function handleFieldChange(field: EditingDomainField['field'], rawText: string): void {
      onEditStart()
      const trimmed = rawText.trim()
      const isYRange = Y_RANGE_FIELDS.has(field)

      // A blank field is valid (autoscale) for yMin/yMax, but xMin/xMax/samples always need a number.
      if (trimmed === '') {
         setEditingField({ field, text: rawText, invalid: !isYRange })
         if (field === 'yMin' || field === 'yMax') draftYRangeField(field, undefined)
         return
      }

      const parsed = Number(trimmed)
      const isValid = Number.isFinite(parsed)
      setEditingField({ field, text: rawText, invalid: !isValid })
      if (!isValid) return

      if (field === 'yMin' || field === 'yMax') {
         draftYRangeField(field, parsed)
      } else {
         draftDomainField(field, parsed)
      }
   }

   function handleFieldBlur(): void {
      setEditingField(null)
      onCommitField()
   }

   function domainField(field: 'xMin' | 'xMax' | 'samples', label: string, value: number): React.ReactElement {
      const invalid = fieldIsInvalid(field)
      return (
         <label className="graph-field graph-domain-field" key={field}>
            <span className="graph-field-label">{label}</span>
            <input
               className={`graph-text-input graph-domain-input${invalid ? ' is-invalid' : ''}`}
               type="text"
               inputMode="decimal"
               value={fieldText(field, value)}
               aria-label={label}
               aria-invalid={invalid || undefined}
               title={invalid ? t.graphInvalidNumber : undefined}
               onFocus={onEditStart}
               onChange={event => handleFieldChange(field, event.target.value)}
               onBlur={handleFieldBlur}
            />
         </label>
      )
   }

   function yRangeField(field: 'yMin' | 'yMax', label: string, value: number | undefined): React.ReactElement {
      const invalid = fieldIsInvalid(field)
      return (
         <label className="graph-field graph-domain-field" key={field}>
            <span className="graph-field-label">{label}</span>
            <input
               className={`graph-text-input graph-domain-input${invalid ? ' is-invalid' : ''}`}
               type="text"
               inputMode="decimal"
               placeholder={t.graphDomainAuto}
               value={fieldText(field, value)}
               aria-label={label}
               aria-invalid={invalid || undefined}
               title={invalid ? t.graphInvalidNumber : undefined}
               onFocus={onEditStart}
               onChange={event => handleFieldChange(field, event.target.value)}
               onBlur={handleFieldBlur}
            />
         </label>
      )
   }

   // ================
   //  Color popover
   // ================
   function openColorPopover(index: number, rect: DOMRect): void {
      if (colorPopover && colorPopover.index === index) {
         setColorPopover(null)
         return
      }
      setColorPopover({ index, rect })
   }

   const activePopover = colorPopover && {
      value:   resolveSeriesColor(colorPopover.index, equations[colorPopover.index]?.color, theme),
      onPick:  (hex: string) => onCommit(setEquationColor(spec, colorPopover.index, hex)),
      onReset: () => { onCommit(setEquationColor(spec, colorPopover.index, undefined)); setColorPopover(null) },
   }

   // ================
   //  Drag reorder + context menu
   // ================
   function handleDragEnd(event: DragEndEvent): void {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = Number(String(active.id).slice(EQUATION_ID_PREFIX.length))
      const toIndex   = Number(String(over.id).slice(EQUATION_ID_PREFIX.length))
      onCommit(moveEquation(spec, fromIndex, toIndex))
   }

   function openEquationMenu(event: React.MouseEvent, equationIndex: number): void {
      event.preventDefault()
      setContextMenu({ index: equationIndex, x: event.clientX, y: event.clientY })
   }

   /** Insert-before / insert-after / delete for an equation row. Inserts respect MAX_SERIES; delete
    *  is disabled at the last remaining equation. */
   function equationMenuEntries(equationIndex: number): ContextMenuEntry[] {
      const atCap = equations.length >= MAX_SERIES
      return [
         { label: t.graphInsertEquationBefore, disabled: atCap, onSelect: () => onCommit(insertEquationAt(spec, equationIndex)) },
         { label: t.graphInsertEquationAfter,  disabled: atCap, onSelect: () => onCommit(insertEquationAt(spec, equationIndex + 1)) },
         { type: 'separator' },
         { label: t.graphRemoveEquation, danger: true, disabled: equations.length <= 1, onSelect: () => onCommit(removeEquation(spec, equationIndex)) },
      ]
   }

   /** The grip affordance a sortable row hands its listeners to (mirrors GraphDataGrid's dragHandle). */
   function dragGrip(handle: DragHandleProps, ariaLabel: string): React.ReactElement {
      return (
         <span
            className="graph-drag-handle"
            ref={handle.setActivatorNodeRef}
            {...handle.attributes}
            {...handle.listeners}
            aria-label={ariaLabel}
            title={ariaLabel}
         >
            <GripVertical size={13} />
         </span>
      )
   }

   // ================
   //  Equation rows
   // ================
   function equationRowContent(equationIndex: number, handle: DragHandleProps): React.ReactNode {
      const equation = equations[equationIndex]
      const resolvedColor = resolveSeriesColor(equationIndex, equation.color, theme)
      const trimmedExpression = equation.expression.trim()
      const isInvalidExpression = trimmedExpression !== '' && compileExpression(equation.expression) === null

      return (
         <>
            {dragGrip(handle, t.graphReorderEquation)}
            <button
               type="button"
               className="graph-lead-swatch"
               data-graph-color-trigger
               style={{ background: resolvedColor }}
               aria-label={t.graphEquationColor}
               title={t.graphEquationColor}
               onClick={event => openColorPopover(equationIndex, event.currentTarget.getBoundingClientRect())}
            />
            <input
               className="graph-lead-name"
               type="text"
               size={Math.max(2, equation.name.length)}
               value={equation.name}
               placeholder={t.graphEquationName}
               aria-label={t.graphEquationName}
               onFocus={onEditStart}
               onChange={event => { onEditStart(); onDraft(setEquationField(spec, equationIndex, 'name', event.target.value)) }}
               onBlur={onCommitField}
            />
            <input
               className={`graph-equation-expression${isInvalidExpression ? ' is-invalid' : ''}`}
               type="text"
               value={equation.expression}
               placeholder="sin(x)"
               aria-label={t.graphEquationExpression}
               aria-invalid={isInvalidExpression || undefined}
               title={isInvalidExpression ? t.graphInvalidExpression : undefined}
               onFocus={onEditStart}
               onChange={event => { onEditStart(); onDraft(setEquationField(spec, equationIndex, 'expression', event.target.value)) }}
               onBlur={onCommitField}
            />
            <button
               type="button"
               className="graph-icon-btn"
               onClick={() => onCommit(removeEquation(spec, equationIndex))}
               disabled={equations.length <= 1}
               aria-label={t.graphRemoveEquation}
               title={t.graphRemoveEquation}
            ><X size={13} /></button>
         </>
      )
   }

   const equationIds = equations.map((_equation, equationIndex) => `${EQUATION_ID_PREFIX}${equationIndex}`)

   return (
      <div className="graph-equation-editor">
         <div className="graph-editor-group">
            <span className="graph-section-label">{t.graphDomainSection}</span>
            <div className="graph-domain-row">
               {domainField('xMin', t.graphDomainXMin, domain.xMin)}
               {domainField('xMax', t.graphDomainXMax, domain.xMax)}
               {domainField('samples', t.graphDomainSamples, domain.samples)}
            </div>
            {/* yMin/yMax are the Y-AXIS range (via setOption), NOT part of the x-domain; blank = autoscale. */}
            <span className="graph-section-label">{t.graphYRangeSection}</span>
            <div className="graph-domain-row">
               {yRangeField('yMin', t.graphDomainYMin, yMin)}
               {yRangeField('yMax', t.graphDomainYMax, yMax)}
            </div>
         </div>

         <div className="graph-editor-group">
            <DndContext
               sensors={sensors}
               collisionDetection={closestCenter}
               modifiers={[LOCK_VERTICAL_MODIFIER]}
               onDragEnd={handleDragEnd}
            >
               <SortableContext items={equationIds} strategy={verticalListSortingStrategy}>
                  {equations.map((_equation, equationIndex) => (
                     <SortableEquationRow
                        key={`${EQUATION_ID_PREFIX}${equationIndex}`}
                        equationIndex={equationIndex}
                        onContextMenu={event => openEquationMenu(event, equationIndex)}
                     >
                        {handle => equationRowContent(equationIndex, handle)}
                     </SortableEquationRow>
                  ))}
               </SortableContext>
            </DndContext>
            <button
               type="button"
               className="graph-grid-btn graph-equation-add"
               onClick={() => onCommit(addEquation(spec))}
               disabled={equations.length >= MAX_SERIES}
               title={t.graphAddEquation}
            >{t.graphAddEquation}</button>
         </div>

         {colorPopover && activePopover && (
            <GraphSeriesColorPopover
               anchorRect={colorPopover.rect}
               value={activePopover.value}
               title={t.graphEquationColor}
               resetLabel={t.graphResetColor}
               onPick={activePopover.onPick}
               onReset={activePopover.onReset}
               onClose={() => setColorPopover(null)}
            />
         )}

         {contextMenu && (
            <ContextMenu
               position={{ x: contextMenu.x, y: contextMenu.y }}
               entries={equationMenuEntries(contextMenu.index)}
               onClose={() => setContextMenu(null)}
            />
         )}
      </div>
   )
}

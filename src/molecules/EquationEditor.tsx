// -- React Imports --
import { useState } from 'react'
import type React from 'react'

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
   setEquationField,
   setEquationColor,
   setDomain,
   setOption,
} from '../lib/graphEdit'
import type { T } from '../lib/i18n'

// -- Molecule Imports --
import { GraphSeriesColorPopover } from './GraphDataGrid'

// #########
// # TYPES #
// #########

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

/** A safe fallback so the editor never operates on an undefined functionPlot. In practice
 *  `graphEdit.setType` seeds a real functionPlot the moment a spec switches to `function`, so this
 *  is a defensive-only backstop, never the normal path. */
const FALLBACK_FUNCTION_PLOT: FunctionPlot = {
   domain: { xMin: FUNCTION_DEFAULT_X_MIN, xMax: FUNCTION_DEFAULT_X_MAX, samples: FUNCTION_DEFAULT_SAMPLES },
   equations: [{ name: 'f', expression: '' }],
}

/** Which domain / y-range field is being typed into, holding its raw text so an unparseable
 *  intermediate ("-", "1.") stays on screen without corrupting the stored value — mirrors
 *  GraphDataGrid's `EditingCell`. `yMin`/`yMax` additionally treat a blank field as valid
 *  (autoscale), unlike the required `xMin`/`xMax`/`samples`. */
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

// #############
// # COMPONENT #
// #############

/**
 * The Data-tab editor for a `function` chart: a shared domain (x-range + sample count, plus an
 * optional pinned y-range) followed by one row per equation (color swatch + name + expression +
 * remove), replacing `GraphDataGrid` for this type — an equation list has no categories and no
 * per-cell numeric grid, so it earns its own dedicated surface (mirrors the study's Q6 sketch).
 *
 * Draft/commit model exactly like `GraphDataGrid`: text/number typing drafts on every keystroke
 * (instant preview) and commits on blur; add/remove/color commit immediately. An expression that
 * fails `compileExpression` gets a live invalid-ring + tooltip (the same affordance the numeric
 * grid uses for a bad number) but is never blocked or reverted — the renderer already treats an
 * uncompileable expression as "draw nothing for this curve," so the editor just surfaces that
 * state rather than fighting it.
 */
export function EquationEditor({ spec, theme, t, onEditStart, onDraft, onCommit, onCommitField }: EquationEditorProps) {
   const functionPlot = spec.functionPlot ?? FALLBACK_FUNCTION_PLOT
   const { domain, equations } = functionPlot
   const { yMin, yMax } = spec.options

   // The one domain/y-range field mid-edit (see EditingDomainField above).
   const [editingField, setEditingField] = useState<EditingDomainField | null>(null)
   // Which equation's swatch color popover is open.
   const [colorPopover, setColorPopover] = useState<EquationColorTarget | null>(null)

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

   /** Apply a parsed domain field (xMin/xMax/samples) to the draft. Split by field so the call into
    *  `setDomain` never needs a computed-key cast. */
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
   //  Equation rows
   // ================
   function equationRow(equationIndex: number): React.ReactElement {
      const equation = equations[equationIndex]
      const resolvedColor = resolveSeriesColor(equationIndex, equation.color, theme)
      const trimmedExpression = equation.expression.trim()
      const isInvalidExpression = trimmedExpression !== '' && compileExpression(equation.expression) === null

      return (
         <div className="graph-equation-row" key={equationIndex}>
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
            >×</button>
         </div>
      )
   }

   return (
      <div className="graph-equation-editor">
         {/* =============== Shared domain: x-range + sample count =============== */}
         <div className="graph-options">
            <span className="graph-section-label">{t.graphDomainSection}</span>
            <div className="graph-domain-row">
               {domainField('xMin', t.graphDomainXMin, domain.xMin)}
               {domainField('xMax', t.graphDomainXMax, domain.xMax)}
               {domainField('samples', t.graphDomainSamples, domain.samples)}
            </div>
            <div className="graph-domain-row">
               {yRangeField('yMin', t.graphDomainYMin, yMin)}
               {yRangeField('yMax', t.graphDomainYMax, yMax)}
            </div>
         </div>

         {/* =============== Equations: one row per curve =============== */}
         <div className="graph-equation-list">
            {equations.map((_equation, equationIndex) => equationRow(equationIndex))}
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
      </div>
   )
}

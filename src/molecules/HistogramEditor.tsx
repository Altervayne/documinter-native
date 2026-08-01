// -- React Imports --
import { useState } from 'react'

// -- Lib Imports --
import type { GraphSpec, GraphTheme, HistogramData } from '../lib/graph'
import { resolveSeriesColor, computeHistogramBins } from '../lib/graph'
import {
   setHistogramSamples,
   setHistogramBins,
   setHistogramName,
   setHistogramColor,
} from '../lib/graphEdit'
import { parseHistogramSamplesText } from '../lib/graphFence'
import type { T } from '../lib/i18n'

// -- Molecule Imports --
import { GraphSeriesColorPopover } from './GraphDataGrid'

// #########
// # TYPES #
// #########

interface HistogramEditorProps {
   /** The live working spec (GraphBlock's local draft); the editor renders from + edits this. */
   spec:  GraphSpec
   /** Resolved chart theme, so the swatch shows the real palette slot color the bars draw in. */
   theme: GraphTheme
   /** UI strings. */
   t:     T
   /** Mark an edit in progress (guards GraphBlock's external-sync from clobbering typing). */
   onEditStart:   () => void
   /** Apply a spec edit to the live draft WITHOUT committing to the document (text/number typing). */
   onDraft:       (next: GraphSpec) => void
   /** Apply a spec edit AND commit it to the document (discrete: color pick / reset). */
   onCommit:      (next: GraphSpec) => void
   /** Commit the current working spec to the document (fired on a text/number input blur). */
   onCommitField: () => void
}

/** A safe fallback so the editor never operates on an undefined histogramData. In practice
 *  `graphEdit.setType` seeds a real histogramData the moment a spec switches to `histogram`, so
 *  this is a defensive-only backstop, never the normal path. */
const FALLBACK_HISTOGRAM_DATA: HistogramData = { samples: [] }

/** Which free-form field is mid-edit, holding its raw text so an in-progress/unparseable
 *  intermediate (a trailing "1, 2, ", or a lone "-" in the bin-count field) stays on screen
 *  without corrupting the stored value — mirrors ScatterEditor's/EquationEditor's editing state. */
type EditingField = 'samples' | 'bins' | null

// #############
// # COMPONENT #
// #############

/**
 * The Data-tab editor for a `histogram` chart: a raw-samples textarea (paste-friendly — numbers
 * separated by commas, whitespace, or new lines), a bin-count control (blank = auto/Sturges, with
 * a live "effective bin count" readout), and a name + color swatch — replacing `GraphDataGrid` for
 * this type, since a histogram has no categories and no series axis (exactly one dataset).
 *
 * Draft/commit model exactly like `ScatterEditor`/`EquationEditor`: text typing drafts on every
 * keystroke (instant preview) and commits on blur; the color pick/reset commits immediately.
 */
export function HistogramEditor({ spec, theme, t, onEditStart, onDraft, onCommit, onCommitField }: HistogramEditorProps) {
   const histogramData = spec.histogramData ?? FALLBACK_HISTOGRAM_DATA
   const { samples, bins, name, color } = histogramData

   // The one free-form field mid-edit (see EditingField above), holding its raw text.
   const [editingField, setEditingField] = useState<EditingField>(null)
   const [samplesText, setSamplesText]   = useState('')
   const [binsText, setBinsText]         = useState('')
   // The dataset swatch's color popover anchor rect, or null when the popover is closed.
   const [colorPopoverRect, setColorPopoverRect] = useState<DOMRect | null>(null)

   // The effective bin count the chart will actually draw (auto or manual), for the live readout —
   // reuses the SAME binning function the renderer calls, so this can never drift from reality.
   const effectiveBinCount = computeHistogramBins(samples, bins).counts.length

   // ================
   //  Samples textarea
   // ================
   function samplesFieldText(): string {
      return editingField === 'samples' ? samplesText : samples.join(', ')
   }

   function handleSamplesChange(rawText: string): void {
      onEditStart()
      setEditingField('samples')
      setSamplesText(rawText)
      onDraft(setHistogramSamples(spec, parseHistogramSamplesText(rawText)))
   }

   function handleSamplesFocus(): void {
      onEditStart()
      setEditingField('samples')
      setSamplesText(samples.join(', '))
   }

   function handleSamplesBlur(): void {
      setEditingField(null)
      onCommitField()
   }

   // ================
   //  Bin count
   // ================
   function binsFieldText(): string {
      if (editingField === 'bins') return binsText
      return bins === undefined ? '' : String(bins)
   }

   function binsFieldIsInvalid(): boolean {
      if (editingField !== 'bins') return false
      const trimmed = binsText.trim()
      return trimmed !== '' && !Number.isFinite(Number(trimmed))
   }

   function handleBinsChange(rawText: string): void {
      onEditStart()
      setEditingField('bins')
      setBinsText(rawText)
      const trimmed = rawText.trim()
      if (trimmed === '') {
         // A blank field means "auto (Sturges)" — a valid, meaningful state, not an invalid one.
         onDraft(setHistogramBins(spec, undefined))
         return
      }
      const parsed = Number(trimmed)
      // Only push a parseable number into the model; an unparseable intermediate keeps the raw
      // text visible (via editingField/binsText) but leaves the last valid bin count in place.
      if (Number.isFinite(parsed)) onDraft(setHistogramBins(spec, parsed))
   }

   function handleBinsFocus(): void {
      onEditStart()
      setEditingField('bins')
      setBinsText(bins === undefined ? '' : String(bins))
   }

   function handleBinsBlur(): void {
      setEditingField(null)
      onCommitField()
   }

   // ================
   //  Name
   // ================
   function handleNameChange(value: string): void {
      onEditStart()
      onDraft(setHistogramName(spec, value))
   }

   // ================
   //  Color popover
   // ================
   function toggleColorPopover(rect: DOMRect): void {
      setColorPopoverRect(previous => (previous ? null : rect))
   }

   const resolvedColor = resolveSeriesColor(0, color, theme)
   const binsInvalid = binsFieldIsInvalid()

   return (
      <div className="graph-histogram-editor graph-editor-group">
         {/* Identity leads (swatch + name), like every other editor, then the samples, then bins. */}
         <label className="graph-field">
            <span className="graph-field-label">{t.graphHistogramName}</span>
            <div className="graph-lead-inner">
               <button
                  type="button"
                  className="graph-lead-swatch"
                  data-graph-color-trigger
                  style={{ background: resolvedColor }}
                  aria-label={t.graphHistogramColor}
                  title={t.graphHistogramColor}
                  onClick={event => toggleColorPopover(event.currentTarget.getBoundingClientRect())}
               />
               <input
                  className="graph-lead-name graph-histogram-name-input"
                  type="text"
                  value={name ?? ''}
                  placeholder={t.graphHistogramName}
                  aria-label={t.graphHistogramName}
                  onFocus={onEditStart}
                  onChange={event => handleNameChange(event.target.value)}
                  onBlur={onCommitField}
               />
            </div>
         </label>

         <label className="graph-field">
            <span className="graph-field-label">{t.graphHistogramSamples}</span>
            <textarea
               className="graph-text-input graph-histogram-samples"
               value={samplesFieldText()}
               placeholder={t.graphHistogramSamplesPlaceholder}
               aria-label={t.graphHistogramSamples}
               onFocus={handleSamplesFocus}
               onChange={event => handleSamplesChange(event.target.value)}
               onBlur={handleSamplesBlur}
            />
         </label>

         <label className="graph-field graph-histogram-bins-field">
            <span className="graph-field-label">{t.graphHistogramBins}</span>
            <div className="graph-histogram-bins-inner">
               <input
                  className={`graph-text-input graph-histogram-bins-input${binsInvalid ? ' is-invalid' : ''}`}
                  type="text"
                  inputMode="numeric"
                  value={binsFieldText()}
                  placeholder={t.graphHistogramBinsAuto}
                  aria-label={t.graphHistogramBins}
                  aria-invalid={binsInvalid || undefined}
                  title={binsInvalid ? t.graphInvalidNumber : undefined}
                  onFocus={handleBinsFocus}
                  onChange={event => handleBinsChange(event.target.value)}
                  onBlur={handleBinsBlur}
               />
               <span className="graph-histogram-bins-readout">
                  {effectiveBinCount} {t.graphHistogramBinsUnit}
               </span>
            </div>
         </label>

         {colorPopoverRect && (
            <GraphSeriesColorPopover
               anchorRect={colorPopoverRect}
               value={resolvedColor}
               title={t.graphHistogramColor}
               resetLabel={t.graphResetColor}
               onPick={hex => onCommit(setHistogramColor(spec, hex))}
               onReset={() => { onCommit(setHistogramColor(spec, undefined)); setColorPopoverRect(null) }}
               onClose={() => setColorPopoverRect(null)}
            />
         )}
      </div>
   )
}

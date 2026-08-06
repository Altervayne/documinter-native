import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, Minus, Plus } from 'lucide-react'
import { Button } from '../atoms/Button'
import {
   MATRIX_BRACKETS,
   buildMatrixLatex,
   buildCasesLatex,
   buildAlignedLatex,
} from '../lib/mathStructures'
import type { MatrixBracket, CasesRow, AlignedRow, MathBuilderKind } from '../lib/mathStructures'
import { renderLatexToMathML, ensureTemmlStyles, isTemmlReady, onTemmlReady } from '../lib/math'
import { buildSnippetInsertion } from '../lib/mathSymbols'
import { MathSymbolPalette } from './MathSymbolPalette'
import { useLang } from '../contexts/LangContext'

// #############
// # CONSTANTS #
// #############

/** Row / column counts are clamped to this range in every builder mode. */
const MIN_DIMENSION = 1
const MAX_DIMENSION = 8

/** Default construct sizes when the modal opens. */
const DEFAULT_MATRIX_SIZE = 2   // 2 rows x 2 columns
const DEFAULT_ROW_COUNT    = 2  // cases / aligned start with two rows

// #########
// # TYPES #
// #########

interface MathBuilderModalProps {
   /** Which construct to build; drives the modal title and the mode-specific body. */
   kind:     MathBuilderKind
   /** Optional preset bracket for the matrix mode (from the palette's matrix-env entries). */
   bracket?: MatrixBracket
   /** Called with the emitted LaTeX; the caller splices it at the captured caret and closes. */
   onInsert: (latex: string) => void
   /** Close without inserting (Cancel / Escape / backdrop). */
   onClose:  () => void
}

/**
 * A snapshot of the cell that was focused when the in-modal f(x) palette opened. The palette
 * steals focus (its filter autofocuses), so the target cell, its value, its live selection, its
 * DOM node, and the setter that writes it back, must be captured UP FRONT, then a symbol insert
 * splices into `value` at `[selectionStart, selectionEnd)` and hands the result to `setValue`.
 */
interface ActiveCellSnapshot {
   element:        HTMLInputElement
   setValue:       (next: string) => void
   value:          string
   selectionStart: number
   selectionEnd:   number
}

// ###########
// # HELPERS #
// ###########

/** Clamp a dimension (row / column count) into the allowed range. */
function clampDimension(value: number): number {
   return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, value))
}

/**
 * Resize a 2D grid to `rowCount` x `columnCount`, preserving every existing cell value that
 * still fits and filling new positions with an empty string. Pure, returns a fresh grid.
 */
function resizeGrid(grid: string[][], rowCount: number, columnCount: number): string[][] {
   const result: string[][] = []
   for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row: string[] = []
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
         row.push(grid[rowIndex]?.[columnIndex] ?? '')
      }
      result.push(row)
   }
   return result
}

/** Resize a list of row objects, preserving existing entries and filling new ones with `make`. */
function resizeRows<RowType>(rows: RowType[], rowCount: number, make: () => RowType): RowType[] {
   const result: RowType[] = []
   for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      result.push(rows[rowIndex] ?? make())
   }
   return result
}

// #####################
// # STEPPER SUB-WIDGET #
// #####################

interface StepperControlProps {
   label:    string
   value:    number
   onChange: (next: number) => void
}

/** A compact label + [-] value [+] stepper, clamped to the dimension range. */
function StepperControl({ label, value, onChange }: StepperControlProps) {
   const atMin = value <= MIN_DIMENSION
   const atMax = value >= MAX_DIMENSION
   return (
      <div className="math-builder-stepper">
         <span className="math-builder-stepper-label">{label}</span>
         <div className="math-builder-stepper-controls">
            <button
               type="button"
               className="math-builder-stepper-btn"
               onClick={() => onChange(clampDimension(value - 1))}
               disabled={atMin}
               aria-label={`${label} −`}
            ><Minus size={13} /></button>
            <span className="math-builder-stepper-value">{value}</span>
            <button
               type="button"
               className="math-builder-stepper-btn"
               onClick={() => onChange(clampDimension(value + 1))}
               disabled={atMax}
               aria-label={`${label} +`}
            ><Plus size={13} /></button>
         </div>
      </div>
   )
}

// #############
// # COMPONENT #
// #############

/**
 * Structured-construct builder for the math block. One centered modal (chrome mirrors
 * ExportModal) whose body switches on `kind`: a matrix grid, a cases/piecewise table, or an
 * aligned system. The user fills cells/rows instead of hand-writing the `&` / `\\` grammar;
 * a live Temml preview mirrors what will be inserted. Insert hands the emitted LaTeX back
 * through `onInsert`; the caret contract (where it lands) is owned by MathBlock, which
 * captured the textarea selection at the moment this modal opened.
 *
 * All construct state lives here. Every state hook is declared unconditionally (React rules);
 * only the slice matching `kind` is rendered and fed to the matching emitter.
 */
export function MathBuilderModal({ kind, bracket, onInsert, onClose }: MathBuilderModalProps) {
   const { t } = useLang()

   // Ensure Temml's correction CSS is present for the in-modal preview (idempotent; MathBlock
   // already injects it, but the modal must not assume a particular mount order).
   useEffect(() => { ensureTemmlStyles() }, [])

   // Re-render once Temml's raw asset finishes loading, so the preview stops showing "rendering...".
   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   // ==============
   //  Mode state
   // ==============
   // Matrix: a 2D grid of raw-LaTeX cells + the chosen bracket. Rows/columns are derived from
   // the grid shape, so resizing preserves values through resizeGrid().
   const [grid, setGrid] = useState<string[][]>(() =>
      resizeGrid([], DEFAULT_MATRIX_SIZE, DEFAULT_MATRIX_SIZE),
   )
   const [matrixBracket, setMatrixBracket] = useState<MatrixBracket>(bracket ?? 'square')

   // Cases: rows of { value, condition }.
   const [caseRows, setCaseRows] = useState<CasesRow[]>(() =>
      resizeRows<CasesRow>([], DEFAULT_ROW_COUNT, () => ({ value: '', condition: '' })),
   )

   // Aligned: rows of { left, right } aligned at `=`, plus the optional system brace.
   const [alignedRows, setAlignedRows] = useState<AlignedRow[]>(() =>
      resizeRows<AlignedRow>([], DEFAULT_ROW_COUNT, () => ({ left: '', right: '' })),
   )
   const [systemBrace, setSystemBrace] = useState(false)

   // Derived matrix dimensions.
   const rowCount    = kind === 'matrix' ? grid.length          : 0
   const columnCount = kind === 'matrix' ? (grid[0]?.length ?? 0) : 0

   // ==================
   //  Emitted LaTeX
   // ==================
   const latex =
      kind === 'matrix' ? buildMatrixLatex(grid, matrixBracket)
      : kind === 'cases' ? buildCasesLatex(caseRows)
      : buildAlignedLatex(alignedRows, { systemBrace })

   // Live preview render (readiness-gated; never throws, mirrors MathBlock).
   const rendered = temmlReady ? renderLatexToMathML(latex, true) : null

   const title =
      kind === 'matrix' ? t.mathBuilderMatrixTitle
      : kind === 'cases' ? t.mathBuilderCasesTitle
      : t.mathBuilderAlignedTitle

   // =======================
   //  Cell / row mutation
   // =======================
   function setCell(rowIndex: number, columnIndex: number, value: string): void {
      setGrid(current => current.map((row, currentRow) =>
         currentRow === rowIndex
            ? row.map((cell, currentColumn) => (currentColumn === columnIndex ? value : cell))
            : row,
      ))
   }

   function setCaseField(rowIndex: number, field: keyof CasesRow, value: string): void {
      setCaseRows(current => current.map((row, currentRow) =>
         currentRow === rowIndex ? { ...row, [field]: value } : row,
      ))
   }

   function setAlignedField(rowIndex: number, field: keyof AlignedRow, value: string): void {
      setAlignedRows(current => current.map((row, currentRow) =>
         currentRow === rowIndex ? { ...row, [field]: value } : row,
      ))
   }

   // ==================================
   //  In-modal symbol palette (per cell)
   // ==================================
   // The f(x) palette lets a cell hold real LaTeX (\pi, \frac{}{}, ...). It mirrors MathBlock's
   // caret contract, but the "source" is whichever cell input was last focused.
   const modalRef = useRef<HTMLDivElement>(null)

   // The last-focused cell: its DOM node + the setter that writes it back. Registered on each
   // input's onFocus; read (live) when f(x) is pressed so the snapshot reflects the real cursor.
   const activeCellRef = useRef<{ element: HTMLInputElement; setValue: (next: string) => void } | null>(null)
   function registerActiveCell(element: HTMLInputElement, setValue: (next: string) => void): void {
      activeCellRef.current = { element, setValue }
   }

   const [paletteOpen,   setPaletteOpen]   = useState(false)
   const [paletteAnchor, setPaletteAnchor] = useState<DOMRect | null>(null)
   const snapshotRef = useRef<ActiveCellSnapshot | null>(null)

   // After a symbol is spliced into a cell, refocus that cell input and restore the caret. Keyed
   // to the pending target so it runs after React commits the cell's new value (same shape as
   // MathBlock's pending-caret effect), the caret lands correctly despite the value changing.
   const [pendingCaret, setPendingCaret] = useState<{ element: HTMLInputElement; offset: number } | null>(null)
   useLayoutEffect(() => {
      if (pendingCaret === null) return
      pendingCaret.element.focus()
      pendingCaret.element.setSelectionRange(pendingCaret.offset, pendingCaret.offset)
      setPendingCaret(null)
   }, [pendingCaret])

   // Fallback when f(x) is pressed with no cell focused: target the first cell (first input in DOM
   // order, which is row 0 / left column for every mode). Returns null only if no cell exists.
   function firstCellSnapshot(): ActiveCellSnapshot | null {
      const element = modalRef.current?.querySelector<HTMLInputElement>('.math-builder-input')
      if (!element) return null
      const setValue =
         kind === 'matrix' ? (next: string) => setCell(0, 0, next)
         : kind === 'cases' ? (next: string) => setCaseField(0, 'value', next)
         : (next: string) => setAlignedField(0, 'left', next)
      return { element, setValue, value: element.value, selectionStart: element.value.length, selectionEnd: element.value.length }
   }

   // f(x) pressed: snapshot the target cell UP FRONT (the palette autofocus will blur it), then
   // open/anchor the palette. MOUSEDOWN + preventDefault so the cell input does not blur here.
   function toggleCellPalette(event: React.MouseEvent<HTMLButtonElement>): void {
      event.preventDefault()
      if (paletteOpen) { setPaletteOpen(false); return }
      const active = activeCellRef.current
      const snapshot: ActiveCellSnapshot | null = active
         ? {
              element:        active.element,
              setValue:       active.setValue,
              value:          active.element.value,
              selectionStart: active.element.selectionStart ?? active.element.value.length,
              selectionEnd:   active.element.selectionEnd   ?? active.element.value.length,
           }
         : firstCellSnapshot()
      if (!snapshot) return   // no cells to target, no-op gracefully, never throw
      snapshotRef.current = snapshot
      setPaletteAnchor(event.currentTarget.getBoundingClientRect())
      setPaletteOpen(true)
   }

   // Splice the chosen symbol into the snapshotted cell via the SHARED resolver (marker / selection
   // wrap handled there), write it back through the cell setter, close the palette, and schedule
   // the caret restore. No cell snapshot -> no-op.
   function insertSymbolIntoCell(insert: string): void {
      const snapshot = snapshotRef.current
      if (!snapshot) return
      const selectedText = snapshot.value.slice(snapshot.selectionStart, snapshot.selectionEnd)
      const { text, caretOffset } = buildSnippetInsertion(insert, selectedText)
      const nextValue =
         snapshot.value.slice(0, snapshot.selectionStart) + text + snapshot.value.slice(snapshot.selectionEnd)
      snapshot.setValue(nextValue)
      setPaletteOpen(false)
      setPendingCaret({ element: snapshot.element, offset: snapshot.selectionStart + caretOffset })
   }

   // ==========
   //  Escape
   // ==========
   // Escape closes without inserting; stop propagation so it does not also reach the editor.
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onClose])

   // =======
   //  Render
   // =======
   return (
      <div
         className="fixed inset-0 z-50 flex items-center justify-center"
         onClick={onClose}
      >
         {/* Backdrop */}
         <div className="absolute inset-0 bg-black/50" />

         {/* Modal */}
         <div
            ref={modalRef}
            className="relative z-10 bg-raised border border-border rounded-xl shadow-2xl p-5 w-[28rem] max-w-[92vw] flex flex-col gap-4"
            onClick={event => event.stopPropagation()}
         >
            {/* Header */}
            <div className="flex items-center justify-between">
               <span className="text-sm font-semibold text-text">{title}</span>
               <div className="flex items-center gap-1.5">
                  <button
                     type="button"
                     className={`math-builder-bracket-btn${paletteOpen ? ' is-active' : ''}`}
                     // f(x) opens the symbol palette targeting the focused cell. MOUSEDOWN +
                     // preventDefault keeps the cell input focused so its selection is snapshotable.
                     onMouseDown={toggleCellPalette}
                     aria-label={t.blockMathInsertSymbol}
                     aria-expanded={paletteOpen}
                     title={t.blockMathInsertSymbol}
                  >ƒ(x)</button>
                  <button
                     onClick={onClose}
                     className="text-muted hover:text-text transition-colors rounded p-0.5"
                     aria-label={t.mathBuilderCancel}
                  >
                     <X size={14} />
                  </button>
               </div>
            </div>

            {/* ===== Matrix mode ===== */}
            {kind === 'matrix' && (
               <>
                  {/* Bracket selector */}
                  <div className="flex flex-col gap-2">
                     <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.mathBuilderBracket}</span>
                     <div className="flex flex-wrap gap-1.5">
                        {MATRIX_BRACKETS.map(descriptor => (
                           <button
                              key={descriptor.key}
                              type="button"
                              onClick={() => setMatrixBracket(descriptor.key)}
                              className={`math-builder-bracket-btn${matrixBracket === descriptor.key ? ' is-active' : ''}`}
                           >
                              {descriptor.glyph}
                           </button>
                        ))}
                     </div>
                  </div>

                  {/* Row / column steppers */}
                  <div className="flex gap-4">
                     <StepperControl
                        label={t.mathBuilderRows}
                        value={rowCount}
                        onChange={next => setGrid(current => resizeGrid(current, next, columnCount))}
                     />
                     <StepperControl
                        label={t.mathBuilderColumns}
                        value={columnCount}
                        onChange={next => setGrid(current => resizeGrid(current, rowCount, next))}
                     />
                  </div>

                  {/* Cell grid */}
                  <div
                     className="math-builder-grid"
                     style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
                  >
                     {grid.map((row, rowIndex) =>
                        row.map((cell, columnIndex) => (
                           <input
                              key={`${rowIndex}-${columnIndex}`}
                              type="text"
                              className="math-builder-input"
                              value={cell}
                              spellCheck={false}
                              onFocus={event => registerActiveCell(event.currentTarget, next => setCell(rowIndex, columnIndex, next))}
                              onChange={event => setCell(rowIndex, columnIndex, event.target.value)}
                              aria-label={`row ${rowIndex + 1}, column ${columnIndex + 1}`}
                           />
                        )),
                     )}
                  </div>
               </>
            )}

            {/* ===== Cases mode ===== */}
            {kind === 'cases' && (
               <>
                  <StepperControl
                     label={t.mathBuilderRows}
                     value={caseRows.length}
                     onChange={next => setCaseRows(current =>
                        resizeRows<CasesRow>(current, next, () => ({ value: '', condition: '' })),
                     )}
                  />
                  <div className="math-builder-rows">
                     <div className="math-builder-row-head">
                        <span>{t.mathBuilderValue}</span>
                        <span>{t.mathBuilderCondition}</span>
                     </div>
                     {caseRows.map((row, rowIndex) => (
                        <div key={rowIndex} className="math-builder-row">
                           <input
                              type="text"
                              className="math-builder-input"
                              value={row.value}
                              spellCheck={false}
                              onFocus={event => registerActiveCell(event.currentTarget, next => setCaseField(rowIndex, 'value', next))}
                              onChange={event => setCaseField(rowIndex, 'value', event.target.value)}
                              aria-label={`${t.mathBuilderValue} ${rowIndex + 1}`}
                           />
                           <input
                              type="text"
                              className="math-builder-input"
                              value={row.condition}
                              spellCheck={false}
                              onFocus={event => registerActiveCell(event.currentTarget, next => setCaseField(rowIndex, 'condition', next))}
                              onChange={event => setCaseField(rowIndex, 'condition', event.target.value)}
                              aria-label={`${t.mathBuilderCondition} ${rowIndex + 1}`}
                           />
                        </div>
                     ))}
                  </div>
               </>
            )}

            {/* ===== Aligned mode ===== */}
            {kind === 'aligned' && (
               <>
                  <StepperControl
                     label={t.mathBuilderRows}
                     value={alignedRows.length}
                     onChange={next => setAlignedRows(current =>
                        resizeRows<AlignedRow>(current, next, () => ({ left: '', right: '' })),
                     )}
                  />
                  <div className="math-builder-rows">
                     <div className="math-builder-row-head">
                        <span>{t.mathBuilderLeft}</span>
                        <span>{t.mathBuilderRight}</span>
                     </div>
                     {alignedRows.map((row, rowIndex) => (
                        <div key={rowIndex} className="math-builder-row">
                           <input
                              type="text"
                              className="math-builder-input"
                              value={row.left}
                              spellCheck={false}
                              onFocus={event => registerActiveCell(event.currentTarget, next => setAlignedField(rowIndex, 'left', next))}
                              onChange={event => setAlignedField(rowIndex, 'left', event.target.value)}
                              aria-label={`${t.mathBuilderLeft} ${rowIndex + 1}`}
                           />
                           <input
                              type="text"
                              className="math-builder-input"
                              value={row.right}
                              spellCheck={false}
                              onFocus={event => registerActiveCell(event.currentTarget, next => setAlignedField(rowIndex, 'right', next))}
                              onChange={event => setAlignedField(rowIndex, 'right', event.target.value)}
                              aria-label={`${t.mathBuilderRight} ${rowIndex + 1}`}
                           />
                        </div>
                     ))}
                  </div>
                  <label className="math-builder-checkbox">
                     <input
                        type="checkbox"
                        checked={systemBrace}
                        onChange={event => setSystemBrace(event.target.checked)}
                     />
                     <span>{t.mathBuilderSystemBrace}</span>
                  </label>
               </>
            )}

            {/* ===== Live preview ===== */}
            <div className="flex flex-col gap-2">
               <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.mathBuilderPreview}</span>
               {/* text-text pins the preview MathML to the APP text color (the builder is app chrome),
                   so the equation stays visible on a light app theme instead of inheriting a light
                   document-theme color from the surrounding page. */}
               <div className="math-builder-preview text-text">
                  {!rendered && <span className="math-loading">{t.blockMathLoading}</span>}
                  {rendered?.ok && (
                     <div className="doc-math">
                        <span dangerouslySetInnerHTML={{ __html: rendered.mathml }} />
                     </div>
                  )}
                  {rendered && !rendered.ok && <span className="math-error">{rendered.error}</span>}
               </div>
            </div>

            {/* ===== Actions ===== */}
            <div className="flex gap-2 pt-1">
               <Button variant="ghost" className="flex-1" onClick={onClose}>
                  {t.mathBuilderCancel}
               </Button>
               <Button variant="primary" className="flex-1" onClick={() => onInsert(latex)}>
                  {t.mathBuilderInsert}
               </Button>
            </div>

            {/* In-modal symbol palette. It portals to document.body (z-index 9999) so it renders
                ABOVE this modal (z-50). showGenerators is false, the recursion guard: a builder
                must never offer to open another builder. onOpenBuilder is unreachable here. */}
            {paletteOpen && paletteAnchor && (
               <MathSymbolPalette
                  anchorRect={paletteAnchor}
                  onInsert={insertSymbolIntoCell}
                  onOpenBuilder={() => {}}
                  showGenerators={false}
                  onClose={() => setPaletteOpen(false)}
               />
            )}
         </div>
      </div>
   )
}

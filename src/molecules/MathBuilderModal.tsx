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

const MIN_DIMENSION = 1
const MAX_DIMENSION = 8

const DEFAULT_MATRIX_SIZE = 2
const DEFAULT_ROW_COUNT    = 2

// #########
// # TYPES #
// #########

interface MathBuilderModalProps {
   kind:     MathBuilderKind
   bracket?: MatrixBracket
   /** Emitted LaTeX; the caller splices it at the captured caret and closes. */
   onInsert: (latex: string) => void
   onClose:  () => void
}

/**
 * Snapshot of the cell focused when the f(x) palette opened. The palette's filter autofocuses and
 * steals focus, so the cell, its value, its selection and its write-back setter are captured up
 * front; a symbol insert then splices into `value` at `[selectionStart, selectionEnd)`.
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

function clampDimension(value: number): number {
   return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, value))
}

/** Resize a grid, preserving cells that still fit and filling new positions with ''. Pure. */
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

/** Resize a row list, preserving existing entries and filling new ones with `make`. */
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
 * Structured-construct builder for the math block: one modal whose body switches on `kind` between
 * a matrix grid, a cases table, and an aligned system, so the user fills cells instead of writing
 * the `&` / `\\` grammar. Insert hands the LaTeX back through `onInsert`; the caret contract is
 * owned by MathBlock, which captured the textarea selection when this modal opened. Every state
 * hook is declared unconditionally (React rules); only the `kind` slice is rendered and emitted.
 */
export function MathBuilderModal({ kind, bracket, onInsert, onClose }: MathBuilderModalProps) {
   const { t } = useLang()

   // Idempotent; MathBlock already injects the styles, but the modal cannot assume a mount order.
   useEffect(() => { ensureTemmlStyles() }, [])

   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   // ==============
   //  Mode state
   // ==============
   // Rows/columns are derived from the grid shape, so resizing preserves values via resizeGrid().
   const [grid, setGrid] = useState<string[][]>(() =>
      resizeGrid([], DEFAULT_MATRIX_SIZE, DEFAULT_MATRIX_SIZE),
   )
   const [matrixBracket, setMatrixBracket] = useState<MatrixBracket>(bracket ?? 'square')

   const [caseRows, setCaseRows] = useState<CasesRow[]>(() =>
      resizeRows<CasesRow>([], DEFAULT_ROW_COUNT, () => ({ value: '', condition: '' })),
   )

   const [alignedRows, setAlignedRows] = useState<AlignedRow[]>(() =>
      resizeRows<AlignedRow>([], DEFAULT_ROW_COUNT, () => ({ left: '', right: '' })),
   )
   const [systemBrace, setSystemBrace] = useState(false)

   const rowCount    = kind === 'matrix' ? grid.length          : 0
   const columnCount = kind === 'matrix' ? (grid[0]?.length ?? 0) : 0

   // ==================
   //  Emitted LaTeX
   // ==================
   const latex =
      kind === 'matrix' ? buildMatrixLatex(grid, matrixBracket)
      : kind === 'cases' ? buildCasesLatex(caseRows)
      : buildAlignedLatex(alignedRows, { systemBrace })

   // Readiness-gated; never throws, mirrors MathBlock.
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
   // The f(x) palette mirrors MathBlock's caret contract, but the source is whichever cell input
   // was last focused.
   const modalRef = useRef<HTMLDivElement>(null)

   // The last-focused cell. Read live when f(x) is pressed so the snapshot reflects the real cursor.
   const activeCellRef = useRef<{ element: HTMLInputElement; setValue: (next: string) => void } | null>(null)
   function registerActiveCell(element: HTMLInputElement, setValue: (next: string) => void): void {
      activeCellRef.current = { element, setValue }
   }

   const [paletteOpen,   setPaletteOpen]   = useState(false)
   const [paletteAnchor, setPaletteAnchor] = useState<DOMRect | null>(null)
   const snapshotRef = useRef<ActiveCellSnapshot | null>(null)

   // Keyed to the pending target so it runs after React commits the cell's new value, restoring the
   // caret despite the value changing (mirrors MathBlock's pending-caret effect).
   const [pendingCaret, setPendingCaret] = useState<{ element: HTMLInputElement; offset: number } | null>(null)
   useLayoutEffect(() => {
      if (pendingCaret === null) return
      pendingCaret.element.focus()
      pendingCaret.element.setSelectionRange(pendingCaret.offset, pendingCaret.offset)
      setPendingCaret(null)
   }, [pendingCaret])

   // Fallback when f(x) is pressed with no cell focused: target the first input in DOM order.
   function firstCellSnapshot(): ActiveCellSnapshot | null {
      const element = modalRef.current?.querySelector<HTMLInputElement>('.math-builder-input')
      if (!element) return null
      const setValue =
         kind === 'matrix' ? (next: string) => setCell(0, 0, next)
         : kind === 'cases' ? (next: string) => setCaseField(0, 'value', next)
         : (next: string) => setAlignedField(0, 'left', next)
      return { element, setValue, value: element.value, selectionStart: element.value.length, selectionEnd: element.value.length }
   }

   // Snapshot the target cell up front (the palette autofocus will blur it), then anchor + open.
   // Mousedown + preventDefault so the cell input does not blur here.
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
      if (!snapshot) return
      snapshotRef.current = snapshot
      setPaletteAnchor(event.currentTarget.getBoundingClientRect())
      setPaletteOpen(true)
   }

   // Splice the symbol into the snapshotted cell via the shared resolver (marker / selection wrap
   // handled there), write it back, close, and schedule the caret restore.
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

   // Escape closes without inserting; stop propagation so it does not also reach the editor.
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onClose])

   return (
      <div
         className="fixed inset-0 z-50 flex items-center justify-center"
         onClick={onClose}
      >
         <div className="absolute inset-0 bg-black/50" />

         <div
            ref={modalRef}
            className="relative z-10 bg-raised border border-border rounded-xl shadow-2xl p-5 w-[28rem] max-w-[92vw] flex flex-col gap-4"
            onClick={event => event.stopPropagation()}
         >
            <div className="flex items-center justify-between">
               <span className="text-sm font-semibold text-text">{title}</span>
               <div className="flex items-center gap-1.5">
                  <button
                     type="button"
                     className={`math-builder-bracket-btn${paletteOpen ? ' is-active' : ''}`}
                     // Mousedown + preventDefault keeps the cell focused so its selection stays snapshotable.
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

            {kind === 'matrix' && (
               <>
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

            <div className="flex flex-col gap-2">
               <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.mathBuilderPreview}</span>
               {/* text-text pins the preview to the app text color so it stays visible on a light app
                   theme instead of inheriting a document-theme color from the page. */}
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

            <div className="flex gap-2 pt-1">
               <Button variant="ghost" className="flex-1" onClick={onClose}>
                  {t.mathBuilderCancel}
               </Button>
               <Button variant="primary" className="flex-1" onClick={() => onInsert(latex)}>
                  {t.mathBuilderInsert}
               </Button>
            </div>

            {/* Portals to document.body (z 9999) so it renders above this modal (z-50).
                showGenerators is false: a builder must never open another builder. */}
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

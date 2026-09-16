import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderLatexToMathML, ensureTemmlStyles, isTemmlReady, onTemmlReady } from '../../../lib/math'
import { DEFAULT_MATH_SCALE, MATH_SCALE_STEPS, stepMathScale } from '../../../lib/mathScale'
import { buildSnippetInsertion } from '../../../lib/mathSymbols'
import { MathSymbolPaletteContent } from '../../../molecules/MathSymbolPalette'
import { MathBuilderModal } from '../../../molecules/MathBuilderModal'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'
import type { MathBuilderKind, MatrixBracket } from '../../../lib/mathStructures'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

/** Wrapper font-size for the rendered MathML (it scales with `em`). Normal size stays unset so the
 *  default markup is untouched, keeping in-app parity with the byte-identical HTML export. */
function mathScaleStyle(scale: number): { fontSize: string } | undefined {
   return scale === DEFAULT_MATH_SCALE ? undefined : { fontSize: `${scale}em` }
}

interface MathBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

/*
 * The math equation block: the LaTeX source (`latex`) renders to native MathML via Temml for both the
 * editor preview and the read-only view. Invalid LaTeX never breaks the document; the parse error
 * surfaces in the preview while the source stays editable.
 */
export function MathBlock({ block, patch, readOnly }: MathBlockProps) {
   const { t } = useLang()

   // Local draft so the preview updates live without spamming a mutation; committed on blur.
   const [draft, setDraft] = useState(block.latex ?? '')
   const editing = useRef(false)

   // Symbol palette: an assisted-input tool over the same `latex` source, in a persistent draggable
   // BlockEditorWindow (a per-block tool, not a modal). The textarea ref lets an inserted snippet read
   // the live caret and hand focus back; focusOnOpen={false} keeps the textarea focused while inserting.
   const textareaRef = useRef<HTMLTextAreaElement>(null)
   const rootRef = useRef<HTMLDivElement>(null)
   const [paletteOpen,   setPaletteOpen]   = useState(false)
   // The math block's viewport rect at open time; the window sits offset from it, then clamps.
   const [paletteAnchor, setPaletteAnchor] = useState<DOMRect | null>(null)

   // A snippet insert mutates `draft` synchronously; this pending caret offset restores focus +
   // selection AFTER React commits the new value (via a layout effect keyed to it).
   const [pendingCaret, setPendingCaret] = useState<number | null>(null)

   // Structured-construct builder (matrix / cases / aligned). `builderKind` holds the open request;
   // `builderCaret` snapshots the selection at OPEN time, since the modal steals focus.
   const [builderKind,  setBuilderKind]  = useState<{ kind: MathBuilderKind; bracket?: MatrixBracket } | null>(null)
   const [builderCaret, setBuilderCaret] = useState<{ start: number; end: number } | null>(null)

   // Temml loads as a raw asset (see lib/math.ts), so on first paint it may not be ready. Track
   // readiness and re-render on load; until then show a placeholder rather than a transient load error.
   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   // Inject Temml's rendering-correction CSS once, so the in-app MathML matches export.
   useEffect(() => { ensureTemmlStyles() }, [])

   // External changes (undo, tab switch, load) sync in only when not actively editing.
   useEffect(() => {
      if (!editing.current) setDraft(block.latex ?? '')
   }, [block.latex])

   // After a palette insert commits the new `draft`, put focus back with the caret at the computed
   // offset. Runs before paint so there is no visible jump.
   useLayoutEffect(() => {
      if (pendingCaret === null) return
      const textarea = textareaRef.current
      if (textarea) {
         textarea.focus()
         textarea.setSelectionRange(pendingCaret, pendingCaret)
      }
      setPendingCaret(null)
   }, [pendingCaret])

   // Core splice, shared by the palette insert (live selection) and the builder insert (a captured
   // caret). Resolves the snippet against the selection, splices it in, schedules the caret restore.
   // Marks `editing` but commits on blur.
   function spliceInsertAt(insert: string, selectionStart: number, selectionEnd: number): void {
      const selectedText = draft.slice(selectionStart, selectionEnd)
      const { text, caretOffset } = buildSnippetInsertion(insert, selectedText)
      editing.current = true
      setDraft(draft.slice(0, selectionStart) + text + draft.slice(selectionEnd))
      setPendingCaret(selectionStart + caretOffset)
   }

   function insertSnippet(insert: string): void {
      const textarea = textareaRef.current
      if (!textarea) return
      spliceInsertAt(insert, textarea.selectionStart, textarea.selectionEnd)
   }

   // Open request from the palette: snapshot the selection before the modal steals focus, then open
   // the builder and close the palette.
   function openBuilder(kind: MathBuilderKind, bracket?: MatrixBracket): void {
      const textarea = textareaRef.current
      const start = textarea ? textarea.selectionStart : draft.length
      const end   = textarea ? textarea.selectionEnd   : draft.length
      setBuilderCaret({ start, end })
      setBuilderKind({ kind, bracket })
      setPaletteOpen(false)
   }

   // Builder Insert: splice the emitted LaTeX at the captured selection, then close the modal. The
   // pending-caret layout effect hands focus back.
   function insertFromBuilder(latex: string): void {
      const caret = builderCaret ?? { start: draft.length, end: draft.length }
      spliceInsertAt(latex, caret.start, caret.end)
      setBuilderKind(null)
      setBuilderCaret(null)
   }

   function togglePalette(): void {
      if (paletteOpen) { setPaletteOpen(false); return }
      // Anchor off the whole math block, so the window sits beside the source rather than the tiny button.
      setPaletteAnchor(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      setPaletteOpen(true)
   }

   // Display scale (absent = normal). Applied to the `.doc-math` wrapper, matching the HTML export.
   const scale      = block.mathScale ?? DEFAULT_MATH_SCALE
   const scaleStyle = mathScaleStyle(scale)

   // ================
   //  Read-only view
   // ================
   if (readOnly) {
      const latex = (block.latex ?? '').trim()
      if (latex === '') return null   // an empty formula shows nothing in the read view
      if (!temmlReady) {
         return <div className="doc-math"><span className="math-loading">{t.blockMathLoading}</span></div>
      }
      const rendered = renderLatexToMathML(latex, true)
      return (
         <div className="doc-math" style={scaleStyle}>
            {rendered.ok
               ? <span dangerouslySetInnerHTML={{ __html: rendered.mathml }} />
               : <code className="doc-math-error">{latex}</code>}
         </div>
      )
   }

   // ============
   //  Editor view
   // ============
   const trimmed  = draft.trim()
   const rendered = trimmed === '' || !temmlReady ? null : renderLatexToMathML(trimmed, true)

   // Discrete size stepper (A- / A+): walk the allowed size steps, clamped, committing immediately.
   const atMinScale = scale <= MATH_SCALE_STEPS[0]
   const atMaxScale = scale >= MATH_SCALE_STEPS[MATH_SCALE_STEPS.length - 1]
   function changeScale(direction: 1 | -1): void {
      const next = stepMathScale(scale, direction)
      if (next === scale) return
      // Store the default as absent so unscaled blocks stay clean in serialization + JSON backup.
      patch({ mathScale: next === DEFAULT_MATH_SCALE ? undefined : next })
   }

   return (
      <div className="math-block" ref={rootRef}>
         <div className="math-toolbar">
            <button
               type="button"
               className={paletteOpen ? 'math-palette-btn is-active' : 'math-palette-btn'}
               onClick={togglePalette}
               aria-label={t.blockMathInsertSymbol}
               aria-expanded={paletteOpen}
               title={t.blockMathInsertSymbol}
            >ƒ(x)</button>
            <span className="math-toolbar-spacer" />
            <span className="math-size-label">{t.blockMathSize}</span>
            <div className="math-size-stepper">
               <button
                  type="button"
                  className="math-size-btn"
                  onClick={() => changeScale(-1)}
                  disabled={atMinScale}
                  aria-label={t.blockMathSizeDecrease}
                  title={t.blockMathSizeDecrease}
               >A−</button>
               <span className="math-size-value">{Math.round(scale * 100)}%</span>
               <button
                  type="button"
                  className="math-size-btn"
                  onClick={() => changeScale(1)}
                  disabled={atMaxScale}
                  aria-label={t.blockMathSizeIncrease}
                  title={t.blockMathSizeIncrease}
               >A+</button>
            </div>
         </div>
         <textarea
            ref={textareaRef}
            className="math-source"
            value={draft}
            spellCheck={false}
            placeholder={t.blockMathPlaceholder}
            onFocus={() => { editing.current = true }}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
               editing.current = false
               if (draft !== (block.latex ?? '')) patch({ latex: draft })
            }}
         />
         <div className="math-preview">
            {trimmed !== '' && !temmlReady && <span className="math-loading">{t.blockMathLoading}</span>}
            {trimmed === '' && <span className="math-empty">{t.blockMathEmpty}</span>}
            {rendered?.ok && (
               <div className="doc-math" style={scaleStyle}>
                  <span dangerouslySetInnerHTML={{ __html: rendered.mathml }} />
               </div>
            )}
            {rendered && !rendered.ok && <span className="math-error">{rendered.error}</span>}
         </div>
         {paletteOpen && paletteAnchor && (
            <BlockEditorWindow
               title={t.blockMathInsertSymbol}
               anchorRect={paletteAnchor}
               focusOnOpen={false}
               onClose={() => setPaletteOpen(false)}
            >
               <MathSymbolPaletteContent
                  onInsert={insertSnippet}
                  onOpenBuilder={openBuilder}
                  showGenerators={true}
                  autoFocusFilter={false}
               />
            </BlockEditorWindow>
         )}
         {builderKind && (
            <MathBuilderModal
               kind={builderKind.kind}
               bracket={builderKind.bracket}
               onInsert={insertFromBuilder}
               onClose={() => { setBuilderKind(null); setBuilderCaret(null) }}
            />
         )}
      </div>
   )
}

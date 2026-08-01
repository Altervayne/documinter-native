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

/** Wrapper font-size for the rendered MathML: the MathML scales with `em`. Normal size stays
 *  unset so the default markup is untouched (in-app parity with the byte-identical HTML export). */
function mathScaleStyle(scale: number): { fontSize: string } | undefined {
   return scale === DEFAULT_MATH_SCALE ? undefined : { fontSize: `${scale}em` }
}

interface MathBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

/**
 * Math equation block, mirroring the code block: the LaTeX source is stored on the
 * block (`latex`) and rendered to native MathML by Temml for both the live editor
 * preview and the read-only view. Invalid LaTeX never breaks the document; the parse
 * error surfaces in the preview area while the source stays editable.
 */
export function MathBlock({ block, patch, readOnly }: MathBlockProps) {
   const { t } = useLang()

   // Local draft so the preview updates live on every keystroke without spamming a
   // document mutation; the stored `latex` is committed on blur. Mirrors the
   // not-editing sync pattern used by PlainEditable.
   const [draft, setDraft] = useState(block.latex ?? '')
   const editing = useRef(false)

   // Symbol palette: a pure-UI assisted-input tool over the same `latex` source, hosted in a
   // persistent, draggable BlockEditorWindow (NOT a modal / not the block-editor-window context —
   // it is a per-block tool). The textarea ref lets an inserted snippet read the live
   // caret/selection and hand focus straight back; the palette opens with focusOnOpen={false} so
   // the source textarea keeps focus and the user can keep typing while inserting symbols.
   const textareaRef = useRef<HTMLTextAreaElement>(null)
   const rootRef = useRef<HTMLDivElement>(null)
   const [paletteOpen,   setPaletteOpen]   = useState(false)
   // The math block's viewport rect at open time; the window sits offset from it, then clamps.
   const [paletteAnchor, setPaletteAnchor] = useState<DOMRect | null>(null)

   // A snippet insert mutates `draft` synchronously, then this pending caret offset restores
   // focus + selection to the textarea AFTER React commits the new value (a layout effect keyed
   // to it, so the caret lands correctly even though the value changed in the same render).
   const [pendingCaret, setPendingCaret] = useState<number | null>(null)

   // Structured-construct builder (matrix / cases / aligned). `builderKind` holds the open
   // request; `builderCaret` snapshots the textarea selection at OPEN time — the modal steals
   // focus, so the insertion point must be captured up-front and can no longer be read live.
   const [builderKind,  setBuilderKind]  = useState<{ kind: MathBuilderKind; bracket?: MatrixBracket } | null>(null)
   const [builderCaret, setBuilderCaret] = useState<{ start: number; end: number } | null>(null)

   // Temml loads as a raw asset (see lib/math.ts), so on first paint it may not be
   // ready yet. Track readiness and re-render once the one-time load completes; until
   // then the preview/read view show a "rendering…" placeholder instead of calling
   // the (synchronous) renderer, which would otherwise report a transient load error.
   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   // Inject Temml's rendering-correction CSS once, so the in-app MathML matches export.
   useEffect(() => { ensureTemmlStyles() }, [])

   // External changes (undo, tab switch, load) sync in only when not actively editing.
   useEffect(() => {
      if (!editing.current) setDraft(block.latex ?? '')
   }, [block.latex])

   // After a palette insert has committed the new `draft`, put focus back on the textarea with
   // the caret/selection at the computed offset. Runs before paint so there is no visible jump.
   useLayoutEffect(() => {
      if (pendingCaret === null) return
      const textarea = textareaRef.current
      if (textarea) {
         textarea.focus()
         textarea.setSelectionRange(pendingCaret, pendingCaret)
      }
      setPendingCaret(null)
   }, [pendingCaret])

   // ==========================
   //  Palette snippet insertion
   // ==========================
   // Owns the caret contract because the textarea + `draft` live here. Reads the live selection,
   // resolves the snippet (marker stripped; a non-empty selection wraps into the marker slot),
   // splices it into `draft`, and schedules the caret restore. Marks `editing` so the external
   // sync does not clobber the edit, but does NOT commit `latex` — the commit-on-blur model is
   // preserved, an insert only mutates the live draft.
   // Core splice, shared by the palette insert (live selection) and the builder insert (a caret
   // captured at open time). Resolves the snippet against the selected text, splices it in, and
   // schedules the caret restore. Marks `editing` but does NOT commit — commit stays on blur.
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

   // ==========================
   //  Structured builder
   // ==========================
   // Open request from the palette: snapshot the CURRENT selection before the modal steals
   // focus, then open the builder and close the palette.
   function openBuilder(kind: MathBuilderKind, bracket?: MatrixBracket): void {
      const textarea = textareaRef.current
      const start = textarea ? textarea.selectionStart : draft.length
      const end   = textarea ? textarea.selectionEnd   : draft.length
      setBuilderCaret({ start, end })
      setBuilderKind({ kind, bracket })
      setPaletteOpen(false)
   }

   // Builder Insert: splice the emitted LaTeX at the captured selection (no marker → plain
   // replace-at-selection, caret after), then close the modal. The pending-caret layout effect
   // hands focus back to the textarea.
   function insertFromBuilder(latex: string): void {
      const caret = builderCaret ?? { start: draft.length, end: draft.length }
      spliceInsertAt(latex, caret.start, caret.end)
      setBuilderKind(null)
      setBuilderCaret(null)
   }

   function togglePalette(): void {
      if (paletteOpen) { setPaletteOpen(false); return }
      // Anchor the window offset from the whole math block, so it sits beside the source/preview
      // rather than crowding the tiny ƒ(x) button.
      setPaletteAnchor(rootRef.current?.getBoundingClientRect() ?? new DOMRect())
      setPaletteOpen(true)
   }

   // Display scale: an absent value means normal size. Applied to the `.doc-math` wrapper so the
   // rendered MathML grows/shrinks in the preview and read view, matching the HTML export.
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

   // Discrete A− / A+ stepper: walk the allowed size steps, clamped, committing immediately.
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

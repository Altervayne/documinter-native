import { useEffect, useRef, useState } from 'react'
import { renderLatexToMathML, ensureTemmlStyles, isTemmlReady, onTemmlReady } from '../../../lib/math'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

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
         <div className="doc-math">
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

   return (
      <div className="math-block">
         <textarea
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
               <div className="doc-math">
                  <span dangerouslySetInnerHTML={{ __html: rendered.mathml }} />
               </div>
            )}
            {rendered && !rendered.ok && <span className="math-error">{rendered.error}</span>}
         </div>
      </div>
   )
}

import { useEffect, useRef, useState } from 'react'
import { renderLatexToMathML, ensureTemmlStyles } from '../../../lib/math'
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
   const rendered = trimmed === '' ? null : renderLatexToMathML(trimmed, true)

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
            {rendered === null && <span className="math-empty">{t.blockMathEmpty}</span>}
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

import { useState } from 'react'
import { ContentEditable } from '../../../atoms/ContentEditable'
import { highlight, LANG_LABELS } from '../../../lib/highlight'
import { useLang } from '../../../lib/LangContext'
import type { Block, CodeLang } from '../../../types'

interface CodeBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
}

export function CodeBlock({ block, patch }: CodeBlockProps) {
   const { t } = useLang()
   const [codeEditing, setCodeEditing] = useState(false)
   const lang = block.lang ?? 'windev'

   return (
      <>
         <div className="lang-picker">
            <span>lang:</span>
            {(Object.keys(LANG_LABELS) as CodeLang[]).map(langOption => (
               <button
                  key={langOption}
                  className={lang === langOption ? 'active' : ''}
                  onClick={() => patch({ lang: langOption })}
               >
                  {LANG_LABELS[langOption]}
               </button>
            ))}
         </div>
         {codeEditing ? (
            <pre>
               <ContentEditable
                  tag="code"
                  content={block.code ?? ''}
                  spellCheck={false}
                  onBlur={value => { patch({ code: value }); setCodeEditing(false) }}
               />
            </pre>
         ) : (
            <pre title={t.clickToEdit} onClick={() => setCodeEditing(true)} style={{ cursor: 'text' }}>
               <code dangerouslySetInnerHTML={{ __html: highlight(block.code ?? '', lang) }} />
            </pre>
         )}
      </>
   )
}

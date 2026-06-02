import { useState } from 'react'
import { ContentEditable } from '../../../atoms/ContentEditable'
import { highlight, LANG_LABELS } from '../../../lib/highlight'
import { useLang } from '../../../contexts/LangContext'
import type { Block, CodeLang } from '../../../types'

interface CodeBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

export function CodeBlock({ block, patch, readOnly }: CodeBlockProps) {
   const { t } = useLang()
   const [codeEditing, setCodeEditing] = useState(false)
   const lang = block.lang ?? 'windev'

   return (
      <>
         {!readOnly && (
            <div className="flex items-center gap-1 p-2 flex-wrap">
               <span className="text-xs opacity-40 font-mono mr-1">lang:</span>
               {(Object.keys(LANG_LABELS) as CodeLang[]).map(langOption => (
                  <button
                     key={langOption}
                     onClick={() => patch({ lang: langOption })}
                     className={[
                        'px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-all',
                        lang === langOption
                           ? 'border-accent/50 bg-accent/10 text-accent font-semibold'
                           : 'border-current/20 opacity-50 hover:opacity-80',
                     ].join(' ')}
                  >
                     {LANG_LABELS[langOption]}
                  </button>
               ))}
            </div>
         )}
         {!readOnly && codeEditing ? (
            <pre>
               <ContentEditable
                  tag="code"
                  content={block.code ?? ''}
                  spellCheck={false}
                  onBlur={value => { patch({ code: value }); setCodeEditing(false) }}
               />
            </pre>
         ) : (
            <pre
               title={readOnly ? undefined : t.clickToEdit}
               onClick={readOnly ? undefined : () => setCodeEditing(true)}
               style={{ cursor: readOnly ? undefined : 'text' }}
            >
               <code dangerouslySetInnerHTML={{ __html: highlight(block.code ?? '', lang) }} />
            </pre>
         )}
      </>
   )
}

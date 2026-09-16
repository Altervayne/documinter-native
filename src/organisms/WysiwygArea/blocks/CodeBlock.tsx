import { useState } from 'react'
import { PlainEditable } from '../../../atoms/PlainEditable'
import { CodeLangPicker } from '../../../molecules/CodeLangPicker'
import { highlight } from '../../../lib/highlight'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

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
            <div className="flex items-center p-2 -mb-4">
               <CodeLangPicker value={lang} onChange={nextLang => patch({ lang: nextLang })} />
            </div>
         )}
         {!readOnly && codeEditing ? (
            <pre>
               <PlainEditable
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

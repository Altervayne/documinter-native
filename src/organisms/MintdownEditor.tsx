import type { DocMeta, Section } from '../types'
import { documentToMintdown, mintdownToDocument } from '../lib/mintdown'
import { useRawEditor } from '../hooks/useRawEditor'

// ============================================================
// Types
// ============================================================

interface MintdownEditorProps {
   sections: Section[]
   meta:     DocMeta
   onCommit: (sections: Section[], meta: DocMeta) => void
}

// ============================================================
// Component
// ============================================================

export function MintdownEditor({ sections, meta, onCommit }: MintdownEditorProps) {
   const { text, handleChange, handleFocus, handleBlur, handleKeyDown } = useRawEditor({
      sections,
      meta,
      onCommit,
      serialize: documentToMintdown,
      parse:     mintdownToDocument,
   })

   return (
      <div className="h-full flex flex-col bg-surface overflow-hidden">
         <textarea
            className={[
               'flex-1 w-full h-full resize-none',
               'bg-transparent text-text text-sm font-mono leading-relaxed',
               'p-5 focus:outline-none',
               'placeholder:text-muted/40',
            ].join(' ')}
            value={text}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="# Mintdown…"
         />
      </div>
   )
}

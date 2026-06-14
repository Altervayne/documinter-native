import type { DocMeta, Section } from '../types'
import { documentToMintdown, mintdownToDocument } from '../lib/mintdown'
import { useRawEditor } from '../hooks/useRawEditor'
import { HighlightedTextarea } from '../atoms/HighlightedTextarea'

// #########
// # TYPES #
// #########

interface MintdownEditorProps {
   sections: Section[]
   meta:     DocMeta
   onCommit: (sections: Section[], meta: DocMeta) => void
}

// #############
// # COMPONENT #
// #############

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
         <HighlightedTextarea
            value={text}
            language="mintdown"
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="# Mintdown…"
         />
      </div>
   )
}

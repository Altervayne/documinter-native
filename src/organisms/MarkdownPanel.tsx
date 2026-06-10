import type { DocMeta, Section } from '../types'
import { documentToMarkdown, markdownToDocument } from '../lib/markdown'
import { useRawEditor } from '../hooks/useRawEditor'
import { HighlightedTextarea } from '../atoms/HighlightedTextarea'

// ============================================================
// Types
// ============================================================

interface MarkdownPanelProps {
   sections: Section[]
   meta:     DocMeta
   onCommit: (sections: Section[], meta: DocMeta) => void
}

// ============================================================
// Component
// ============================================================

export function MarkdownPanel({ sections, meta, onCommit }: MarkdownPanelProps) {
   const { text, handleChange, handleFocus, handleBlur, handleKeyDown } = useRawEditor({
      sections,
      meta,
      onCommit,
      serialize: documentToMarkdown,
      parse:     markdownToDocument,
   })

   return (
      <div className="h-full flex flex-col bg-surface overflow-hidden">
         <HighlightedTextarea
            value={text}
            language="markdown"
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="# Markdown…"
         />
      </div>
   )
}

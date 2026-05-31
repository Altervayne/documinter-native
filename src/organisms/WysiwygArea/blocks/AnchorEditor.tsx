// -- Library Imports --
import { X, TriangleAlert } from 'lucide-react'

// -- Context / Hook Imports --
import { useLang } from '../../../contexts/LangContext'
import { useDocumentHandles } from '../../../contexts/DocumentHandlesContext'

interface AnchorEditorProps {
   draft:         string
   currentHandle: string | undefined   // the block's currently saved handle (excluded from duplicate check)
   hasHandle:     boolean
   onChange:      (value: string) => void
   onConfirm:     () => void
   onClose:       () => void
   onRemove:      () => void
   pos:           { top: number; right: number }
}

export function AnchorEditor({ draft, currentHandle, hasHandle, onChange, onConfirm, onClose, onRemove, pos }: AnchorEditorProps) {
   const { t } = useLang()
   const allHandles = useDocumentHandles()

   const sluggedDraft    = draft.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
   const matchCount      = allHandles.filter(handle => handle === sluggedDraft).length
   // Duplicate if: same as own saved handle but appears more than once (e.g. after duplication),
   // or different from own saved handle but appears at least once elsewhere.
   const isDuplicate     = sluggedDraft !== '' && (
      sluggedDraft === currentHandle ? matchCount > 1 : matchCount > 0
   )

   return (
      <div
         className="flex items-center gap-1.5 px-2 py-1 rounded-[10px] border border-gray-300 bg-[#eef0f3] shadow-sm whitespace-nowrap z-200 animate-[sidebar-fadein_0.12s_ease] font-mono text-xs doc-dark:bg-[#21262d] doc-dark:border-[#30363d]"
         style={{ position: 'fixed', top: pos.top, right: pos.right }}
      >
         <span className="shrink-0 font-semibold text-accent">#</span>
         <input
            autoFocus
            type="text"
            className="w-35 bg-transparent border-0 outline-none font-mono text-xs"
            value={draft}
            placeholder="anchor-name"
            spellCheck={false}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
               if (event.key === 'Enter') onConfirm()
               if (event.key === 'Escape') onClose()
            }}
            onBlur={onConfirm}
         />
         {isDuplicate && (
            <span className="shrink-0 flex items-center gap-0.5 text-amber-500" title={t.duplicateAnchor}>
               <TriangleAlert size={11} />
            </span>
         )}
         {hasHandle && (
            <button
               className="shrink-0 flex items-center justify-center bg-transparent border-0 cursor-pointer text-gray-400 p-px rounded-sm transition-colors hover:text-rose-600 doc-dark:hover:text-red-400"
               onMouseDown={event => event.preventDefault()}
               onClick={onRemove}
               title={t.removeAnchor}
            >
               <X size={11} />
            </button>
         )}
      </div>
   )
}

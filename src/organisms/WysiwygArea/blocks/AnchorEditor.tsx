// -- Library Imports --
import { X } from 'lucide-react'

// -- Context / Hook Imports --
import { useLang } from '../../../lib/LangContext'

interface AnchorEditorProps {
   draft:     string
   hasHandle: boolean
   onChange:  (value: string) => void
   onConfirm: () => void
   onClose:   () => void
   onRemove:  () => void
}

export function AnchorEditor({ draft, hasHandle, onChange, onConfirm, onClose, onRemove }: AnchorEditorProps) {
   const { t } = useLang()

   return (
      <div className="absolute right-full top-0 mr-2.5 flex items-center gap-1.5 px-2 py-1 rounded-[10px] border border-gray-300 bg-[#eef0f3] shadow-sm whitespace-nowrap z-10 animate-[sidebar-fadein_0.12s_ease] font-mono text-xs doc-dark:bg-[#21262d] doc-dark:border-[#30363d]">
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

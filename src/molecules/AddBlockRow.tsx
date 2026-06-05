import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { BlockTypePicker } from './BlockTypePicker'
import { useLang } from '../contexts/LangContext'
import type { BlockType } from '../types'

interface AddBlockRowProps {
   onAdd:            (type: BlockType) => void
   insideContainer?: boolean
}

export function AddBlockRow({ onAdd, insideContainer }: AddBlockRowProps) {
   const { t } = useLang()
   const [open, setOpen]           = useState(false)
   const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
   const buttonRef = useRef<HTMLButtonElement>(null)

   function handleOpen() {
      setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null)
      setOpen(true)
   }

   return (
      <div className="pt-2 mt-1.5 border-t border-border/40">
         <button
            ref={buttonRef}
            onClick={handleOpen}
            className="doc-add-btn w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm border border-dashed cursor-pointer"
         >
            <Plus size={15} />
            <span>{t.addBlock}</span>
         </button>

         {open && anchorRect && (
            <BlockTypePicker
               anchorRect={anchorRect}
               insideContainer={insideContainer}
               onSelect={(type: BlockType) => { onAdd(type); setOpen(false) }}
               onClose={() => setOpen(false)}
            />
         )}
      </div>
   )
}

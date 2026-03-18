import { useEffect, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react'

// execCommand is deprecated but remains the practical cross-browser solution
// for formatting in contenteditable. All major browsers still support it.
function cmd(command: string) {
   document.execCommand(command, false, undefined)
}

function applyBoldItalic() {
   const isBold   = document.queryCommandState('bold')
   const isItalic = document.queryCommandState('italic')
   if (isBold && isItalic) {
      cmd('bold')
      cmd('italic')
   } else {
      if (!isBold)   cmd('bold')
      if (!isItalic) cmd('italic')
   }
}

interface Pos { top: number; left: number }

/**
 * Floating format toolbar that appears above a text selection inside any
 * element with the data-rich attribute (set by ContentEditable rich=true).
 * Uses position:fixed so it works inside scrollable containers.
 */
export function FormatToolbar() {
   const [pos, setPos] = useState<Pos | null>(null)

   useEffect(() => {
      function onSelChange() {
         const sel = window.getSelection()
         if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            setPos(null)
            return
         }
         // Only show inside rich-text contenteditables
         const anchor = sel.anchorNode
         const inRich = anchor?.parentElement?.closest('[data-rich]')
         if (!inRich) {
            setPos(null)
            return
         }
         const rect = sel.getRangeAt(0).getBoundingClientRect()
         if (!rect.width) {
            setPos(null)
            return
         }
         setPos({ top: rect.top - 44, left: rect.left + rect.width / 2 })
      }

      document.addEventListener('selectionchange', onSelChange)
      return () => document.removeEventListener('selectionchange', onSelChange)
   }, [])

   if (!pos) return null

   const btn = 'w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors cursor-pointer text-white/75 hover:text-white'

   return (
      <div
         className="fixed z-[9999] flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-xl border border-white/12"
         style={{
            top: pos.top,
            left: pos.left,
            transform: 'translateX(-50%)',
            background: '#0d1117',
         }}
         onMouseDown={e => e.preventDefault()} // keep focus in contenteditable
      >
         <button className={btn} title="Bold"              onClick={() => cmd('bold')}>
            <Bold size={12} />
         </button>
         <button className={btn} title="Italic"            onClick={() => cmd('italic')}>
            <Italic size={12} />
         </button>
         <button
            className={btn}
            title="Bold + Italic"
            onClick={applyBoldItalic}
            style={{ fontSize: '0.68rem', fontFamily: 'Georgia, serif', fontWeight: 700, fontStyle: 'italic' }}
         >
            BI
         </button>
         <div className="w-px h-4 bg-white/15 mx-0.5" />
         <button className={btn} title="Underline"         onClick={() => cmd('underline')}>
            <Underline size={12} />
         </button>
         <button className={btn} title="Strikethrough"     onClick={() => cmd('strikeThrough')}>
            <Strikethrough size={12} />
         </button>
      </div>
   )
}

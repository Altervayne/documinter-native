import { useEffect, useRef, useState } from 'react'
import { Layout, Columns2, FileText, Check } from 'lucide-react'
import type { ViewLayout } from '../types'
import type { T } from '../lib/i18n'

// ============================================================
// Types
// ============================================================

interface ViewMenuProps {
   viewLayout: ViewLayout
   onChange:   (layout: ViewLayout) => void
   t:          T
}

// ============================================================
// Option config (stable — defined at module level)
// ============================================================

const VIEW_OPTIONS: { value: ViewLayout; icon: React.ReactElement; labelKey: keyof T }[] = [
   { value: 'wysiwyg',  icon: <Layout   size={14} />, labelKey: 'viewWysiwyg'  },
   { value: 'split',    icon: <Columns2 size={14} />, labelKey: 'viewSplit'    },
   { value: 'markdown', icon: <FileText size={14} />, labelKey: 'viewMarkdown' },
]

// ============================================================
// Component
// ============================================================

export function ViewMenu({ viewLayout, onChange, t }: ViewMenuProps) {
   const [open, setOpen]       = useState(false)
   const containerRef           = useRef<HTMLDivElement>(null)

   // Close on outside click.
   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) {
            setOpen(false)
         }
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   function handleTriggerClick() {
      setOpen(wasOpen => !wasOpen)
   }

   function handleOptionSelect(layout: ViewLayout) {
      onChange(layout)
      setOpen(false)
   }

   const activeOption = VIEW_OPTIONS.find(option => option.value === viewLayout)!

   return (
      <div ref={containerRef} className="relative">
         {/* Trigger button */}
         <button
            onClick={handleTriggerClick}
            title={t.viewLayout}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-medium
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border'
               }`}
         >
            {activeOption.icon}
            <span>{t[activeOption.labelKey]}</span>
         </button>

         {/* Dropdown panel */}
         {open && (
            <div className="absolute top-full mt-1.5 left-0 w-44 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden py-1" style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}>
               {VIEW_OPTIONS.map(({ value, icon, labelKey }) => {
                  const isActive = viewLayout === value
                  return (
                     <button
                        key={value}
                        onClick={() => handleOptionSelect(value)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
                           transition-colors cursor-pointer hover:bg-border/50
                           ${isActive ? 'text-accent' : 'text-text'}`}
                     >
                        {icon}
                        <span className="flex-1">{t[labelKey]}</span>
                        {isActive
                           ? <Check size={13} />
                           : <span className="w-[13px]" />
                        }
                     </button>
                  )
               })}

               {/* Keyboard shortcut hint */}
               <div className="border-t border-border mt-1 px-3 py-1.5">
                  <span className="text-[10px] text-muted font-mono">
                     Ctrl+\ &nbsp;cycle views
                  </span>
               </div>
            </div>
         )}
      </div>
   )
}

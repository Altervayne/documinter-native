import { useEffect, useRef, useState } from 'react'
import { Layout, FileText, FileType, Check } from 'lucide-react'
import type { PaneId, PaneNode } from '../types'
import type { T } from '../lib/i18n'
import { isPanelVisible } from '../lib/paneTree'

// ============================================================
// Types
// ============================================================

interface ViewMenuProps {
   paneLayout:    PaneNode
   onTogglePanel: (id: PaneId) => void
   t:             T
}

// ============================================================
// Panel config (stable — defined at module level)
// ============================================================

const PANEL_OPTIONS: {
   id:          PaneId
   icon:        React.ReactElement
   labelKey:    keyof T
   shortcutKey: keyof T
}[] = [
   { id: 'wysiwyg',  icon: <Layout       size={14} />, labelKey: 'viewWysiwyg',  shortcutKey: 'shortcutToggleWysiwyg'  },
   { id: 'mintdown', icon: <FileType size={14} />, labelKey: 'viewMintdown', shortcutKey: 'shortcutToggleMintdown' },
   { id: 'markdown', icon: <FileText     size={14} />, labelKey: 'viewMarkdown', shortcutKey: 'shortcutToggleMarkdown' },
]

// ============================================================
// Component
// ============================================================

export function ViewMenu({ paneLayout, onTogglePanel, t }: ViewMenuProps) {
   const [open, setOpen]  = useState(false)
   const containerRef     = useRef<HTMLDivElement>(null)

   // Close on outside click.
   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   function handleOptionClick(id: PaneId) {
      onTogglePanel(id)
   }

   return (
      <div ref={containerRef} className="relative">
         {/* Trigger button */}
         <button
            onClick={() => setOpen(wasOpen => !wasOpen)}
            title={t.menuView}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-medium
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border'
               }`}
         >
            <Layout size={14} />
            <span>{t.menuView}</span>
         </button>

         {/* Dropdown panel */}
         {open && (
            <div
               className="absolute top-full mt-1.5 left-0 w-56 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden"
               style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
            >
               {PANEL_OPTIONS.map(({ id, icon, labelKey, shortcutKey }) => {
                  const isActive = isPanelVisible(paneLayout, id)
                  return (
                     <button
                        key={id}
                        onClick={() => handleOptionClick(id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                           transition-colors cursor-pointer hover:bg-border/50
                           ${isActive ? 'text-accent' : 'text-text'}`}
                     >
                        <span className="shrink-0 flex items-center">{icon}</span>
                        <span className="flex-1 min-w-0">{t[labelKey]}</span>
                        <span className="text-[10px] font-mono text-muted/60 shrink-0 tabular-nums">{t[shortcutKey]}</span>
                        <span className="w-[13px] shrink-0 flex items-center justify-center">
                           {isActive && <Check size={13} />}
                        </span>
                     </button>
                  )
               })}
            </div>
         )}
      </div>
   )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Layout, FileText, Check, ChevronDown } from 'lucide-react'
import type { PaneId, PaneNode } from '../types'
import type { T } from '../lib/i18n'
import { isPanelVisible } from '../lib/paneTree'

// #########
// # TYPES #
// #########

/** A dockable side panel presented as a View-menu toggle: on = visible (docked or floating), off =
 *  hidden. Toggling preserves the panel's previous config (docked-where / floating-at-geometry). */
export interface DockPanelToggle {
   id:      string
   label:   string
   icon:    ReactNode
   visible: boolean
   onToggle: () => void
}

interface ViewMenuProps {
   paneLayout:    PaneNode
   onTogglePanel: (id: PaneId) => void
   /** The dockable side panels applicable to the current document, listed under the workspace panes. */
   dockPanels:    DockPanelToggle[]
   t:             T
}

// ###################################################
// # PANEL CONFIG (STABLE, DEFINED AT MODULE LEVEL) #
// ###################################################

const PANEL_OPTIONS: {
   id:          PaneId
   icon:        React.ReactElement
   labelKey:    keyof T
   shortcutKey: keyof T
}[] = [
   { id: 'wysiwyg',  icon: <Layout       size={14} />, labelKey: 'viewWysiwyg',  shortcutKey: 'shortcutToggleWysiwyg'  },
   { id: 'markdown', icon: <FileText     size={14} />, labelKey: 'viewMarkdown', shortcutKey: 'shortcutToggleMarkdown' },
]

// Not portaled/JS-positioned (see molecules/ContextMenu.tsx for that pattern), this dropdown
// stays in-flow `absolute` under its trigger. These are only used for the light right-edge guard
// below, sized to the dropdown's own `w-56` Tailwind class.
const DROPDOWN_WIDTH = 224
const EDGE_MARGIN     = 8

// #############
// # COMPONENT #
// #############

export function ViewMenu({ paneLayout, onTogglePanel, dockPanels, t }: ViewMenuProps) {
   const [open, setOpen]  = useState(false)
   const [alignRight, setAlignRight] = useState(false)
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

   // Light right-edge guard: on a narrow window, a left-aligned dropdown near the right side of
   // the header can overflow past the viewport edge. Flip to right-aligned when there isn't room.
   useLayoutEffect(() => {
      if (!open) return
      const containerRect = containerRef.current?.getBoundingClientRect()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (containerRect) setAlignRight(containerRect.left + DROPDOWN_WIDTH > window.innerWidth - EDGE_MARGIN)
   }, [open])

   return (
      <div ref={containerRef} className="relative">
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
            <span className="hdr-collapse">{t.menuView}</span>
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {open && (
            <div
               className={`absolute top-full mt-1.5 w-56 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden ${alignRight ? 'right-0 left-auto' : 'left-0'}`}
               style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}
            >
               {/* The three workspace panes. */}
               {PANEL_OPTIONS.map(({ id, icon, labelKey, shortcutKey }) => {
                  const isActive = isPanelVisible(paneLayout, id)
                  return (
                     <button
                        key={id}
                        onClick={() => onTogglePanel(id)}
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

               {/* The dockable side panels, each a show/hide toggle that preserves its previous config. */}
               {dockPanels.length > 0 && <div className="h-px bg-border my-1 mx-2" />}
               {dockPanels.map((panel) => (
                  <button
                     key={panel.id}
                     onClick={panel.onToggle}
                     className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                        transition-colors cursor-pointer hover:bg-border/50
                        ${panel.visible ? 'text-accent' : 'text-text'}`}
                  >
                     <span className="shrink-0 flex items-center">{panel.icon}</span>
                     <span className="flex-1 min-w-0">{panel.label}</span>
                     <span className="w-[13px] shrink-0 flex items-center justify-center">
                        {panel.visible && <Check size={13} />}
                     </span>
                  </button>
               ))}
            </div>
         )}
      </div>
   )
}

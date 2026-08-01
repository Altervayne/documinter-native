// -- React Imports --
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// -- Library Imports --
import { ExternalLink } from 'lucide-react'

// -- Atom Imports --
import { LogoColor, LogoMono } from '../atoms/Logo'

// -- Type Imports --
import type { T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

const COPYRIGHT = '© 2026 Florian Douay'
const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0'

// Not portaled/JS-positioned (see molecules/ContextMenu.tsx for that pattern) — this dropdown
// stays in-flow `absolute` under its trigger. These are only used for the light right-edge guard
// below, sized to the dropdown's own `w-56` Tailwind class.
const DROPDOWN_WIDTH = 224
const EDGE_MARGIN     = 8

// #########
// # TYPES #
// #########

interface AboutMenuProps {
   theme: 'dark' | 'light'
   t:     T
}

// #############
// # COMPONENT #
// #############

export function AboutMenu({ theme, t }: AboutMenuProps) {
   const [open, setOpen] = useState(false)
   const [alignRight, setAlignRight] = useState(false)
   const containerRef     = useRef<HTMLDivElement>(null)

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

   // =======
   //  Render
   // =======

   return (
      <div ref={containerRef} className="relative">
         {/* Trigger */}
         <button
            onClick={() => setOpen(wasOpen => !wasOpen)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-mono font-medium
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border'
               }`}
         >
            {t.menuAbout}
         </button>

         {/* Dropdown */}
         {open && (
            <div
               className={`absolute top-full mt-1.5 w-56 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden ${alignRight ? 'right-0 left-auto' : 'left-0'}`}
               style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}
            >
               {/* App identity */}
               <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
                  {theme === 'dark'
                     ? <LogoColor className="h-6 w-auto shrink-0" />
                     : <LogoMono className="h-6 w-auto shrink-0" style={{ color: 'var(--color-accent)' }} />
                  }
                  <div>
                     <div className="flex items-baseline gap-1.5">
                        <div className="font-mono text-xs font-bold text-accent">documinter</div>
                        <span className="font-mono text-[10px] text-muted">v{__APP_VERSION__}</span>
                     </div>
                     <div className="text-[10px] text-muted leading-tight">{t.aboutTagline}</div>
                  </div>
               </div>

               {/* Legal */}
               <div className="px-4 py-3 flex flex-col gap-1.5">
                  <p className="text-[11px] text-muted select-all">{COPYRIGHT}</p>
                  <a
                     href={LICENSE_URL}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
                  >
                     {t.aboutLicense}
                     <ExternalLink size={10} className="shrink-0" />
                  </a>
               </div>
            </div>
         )}
      </div>
   )
}

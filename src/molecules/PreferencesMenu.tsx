import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Lang, T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

// Not portaled/JS-positioned (see molecules/ContextMenu.tsx for that pattern) — this dropdown
// stays in-flow `absolute` under its trigger. These are only used for the light right-edge guard
// below, sized to the dropdown's own `w-64` Tailwind class.
const DROPDOWN_WIDTH = 256
const EDGE_MARGIN     = 8

// #########
// # TYPES #
// #########

interface PreferencesMenuProps {
   /** The app/chrome theme (html[data-theme]) — distinct from the per-document theme (Document menu). */
   theme:         'light' | 'dark'
   onToggleTheme: () => void
   lang:          Lang
   onLangChange:  (language: Lang) => void
   t: T
}

// #############
// # COMPONENT #
// #############

/**
 * The Preferences menu: APP-WIDE settings only — the app/chrome light/dark theme (html[data-theme])
 * and the UI language. Per-document appearance (doc theme + accent) lives in the Document menu; the
 * two are deliberately separate settings. This replaces the dissolved Appearance menu, which used to
 * mix the app-wide and per-document settings in one dropdown.
 */
export function PreferencesMenu({ theme, onToggleTheme, lang, onLangChange, t }: PreferencesMenuProps) {
   const [open, setOpen]            = useState(false)
   const [alignRight, setAlignRight] = useState(false)
   const containerRef               = useRef<HTMLDivElement>(null)

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

   function handleAppThemeClick(targetTheme: 'light' | 'dark') {
      if (theme !== targetTheme) onToggleTheme()
   }

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
            {t.menuPreferences}
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {/* Dropdown */}
         {open && (
            <div className={`absolute top-full mt-1.5 w-64 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden py-2 ${alignRight ? 'right-0 left-auto' : 'left-0'}`} style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}>

               {/* App theme (chrome) — NOT the document theme. */}
               <ToggleRow
                  label={t.appLabel}
                  options={[
                     { value: 'light', label: t.light },
                     { value: 'dark',  label: t.dark  },
                  ]}
                  active={theme}
                  onChange={(value) => handleAppThemeClick(value as 'light' | 'dark')}
               />

               {/* Language */}
               <ToggleRow
                  label={t.language}
                  options={[
                     { value: 'en', label: 'EN' },
                     { value: 'fr', label: 'FR' },
                  ]}
                  active={lang}
                  onChange={(value) => onLangChange(value as Lang)}
                  monoButtons
               />
            </div>
         )}
      </div>
   )
}

// #################################
// # SHARED PRIMITIVE (FILE-LOCAL) #
// #################################

interface ToggleOption {
   value: string
   label: string
}

interface ToggleRowProps {
   label:        string
   options:      ToggleOption[]
   active:       string
   onChange:     (value: string) => void
   monoButtons?: boolean
}

function ToggleRow({ label, options, active, onChange, monoButtons }: ToggleRowProps) {
   return (
      <div className="flex items-center justify-between px-3 py-1.5">
         <span className="text-xs text-muted">{label}</span>
         <div className="flex gap-1">
            {options.map(option => (
               <button
                  key={option.value}
                  onClick={() => onChange(option.value)}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors cursor-pointer
                     ${monoButtons ? 'font-mono font-semibold uppercase' : 'font-medium capitalize'}
                     ${active === option.value
                        ? 'bg-accent/10 border-accent/50 text-accent'
                        : 'border-border text-muted hover:text-text'
                     }`}
               >
                  {option.label}
               </button>
            ))}
         </div>
      </div>
   )
}

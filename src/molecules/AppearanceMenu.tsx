import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Palette } from 'lucide-react'
import { ColorPicker } from './ColorPicker'
import { ACCENT_PRESETS } from '../lib/constants'
import type { Lang, T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

// Not portaled/JS-positioned (see molecules/ContextMenu.tsx for that pattern) — this dropdown
// stays in-flow `absolute` under its trigger. These are only used for the light right-edge guard
// below, sized to the dropdown's own `w-64` Tailwind class — the widest of the four header menus,
// so the highest-risk case for right-edge overflow on a narrow window.
const DROPDOWN_WIDTH = 256
const EDGE_MARGIN     = 8

// #########
// # TYPES #
// #########

interface AppearanceMenuProps {
   theme:             'light' | 'dark'
   onToggleTheme:     () => void
   lang:              Lang
   onLangChange:      (language: Lang) => void
   /** Mount the per-document appearance section (theme + accent). Off in binder mode, where no
    *  document context applies — the settings stay in this menu, they simply don't mount. */
   showDocumentSettings: boolean
   docTheme?:          'light' | 'dark'
   onDocThemeChange?:  (theme: 'light' | 'dark') => void
   docAccent?:         string
   onDocAccentChange?: (hex: string) => void
   t: T
}

// #############
// # COMPONENT #
// #############

export function AppearanceMenu({
   theme,
   onToggleTheme,
   lang,
   onLangChange,
   showDocumentSettings,
   docTheme,
   onDocThemeChange,
   docAccent,
   onDocAccentChange,
   t,
}: AppearanceMenuProps) {
   const [open, setOpen]                       = useState(false)
   const [accentPickerOpen, setAccentPickerOpen] = useState(false)
   const [alignRight, setAlignRight]            = useState(false)
   const containerRef                           = useRef<HTMLDivElement>(null)

   const isCustomAccent = !ACCENT_PRESETS.includes(docAccent ?? '')

   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) {
            setOpen(false)
            setAccentPickerOpen(false)
         }
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
            {t.appearance}
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {/* Dropdown */}
         {open && (
            <div className={`absolute top-full mt-1.5 w-64 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden py-2 ${alignRight ? 'right-0 left-auto' : 'left-0'}`} style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}>

               {/* App theme */}
               <ToggleRow
                  label={t.appLabel}
                  options={[
                     { value: 'light', label: t.light },
                     { value: 'dark',  label: t.dark  },
                  ]}
                  active={theme}
                  onChange={(value) => handleAppThemeClick(value as 'light'| 'dark')}
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

               {/* Per-document appearance, mounted only when a document context applies. */}
               {showDocumentSettings && (
                  <>
                     <div className="h-px bg-border my-2 mx-3" />

                     {/* Document theme */}
                     <ToggleRow
                        label={t.document}
                        options={[
                           { value: 'light', label: t.light },
                           { value: 'dark',  label: t.dark  },
                        ]}
                        active={docTheme ?? 'light'}
                        onChange={(value) => onDocThemeChange?.(value as 'light' | 'dark')}
                     />

                     {/* Accent color */}
                     <div className="px-3 py-1.5 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                           <span className="text-xs text-muted">{t.accent}</span>
                           <div className="flex items-center gap-1">
                              {ACCENT_PRESETS.map(color => (
                                 <button
                                    key={color}
                                    title={color}
                                    onClick={() => { onDocAccentChange?.(color); setAccentPickerOpen(false) }}
                                    style={{ background: color }}
                                    className={`w-3.5 h-3.5 rounded-full border-2 transition-all cursor-pointer
                                       ${docAccent === color
                                          ? 'border-text/70 scale-110'
                                          : 'border-transparent opacity-50 hover:opacity-90 hover:scale-105'
                                       }`}
                                 />
                              ))}
                              {/* Custom-color swatch */}
                              <button
                                 title={t.customColor}
                                 onClick={() => setAccentPickerOpen(current => !current)}
                                 className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer
                                    ${isCustomAccent
                                       ? 'border-text/70 scale-110'
                                       : 'border-border opacity-50 hover:opacity-90 hover:scale-105'
                                    }`}
                                 style={isCustomAccent ? { background: docAccent } : {}}
                              >
                                 {!isCustomAccent && <Palette size={8} className="text-muted pointer-events-none" />}
                              </button>
                           </div>
                        </div>

                        {/* Full color picker, expanded on demand */}
                        {accentPickerOpen && docAccent && (
                           <ColorPicker value={docAccent} onChange={(hex) => onDocAccentChange?.(hex)} />
                        )}
                     </div>
                  </>
               )}

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

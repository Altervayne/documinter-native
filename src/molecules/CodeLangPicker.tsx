/*
 * The code block's language picker: a badge + name trigger opening a portaled dropdown of every
 * supported language, each with a colored monogram badge. Replaces the old wrapping row of 14 buttons.
 * Portaled + viewport-clamped (like ColorSwatchField) so it never clips against an overflow-hidden page.
 */

// -- React Imports --
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// -- Icon Imports --
import { ChevronDown, Check } from 'lucide-react'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// -- Lib Imports --
import { LANG_LABELS } from '../lib/highlight'
import type { CodeLang } from '../types'

// #############
// # BADGES    #
// #############

/** A monogram + signature color per language, a logo-free mark that covers every language uniformly
 *  (W-Langage and Plaintext have no standard logo). Fixed hex, not theme tokens, so a language keeps
 *  its color in both app themes; text color is picked for contrast on that background. */
const LANG_BADGES: Record<CodeLang, { text: string; bg: string; fg: string }> = {
   windev:   { text: 'W',   bg: '#eab308', fg: '#1a1a1a' },
   js:       { text: 'JS',  bg: '#f7df1e', fg: '#1a1a1a' },
   ts:       { text: 'TS',  bg: '#3178c6', fg: '#ffffff' },
   python:   { text: 'PY',  bg: '#3776ab', fg: '#ffffff' },
   rust:     { text: 'RS',  bg: '#ce422b', fg: '#ffffff' },
   c:        { text: 'C',   bg: '#00599c', fg: '#ffffff' },
   sql:      { text: 'SQL', bg: '#336791', fg: '#ffffff' },
   bash:     { text: '>_',  bg: '#0d1117', fg: '#ffffff' },
   json:     { text: '{}',  bg: '#64748b', fg: '#ffffff' },
   yaml:     { text: 'YML', bg: '#cb171e', fg: '#ffffff' },
   html:     { text: '</>', bg: '#e34c26', fg: '#ffffff' },
   xml:      { text: 'XML', bg: '#8b5cf6', fg: '#ffffff' },
   css:      { text: 'CSS', bg: '#1572b6', fg: '#ffffff' },
   markdown: { text: 'MD',  bg: '#334155', fg: '#ffffff' },
   plain:    { text: 'Aa',  bg: '#94a3b8', fg: '#ffffff' },
}

function LangBadge({ lang }: { lang: CodeLang }) {
   const badge = LANG_BADGES[lang]
   return (
      <span
         // pt-[2px] nudges the run down ~1px: caps sit high in the line box, so flex-centering alone
         // leaves them optically above the middle of the badge.
         className="inline-flex h-[18px] min-w-[26px] shrink-0 items-center justify-center rounded px-1 pt-[2px] font-mono text-[9px] font-bold leading-none"
         style={{ backgroundColor: badge.bg, color: badge.fg }}
      >
         {badge.text}
      </span>
   )
}

// #############
// # PICKER    #
// #############

export function CodeLangPicker({ value, onChange }: { value: CodeLang; onChange: (lang: CodeLang) => void }) {
   const [isOpen, setIsOpen]         = useState(false)
   const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
   const triggerRef = useRef<HTMLButtonElement>(null)

   function toggle(): void {
      if (isOpen) { setIsOpen(false); return }
      setAnchorRect(triggerRef.current?.getBoundingClientRect() ?? null)
      setIsOpen(true)
   }

   return (
      <>
         <button
            type="button"
            ref={triggerRef}
            data-code-lang-trigger
            onClick={toggle}
            // Doc-theme tokens (currentColor + --doc-accent), so the trigger follows the DOCUMENT theme
            // like the callout style picker, not the app chrome. The portaled popover keeps app tokens.
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer ${
               isOpen ? 'font-medium' : 'border-current/25 hover:border-current/50'
            }`}
            style={isOpen
               ? {
                    color:       'var(--doc-accent, var(--color-accent))',
                    borderColor: 'var(--doc-accent, var(--color-accent))',
                    background:  'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 10%, transparent)',
                 }
               : undefined}
         >
            <LangBadge lang={value} />
            <span>{LANG_LABELS[value]}</span>
            <ChevronDown size={11} className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
         </button>
         {isOpen && anchorRect && (
            <CodeLangMenu
               anchorRect={anchorRect}
               value={value}
               onPick={lang => { onChange(lang); setIsOpen(false) }}
               onClose={() => setIsOpen(false)}
            />
         )}
      </>
   )
}

interface CodeLangMenuProps {
   anchorRect: DOMRect
   value:      CodeLang
   onPick:     (lang: CodeLang) => void
   onClose:    () => void
}

function CodeLangMenu({ anchorRect, value, onPick, onClose }: CodeLangMenuProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({ type: 'rect', rect: anchorRect })
   const languages = Object.keys(LANG_LABELS) as CodeLang[]

   // Dismiss on outside pointerdown, ignoring the trigger (its own click toggles the menu).
   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         const target = event.target as HTMLElement
         if (ref.current?.contains(target)) return
         if (target.closest('[data-code-lang-trigger]')) return
         onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      return () => document.removeEventListener('pointerdown', handlePointerDown)
   }, [onClose, ref])

   return createPortal(
      <div
         ref={ref}
         className="fixed z-[10001] max-h-[60vh] w-52 overflow-y-auto rounded-lg border border-border bg-raised py-1 shadow-xl"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         {languages.map(lang => (
            <button
               key={lang}
               type="button"
               onClick={() => onPick(lang)}
               className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer hover:bg-border/50"
            >
               <LangBadge lang={lang} />
               <span className="flex-1 text-text">{LANG_LABELS[lang]}</span>
               {lang === value && <Check size={13} className="shrink-0 text-accent" />}
            </button>
         ))}
      </div>,
      document.body,
   )
}

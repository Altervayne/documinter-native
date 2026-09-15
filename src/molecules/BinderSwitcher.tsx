/**
 * BinderSwitcher, the native Header Binder-switcher.
 *
 * Shows the open Binder's name next to the logo; clicking opens a menu to switch to a recent Binder,
 * open a folder, or create a new one. It reads the lifecycle controls from NativeBinderContext, so it
 * renders nothing on the web (no provider) and only appears once a Binder is open. The dropdown mirrors
 * FileMenu's in-flow absolute pattern (outside-click close + a light right-edge flip) for visual parity.
 */

// -- React Imports --
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// -- Icon Imports --
import { Library, ChevronDown, FolderOpen, FolderPlus, FolderClock, Check, ArrowLeft } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'
import { useNativeBinderControls } from '../contexts/NativeBinderContext'

// #############
// # CONSTANTS #
// #############

// Sized to the dropdown's own min width, for the right-edge guard (same approach as FileMenu).
const DROPDOWN_WIDTH = 288
const EDGE_MARGIN    = 8

// #############
// # COMPONENT #
// #############

export function BinderSwitcher() {
   const controls = useNativeBinderControls()
   const { t } = useLang()

   const [open, setOpen]           = useState(false)
   const [creating, setCreating]   = useState(false)
   const [name, setName]           = useState('')
   const [alignRight, setAlignRight] = useState(false)
   const containerRef = useRef<HTMLDivElement>(null)

   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   // On a narrow window a left-aligned dropdown could overflow the right edge; flip when there is no room.
   useLayoutEffect(() => {
      if (!open) return
      const containerRect = containerRef.current?.getBoundingClientRect()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (containerRect) setAlignRight(containerRect.left + DROPDOWN_WIDTH > window.innerWidth - EDGE_MARGIN)
   }, [open])

   // The switcher only exists inside the native host, past an open Binder. Off native (web) the provider
   // is absent, so there is nothing to render. Placed after the hooks so hook order stays stable.
   if (controls === null) return null

   const others = controls.known.filter(entry => entry.path !== controls.activePath)

   function closeMenu() {
      setOpen(false)
      setCreating(false)
      setName('')
   }

   function handleSwitch(path: string) {
      if (controls === null || controls.busy) return
      void controls.switchBinder(path)
      closeMenu()
   }

   function handleOpen() {
      if (controls === null || controls.busy) return
      void controls.openBinder()
      closeMenu()
   }

   function handleCreate() {
      const trimmed = name.trim()
      if (controls === null || controls.busy || trimmed === '') return
      void controls.createBinder(trimmed)
      closeMenu()
   }

   return (
      <div ref={containerRef} className="relative shrink-0">
         {/* Trigger: the open Binder's name. Its own pointer events (a button), so it stops the window
             drag directly on itself, like every other header control. */}
         <button
            onClick={() => setOpen(wasOpen => !wasOpen)}
            title={t.binderMenuSwitch}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium max-w-48
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text'
               }`}
         >
            <Library size={14} className="shrink-0" />
            <span className="truncate">{controls.activeName}</span>
            <ChevronDown size={11} className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {open && (
            <div
               className={`absolute top-full mt-1.5 w-72 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden ${alignRight ? 'right-0 left-auto' : 'left-0'}`}
               style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}
            >
               {creating ? (
                  // ==== Create view ====
                  <div className="p-3">
                     <button
                        onClick={() => { setCreating(false); setName('') }}
                        className="mb-2 flex items-center gap-1 text-xs text-muted hover:text-text cursor-pointer"
                     >
                        <ArrowLeft size={12} /> {t.binderMenuCancel}
                     </button>
                     <label className="mb-1 block text-xs font-medium text-muted">{t.welcomeNameLabel}</label>
                     <input
                        type="text"
                        value={name}
                        autoFocus
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') handleCreate() }}
                        placeholder={t.welcomeNamePlaceholder}
                        disabled={controls.busy}
                        className="mb-3 w-full rounded border border-border bg-el px-2 py-1.5 text-sm outline-none focus:border-accent"
                     />
                     <button
                        onClick={handleCreate}
                        disabled={controls.busy || name.trim() === ''}
                        className="w-full rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                     >
                        {controls.busy ? t.welcomeBusyCreating : t.welcomeCreateAction}
                     </button>
                  </div>
               ) : (
                  // ==== List view ====
                  <>
                     {/* Current Binder header */}
                     <div className="px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{t.binderMenuCurrent}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-text">
                           <Check size={13} className="shrink-0 text-accent" />
                           <span className="truncate">{controls.activeName}</span>
                        </div>
                        <div className="truncate text-[11px] text-muted" title={controls.activePath}>{controls.activePath}</div>
                     </div>

                     {others.length > 0 && (
                        <>
                           <MenuSeparator />
                           <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{t.binderMenuOthers}</div>
                           {others.map(entry => (
                              <button
                                 key={entry.path}
                                 onClick={() => handleSwitch(entry.path)}
                                 disabled={controls.busy}
                                 className="flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors cursor-pointer hover:bg-border/50 disabled:opacity-40"
                              >
                                 <span className="flex items-center gap-2 text-sm text-text">
                                    <FolderClock size={13} className="shrink-0 text-muted" />
                                    <span className="truncate">{entry.name}</span>
                                 </span>
                                 <span className="w-full truncate pl-[21px] text-[11px] text-muted" title={entry.path}>{entry.path}</span>
                              </button>
                           ))}
                        </>
                     )}

                     <MenuSeparator />
                     <MenuItem icon={<FolderOpen size={13} />} label={t.binderMenuOpen} onClick={handleOpen} disabled={controls.busy} />
                     <MenuItem icon={<FolderPlus size={13} />} label={t.binderMenuCreate} onClick={() => setCreating(true)} disabled={controls.busy} />

                     {controls.error !== null && (
                        <p className="px-3 py-2 text-[11px] text-[var(--callout-danger-accent)]">{controls.error}</p>
                     )}
                  </>
               )}
            </div>
         )}
      </div>
   )
}

// ##################################
// # SHARED PRIMITIVES (FILE-LOCAL) #
// ##################################

interface MenuItemProps {
   icon:     React.ReactNode
   label:    string
   onClick:  () => void
   disabled?: boolean
}

function MenuItem({ icon, label, onClick, disabled }: MenuItemProps) {
   return (
      <button
         onClick={onClick}
         disabled={disabled}
         className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
            transition-colors cursor-pointer hover:bg-border/50 text-text
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
         <span className="text-muted">{icon}</span>
         <span className="flex-1">{label}</span>
      </button>
   )
}

function MenuSeparator() {
   return <div className="h-px bg-border my-1 mx-2" />
}

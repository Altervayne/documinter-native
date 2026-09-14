/*
 * NativeBinderHost, the native-only Binder lifecycle owner + the Welcome picker (arc A1.4).
 *
 * On the web the app runs against the IndexedDB backend and never mounts this. On native there is no
 * default Binder: this host picks one (create / open), grants its folder to the fs scope, opens it as a
 * live filesystem backend, and provides that backend to <App/>. It restores the last-active Binder on
 * launch and can switch between Binders; a switch remounts the provided subtree under a key (the Binder
 * path) so every open tab and all transient App state reset, matching the deferred-binder blank reset.
 *
 * The pre-Binder surface (Welcome + launch-restore) lives OUTSIDE <App/>, so it carries its own
 * LangProvider and its own title bar: window decorations are off, and the app's title bar lives inside
 * HeaderMenuBar which only mounts once a Binder is open. Without this the Welcome window would have no
 * drag handle and no close button. The frame renders the title bar in every pre-Binder phase (loading
 * included) so the window is always movable and closable.
 */

// -- React Imports --
import { useEffect, useState } from 'react'

// -- Tauri Imports --
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { documentDir, join } from '@tauri-apps/api/path'

// -- Icon Imports --
import { FolderPlus, FolderOpen, FolderClock } from 'lucide-react'

// -- App Imports --
import App from '../App'
import { ToastProvider } from '../contexts/ToastContext'
import { BinderBackendProvider } from '../contexts/BinderBackendContext'
import { LangProvider, useLang } from '../contexts/LangContext'
import { WindowControls } from '../molecules/WindowControls'
import { LogoColor } from '../atoms/Logo'
import { createFilesystemBackend } from '../lib/filesystem/filesystemBackend'
import { slugify } from '../lib/text'
import type { Lang } from '../lib/i18n'
import {
   readBinderRegistry, writeBinderRegistry,
   rememberBinder, setActivePath,
   type KnownBinder,
} from '../lib/native/binderRegistry'

import type { BinderBackend } from '../lib/binderBackend'

// ####################
// # THE LIFECYCLE HOOK
// ####################

/** The three surfaces the host can show: the brief launch-restore, the Welcome picker (no Binder open),
 *  and the app itself (a Binder is open). */
type BinderPhase = 'loading' | 'welcome' | 'open'

/** A translatable notice code rather than a baked string, so the Welcome screen renders it in the
 *  active language. Only one case for now (the restore target vanished). */
type BinderNotice = 'missing-folder'

interface NativeBinder {
   phase:      BinderPhase
   backend:    BinderBackend | null
   activePath: string | null
   known:      KnownBinder[]
   notice:     BinderNotice | null
   error:      string | null
   busy:       boolean
   createBinder(name: string, parentDir?: string): Promise<void>
   openBinder(): Promise<void>
   switchBinder(path: string): Promise<void>
}

/**
 * Owns the active-Binder state and the create / open / switch / launch-restore flows. Every flow ends
 * by handing back a live filesystem backend + its path; the host renders <App/> under it. Errors surface
 * as inline text rather than throwing, so a failed pick / mkdir never dead-ends the Welcome screen.
 */
function useNativeBinder(): NativeBinder {
   const [phase, setPhase]                 = useState<BinderPhase>('loading')
   const [backend, setBackend]             = useState<BinderBackend | null>(null)
   const [activePath, setActivePathState]  = useState<string | null>(null)
   const [known, setKnown]                 = useState<KnownBinder[]>(() => readBinderRegistry().known)
   const [notice, setNotice]               = useState<BinderNotice | null>(null)
   const [error, setError]                 = useState<string | null>(null)
   const [busy, setBusy]                   = useState(false)

   // ====
   // Launch restore: re-open the last-active Binder (persisted-scope has re-granted its folder). On a
   // missing folder, clear the active pointer (keep it in the known list for a later retry) and fall
   // back to Welcome with a gentle notice. StrictMode double-invokes this effect in dev, so a backend
   // opened by a torn-down run is disposed in cleanup and the surviving run opens a fresh one.
   // ====
   useEffect(() => {
      let cancelled = false
      let openedBackend: BinderBackend | null = null

      void (async () => {
         const registry = readBinderRegistry()
         if (registry.activePath === null) {
            if (!cancelled) setPhase('welcome')
            return
         }
         try {
            // Re-grant the folder scope (persisted-scope usually restores it, but this guarantees it).
            // Grant-only, so a Binder folder deleted since last launch is not recreated: createFilesystem
            // Backend's exists check then throws and we fall back to Welcome with the missing-folder notice.
            await invoke('allow_binder_directory', { path: registry.activePath })
            const restored = await createFilesystemBackend(registry.activePath)
            openedBackend = restored
            if (cancelled) return
            setBackend(restored)
            setActivePathState(registry.activePath)
            setPhase('open')
         } catch {
            const cleared = setActivePath(registry, null)
            writeBinderRegistry(cleared)
            if (cancelled) return
            setKnown(cleared.known)
            setNotice('missing-folder')
            setPhase('welcome')
         }
      })()

      return () => {
         cancelled = true
         if (openedBackend) void openedBackend.dispose()
      }
   }, [])

   // ====
   // Flows. Each opens the backend, remembers + persists the Binder, then flips to the app.
   // ====

   const adoptBinder = (nextBackend: BinderBackend, path: string, name?: string): void => {
      const updated = rememberBinder(readBinderRegistry(), { path, name })
      writeBinderRegistry(updated)
      setKnown(updated.known)
      setBackend(nextBackend)
      setActivePathState(path)
      setNotice(null)
      setError(null)
      setPhase('open')
   }

   const createBinder = async (name: string, parentDir?: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
         // Default location: <home>/Documents/Documinter/<slug>. Path APIs so the separator stays native.
         const base   = parentDir ?? await join(await documentDir(), 'Documinter')
         const target = await join(base, slugify(name))
         // Rust creates the folder (its std::fs is not gated by the fs scope) then grants it, so we never
         // hit the scoped mkdir on a path that is not yet in scope. Covers first-run parent creation too.
         await invoke('create_binder_directory', { path: target })
         const nextBackend = await createFilesystemBackend(target)
         adoptBinder(nextBackend, target, name)
      } catch (failure) {
         setError(String(failure))
      } finally {
         setBusy(false)
      }
   }

   const openBinder = async (): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
         const picked = await open({ directory: true })
         // A cancelled dialog returns null; directory picks are single, so this is a string when set.
         if (typeof picked !== 'string') return
         await invoke('allow_binder_directory', { path: picked })
         const nextBackend = await createFilesystemBackend(picked)
         adoptBinder(nextBackend, picked)
      } catch (failure) {
         setError(String(failure))
      } finally {
         setBusy(false)
      }
   }

   const switchBinder = async (path: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
         // Close the outgoing SQLite handle first; the key-remount (activePath changes below) then resets
         // App so the old Binder's tabs and transient state are gone before the new backend renders.
         if (backend) await backend.dispose()
         const nextBackend = await createFilesystemBackend(path)
         adoptBinder(nextBackend, path)
      } catch (failure) {
         setError(String(failure))
      } finally {
         setBusy(false)
      }
   }

   return { phase, backend, activePath, known, notice, error, busy, createBinder, openBinder, switchBinder }
}

// ####################
// # THE HOST
// ####################

/**
 * Native entry point. Once a Binder is open it renders <App/> under the filesystem backend, keyed by the
 * Binder path so a switch remounts App and clears its tabs. Before that, it renders the Welcome frame
 * (which owns its own language + title bar).
 */
export function NativeBinderHost() {
   const binder = useNativeBinder()

   if (binder.phase === 'open' && binder.backend !== null && binder.activePath !== null) {
      return (
         <BinderBackendProvider key={binder.activePath} backend={binder.backend}>
            <ToastProvider>
               <App />
            </ToastProvider>
         </BinderBackendProvider>
      )
   }

   return <WelcomeFrame binder={binder} />
}

// ####################
// # THE WELCOME FRAME
// ####################

/** The pre-Binder chrome: its own language state (mirrors App's `documinter-lang` so the choice carries
 *  through), a title bar with the window controls, and the Welcome content. The title bar renders in the
 *  loading phase too, so the window is always draggable + closable even if a restore is slow. */
function WelcomeFrame({ binder }: { binder: NativeBinder }) {
   const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('documinter-lang') as Lang) ?? 'en')
   useEffect(() => { localStorage.setItem('documinter-lang', lang) }, [lang])

   return (
      <LangProvider lang={lang} setLang={setLang}>
         <div className="flex min-h-screen flex-col bg-bg text-text">
            <WelcomeTitleBar lang={lang} setLang={setLang} />
            <div className="flex-1 overflow-y-auto">
               {binder.phase === 'welcome' && <WelcomeContent binder={binder} />}
            </div>
         </div>
      </LangProvider>
   )
}

/** The title bar for the Welcome frame. The empty middle is the drag handle; a small language toggle sits
 *  on the left and the window caption buttons on the right (flush to the corner, same as the app header).
 *  data-tauri-drag-region only on the non-interactive areas so the toggle + controls stay clickable. */
function WelcomeTitleBar({ lang, setLang }: { lang: Lang; setLang: (language: Lang) => void }) {
   return (
      <div className="shrink-0 flex items-center gap-1 p-1 px-3">
         <LanguageToggle lang={lang} setLang={setLang} />
         <div data-tauri-drag-region className="flex-1 self-stretch" />
         <WindowControls />
      </div>
   )
}

/** A compact EN / FR segment (no <select>, per the app's convention). Two languages, so two buttons. */
function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (language: Lang) => void }) {
   const languages: Lang[] = ['en', 'fr']
   return (
      <div className="flex overflow-hidden rounded border border-border text-xs">
         {languages.map(code => (
            <button
               key={code}
               type="button"
               onClick={() => setLang(code)}
               className={
                  'px-2 py-0.5 uppercase transition-colors cursor-pointer ' +
                  (code === lang ? 'bg-accent text-bg font-semibold' : 'text-muted hover:bg-el hover:text-text')
               }
            >
               {code}
            </button>
         ))}
      </div>
   )
}

// ####################
// # THE WELCOME CONTENT
// ####################

/** The onboarding body: presents Documinter, explains what a Binder is, then the create + open actions
 *  and any recent Binders. Centered, and scrolls within the frame when the window is short. */
function WelcomeContent({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()

   return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-6 py-12">

         {/* Identity: the mark, the name, and a one-line pitch. */}
         <div className="flex flex-col items-center gap-3 text-center">
            <LogoColor className="h-16 w-auto" />
            <h1 className="text-3xl font-semibold tracking-tight">Documinter</h1>
            <p className="max-w-md text-sm text-muted">{t.welcomeTagline}</p>
         </div>

         {/* What this is + what a Binder is, so the empty first run explains itself. */}
         <div className="w-full rounded-lg border border-border bg-raised p-5 text-sm leading-relaxed text-muted">
            <p>{t.welcomeIntro}</p>
            <p className="mt-3 font-medium text-text">{t.welcomeBinderTitle}</p>
            <p className="mt-1">{t.welcomeBinderBody}</p>
         </div>

         {binder.notice !== null && (
            <p className="w-full rounded border border-border bg-raised px-4 py-2 text-center text-sm text-muted">
               {t.welcomeNoticeMissingFolder}
            </p>
         )}

         {/* The two ways in. */}
         <div className="grid w-full gap-4 sm:grid-cols-2">
            <CreateBinderCard binder={binder} />
            <OpenBinderCard binder={binder} />
         </div>

         {binder.known.length > 0 && <RecentBinders binder={binder} />}

         {binder.error !== null && (
            <p className="w-full max-w-md text-center text-sm text-[var(--callout-danger-accent)]">{binder.error}</p>
         )}
      </div>
   )
}

/** Create: a name + a location (defaulting to ~/Documents/Documinter, changeable via a folder pick). The
 *  resolved default parent is read once on mount so the path is shown before anything is created. */
function CreateBinderCard({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()
   const [name, setName] = useState('')
   const [parent, setParent] = useState<string | null>(null)

   // Resolve the default parent (~/Documents/Documinter) for display. The flow falls back to the same
   // default when parent is null, so this is presentation only, not the source of truth.
   useEffect(() => {
      let active = true
      void (async () => {
         const resolved = await join(await documentDir(), 'Documinter')
         if (active) setParent(current => current ?? resolved)
      })()
      return () => { active = false }
   }, [])

   const trimmed = name.trim()
   const folderName = trimmed === '' ? '' : slugify(trimmed)

   const handleChangeLocation = async () => {
      const picked = await open({ directory: true })
      if (typeof picked === 'string') setParent(picked)
   }

   const handleCreate = () => {
      if (trimmed === '' || binder.busy) return
      void binder.createBinder(trimmed, parent ?? undefined)
   }

   return (
      <div className="flex flex-col rounded-lg border border-border bg-raised p-5">
         <div className="mb-3 flex items-center gap-2 text-text">
            <FolderPlus size={18} className="text-accent" />
            <h2 className="font-semibold">{t.welcomeCreateTitle}</h2>
         </div>
         <p className="mb-4 text-sm text-muted">{t.welcomeCreateBody}</p>

         <label className="mb-1 text-xs font-medium text-muted">{t.welcomeNameLabel}</label>
         <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') handleCreate() }}
            placeholder={t.welcomeNamePlaceholder}
            disabled={binder.busy}
            className="mb-3 rounded border border-border bg-el px-2 py-1.5 text-sm outline-none focus:border-accent"
         />

         <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{t.welcomeLocationLabel}</span>
            <button
               type="button"
               onClick={() => void handleChangeLocation()}
               disabled={binder.busy}
               className="text-xs text-accent hover:underline disabled:opacity-50 cursor-pointer"
            >
               {t.welcomeLocationChange}
            </button>
         </div>
         <div className="mb-4 truncate rounded border border-border bg-el px-2 py-1.5 text-xs text-muted" title={parent ?? ''}>
            {parent ?? '...'}{folderName !== '' && <span className="text-text">/{folderName}</span>}
         </div>

         <button
            type="button"
            onClick={handleCreate}
            disabled={binder.busy || trimmed === ''}
            className="mt-auto rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
         >
            {binder.busy ? t.welcomeBusyCreating : t.welcomeCreateAction}
         </button>
      </div>
   )
}

/** Open: point at an existing folder. Any Documinter folder rebuilds its index on open. */
function OpenBinderCard({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()
   return (
      <div className="flex flex-col rounded-lg border border-border bg-raised p-5">
         <div className="mb-3 flex items-center gap-2 text-text">
            <FolderOpen size={18} className="text-accent" />
            <h2 className="font-semibold">{t.welcomeOpenTitle}</h2>
         </div>
         <p className="mb-4 text-sm text-muted">{t.welcomeOpenBody}</p>
         <button
            type="button"
            onClick={() => void binder.openBinder()}
            disabled={binder.busy}
            className="mt-auto rounded border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-el disabled:opacity-50 cursor-pointer"
         >
            {binder.busy ? t.welcomeBusyOpening : t.welcomeOpenAction}
         </button>
      </div>
   )
}

/** Recent Binders: one click reopens a known folder (persisted-scope has re-granted it). Useful after the
 *  first run, and as the recovery path when a restore target was missing. */
function RecentBinders({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()
   return (
      <div className="w-full">
         <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            <FolderClock size={14} />
            {t.welcomeRecentTitle}
         </div>
         <ul className="flex flex-col gap-1">
            {binder.known.map(entry => (
               <li key={entry.path}>
                  <button
                     type="button"
                     onClick={() => void binder.switchBinder(entry.path)}
                     disabled={binder.busy}
                     className="flex w-full flex-col items-start rounded border border-border bg-raised px-3 py-2 text-left transition-colors hover:bg-el disabled:opacity-50 cursor-pointer"
                  >
                     <span className="text-sm font-medium text-text">{entry.name}</span>
                     <span className="w-full truncate text-xs text-muted" title={entry.path}>{entry.path}</span>
                  </button>
               </li>
            ))}
         </ul>
      </div>
   )
}

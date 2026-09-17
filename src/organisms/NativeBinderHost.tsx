/*
 * Native-only. Picks a Binder (create / open / switch), opens it as a filesystem backend, and provides
 * it to <App/>. A switch remounts the subtree by Binder path so tabs and transient state reset. The
 * pre-Binder surface (Welcome + launch-restore) sits outside <App/> with its own title bar, since
 * decorations are off and HeaderMenuBar (the real title bar) only mounts once a Binder is open.
 */

// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Tauri Imports --
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import { documentDir, join, sep } from '@tauri-apps/api/path'

// -- Icon Imports --
import { FolderPlus, FolderOpen, FolderClock, Languages, Trash2 } from 'lucide-react'

// -- App Imports --
import App from '../App'
import { ToastProvider } from '../contexts/ToastContext'
import { BinderBackendProvider } from '../contexts/BinderBackendContext'
import { LangProvider, useLang } from '../contexts/LangContext'
import { NativeBinderProvider, type NativeBinderControls, type PendingLaunchOpen } from '../contexts/NativeBinderContext'
import { WindowControls } from '../molecules/WindowControls'
import { DeleteBinderDialog } from '../molecules/DeleteBinderDialog'
import { LogoColor } from '../atoms/Logo'
import { createFilesystemBackend } from '../lib/filesystem/filesystemBackend'
import { slugify } from '../lib/text'
import type { Lang } from '../lib/i18n'
import {
   readBinderRegistry, writeBinderRegistry,
   rememberBinder, setActivePath, forgetBinder, binderNameFromPath,
   type KnownBinder,
} from '../lib/native/binderRegistry'
import { takePendingLaunchFile, onLaunchFile, resolveBinderRoot } from '../lib/native/launchFile'

import type { BinderBackend } from '../lib/binderBackend'

// ####################
// # THE LIFECYCLE HOOK
// ####################

type BinderPhase = 'loading' | 'welcome' | 'open'

/** A code, not a baked string, so the Welcome screen renders it in the active language. */
type BinderNotice = 'missing-folder'

interface NativeBinder {
   phase:      BinderPhase
   backend:    BinderBackend | null
   activePath: string | null
   known:      KnownBinder[]
   notice:     BinderNotice | null
   error:      string | null
   busy:       boolean
   pendingLaunchOpen: PendingLaunchOpen | null
   createBinder(name: string, parentDir?: string): Promise<void>
   openBinder(): Promise<void>
   switchBinder(path: string): Promise<void>
   deleteBinder(path: string): Promise<void>
   consumeLaunchOpen(): void
}

/** Owns the active-Binder state + the create / open / switch / launch-restore flows. Errors surface as
 *  state, never thrown, so a failed pick never dead-ends the Welcome screen. */
function useNativeBinder(): NativeBinder {
   const [phase, setPhase]                 = useState<BinderPhase>('loading')
   const [backend, setBackend]             = useState<BinderBackend | null>(null)
   const [activePath, setActivePathState]  = useState<string | null>(null)
   const [known, setKnown]                 = useState<KnownBinder[]>(() => readBinderRegistry().known)
   const [notice, setNotice]               = useState<BinderNotice | null>(null)
   const [error, setError]                 = useState<string | null>(null)
   const [busy, setBusy]                   = useState(false)
   const [pendingLaunchOpen, setPendingLaunchOpen] = useState<PendingLaunchOpen | null>(null)

   // Re-open the last-active Binder on launch; a missing folder falls back to Welcome. StrictMode
   // double-invokes this in dev, so a backend opened by a torn-down run is disposed in cleanup.
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
            // Grant-only (not create), so a folder deleted since last launch is not resurrected: the
            // backend's exists check throws and we fall through to the missing-folder notice.
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

   // Adopt a freshly opened backend, then dispose the one it replaces. The new backend is always opened
   // BEFORE this runs, so a failed open leaves the current Binder working. The activePath change remounts
   // App and clears its tabs.
   const finishOpen = (nextBackend: BinderBackend, path: string, name?: string): void => {
      const previous = backend
      const updated = rememberBinder(readBinderRegistry(), { path, name })
      writeBinderRegistry(updated)
      setKnown(updated.known)
      setBackend(nextBackend)
      setActivePathState(path)
      setNotice(null)
      setError(null)
      setPhase('open')
      if (previous && previous !== nextBackend) void previous.dispose()
   }

   const createBinder = async (name: string, parentDir?: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
         const base   = parentDir ?? await join(await documentDir(), 'Documinter')
         const target = await join(base, slugify(name))
         // Rust creates the folder (its std::fs is not gated by the fs scope) then grants it, so we never
         // hit the scoped mkdir on a path not yet in scope.
         await invoke('create_binder_directory', { path: target })
         const nextBackend = await createFilesystemBackend(target)
         finishOpen(nextBackend, target, name)
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
         // A cancelled dialog returns null; a directory pick is a single string.
         const picked = await open({ directory: true })
         if (typeof picked !== 'string') return
         await invoke('allow_binder_directory', { path: picked })
         const nextBackend = await createFilesystemBackend(picked)
         finishOpen(nextBackend, picked)
      } catch (failure) {
         setError(String(failure))
      } finally {
         setBusy(false)
      }
   }

   // Grant + open a Binder at a known path (a recent pick, or a launched `.mint`'s resolved root). The
   // grant is idempotent, so a persisted-scope path re-grants harmlessly; a launched Binder never opened
   // before still gets its scope. Returns whether it opened, for the launch flow.
   const openBinderAtPath = async (path: string): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
         await invoke('allow_binder_directory', { path })
         const nextBackend = await createFilesystemBackend(path)
         finishOpen(nextBackend, path)
         return true
      } catch (failure) {
         setError(String(failure))
         return false
      } finally {
         setBusy(false)
      }
   }

   const switchBinder = async (path: string): Promise<void> => { await openBinderAtPath(path) }

   // Latest values for the launch effect, which runs once yet must see the current active Binder + the
   // current openBinderAtPath (both change across renders).
   const activePathRef      = useRef(activePath)
   const openBinderAtPathRef = useRef(openBinderAtPath)
   activePathRef.current      = activePath
   openBinderAtPathRef.current = openBinderAtPath

   const backendRef = useRef(backend)
   backendRef.current = backend

   // Remove a Binder from the app: drop it from the registry, and if it is the one open, dispose its
   // backend and fall back to Welcome. Reads refs so the external-deletion watcher (a captured effect) sees
   // the live active path + backend. Shared by the in-app delete and the external evict.
   const evictBinderState = (path: string): void => {
      const wasActive = activePathRef.current === path
      const updated = forgetBinder(readBinderRegistry(), path)
      writeBinderRegistry(updated)
      setKnown(updated.known)
      if (wasActive) {
         const previous = backendRef.current
         setBackend(null)
         setActivePathState(null)
         setNotice(null)
         setPhase('welcome')
         if (previous) void previous.dispose().catch(() => { /* the folder is already gone; nothing to close cleanly */ })
      }
   }
   const evictBinderStateRef = useRef(evictBinderState)
   evictBinderStateRef.current = evictBinderState

   // Delete a Binder folder from disk (the name-typed confirmation happens in the UI). The ACTIVE Binder
   // holds its index.sqlite + folder watch open, which LOCKS the folder against deletion, so we first drop
   // to Welcome (App stops touching it) and dispose the backend to release those handles, THEN delete. A
   // non-active Binder has no open handles and deletes directly. The registry entry is forgotten only on a
   // successful delete, so a blocked / failed delete leaves the Binder recoverable in the list.
   const deleteBinder = async (path: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
         if (activePathRef.current === path) {
            const previous = backendRef.current
            setBackend(null)
            setActivePathState(null)
            setNotice(null)
            setPhase('welcome')
            if (previous) await previous.dispose()
         }
         await invoke('delete_binder_directory', { path })
         const updated = forgetBinder(readBinderRegistry(), path)
         writeBinderRegistry(updated)
         setKnown(updated.known)
      } catch (failure) {
         setError(String(failure))
      } finally {
         setBusy(false)
      }
   }

   // Quietly evict the active Binder if its folder vanishes from disk (deleted in a file manager). Checks on
   // window focus (the "deleted in Explorer, alt-tab back" flow) plus a slow interval backstop, so a gone
   // folder never lingers or crashes a later access. No notice: the Binder is simply gone.
   useEffect(() => {
      if (activePath === null) return
      let cancelled = false
      const check = async (): Promise<void> => {
         try {
            if (!(await exists(activePath)) && !cancelled) evictBinderStateRef.current(activePath)
         } catch { /* a transient stat error is not proof the folder is gone; ignore */ }
      }
      const onFocus = (): void => { void check() }
      window.addEventListener('focus', onFocus)
      const interval = window.setInterval(() => { void check() }, 5000)
      return () => {
         cancelled = true
         window.removeEventListener('focus', onFocus)
         clearInterval(interval)
      }
   }, [activePath])

   // Open the OS-launched `.mint`: resolve its Binder, adopt that Binder when it differs from the active
   // one (remounting App), then publish the pending open App consumes. A loose file (no Binder) publishes
   // a loose open against whatever Binder is active, or waits on the Welcome screen until one opens. The
   // cold-start drain is intentionally unguarded so StrictMode's remount does not discard it (the second
   // run drains null); the live event listener is torn down on unmount.
   useEffect(() => {
      let active = true

      const handleLaunchPath = async (filePath: string): Promise<void> => {
         const root = await resolveBinderRoot(filePath)
         if (root !== null) {
            if (root !== activePathRef.current) {
               const opened = await openBinderAtPathRef.current(root)
               if (!opened) return
            }
            setPendingLaunchOpen({ kind: 'binder-doc', binderRoot: root, filePath })
         } else {
            setPendingLaunchOpen({ kind: 'loose', filePath })
         }
      }

      void (async () => {
         const pending = await takePendingLaunchFile()
         if (pending !== null) await handleLaunchPath(pending)
      })()

      const unsubscribe = onLaunchFile(filePath => { if (active) void handleLaunchPath(filePath) })
      return () => { active = false; unsubscribe() }
   }, [])

   const consumeLaunchOpen = (): void => setPendingLaunchOpen(null)

   return {
      phase, backend, activePath, known, notice, error, busy, pendingLaunchOpen,
      createBinder, openBinder, switchBinder, deleteBinder, consumeLaunchOpen,
   }
}

// ####################
// # THE HOST
// ####################

/** Renders <App/> under the filesystem backend once a Binder is open (keyed by path so a switch remounts
 *  it), otherwise the Welcome frame. */
export function NativeBinderHost() {
   const binder = useNativeBinder()

   if (binder.phase === 'open' && binder.backend !== null && binder.activePath !== null) {
      // The header switcher reads these controls; activeName falls back to the folder name for a fresh open.
      const activeName = binder.known.find(entry => entry.path === binder.activePath)?.name
         ?? binderNameFromPath(binder.activePath)
      const controls: NativeBinderControls = {
         activePath: binder.activePath,
         activeName,
         known:      binder.known,
         busy:       binder.busy,
         error:      binder.error,
         switchBinder: binder.switchBinder,
         openBinder:   binder.openBinder,
         createBinder: binder.createBinder,
         deleteBinder: binder.deleteBinder,
         pendingLaunchOpen: binder.pendingLaunchOpen,
         consumeLaunchOpen: binder.consumeLaunchOpen,
      }
      return (
         <BinderBackendProvider key={binder.activePath} backend={binder.backend}>
            <NativeBinderProvider value={controls}>
               <ToastProvider>
                  <App />
               </ToastProvider>
            </NativeBinderProvider>
         </BinderBackendProvider>
      )
   }

   return <WelcomeFrame binder={binder} />
}

// ####################
// # THE WELCOME FRAME
// ####################

/** The pre-Binder chrome: its own language state (mirrors App's `documinter-lang`) and a title bar that
 *  renders in the loading phase too, so the window stays draggable + closable even during a slow restore. */
function WelcomeFrame({ binder }: { binder: NativeBinder }) {
   const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('documinter-lang') as Lang) ?? 'en')
   useEffect(() => { localStorage.setItem('documinter-lang', lang) }, [lang])

   return (
      <LangProvider lang={lang} setLang={setLang}>
         <div className="flex min-h-screen flex-col bg-bg text-text">
            <WelcomeTitleBar />
            <div className="flex-1 overflow-y-auto">
               {binder.phase === 'welcome' && <WelcomeContent binder={binder} />}
            </div>
         </div>
      </LangProvider>
   )
}

/** Drag region + window controls only. The language switch moved into the Welcome body, where a lost
 *  non-English user actually looks; the caption divider is dropped since nothing sits left of it here. */
function WelcomeTitleBar() {
   return (
      // min-h matches the main HeaderMenuBar's height (its logo h-7 + p-1 padding); without the old
      // language toggle nothing else gives the bar its height, so it would otherwise collapse thin.
      <div className="shrink-0 flex items-center gap-1 p-1 px-3 min-h-[2.25rem]">
         <div data-tauri-drag-region className="flex-1 self-stretch" />
         <WindowControls dividerLeft={false} />
      </div>
   )
}

const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', fr: 'Français' }

/** A globe-marked language switch showing full language names, so its purpose reads even to someone who
 *  cannot read the current UI language. Reads lang / setLang from context. */
function LanguageSelector() {
   const { lang, setLang } = useLang()
   const languages: Lang[] = ['en', 'fr']
   return (
      <div className="flex items-center gap-1 rounded-full border border-border bg-raised py-1 pl-2.5 pr-1">
         <Languages size={15} className="text-muted" />
         {languages.map(code => (
            <button
               key={code}
               type="button"
               onClick={() => setLang(code)}
               className={
                  'rounded-full px-3 py-0.5 text-xs transition-colors cursor-pointer ' +
                  (code === lang ? 'bg-accent text-bg font-semibold' : 'text-muted hover:bg-el hover:text-text')
               }
            >
               {LANGUAGE_NAMES[code]}
            </button>
         ))}
      </div>
   )
}

// ####################
// # THE WELCOME CONTENT
// ####################

/** The onboarding body: presents Documinter, explains Binders, and offers create / open / recent. */
function WelcomeContent({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()

   return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-6 pb-12 pt-6">

         <div className="flex w-full justify-end">
            <LanguageSelector />
         </div>

         <div className="flex flex-col items-center gap-3 text-center">
            <LogoColor className="h-16 w-auto" />
            <h1 className="text-3xl font-semibold tracking-tight">Documinter</h1>
         </div>

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

/** Create: a name + a location (defaults to ~/Documents/Documinter, changeable via a folder pick). */
function CreateBinderCard({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()
   const [name, setName] = useState('')
   const [parent, setParent] = useState<string | null>(null)

   // Resolve the default parent for display only; the flow re-derives it when parent is null.
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

   // The OS path separator ('\\' on Windows, '/' elsewhere), so the preview matches the real created path.
   // previewLocation is the full intended path, used verbatim as the tooltip since the field truncates.
   const separator = sep()
   const previewLocation = parent === null
      ? null
      : folderName === '' ? parent : `${parent}${separator}${folderName}`

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
         <div className="mb-4 truncate rounded border border-border bg-el px-2 py-1.5 text-xs text-muted" title={previewLocation ?? undefined}>
            {parent ?? '...'}{folderName !== '' && <span className="text-text">{separator}{folderName}</span>}
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

/** Recent Binders: one click reopens a known folder; the trash on hover deletes it (with confirmation). */
function RecentBinders({ binder }: { binder: NativeBinder }) {
   const { t } = useLang()
   const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null)
   return (
      <div className="w-full">
         <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            <FolderClock size={14} />
            {t.welcomeRecentTitle}
         </div>
         <ul className="flex flex-col gap-1">
            {binder.known.map(entry => (
               <li key={entry.path} className="group flex items-stretch overflow-hidden rounded border border-border bg-raised transition-colors hover:bg-el">
                  <button
                     type="button"
                     onClick={() => void binder.switchBinder(entry.path)}
                     disabled={binder.busy}
                     className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left disabled:opacity-50 cursor-pointer"
                  >
                     <span className="text-sm font-medium text-text">{entry.name}</span>
                     <span className="w-full truncate text-xs text-muted" title={entry.path}>{entry.path}</span>
                  </button>
                  <button
                     type="button"
                     onClick={() => setDeleteTarget({ path: entry.path, name: entry.name })}
                     disabled={binder.busy}
                     title={t.deleteBinderAction}
                     aria-label={t.deleteBinderAction}
                     className="flex items-center px-3 text-muted opacity-0 transition-opacity hover:text-[var(--callout-danger-accent)] group-hover:opacity-100 disabled:opacity-40 cursor-pointer"
                  >
                     <Trash2 size={14} />
                  </button>
               </li>
            ))}
         </ul>
         {deleteTarget !== null && (
            <DeleteBinderDialog
               binderName={deleteTarget.name}
               binderPath={deleteTarget.path}
               busy={binder.busy}
               onConfirm={() => { void binder.deleteBinder(deleteTarget.path); setDeleteTarget(null) }}
               onCancel={() => setDeleteTarget(null)}
            />
         )}
      </div>
   )
}

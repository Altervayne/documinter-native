/**
 * NativeBinderContext, the bridge from the native host down to components inside <App/>.
 *
 * The Binder lifecycle (switch / open / create) lives in NativeBinderHost, ABOVE App. The Header
 * Binder-switcher lives inside HeaderMenuBar, BELOW it. Rather than thread callbacks through App, the
 * host publishes the controls here and the switcher reads them. The value is null on the web (App is
 * mounted without this provider) and before a Binder opens, so a consumer renders nothing off native.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, type ReactNode } from 'react'
import type { KnownBinder } from '../lib/native/binderRegistry'

/** Something to act on from the OS file association, set by the host once a Binder is mounted, consumed by
 *  App: a `.mint` document already inside the open Binder (by root + absolute path), a loose `.mint`
 *  outside any Binder (opened as a scratch tab), or a `.tin` bundle to import into the open Binder (the
 *  merge / replace dialog, targeting the root). */
export type PendingLaunchOpen =
   | { kind: 'binder-doc'; binderRoot: string; filePath: string }
   | { kind: 'loose';      filePath: string }
   | { kind: 'tin';        filePath: string }

export interface NativeBinderControls {
   /** The open Binder's absolute path (its id) and display name. */
   activePath: string
   activeName: string
   /** Every remembered Binder, most-recent first (includes the active one). */
   known:      KnownBinder[]
   /** A flow is in flight (a pick / open / create); the switcher disables its actions. */
   busy:       boolean
   /** The last flow error, surfaced in the switcher since the Welcome screen is not mounted while open. */
   error:      string | null
   switchBinder(path: string): Promise<void>
   openBinder(): Promise<void>
   createBinder(name: string, parentDir?: string): Promise<void>
   deleteBinder(path: string): Promise<void>
   /** A launched `.mint` waiting to open in this Binder, or null. App opens it then calls consume. */
   pendingLaunchOpen: PendingLaunchOpen | null
   consumeLaunchOpen(): void
}

const NativeBinderContext = createContext<NativeBinderControls | null>(null)

export function NativeBinderProvider({ value, children }: { value: NativeBinderControls; children: ReactNode }) {
   return <NativeBinderContext.Provider value={value}>{children}</NativeBinderContext.Provider>
}

/** The native Binder controls, or null off native (web) / before a Binder is open. */
export function useNativeBinderControls(): NativeBinderControls | null {
   return useContext(NativeBinderContext)
}

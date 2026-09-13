/**
 * BinderBackendContext, Provides the active BinderBackend to the whole tree.
 *
 * Exports: useBinderBackend, BinderBackendProvider
 *
 * One backend instance drives every persistence call in the app. The provider defaults to the
 * IndexedDB backend; a native build can supply a filesystem backend and swap it on Binder switch.
 * useBinderBackend falls back to a lazily-created IndexedDB singleton when no provider is mounted,
 * so an un-wrapped render (and every test) keeps working without a wrapper.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { createIndexedDbBackend, type BinderBackend } from '../lib/binderBackend'

const BinderBackendContext = createContext<BinderBackend | null>(null)

// Shared IndexedDB backend for renders outside a provider (tests, un-wrapped mounts). Built on
// first use so importing this module never opens the database on its own.
let fallbackBackend: BinderBackend | null = null
function getFallbackBackend(): BinderBackend {
   if (!fallbackBackend) fallbackBackend = createIndexedDbBackend()
   return fallbackBackend
}

/** The active backend. Returns the provider's instance, or the shared IndexedDB fallback when no
 *  provider is mounted (so nothing crashes when the app tree is rendered without a wrapper). */
export function useBinderBackend(): BinderBackend {
   return useContext(BinderBackendContext) ?? getFallbackBackend()
}

/** Supplies one backend instance to the subtree. Defaults to a fresh IndexedDB backend, held stable
 *  for the provider's lifetime; pass `backend` to override (a native filesystem backend). The initial
 *  prop wins for the provider's life, a native Binder switch remounts the provider under a new key. */
export function BinderBackendProvider({ backend, children }: { backend?: BinderBackend; children: ReactNode }) {
   const [backendInstance] = useState<BinderBackend>(() => backend ?? createIndexedDbBackend())
   return (
      <BinderBackendContext.Provider value={backendInstance}>
         {children}
      </BinderBackendContext.Provider>
   )
}

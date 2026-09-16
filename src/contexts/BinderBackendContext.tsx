/*
 * The active BinderBackend that drives every persistence call. The provider defaults to the
 * IndexedDB backend; a native build supplies a filesystem backend and swaps it on Binder switch. A
 * lazily-created IndexedDB singleton backs any render outside a provider, so tests and un-wrapped
 * mounts keep working.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { createIndexedDbBackend, type BinderBackend } from '../lib/binderBackend'

const BinderBackendContext = createContext<BinderBackend | null>(null)

// Built on first use, so importing this module never opens the database on its own.
let fallbackBackend: BinderBackend | null = null
function getFallbackBackend(): BinderBackend {
   if (!fallbackBackend) fallbackBackend = createIndexedDbBackend()
   return fallbackBackend
}

/** The provider's backend, or the shared IndexedDB fallback when no provider is mounted. */
export function useBinderBackend(): BinderBackend {
   return useContext(BinderBackendContext) ?? getFallbackBackend()
}

/** Supplies one backend to the subtree, held stable for the provider's life; the initial `backend`
 *  prop wins, and a native Binder switch remounts the provider under a new key to replace it. */
export function BinderBackendProvider({ backend, children }: { backend?: BinderBackend; children: ReactNode }) {
   const [backendInstance] = useState<BinderBackend>(() => backend ?? createIndexedDbBackend())
   return (
      <BinderBackendContext.Provider value={backendInstance}>
         {children}
      </BinderBackendContext.Provider>
   )
}

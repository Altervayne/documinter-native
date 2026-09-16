/*
 * The active BinderBackend that drives every persistence call. The native host builds a filesystem
 * backend per Binder and supplies it here, swapping it on a Binder switch. There is no default backend:
 * a consumer must sit under a provider.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { BinderBackend } from '../lib/binderBackend'

const BinderBackendContext = createContext<BinderBackend | null>(null)

/** The provider's backend. Throws when no provider is mounted, so a missing host surfaces loudly
 *  instead of silently reading a phantom store. */
export function useBinderBackend(): BinderBackend {
   const backend = useContext(BinderBackendContext)
   if (backend === null) throw new Error('useBinderBackend used outside a BinderBackendProvider')
   return backend
}

/** Supplies one backend to the subtree, held stable for the provider's life; a native Binder switch
 *  remounts the provider under a new key to replace it. */
export function BinderBackendProvider({ backend, children }: { backend: BinderBackend; children: ReactNode }) {
   const [backendInstance] = useState<BinderBackend>(() => backend)
   return (
      <BinderBackendContext.Provider value={backendInstance}>
         {children}
      </BinderBackendContext.Provider>
   )
}

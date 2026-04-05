/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

const DocumentHandlesContext = createContext<string[]>([])

export function DocumentHandlesProvider({ handles, children }: { handles: string[]; children: ReactNode }) {
   return <DocumentHandlesContext.Provider value={handles}>{children}</DocumentHandlesContext.Provider>
}

export function useDocumentHandles(): string[] {
   return useContext(DocumentHandlesContext)
}

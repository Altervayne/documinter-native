/**
 * DocumentHandlesContext, Provides the flat list of all anchor handles
 * currently defined in the document.
 *
 * Exports: DocumentHandlesProvider, useDocumentHandles
 *
 * Used by AnchorEditor and BlockSidebar to detect duplicate handles, and by
 * FormatToolbar to populate the "jump to block" link picker.
 */

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

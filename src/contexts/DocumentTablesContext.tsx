/*
 * The cross-block read seam for the graph<->table live link. DocumentTablesContext maps every
 * handled table's handle to its cells (what a linked graph resolves from); LinkableTablesContext
 * lists every table, handled or not, for the "Link to a table..." picker. Both are memoized over
 * the active document's `sections`, so a table edit reflows every linked graph automatically.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { GraphTableCatalog, LinkableTable } from '../lib/graphTableData'

// A frozen empty default, so a consumer outside a provider resolves every link as dangling rather
// than throwing.
const EMPTY_CATALOG: GraphTableCatalog = new Map()

const DocumentTablesContext = createContext<GraphTableCatalog>(EMPTY_CATALOG)

export function DocumentTablesProvider({ tables, children }: { tables: GraphTableCatalog; children: ReactNode }) {
   return <DocumentTablesContext.Provider value={tables}>{children}</DocumentTablesContext.Provider>
}

export function useDocumentTables(): GraphTableCatalog {
   return useContext(DocumentTablesContext)
}

const EMPTY_LINKABLE_TABLES: LinkableTable[] = []

const LinkableTablesContext = createContext<LinkableTable[]>(EMPTY_LINKABLE_TABLES)

export function LinkableTablesProvider({ tables, children }: { tables: LinkableTable[]; children: ReactNode }) {
   return <LinkableTablesContext.Provider value={tables}>{children}</LinkableTablesContext.Provider>
}

export function useLinkableTables(): LinkableTable[] {
   return useContext(LinkableTablesContext)
}

/**
 * DocumentTablesContext, Provides the document-wide `handle -> table cells` catalog that a linked
 * graph resolves its data from, PLUS the full linkable-tables listing the "Link to a table…" editor
 * picker draws from.
 *
 * Exports: DocumentTablesProvider, useDocumentTables, LinkableTablesProvider, useLinkableTables
 *
 * This is the cross-block read seam for the graph<->table LIVE LINK (stage 2 of
 * docs/reference/graph_table_linking_study.md), the exact analogue of DocumentHandlesContext, one
 * axis over: where that context lists every anchor handle, `DocumentTablesContext` maps every
 * HANDLED table block's handle to its cells (the resolver's lookup), and `LinkableTablesContext`
 * (stage 2b, the editor UX) lists EVERY table, handled or not, with enough identity to route a
 * mutation back at a pick (see `LinkableTable` in `lib/graphTableData.ts`). Both are built once with
 * a `useMemo` over the active document's `sections` (in WysiwygArea/index.tsx, right beside
 * DocumentHandlesProvider) via the pure `collectTableSources` / `collectLinkableTables`.
 *
 * Reactivity is automatic: a table edit -> `setSections` -> new `sections` identity -> the memo
 * recomputes -> the provider's value changes -> every linked GraphBlock re-renders and re-resolves,
 * and the picker's listing stays current. No manual subscription, no event bus (the React Compiler
 * auto-memoizes the consumers).
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { GraphTableCatalog, LinkableTable } from '../lib/graphTableData'

// A frozen empty catalog as the default, so `useDocumentTables()` outside a provider (e.g. a stray
// render path) resolves every link as dangling rather than throwing.
const EMPTY_CATALOG: GraphTableCatalog = new Map()

const DocumentTablesContext = createContext<GraphTableCatalog>(EMPTY_CATALOG)

export function DocumentTablesProvider({ tables, children }: { tables: GraphTableCatalog; children: ReactNode }) {
   return <DocumentTablesContext.Provider value={tables}>{children}</DocumentTablesContext.Provider>
}

export function useDocumentTables(): GraphTableCatalog {
   return useContext(DocumentTablesContext)
}

// A frozen empty list as the default, so `useLinkableTables()` outside a provider (e.g. a stray
// render path, or a test) renders the "Link to a table…" picker as empty rather than throwing.
const EMPTY_LINKABLE_TABLES: LinkableTable[] = []

const LinkableTablesContext = createContext<LinkableTable[]>(EMPTY_LINKABLE_TABLES)

export function LinkableTablesProvider({ tables, children }: { tables: LinkableTable[]; children: ReactNode }) {
   return <LinkableTablesContext.Provider value={tables}>{children}</LinkableTablesContext.Provider>
}

export function useLinkableTables(): LinkableTable[] {
   return useContext(LinkableTablesContext)
}

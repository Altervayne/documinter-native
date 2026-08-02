/**
 * GraphLinkPanel.tsx, the graph<->table LIVE LINK's editor surface (stage 2b of
 * docs/reference/graph_table_linking_study.md, the architecture, stage 2a, is already built; this
 * is the UI to CREATE and MANAGE a link). Lives in the graph editor's Data tab, tabular chart types
 * only (bar family / line / area / pie / donut, the continuous-x types never carry a `source`).
 *
 * Two render modes, switched on `spec.source`:
 *   - UNLINKED: a compact "Link to a table…" picker row above the ordinary editable GraphDataGrid
 *     (rendered by the caller, not here, see GraphBlock.tsx's dataTab). Picking a table calls
 *     `onLinkTable`; nothing else in this panel is shown.
 *   - LINKED: REPLACES the editable grid entirely (the caller hides GraphDataGrid while linked) with
 *     a banner naming the source table, a READ-ONLY preview of the resolved data (never editable,
 *     the table is the source of truth), a mapping panel (label column + orientation), a "change
 *     source table" re-pick, and an "Unlink (keep current data)" escape hatch. A dangling link
 *     (source handle not found) additionally shows the existing quiet missing-source notice; the
 *     preview + mapping still render against the last-known materialized snapshot.
 *
 * This component owns NO document mutation itself, auto-assigning a handle to a handle-less table
 * touches a DIFFERENT block than this graph, which only GraphBlock (via DocumentMutationsContext)
 * can do. `onLinkTable` hands the picked `LinkableTable` back up; GraphBlock resolves the handle
 * assignment + commits `graph.source`. The three lighter edits (mapping change, unlink) route
 * through the pure `graphEdit.ts` helpers the same way the rest of the editor's controls do.
 */

// -- React Imports --
import { useState } from 'react'
import type React from 'react'

// -- Library Imports --
import { Link2 } from 'lucide-react'

// -- Lib Imports --
import type { GraphData, GraphSource, GraphSpec } from '../lib/graph'
import type { LinkableTable } from '../lib/graphTableData'
import type { T } from '../lib/i18n'

// #########
// # TYPES #
// #########

interface GraphLinkPanelProps {
   /** The live working spec (GraphBlock's local draft); only `source` is read here. */
   spec: GraphSpec
   /** UI strings. */
   t: T
   /** Every document table (handled or not), for the picker + the linked-state "change table"
    *  re-pick. Order follows document order. */
   linkableTables: LinkableTable[]
   /** The already-resolved data for the CURRENT link (GraphBlock's own `resolveGraphSpec` call),
    *  the live remap when the source is found, or the last materialized snapshot when dangling.
    *  Ignored while unlinked. */
   resolvedData: GraphData
   /** True when `spec.source` is set but its handle did not resolve in the document's table
    *  catalog (the source table was deleted/renamed), `resolvedData` is then the last snapshot. */
   dangling: boolean
   /** Link (or re-link) to a table. GraphBlock auto-assigns the table a handle first if it has
    *  none, then commits `graph.source`. */
   onLinkTable: (entry: LinkableTable) => void
   /** Apply a mapping change (label column and/or orientation); commits immediately, a `<select>`
    *  change is discrete, not draft-as-you-type. */
   onUpdateMapping: (partial: Partial<Omit<GraphSource, 'handle'>>) => void
   /** Unlink: materialize `resolvedData` onto `data` and drop `source`, reverting to a normal
    *  self-contained, editable chart. */
   onUnlink: () => void
}

// ###########
// # HELPERS #
// ###########

/** A human label for a picker entry: its handle if it has one, else its first non-blank header
 *  cell, else a positional fallback (never blank, so every row reads as something pickable). */
function tableLabel(entry: LinkableTable, index: number, t: T): string {
   if (entry.handle) return `#${entry.handle}`
   const firstHeader = entry.headerPreview.find(text => text.trim() !== '')
   return firstHeader?.trim() || `${t.graphLinkUntitledTable} ${index + 1}`
}

// #############
// # COMPONENT #
// #############

export function GraphLinkPanel({
   spec, t, linkableTables, resolvedData, dangling, onLinkTable, onUpdateMapping, onUnlink,
}: GraphLinkPanelProps) {
   const source = spec.source

   // The picker `<select>`s are uncontrolled-by-value in effect: picking a table fires immediately
   // (matching every other discrete graph-editor control's commit-on-change convention) and the
   // select resets to the blank placeholder right after, so the SAME dropdown can be reused for a
   // second pick without carrying the previous choice forward.
   const [pickerKey, setPickerKey] = useState(0)

   function handlePick(event: React.ChangeEvent<HTMLSelectElement>): void {
      const blockId = event.target.value
      const entry = linkableTables.find(candidate => candidate.blockId === blockId)
      if (!entry) return
      onLinkTable(entry)
      setPickerKey(key => key + 1) // remounts the select, clearing its displayed value
   }

   // ================
   //  Unlinked: the picker row only (the caller renders the editable grid alongside this)
   // ================
   if (!source) {
      if (linkableTables.length === 0) return null // nothing in the document to link to yet
      return (
         <div className="graph-editor-group graph-link-panel">
            <span className="graph-section-label">{t.graphLinkSection}</span>
            <select
               key={pickerKey}
               className="graph-overlay-select graph-link-select"
               aria-label={t.graphLinkPickTable}
               defaultValue=""
               onChange={handlePick}
            >
               <option value="" disabled>{t.graphLinkPickTable}</option>
               {linkableTables.map((entry, index) => (
                  <option key={entry.blockId} value={entry.blockId}>
                     {tableLabel(entry, index, t)} · {entry.columnCount}×{entry.rowCount}
                  </option>
               ))}
            </select>
         </div>
      )
   }

   // ================
   //  Linked: banner + read-only preview + mapping + change-table / unlink
   // ================
   const linkedEntryIndex = linkableTables.findIndex(entry => entry.handle === source.handle)
   const linkedEntry = linkedEntryIndex === -1 ? undefined : linkableTables[linkedEntryIndex]
   const bannerLabel = linkedEntry ? tableLabel(linkedEntry, linkedEntryIndex, t) : `#${source.handle}`
   const columnCount = Math.max(linkedEntry?.columnCount ?? 0, 1)

   return (
      <div className="graph-editor-group graph-link-panel graph-link-panel-linked">
         <div className="graph-link-banner">
            <Link2 size={13} className="graph-link-banner-icon" />
            <span className="graph-link-banner-text">{t.graphLinkedTo} <strong>{bannerLabel}</strong></span>
         </div>

         {dangling && (
            <div className="graph-source-missing graph-link-dangling" role="status">{t.graphSourceMissing}</div>
         )}

         {/* Read-only preview of the resolved (or last-known snapshot) data, never editable, the
             table is the source of truth. Reuses the grid's own table/cell chrome classes. */}
         <div className="graph-grid-scroll graph-link-preview-scroll">
            <table className="graph-grid-table">
               <thead>
                  <tr>
                     <th className="graph-grid-corner">{t.graphAxisHint}</th>
                     {resolvedData.series.map((oneSeries, seriesIndex) => (
                        <th key={seriesIndex} className="graph-series-head">
                           {oneSeries.name || `${t.graphSeriesDefault} ${seriesIndex + 1}`}
                        </th>
                     ))}
                  </tr>
               </thead>
               <tbody>
                  {resolvedData.labels.map((label, rowIndex) => (
                     <tr key={rowIndex}>
                        <th className="graph-lead-cell" scope="row">{label}</th>
                        {resolvedData.series.map((oneSeries, seriesIndex) => (
                           <td key={seriesIndex} className="graph-cell graph-link-preview-cell">
                              {oneSeries.values[rowIndex] ?? '–'}
                           </td>
                        ))}
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>

         {/* Mapping panel: which column supplies labels/series-names, and the orientation. */}
         <div className="graph-link-mapping-row">
            <label className="graph-field">
               <span className="graph-field-label">{t.graphMappingLabelColumn}</span>
               {linkedEntry ? (
                  <select
                     className="graph-overlay-select"
                     value={source.labelColumn ?? 0}
                     onChange={event => onUpdateMapping({ labelColumn: Number(event.target.value) })}
                  >
                     {Array.from({ length: columnCount }, (_unused, columnIndex) => (
                        <option key={columnIndex} value={columnIndex}>
                           {linkedEntry.headerPreview[columnIndex]?.trim() || `${t.graphMappingColumn} ${columnIndex + 1}`}
                        </option>
                     ))}
                  </select>
               ) : (
                  // The source table couldn't be found in the catalog (fully dangling, deleted, not
                  // just reshaped), so there is no column list to offer: fall back to a bare number.
                  <input
                     className="graph-text-input"
                     type="number"
                     min={0}
                     value={source.labelColumn ?? 0}
                     onChange={event => onUpdateMapping({ labelColumn: Number(event.target.value) })}
                  />
               )}
            </label>
            <label className="graph-field">
               <span className="graph-field-label">{t.graphMappingOrient}</span>
               <select
                  className="graph-overlay-select"
                  value={source.orient ?? 'columns'}
                  onChange={event => onUpdateMapping({ orient: event.target.value as 'columns' | 'rows' })}
               >
                  <option value="columns">{t.graphMappingOrientColumns}</option>
                  <option value="rows">{t.graphMappingOrientRows}</option>
               </select>
            </label>
         </div>

         {/* Change source table (re-pick, also the dangling state's recovery path) + unlink. */}
         <div className="graph-link-actions">
            <select
               key={pickerKey}
               className="graph-overlay-select graph-link-select"
               aria-label={t.graphLinkChangeTable}
               defaultValue=""
               onChange={handlePick}
            >
               <option value="" disabled>{t.graphLinkChangeTable}</option>
               {linkableTables.map((entry, index) => (
                  <option key={entry.blockId} value={entry.blockId}>
                     {tableLabel(entry, index, t)} · {entry.columnCount}×{entry.rowCount}
                  </option>
               ))}
            </select>
            <button type="button" className="graph-grid-btn graph-link-unlink" onClick={onUnlink}>
               {t.graphUnlink}
            </button>
         </div>
      </div>
   )
}

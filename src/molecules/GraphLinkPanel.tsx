/*
 * The graph<->table LIVE LINK's editor, in the graph editor's Data tab (tabular chart types only).
 * Two modes on `spec.source`: UNLINKED shows a picker row above the caller's editable grid; LINKED
 * REPLACES the grid with a source banner, a read-only preview, a mapping panel, and change/unlink
 * actions (a dangling source still renders against the last-known snapshot). Owns NO document
 * mutation: `onLinkTable` hands the picked table up (assigning a handle touches another block, only
 * GraphBlock can do that), while mapping/unlink route through the pure `graphEdit` helpers.
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
   /** Only `source` is read here. */
   spec: GraphSpec
   t: T
   /** Every document table, for the picker + the "change table" re-pick, in document order. */
   linkableTables: LinkableTable[]
   /** The resolved data for the current link (the live remap, or the last snapshot when dangling).
    *  Ignored while unlinked. */
   resolvedData: GraphData
   /** `spec.source` is set but its handle did not resolve (the source was deleted/renamed);
    *  `resolvedData` is then the last snapshot. */
   dangling: boolean
   /** Link or re-link to a table. GraphBlock assigns the table a handle if it has none, then commits `source`. */
   onLinkTable: (entry: LinkableTable) => void
   /** Apply a mapping change (label column / orientation); commits immediately. */
   onUpdateMapping: (partial: Partial<Omit<GraphSource, 'handle'>>) => void
   /** Materialize `resolvedData` onto `data` and drop `source`, back to a self-contained chart. */
   onUnlink: () => void
}

// ###########
// # HELPERS #
// ###########

/** A label for a picker entry: its handle, else its first non-blank header cell, else a positional fallback. */
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

   // The picker fires on change, then remounts back to the blank placeholder (via pickerKey) so the
   // same dropdown can be reused for a second pick without carrying the previous choice forward.
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

         {/* Read-only preview of the resolved (or snapshot) data; the table is the source of truth. */}
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
                              {oneSeries.values[rowIndex] ?? '-'}
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
                  // The source table isn't in the catalog, so there is no column list: bare number input.
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

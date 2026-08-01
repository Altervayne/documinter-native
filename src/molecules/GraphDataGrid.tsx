// -- React Imports --
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { ColorPicker } from 'react-piqua-color'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// -- Lib Imports --
import type { GraphSpec, GraphTheme } from '../lib/graph'
import { resolveSeriesColor, MAX_SERIES } from '../lib/graph'
import {
   addCategory,
   removeCategory,
   setLabel,
   addSeries,
   removeSeries,
   setSeriesName,
   setSeriesColor,
   setCell,
} from '../lib/graphEdit'
import type { T } from '../lib/i18n'

// #########
// # TYPES #
// #########

interface GraphDataGridProps {
   /** The live working spec (GraphBlock's local draft); the grid renders from + edits this. */
   spec:  GraphSpec
   /** Resolved chart theme, so a swatch shows the real palette slot color a series draws in. */
   theme: GraphTheme
   /** UI strings. */
   t:     T
   /** Mark an edit in progress (guards GraphBlock's external-sync from clobbering typing). */
   onEditStart:   () => void
   /** Apply a spec edit to the live draft WITHOUT committing to the document (text/number typing). */
   onDraft:       (next: GraphSpec) => void
   /** Apply a spec edit AND commit it to the document (discrete: add/remove/color). */
   onCommit:      (next: GraphSpec) => void
   /** Commit the current working spec to the document (fired on a text/number input blur). */
   onCommitField: () => void
}

/** The transient raw text of the one numeric cell being typed into (survives un-parseable
 *  mid-typing states like "1." or "-" without losing the keystroke — see handleCellChange). */
interface EditingCell {
   rowIndex:    number
   seriesIndex: number
   text:        string
}

// #############
// # COMPONENT #
// #############

/**
 * The editable data table for a graph block: rows are categories (a label input + one numeric
 * cell per series), columns are series (a name input + a color swatch + remove control). Add/
 * remove affordances mirror the table block. All structural edits route through the pure
 * `graphEdit` helpers, so the arrays always stay rectangular and never drop below one row/column.
 *
 * Text + number inputs update the live draft on every keystroke (for the instant preview) and
 * commit to the document on blur; discrete actions (add/remove, color pick) commit immediately.
 */
export function GraphDataGrid({ spec, theme, t, onEditStart, onDraft, onCommit, onCommitField }: GraphDataGridProps) {
   const { labels, series } = spec.data

   // The one cell mid-edit, letting an un-parseable intermediate ("1.", "-") stay on screen.
   const [editingCell, setEditingCell] = useState<EditingCell | null>(null)

   // Which series' color popover is open, and the swatch rect that anchors it.
   const [colorPopover, setColorPopover] = useState<{ seriesIndex: number; rect: DOMRect } | null>(null)

   // ================
   //  Cell rendering
   // ================
   // Show the transient raw text while a cell is being typed into; otherwise the stored number
   // (an empty string for a null gap).
   function cellText(rowIndex: number, seriesIndex: number, value: number | null | undefined): string {
      if (editingCell && editingCell.rowIndex === rowIndex && editingCell.seriesIndex === seriesIndex) {
         return editingCell.text
      }
      return value === null || value === undefined ? '' : String(value)
   }

   function handleCellChange(rowIndex: number, seriesIndex: number, rawText: string): void {
      onEditStart()
      setEditingCell({ rowIndex, seriesIndex, text: rawText })
      const trimmed = rawText.trim()
      if (trimmed === '') {
         onDraft(setCell(spec, rowIndex, seriesIndex, null))
         return
      }
      const parsed = Number(trimmed)
      // Only push a parseable number into the model; an intermediate like "1." keeps the raw
      // text visible (via editingCell) but leaves the last valid number in place until it parses.
      if (Number.isFinite(parsed)) {
         onDraft(setCell(spec, rowIndex, seriesIndex, parsed))
      }
   }

   function handleCellBlur(): void {
      setEditingCell(null)
      onCommitField()
   }

   // ================
   //  Series color
   // ================
   function openColorPopover(seriesIndex: number, event: React.MouseEvent<HTMLButtonElement>): void {
      if (colorPopover?.seriesIndex === seriesIndex) { setColorPopover(null); return }
      setColorPopover({ seriesIndex, rect: event.currentTarget.getBoundingClientRect() })
   }

   return (
      <div className="graph-data-grid">
         <div className="graph-grid-scroll">
            <table className="graph-grid-table">
               {/* =============== Series header row =============== */}
               <thead>
                  <tr>
                     <th className="graph-grid-corner">{t.graphCategoryColumn}</th>
                     {series.map((oneSeries, seriesIndex) => (
                        <th key={seriesIndex} className="graph-series-head">
                           <input
                              className="graph-series-name"
                              type="text"
                              value={oneSeries.name}
                              placeholder={t.graphSeriesName}
                              aria-label={t.graphSeriesName}
                              onFocus={onEditStart}
                              onChange={event => { onEditStart(); onDraft(setSeriesName(spec, seriesIndex, event.target.value)) }}
                              onBlur={onCommitField}
                           />
                           <div className="graph-series-tools">
                              <button
                                 type="button"
                                 className="graph-color-swatch"
                                 data-graph-color-trigger
                                 style={{ background: resolveSeriesColor(seriesIndex, oneSeries.color, theme) }}
                                 aria-label={t.graphSeriesColor}
                                 title={t.graphSeriesColor}
                                 onClick={event => openColorPopover(seriesIndex, event)}
                              />
                              <button
                                 type="button"
                                 className="graph-icon-btn"
                                 onClick={() => onCommit(removeSeries(spec, seriesIndex))}
                                 disabled={series.length <= 1}
                                 aria-label={t.graphRemoveSeries}
                                 title={t.graphRemoveSeries}
                              >×</button>
                           </div>
                        </th>
                     ))}
                     <th className="graph-grid-add">
                        <button
                           type="button"
                           className="graph-grid-btn"
                           onClick={() => onCommit(addSeries(spec, `${t.graphSeriesDefault} ${series.length + 1}`))}
                           disabled={series.length >= MAX_SERIES}
                           title={t.graphAddSeries}
                        >{t.graphAddSeries}</button>
                     </th>
                  </tr>
               </thead>
               {/* =============== Category rows =============== */}
               <tbody>
                  {labels.map((label, rowIndex) => (
                     <tr key={rowIndex}>
                        <th className="graph-row-head">
                           <input
                              className="graph-label-input"
                              type="text"
                              value={label}
                              placeholder={t.graphCategoryLabel}
                              aria-label={t.graphCategoryLabel}
                              onFocus={onEditStart}
                              onChange={event => { onEditStart(); onDraft(setLabel(spec, rowIndex, event.target.value)) }}
                              onBlur={onCommitField}
                           />
                           <button
                              type="button"
                              className="graph-icon-btn"
                              onClick={() => onCommit(removeCategory(spec, rowIndex))}
                              disabled={labels.length <= 1}
                              aria-label={t.graphRemoveCategory}
                              title={t.graphRemoveCategory}
                           >×</button>
                        </th>
                        {series.map((oneSeries, seriesIndex) => (
                           <td key={seriesIndex} className="graph-cell">
                              <input
                                 className="graph-cell-input"
                                 type="text"
                                 inputMode="decimal"
                                 value={cellText(rowIndex, seriesIndex, oneSeries.values[rowIndex])}
                                 aria-label={t.graphCellValue}
                                 onFocus={onEditStart}
                                 onChange={event => handleCellChange(rowIndex, seriesIndex, event.target.value)}
                                 onBlur={handleCellBlur}
                              />
                           </td>
                        ))}
                        <td className="graph-grid-add" />
                     </tr>
                  ))}
                  {/* =============== Add-category footer =============== */}
                  <tr>
                     <td className="graph-row-head">
                        <button
                           type="button"
                           className="graph-grid-btn"
                           onClick={() => onCommit(addCategory(spec))}
                           title={t.graphAddCategory}
                        >{t.graphAddCategory}</button>
                     </td>
                     <td colSpan={series.length + 1} />
                  </tr>
               </tbody>
            </table>
         </div>

         {colorPopover && (
            <GraphSeriesColorPopover
               anchorRect={colorPopover.rect}
               value={resolveSeriesColor(colorPopover.seriesIndex, series[colorPopover.seriesIndex]?.color, theme)}
               title={t.graphSeriesColor}
               resetLabel={t.graphResetColor}
               onPick={hex => onCommit(setSeriesColor(spec, colorPopover.seriesIndex, hex))}
               onReset={() => { onCommit(setSeriesColor(spec, colorPopover.seriesIndex, undefined)); setColorPopover(null) }}
               onClose={() => setColorPopover(null)}
            />
         )}
      </div>
   )
}

// #####################
// # COLOR POPOVER     #
// #####################

interface GraphSeriesColorPopoverProps {
   /** Viewport rect of the swatch trigger; drives the clamped placement below/above it. */
   anchorRect: DOMRect
   /** The color the picker opens on (the series' current resolved color). */
   value:      string
   /** Localized heading. */
   title:      string
   /** Localized reset-to-palette-default label. */
   resetLabel: string
   /** Apply a picked hex (fires live while adjusting). */
   onPick:     (hex: string) => void
   /** Clear the override back to the palette slot, then close. */
   onReset:    () => void
   /** Dismiss the popover. */
   onClose:    () => void
}

/**
 * Floating per-series color popover: the reused react-piqua-color ColorPicker plus a "reset to
 * default" action that clears the override so the series falls back to its palette slot. Portaled
 * to document.body and viewport-clamped, mirroring MetaFieldColorPopover's shell.
 */
function GraphSeriesColorPopover({ anchorRect, value, title, resetLabel, onPick, onReset, onClose }: GraphSeriesColorPopoverProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({ type: 'rect', rect: anchorRect })

   // Dismiss on a pointerdown outside the popover, ignoring the swatch trigger (its own click
   // toggles the popover via the parent, so we must not also close it here and fight that).
   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         const target = event.target as HTMLElement
         if (ref.current?.contains(target)) return
         if (target.closest('[data-graph-color-trigger]')) return
         onClose()
      }
      document.addEventListener('pointerdown', handlePointerDown)
      return () => document.removeEventListener('pointerdown', handlePointerDown)
   }, [onClose, ref])

   return createPortal(
      <div
         ref={ref}
         className="fixed z-[9999] w-62 rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{ top, left, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
         onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
         <div className="px-2 pt-2 pb-1.5">
            <span className="text-[0.7rem] uppercase tracking-wider text-muted/70 font-semibold select-none">{title}</span>
         </div>
         <div className="p-2 border-t border-border">
            <ColorPicker value={value} onChange={onPick} />
         </div>
         <div className="border-t border-border px-2 py-1.5">
            <button
               onClick={onReset}
               className="w-full text-left text-xs text-muted hover:text-text transition-colors cursor-pointer px-1 py-0.5 rounded"
            >
               {resetLabel}
            </button>
         </div>
      </div>,
      document.body,
   )
}

// -- React Imports --
import { useEffect, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'

// -- Library Imports --
import { ColorPicker } from 'react-piqua-color'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// -- Lib Imports --
import type { GraphSpec, GraphType, GraphTheme } from '../lib/graph'
import { resolveSeriesColor, MAX_SERIES } from '../lib/graph'
import {
   addCategory,
   removeCategory,
   setLabel,
   setCategoryColor,
   addSeries,
   removeSeries,
   setSeriesName,
   setSeriesColor,
   setCell,
} from '../lib/graphEdit'
import type { T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

/** The radial families: a single series whose CATEGORIES are the colored slices. They share the
 *  single-series table shape with the simple `bar` (which also renders series[0] only); the
 *  distinction the table keeps between them is wording + the per-category color default. */
const RADIAL_TYPES = new Set<GraphType>(['pie', 'donut'])

// #########
// # TYPES #
// #########

interface GraphDataGridProps {
   /** The live working spec (GraphBlock's local draft); the grid renders from + edits this. */
   spec:  GraphSpec
   /** Resolved chart theme, so a swatch shows the real palette slot color a series/slice draws in. */
   theme: GraphTheme
   /** UI strings. */
   t:     T
   /** Mark an edit in progress (guards GraphBlock's external-sync from clobbering typing). */
   onEditStart:   () => void
   /** Apply a spec edit to the live draft WITHOUT committing to the document (text/number typing). */
   onDraft:       (next: GraphSpec) => void
   /** Apply a spec edit AND commit it to the document (discrete: add/remove/color/paste). */
   onCommit:      (next: GraphSpec) => void
   /** Commit the current working spec to the document (fired on a text/number input blur). */
   onCommitField: () => void
}

/** The transient raw text of the one numeric cell being typed into (survives un-parseable
 *  mid-typing states like "1." or "-" without losing the keystroke — see handleCellChange).
 *  `categoryIndex`/`seriesIndex` are MODEL coordinates (setCell's row/series), independent of which
 *  axis renders as table rows. `invalid` flags non-numeric text so the cell shows a warning ring. */
interface EditingCell {
   categoryIndex: number
   seriesIndex:   number
   text:          string
   invalid:       boolean
}

/** Which swatch popover is open: a per-series color (multi-series table) or a per-category color
 *  (single-series table — a radial slice or a simple-bar bar). */
type ColorTarget =
   | { kind: 'series'; index: number; rect: DOMRect }
   | { kind: 'slice';  index: number; rect: DOMRect }

// ###########
// # HELPERS #
// ###########

/**
 * Parse a clipboard payload as TSV: rows split on newlines, columns split on tabs. Normalizes
 * CRLF/CR, drops a single trailing newline, and returns [] for an empty payload. Never throws.
 */
function parseTsvClipboard(text: string): string[][] {
   const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
   if (normalized === '') return []
   return normalized.split('\n').map(line => line.split('\t'))
}

/** Whether a parsed TSV grid spans more than one cell (so it is a paste worth expanding into). */
function isMultiCellPaste(grid: string[][]): boolean {
   return grid.length > 1 || grid.some(row => row.length > 1)
}

/**
 * Parse one pasted / typed cell into `number | null`, mirroring the fence parser: surrounding
 * whitespace and thousands-grouping commas are stripped, an empty or non-numeric cell becomes
 * `null` (a gap the renderer handles per type).
 */
function parseCellNumber(raw: string): number | null {
   const cleaned = raw.trim().replace(/\s+/g, '').replace(/,/g, '')
   if (cleaned === '') return null
   const parsed = Number(cleaned)
   return Number.isFinite(parsed) ? parsed : null
}

// #############
// # COMPONENT #
// #############

/**
 * The editable data table for a graph block, ADAPTING to whether the chart type draws ONE series
 * or MANY (not radial-vs-cartesian — a simple `bar` is single-series and shares the radial shape):
 *
 *   - MULTI-SERIES (grouped/stacked bar, line, area): transposed — rows = series (a sticky leading
 *     column with the series' color swatch + name + remove), columns = categories (a sticky header
 *     row of label inputs + remove, plus a trailing "+" to add a category). A "+ Series" footer row
 *     adds a series (capped at MAX_SERIES). Body cells are numeric, series x category.
 *   - SINGLE-SERIES (pie/donut AND simple bar): the one series' CATEGORIES are the rows — each is
 *     the category's own color swatch (per-category color) + label + its single value + remove, with
 *     a "+" footer that adds a category. No "Add series". Radial reads "slice" and defaults each
 *     swatch to a palette slot per index; simple bar reads "bar"/"category" and defaults each swatch
 *     to the ONE series' uniform base color (so an un-overridden bar chart stays uniform). Both write
 *     `categoryColors` via `setCategoryColor`; only the fallback color differs by type.
 *
 * Both shapes share the draft/commit model: numeric typing drafts on every keystroke (instant
 * preview) and commits on blur; structural + color edits commit immediately; a TSV paste auto-grows
 * the grid and commits once. All structural edits route through the pure `graphEdit` helpers, so the
 * arrays stay rectangular and never drop below one row/column.
 */
export function GraphDataGrid({ spec, theme, t, onEditStart, onDraft, onCommit, onCommitField }: GraphDataGridProps) {
   const { labels, series, categoryColors } = spec.data
   // Radial keeps its "slice" identity; a simple `bar` is ALSO single-series (it renders series[0]
   // only), so it shares the category-row table shape — the difference is only wording + the
   // per-category color default (radial = a palette slot per index; bar = the one uniform base).
   const isRadial = RADIAL_TYPES.has(spec.type)
   const isSingleSeries = isRadial || spec.type === 'bar'

   // ================
   //  Single-series wording (radial reads "slice", simple bar reads "category"/"bar")
   // ================
   const singleSeriesAddLabel    = isRadial ? t.graphAddSlice : t.graphAddCategory
   const singleSeriesRemoveLabel = isRadial ? t.graphRemoveSlice : t.graphRemoveCategory
   const singleSeriesColorLabel  = isRadial ? t.graphSliceColor : t.graphBarColor

   /**
    * The swatch display color for a single-series row: radial defaults to a palette slot PER index
    * (multicolor slices), simple bar defaults to the ONE series' uniform base color, and either is
    * overridden by an explicit `categoryColors[index]`.
    */
   function singleSeriesSwatchColor(categoryIndex: number): string {
      if (isRadial) return resolveSeriesColor(categoryIndex, categoryColors?.[categoryIndex], theme)
      const uniformBase = resolveSeriesColor(0, series[0]?.color, theme)
      return resolveSeriesColor(0, categoryColors?.[categoryIndex] ?? uniformBase, theme)
   }

   // The one cell mid-edit, letting an un-parseable intermediate ("1.", "-") stay on screen.
   const [editingCell, setEditingCell] = useState<EditingCell | null>(null)

   // Which swatch's color popover is open, and the swatch rect that anchors it.
   const [colorPopover, setColorPopover] = useState<ColorTarget | null>(null)

   // ================
   //  Cell rendering
   // ================
   // Show the transient raw text while a cell is being typed into; otherwise the stored number
   // (an empty string for a null gap — the muted "–" placeholder then reads the cell as a gap).
   function cellText(categoryIndex: number, seriesIndex: number, value: number | null | undefined): string {
      if (editingCell && editingCell.categoryIndex === categoryIndex && editingCell.seriesIndex === seriesIndex) {
         return editingCell.text
      }
      return value === null || value === undefined ? '' : String(value)
   }

   /** Whether the cell at these coordinates is currently holding invalid (non-numeric) text. */
   function cellIsInvalid(categoryIndex: number, seriesIndex: number): boolean {
      return !!editingCell
         && editingCell.categoryIndex === categoryIndex
         && editingCell.seriesIndex === seriesIndex
         && editingCell.invalid
   }

   function handleCellChange(categoryIndex: number, seriesIndex: number, rawText: string): void {
      onEditStart()
      const trimmed = rawText.trim()
      if (trimmed === '') {
         setEditingCell({ categoryIndex, seriesIndex, text: rawText, invalid: false })
         onDraft(setCell(spec, categoryIndex, seriesIndex, null))
         return
      }
      const parsed = Number(trimmed)
      const isValid = Number.isFinite(parsed)
      setEditingCell({ categoryIndex, seriesIndex, text: rawText, invalid: !isValid })
      // Only push a parseable number into the model; an intermediate like "1." keeps the raw text
      // visible (via editingCell) but leaves the last valid value in place until it parses.
      if (isValid) {
         onDraft(setCell(spec, categoryIndex, seriesIndex, parsed))
      }
   }

   function handleCellBlur(): void {
      setEditingCell(null)
      onCommitField()
   }

   // ================
   //  Paste (TSV)
   // ================
   // A rectangular paste from a spreadsheet fills the numeric grid from the focused cell, auto-
   // growing categories (and, for cartesian, series up to MAX_SERIES) so a bigger paste expands the
   // grid. Non-numeric cells land as null. Applied over the pure transforms, committed once.
   function handleMultiSeriesPaste(event: React.ClipboardEvent<HTMLInputElement>, focusCategoryIndex: number, focusSeriesIndex: number): void {
      const grid = parseTsvClipboard(event.clipboardData.getData('text/plain'))
      if (!isMultiCellPaste(grid)) return // a plain single value falls through to normal typing.
      event.preventDefault()
      setEditingCell(null)
      let next = spec
      // Pasted rows map to SERIES (downward), pasted columns to CATEGORIES (rightward) — the
      // transposed orientation the table already presents.
      for (let rowOffset = 0; rowOffset < grid.length; rowOffset++) {
         const seriesIndex = focusSeriesIndex + rowOffset
         while (seriesIndex >= next.data.series.length && next.data.series.length < MAX_SERIES) {
            next = addSeries(next, `${t.graphSeriesDefault} ${next.data.series.length + 1}`)
         }
         if (seriesIndex >= next.data.series.length) break // hit the MAX_SERIES cap: stop growing.
         const cells = grid[rowOffset]
         for (let columnOffset = 0; columnOffset < cells.length; columnOffset++) {
            const categoryIndex = focusCategoryIndex + columnOffset
            while (categoryIndex >= next.data.labels.length) next = addCategory(next)
            next = setCell(next, categoryIndex, seriesIndex, parseCellNumber(cells[columnOffset]))
         }
      }
      onCommit(next)
   }

   function handleSingleSeriesPaste(event: React.ClipboardEvent<HTMLInputElement>, focusCategoryIndex: number): void {
      const grid = parseTsvClipboard(event.clipboardData.getData('text/plain'))
      if (!isMultiCellPaste(grid)) return
      event.preventDefault()
      setEditingCell(null)
      let next = spec
      // Each pasted row is one category (slice / bar), filling downward from the focused row. Two
      // columns read as (label, value); a single column is values only.
      for (let rowOffset = 0; rowOffset < grid.length; rowOffset++) {
         const categoryIndex = focusCategoryIndex + rowOffset
         while (categoryIndex >= next.data.labels.length) next = addCategory(next)
         const cells = grid[rowOffset]
         if (cells.length >= 2) {
            next = setLabel(next, categoryIndex, cells[0].trim())
            next = setCell(next, categoryIndex, 0, parseCellNumber(cells[1]))
         } else {
            next = setCell(next, categoryIndex, 0, parseCellNumber(cells[0]))
         }
      }
      onCommit(next)
   }

   // ================
   //  Color popover
   // ================
   function openColorPopover(target: ColorTarget): void {
      if (colorPopover && colorPopover.kind === target.kind && colorPopover.index === target.index) {
         setColorPopover(null)
         return
      }
      setColorPopover(target)
   }

   /** The resolved color + apply/reset actions for whichever swatch popover is open. */
   function colorPopoverBinding(target: ColorTarget) {
      if (target.kind === 'series') {
         return {
            value:   resolveSeriesColor(target.index, series[target.index]?.color, theme),
            title:   t.graphSeriesColor,
            onPick:  (hex: string) => onCommit(setSeriesColor(spec, target.index, hex)),
            onReset: () => { onCommit(setSeriesColor(spec, target.index, undefined)); setColorPopover(null) },
         }
      }
      return {
         value:   singleSeriesSwatchColor(target.index),
         title:   singleSeriesColorLabel,
         onPick:  (hex: string) => onCommit(setCategoryColor(spec, target.index, hex)),
         onReset: () => { onCommit(setCategoryColor(spec, target.index, undefined)); setColorPopover(null) },
      }
   }

   // ================
   //  Shared cell parts
   // ================
   function swatchButton(kind: 'series' | 'slice', index: number, resolvedColor: string, ariaLabel: string): React.ReactElement {
      return (
         <button
            type="button"
            className="graph-lead-swatch"
            data-graph-color-trigger
            style={{ background: resolvedColor }}
            aria-label={ariaLabel}
            title={ariaLabel}
            onClick={event => openColorPopover({ kind, index, rect: event.currentTarget.getBoundingClientRect() })}
         />
      )
   }

   function numericCell(categoryIndex: number, seriesIndex: number, value: number | null | undefined, onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void): React.ReactElement {
      const invalid = cellIsInvalid(categoryIndex, seriesIndex)
      return (
         <input
            className={`graph-cell-input${invalid ? ' is-invalid' : ''}`}
            type="text"
            inputMode="decimal"
            placeholder="–"
            value={cellText(categoryIndex, seriesIndex, value)}
            aria-label={t.graphCellValue}
            aria-invalid={invalid || undefined}
            title={invalid ? t.graphInvalidNumber : undefined}
            onFocus={onEditStart}
            onChange={event => handleCellChange(categoryIndex, seriesIndex, event.target.value)}
            onPaste={onPaste}
            onBlur={handleCellBlur}
         />
      )
   }

   // ################
   // # MULTI-SERIES #  (transposed: rows = series, columns = categories)
   // ################
   const multiSeriesTable = (
      <table className="graph-grid-table">
         {/* =============== Category header row =============== */}
         <thead>
            <tr>
               <th className="graph-grid-corner" title={t.graphAxisHint}>{t.graphAxisHint}</th>
               {labels.map((label, categoryIndex) => (
                  <th key={categoryIndex} className="graph-cat-head">
                     <div className="graph-cat-inner">
                        <input
                           className="graph-cat-input"
                           type="text"
                           size={Math.max(2, label.length)}
                           value={label}
                           placeholder={t.graphCategoryLabel}
                           aria-label={t.graphCategoryLabel}
                           onFocus={onEditStart}
                           onChange={event => { onEditStart(); onDraft(setLabel(spec, categoryIndex, event.target.value)) }}
                           onBlur={onCommitField}
                        />
                        <button
                           type="button"
                           className="graph-icon-btn"
                           onClick={() => onCommit(removeCategory(spec, categoryIndex))}
                           disabled={labels.length <= 1}
                           aria-label={t.graphRemoveCategory}
                           title={t.graphRemoveCategory}
                        >×</button>
                     </div>
                  </th>
               ))}
               <th className="graph-add-head">
                  <button
                     type="button"
                     className="graph-icon-btn graph-add-btn"
                     onClick={() => onCommit(addCategory(spec))}
                     aria-label={t.graphAddCategory}
                     title={t.graphAddCategory}
                  >+</button>
               </th>
            </tr>
         </thead>
         {/* =============== Series rows =============== */}
         <tbody>
            {series.map((oneSeries, seriesIndex) => (
               <tr key={seriesIndex}>
                  <th className="graph-lead-cell" scope="row">
                     <div className="graph-lead-inner">
                        {swatchButton('series', seriesIndex, resolveSeriesColor(seriesIndex, oneSeries.color, theme), t.graphSeriesColor)}
                        <input
                           className="graph-lead-name"
                           type="text"
                           size={Math.max(2, oneSeries.name.length)}
                           value={oneSeries.name}
                           placeholder={t.graphSeriesName}
                           aria-label={t.graphSeriesName}
                           onFocus={onEditStart}
                           onChange={event => { onEditStart(); onDraft(setSeriesName(spec, seriesIndex, event.target.value)) }}
                           onBlur={onCommitField}
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
                  {labels.map((_label, categoryIndex) => (
                     <td key={categoryIndex} className="graph-cell">
                        {numericCell(categoryIndex, seriesIndex, oneSeries.values[categoryIndex], event => handleMultiSeriesPaste(event, categoryIndex, seriesIndex))}
                     </td>
                  ))}
                  <td className="graph-grid-gutter" />
               </tr>
            ))}
            {/* =============== Add-series footer =============== */}
            <tr>
               <th className="graph-lead-cell graph-add-row-cell" scope="row">
                  <button
                     type="button"
                     className="graph-grid-btn"
                     onClick={() => onCommit(addSeries(spec, `${t.graphSeriesDefault} ${series.length + 1}`))}
                     disabled={series.length >= MAX_SERIES}
                     title={t.graphAddSeries}
                  >{t.graphAddSeries}</button>
               </th>
               <td className="graph-grid-gutter" colSpan={labels.length + 1} />
            </tr>
         </tbody>
      </table>
   )

   // #################
   // # SINGLE-SERIES #  (rows = categories: swatch + label + value + remove — radial slices AND
   // #################   simple bars; wording + swatch-color default branch on the chart type)
   const singleSeriesTable = (
      <table className="graph-grid-table">
         <thead>
            <tr>
               <th className="graph-grid-corner" scope="col">{t.graphCategoryColumn}</th>
               <th className="graph-value-head" scope="col">{t.graphValueColumn}</th>
            </tr>
         </thead>
         <tbody>
            {labels.map((label, categoryIndex) => (
               <tr key={categoryIndex}>
                  <th className="graph-lead-cell" scope="row">
                     <div className="graph-lead-inner">
                        {swatchButton('slice', categoryIndex, singleSeriesSwatchColor(categoryIndex), singleSeriesColorLabel)}
                        <input
                           className="graph-lead-name"
                           type="text"
                           size={Math.max(2, label.length)}
                           value={label}
                           placeholder={t.graphCategoryLabel}
                           aria-label={t.graphCategoryLabel}
                           onFocus={onEditStart}
                           onChange={event => { onEditStart(); onDraft(setLabel(spec, categoryIndex, event.target.value)) }}
                           onBlur={onCommitField}
                        />
                        <button
                           type="button"
                           className="graph-icon-btn"
                           onClick={() => onCommit(removeCategory(spec, categoryIndex))}
                           disabled={labels.length <= 1}
                           aria-label={singleSeriesRemoveLabel}
                           title={singleSeriesRemoveLabel}
                        >×</button>
                     </div>
                  </th>
                  <td className="graph-cell">
                     {numericCell(categoryIndex, 0, series[0]?.values[categoryIndex], event => handleSingleSeriesPaste(event, categoryIndex))}
                  </td>
               </tr>
            ))}
            {/* =============== Add-category footer =============== */}
            <tr>
               <th className="graph-lead-cell graph-add-row-cell" scope="row">
                  <button
                     type="button"
                     className="graph-grid-btn"
                     onClick={() => onCommit(addCategory(spec))}
                     title={singleSeriesAddLabel}
                  >{singleSeriesAddLabel}</button>
               </th>
               <td className="graph-grid-gutter" />
            </tr>
         </tbody>
      </table>
   )

   const activePopover = colorPopover ? colorPopoverBinding(colorPopover) : null

   return (
      <div className="graph-data-grid">
         <div className="graph-grid-scroll">
            {isSingleSeries ? singleSeriesTable : multiSeriesTable}
         </div>

         {colorPopover && activePopover && (
            <GraphSeriesColorPopover
               anchorRect={colorPopover.rect}
               value={activePopover.value}
               title={activePopover.title}
               resetLabel={t.graphResetColor}
               onPick={activePopover.onPick}
               onReset={activePopover.onReset}
               onClose={() => setColorPopover(null)}
            />
         )}
      </div>
   )
}

// #####################
// # COLOR POPOVER     #
// #####################

export interface GraphSeriesColorPopoverProps {
   /** Viewport rect of the swatch trigger; drives the clamped placement below/above it. */
   anchorRect: DOMRect
   /** The color the picker opens on (the series' or slice's current resolved color). */
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
 * Floating color popover reused for the per-series swatch (cartesian), the per-slice swatch
 * (radial), AND (exported for `molecules/EquationEditor.tsx`) the per-equation swatch on a
 * `function` chart: the react-piqua-color ColorPicker plus a "reset to default" action that clears
 * the override so the mark falls back to its palette slot. Portaled to document.body and viewport-
 * clamped, mirroring MetaFieldColorPopover's shell.
 */
export function GraphSeriesColorPopover({ anchorRect, value, title, resetLabel, onPick, onReset, onClose }: GraphSeriesColorPopoverProps) {
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

/**
 * graphEdit.ts, pure structural transforms for the graph block's interactive editor.
 *
 * PURE DATA / PURE FUNCTIONS, side-effect free, imports ONLY the graph types + the series cap.
 * Each function takes a GraphSpec and returns a BRAND-NEW GraphSpec with one structural or cell
 * edit applied, never mutating the input. This is the single tested place the data grid's
 * add/remove/set operations live (mirrors lib/mathStructures.ts for the math builder): the
 * editor UI (molecules/GraphDataGrid.tsx + blocks/GraphBlock.tsx) is thin glue over these.
 *
 * Two invariants every helper preserves:
 *   - RECTANGULAR: every series' `values` length always equals `labels` length (adding a
 *     category appends a null across all series; adding a series backfills nulls to the label
 *     count; removing either drops the matching index everywhere).
 *   - NON-EMPTY: the last remaining category or series is never removed (keep >= 1), so the
 *     spec never degenerates into an unlabeled / seriesless shape mid-edit.
 *
 * The renderer separately tolerates empty/degenerate data, so these guards are about a sane
 * editing model, not about preventing a crash.
 */

import type { GraphSpec, GraphSeries, GraphType, GraphOptions } from './graph'
import { MAX_SERIES } from './graph'

// ###########
// # HELPERS #
// ###########

/** Shallow-clone the spec's data with a fresh series array (each series object also fresh). */
function cloneData(spec: GraphSpec): { labels: string[]; series: GraphSeries[] } {
   return {
      labels: [...spec.data.labels],
      series: spec.data.series.map(series => ({ ...series, values: [...series.values] })),
   }
}

/** Reassemble a fresh spec from freshly-cloned data, carrying type + options through unchanged. */
function withData(spec: GraphSpec, data: { labels: string[]; series: GraphSeries[] }): GraphSpec {
   return { type: spec.type, data, options: spec.options }
}

// #############
// # CATEGORIES #  (rows: a label + one aligned value per series)
// #############

/**
 * Append a new category. The new label defaults to empty (the grid supplies a localized
 * placeholder / name); every series gets a trailing `null` so the arrays stay rectangular.
 */
export function addCategory(spec: GraphSpec, label: string = ''): GraphSpec {
   const data = cloneData(spec)
   data.labels.push(label)
   for (const series of data.series) {
      series.values.push(null)
   }
   return withData(spec, data)
}

/**
 * Remove the category at `rowIndex`, dropping its label and the aligned value in every series.
 * No-op (returns the spec unchanged) when it would remove the last category or the index is
 * out of range, honoring the keep-at-least-one invariant.
 */
export function removeCategory(spec: GraphSpec, rowIndex: number): GraphSpec {
   if (spec.data.labels.length <= 1) return spec
   if (rowIndex < 0 || rowIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   data.labels.splice(rowIndex, 1)
   for (const series of data.series) {
      series.values.splice(rowIndex, 1)
   }
   return withData(spec, data)
}

/** Set the text of the label at `rowIndex`. Out-of-range indices return the spec unchanged. */
export function setLabel(spec: GraphSpec, rowIndex: number, text: string): GraphSpec {
   if (rowIndex < 0 || rowIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   data.labels[rowIndex] = text
   return withData(spec, data)
}

// ##########
// # SERIES #  (columns: a named track of values, one per category)
// ##########

/**
 * Append a new series, backfilled with `null` for every existing category so it stays
 * rectangular. No-op once the series count reaches MAX_SERIES (the palette cap; a further
 * series would have no distinct slot to draw in).
 */
export function addSeries(spec: GraphSpec, name: string = ''): GraphSpec {
   if (spec.data.series.length >= MAX_SERIES) return spec
   const data = cloneData(spec)
   data.series.push({ name, values: data.labels.map(() => null) })
   return withData(spec, data)
}

/**
 * Remove the series at `seriesIndex`. No-op when it would remove the last series or the index
 * is out of range, honoring the keep-at-least-one invariant.
 */
export function removeSeries(spec: GraphSpec, seriesIndex: number): GraphSpec {
   if (spec.data.series.length <= 1) return spec
   if (seriesIndex < 0 || seriesIndex >= spec.data.series.length) return spec
   const data = cloneData(spec)
   data.series.splice(seriesIndex, 1)
   return withData(spec, data)
}

/** Set the display name of the series at `seriesIndex`. Out-of-range returns unchanged. */
export function setSeriesName(spec: GraphSpec, seriesIndex: number, name: string): GraphSpec {
   if (seriesIndex < 0 || seriesIndex >= spec.data.series.length) return spec
   const data = cloneData(spec)
   data.series[seriesIndex] = { ...data.series[seriesIndex], name }
   return withData(spec, data)
}

/**
 * Set (or clear) the per-series color override at `seriesIndex`. Passing `undefined` drops the
 * `color` key entirely, resetting the series back to its palette slot (the grid's "reset to
 * default" action). Out-of-range returns unchanged.
 */
export function setSeriesColor(spec: GraphSpec, seriesIndex: number, color: string | undefined): GraphSpec {
   if (seriesIndex < 0 || seriesIndex >= spec.data.series.length) return spec
   const data = cloneData(spec)
   const { color: _dropped, ...rest } = data.series[seriesIndex]
   data.series[seriesIndex] = color === undefined ? rest : { ...rest, color }
   return withData(spec, data)
}

// #########
// # CELLS #
// #########

/**
 * Set the value at the (`rowIndex`, `seriesIndex`) cell. `null` marks a gap (line/area draw a
 * break, bar/pie treat it as zero). Out-of-range indices return the spec unchanged.
 */
export function setCell(spec: GraphSpec, rowIndex: number, seriesIndex: number, value: number | null): GraphSpec {
   if (seriesIndex < 0 || seriesIndex >= spec.data.series.length) return spec
   if (rowIndex < 0 || rowIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   data.series[seriesIndex].values[rowIndex] = value
   return withData(spec, data)
}

// ####################
// # TYPE & OPTIONS   #
// ####################

/** Switch the chart type, carrying data + options through unchanged. */
export function setType(spec: GraphSpec, type: GraphType): GraphSpec {
   return { type, data: spec.data, options: spec.options }
}

/**
 * Set one presentation option. Passing `undefined` DELETES the key (keeps a freshly-toggled-off
 * option out of the serialized spec, so the stored graph stays lean — the same "absent means
 * default" discipline the renderer's options already follow).
 */
export function setOption<Key extends keyof GraphOptions>(
   spec: GraphSpec,
   key: Key,
   value: GraphOptions[Key],
): GraphSpec {
   const options: GraphOptions = { ...spec.options }
   if (value === undefined) {
      delete options[key]
   } else {
      options[key] = value
   }
   return { type: spec.type, data: spec.data, options }
}

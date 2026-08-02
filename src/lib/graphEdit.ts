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

import type {
   GraphSpec, GraphData, GraphType, GraphOptions, Overlay, GraphSource,
   FunctionDomain, FunctionPlot, ScatterPlot, ScatterPoint, HistogramData,
} from './graph'
import {
   MAX_SERIES,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
   FUNCTION_MIN_SAMPLES,
   FUNCTION_MAX_SAMPLES,
   HISTOGRAM_MIN_BINS,
   HISTOGRAM_MAX_BINS,
   supportsLogScale,
   computeHistogramBins,
   computeFunctionYDomain,
} from './graph'

// ###########
// # HELPERS #
// ###########

/**
 * Shallow-clone the spec's data with a fresh series array (each series object also fresh) and,
 * when present, a fresh `categoryColors` array so the per-slice overrides survive every transform
 * (a plain `{ labels, series }` clone would silently DROP them).
 */
function cloneData(spec: GraphSpec): GraphData {
   const cloned: GraphData = {
      labels: [...spec.data.labels],
      series: spec.data.series.map(series => ({ ...series, values: [...series.values] })),
   }
   if (spec.data.categoryColors) {
      cloned.categoryColors = [...spec.data.categoryColors]
   }
   return cloned
}

/**
 * Reassemble a fresh spec from freshly-cloned data, carrying type + options + (when present)
 * functionPlot through unchanged. Spreading `spec` first (rather than listing `type`/`data`/
 * `options` by hand) is what keeps a spec's `functionPlot` payload alive across every data-editing
 * transform below,ropping it here would silently wipe an author's equations the next time they,
 * say, add a category on an unrelated bar chart's spec object reached via a shared helper.
 */
function withData(spec: GraphSpec, data: GraphData): GraphSpec {
   return { ...spec, data }
}

/**
 * Move the item at `fromIndex` to `toIndex` IN PLACE (the array is already a fresh clone by the
 * time this is called). Splice-out then splice-in, so every item between the two positions shifts
 * by one,the standard drag-reorder semantics dnd-kit's sortable produces.
 */
function moveArrayItem<Item>(array: Item[], fromIndex: number, toIndex: number): void {
   const [moved] = array.splice(fromIndex, 1)
   array.splice(toIndex, 0, moved)
}

/**
 * Drop a `categoryColors` array that carries no actual override (all slots undefined), so a spec
 * whose per-slice colors were all reset serializes lean and compares equal to a never-colored one.
 */
function pruneCategoryColors(data: GraphData): void {
   if (data.categoryColors && data.categoryColors.every(color => color === undefined)) {
      delete data.categoryColors
   }
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
   // Keep the per-slice color array aligned to labels: the new category has no override yet.
   if (data.categoryColors) {
      data.categoryColors.push(undefined)
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
   // Keep the per-slice color array aligned to labels: drop the removed slot too.
   if (data.categoryColors) {
      data.categoryColors.splice(rowIndex, 1)
      pruneCategoryColors(data)
   }
   return withData(spec, data)
}

/**
 * Insert a fresh empty category AT `index`, shifting every later category down. Every series gets a
 * `null` spliced in at the same position (rectangular), and `categoryColors` (when present) gets an
 * `undefined` slot so the per-slice overrides stay index-aligned. `index` may run from 0 to the
 * current label count inclusive (an end insert equals {@link addCategory}); out of that range
 * returns the spec unchanged. Used by the row context menu's insert-before / insert-after.
 */
export function insertCategoryAt(spec: GraphSpec, index: number, label: string = ''): GraphSpec {
   if (index < 0 || index > spec.data.labels.length) return spec
   const data = cloneData(spec)
   data.labels.splice(index, 0, label)
   for (const series of data.series) {
      series.values.splice(index, 0, null)
   }
   if (data.categoryColors) {
      data.categoryColors.splice(index, 0, undefined)
   }
   return withData(spec, data)
}

/**
 * Move the category at `fromIndex` to `toIndex`, reordering `labels`, EVERY series' `values`, AND
 * `categoryColors` (when present) in lockstep so all three stay index-aligned. A no-op (returns the
 * spec unchanged) when either index is out of range or they are equal. The category count never
 * changes, so the keep-at-least-one invariant is untouched. Drives the row drag-reorder.
 */
export function moveCategory(spec: GraphSpec, fromIndex: number, toIndex: number): GraphSpec {
   const categoryCount = spec.data.labels.length
   if (fromIndex < 0 || fromIndex >= categoryCount) return spec
   if (toIndex < 0 || toIndex >= categoryCount) return spec
   if (fromIndex === toIndex) return spec
   const data = cloneData(spec)
   moveArrayItem(data.labels, fromIndex, toIndex)
   for (const series of data.series) {
      moveArrayItem(series.values, fromIndex, toIndex)
   }
   if (data.categoryColors) {
      // Pad to the label count first so a sparse override array reorders without dropping short.
      while (data.categoryColors.length < categoryCount) data.categoryColors.push(undefined)
      moveArrayItem(data.categoryColors, fromIndex, toIndex)
      pruneCategoryColors(data)
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

/**
 * Set (or clear) the per-category (per-slice) color override at `categoryIndex`,the radial
 * counterpart to {@link setSeriesColor}. Passing `undefined` clears the slot back to the palette
 * color; if that leaves every slot cleared, the whole `categoryColors` array is dropped so the
 * spec stays lean. The array is padded with `undefined` up to the label count so it stays aligned
 * even when only a later slice is colored. Out-of-range returns unchanged.
 */
export function setCategoryColor(spec: GraphSpec, categoryIndex: number, color: string | undefined): GraphSpec {
   if (categoryIndex < 0 || categoryIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   const categoryColors = data.categoryColors ? [...data.categoryColors] : []
   // Pad to the label count so a sparse override array never drifts short of its labels.
   while (categoryColors.length < data.labels.length) categoryColors.push(undefined)
   categoryColors[categoryIndex] = color
   data.categoryColors = categoryColors
   pruneCategoryColors(data)
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
 * Insert a fresh series AT `index`, backfilled with `null` for every category so it stays
 * rectangular. `index` may run from 0 to the current series count inclusive (an end insert equals
 * {@link addSeries}); out of that range returns the spec unchanged. No-op once the series count
 * reaches MAX_SERIES (the palette cap). Used by the column context menu's insert-before /
 * insert-after.
 */
export function insertSeriesAt(spec: GraphSpec, index: number, name: string = ''): GraphSpec {
   if (spec.data.series.length >= MAX_SERIES) return spec
   if (index < 0 || index > spec.data.series.length) return spec
   const data = cloneData(spec)
   data.series.splice(index, 0, { name, values: data.labels.map(() => null) })
   return withData(spec, data)
}

/**
 * Move the series at `fromIndex` to `toIndex`, reordering the `series` array. A no-op (returns the
 * spec unchanged) when either index is out of range or they are equal. The series count never
 * changes, so the keep-at-least-one invariant is untouched. Drives the column drag-reorder.
 */
export function moveSeries(spec: GraphSpec, fromIndex: number, toIndex: number): GraphSpec {
   const seriesCount = spec.data.series.length
   if (fromIndex < 0 || fromIndex >= seriesCount) return spec
   if (toIndex < 0 || toIndex >= seriesCount) return spec
   if (fromIndex === toIndex) return spec
   const data = cloneData(spec)
   moveArrayItem(data.series, fromIndex, toIndex)
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

/**
 * Switch the chart type, carrying data + options + any existing functionPlot/scatterPlot/
 * histogramData through unchanged. Switching TO `function` for the first time (no functionPlot
 * yet) seeds one from the FUNCTION_DEFAULT_* constants + a single blank equation, so the Data
 * tab's EquationEditor always has something real to render the moment the type card is clicked,
 * never an undefined payload. Switching TO `scatter` for the first time (no scatterPlot yet)
 * similarly seeds one series with a single point at the origin, so the Data tab's ScatterEditor
 * always has something real to render. Switching TO `histogram` for the first time (no
 * histogramData yet) similarly seeds a small sample list, so the Data tab's HistogramEditor never
 * opens on a totally empty chart.
 */
export function setType(spec: GraphSpec, type: GraphType): GraphSpec {
   const next: GraphSpec = { ...spec, type }
   if (type === 'function' && !next.functionPlot) {
      next.functionPlot = ensureFunctionPlot(spec)
   }
   if (type === 'scatter' && !next.scatterPlot) {
      next.scatterPlot = ensureScatterPlot(spec)
   }
   if (type === 'histogram' && !next.histogramData) {
      next.histogramData = ensureHistogramData(spec)
   }
   // A type change RESETS the explicit y-axis range (yMin/yMax). These are only ever set through the
   // function editor (a function-specific concern, pinning a range so the asymptote heuristic bites),
   // and a range that's reasonable for f(x) is usually insane for a bar/line chart, which would leave
   // the new chart unviewable. Dropping them lets the new type auto-scale to a sensible range.
   if (type !== spec.type && (next.options.yMin !== undefined || next.options.yMax !== undefined)) {
      const options: GraphOptions = { ...next.options }
      delete options.yMin
      delete options.yMax
      next.options = options
   }
   // Switching to a type that can't render a log value axis (pie/donut/bar-stacked, see
   // supportsLogScale) drops a stale `yScale: 'log'` rather than leaving it silently unused: the
   // renderer would ignore it anyway, but clearing it keeps the stored spec honest about what is
   // actually in effect, and means switching back later starts from a clean 'linear' default.
   if (type !== spec.type && next.options.yScale === 'log' && !supportsLogScale(type)) {
      const options: GraphOptions = { ...next.options }
      delete options.yScale
      next.options = options
   }
   // A custom axis origin (textbook axes) is a continuous-x/y concept, only `function`/`scatter`
   // render it. Switching to any other type drops a stale `axisOrigin` rather than leaving it
   // silently unused (the renderer would ignore it anyway), keeping the stored spec honest and
   // matching the yScale-drop just above.
   if (type !== spec.type && next.options.axisOrigin !== undefined && type !== 'function' && type !== 'scatter') {
      const options: GraphOptions = { ...next.options }
      delete options.axisOrigin
      next.options = options
   }
   return next
}

/**
 * Set one presentation option. Passing `undefined` DELETES the key (keeps a freshly-toggled-off
 * option out of the serialized spec, so the stored graph stays lean, the same "absent means
 * default" discipline the renderer's options already follow). Carries `functionPlot` through
 * unchanged (via the `{ ...spec }` spread), an option toggle on a `function` chart must never
 * wipe its equations.
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
   return { ...spec, options }
}

/**
 * Whether a chart requesting `options.yScale === 'log'` would actually render on a log axis, or
 * silently fall back to linear because its own data touches zero or goes negative, log is
 * undefined at <= 0 (see `graph/cartesian.ts`'s per-type axis-mode resolution, which this MIRRORS
 * for an editor-only in-editor fallback notice; it is not itself consulted by the renderer). Used
 * by GraphBlock.tsx to show a small "showing linear instead" hint rather than leaving an author
 * wondering why a toggled-on log axis looks unchanged (previously this was the ONLY log-enabled
 * type with no fallback notice at all, which read as "log scale doesn't do anything" for a
 * function whose sampled curve dips to/through zero, see docs/reports/
 * 2026-08-02-graph-log-scale-function-fix.md).
 *
 * Returns `false` (nothing to warn about) whenever log isn't even requested, or the type doesn't
 * support it at all (see {@link supportsLogScale}, the toggle is hidden in that case anyway).
 *
 * `function` charts reuse {@link computeFunctionYDomain}, the EXACT same expression-sampling +
 * domain pipeline `renderFunctionPlot` resolves its own axis-mode decision from, rather than
 * re-implementing (and risking drifting from) that logic here.
 */
export function logScaleWouldFallBackToLinear(spec: GraphSpec): boolean {
   if (spec.options.yScale !== 'log' || !supportsLogScale(spec.type)) return false

   if (spec.type === 'function') {
      const [domainMin, domainMax] = computeFunctionYDomain(spec)
      return !(Number.isFinite(domainMin) && Number.isFinite(domainMax) && domainMin > 0)
   }

   if (spec.type === 'scatter') {
      const finiteYValues = (spec.scatterPlot?.series ?? [])
         .flatMap(series => series.points.map(point => point.y))
         .filter(value => Number.isFinite(value))
      if (finiteYValues.length === 0) return false
      return Math.min(...finiteYValues) <= 0
   }

   if (spec.type === 'histogram') {
      const { counts } = computeHistogramBins(spec.histogramData?.samples ?? [], spec.histogramData?.bins)
      return !counts.some(count => count > 0)
   }

   const finiteValues = spec.data.series
      .flatMap(series => series.values)
      .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value))
   if (finiteValues.length === 0) return false
   return Math.min(...finiteValues) <= 0
}

// ####################
// # OVERLAYS          #
// ####################

/**
 * Append one statistical overlay to the spec (mean / trend / reference; median is reserved). Builds
 * on {@link setOption} so the whole options object stays freshly cloned and the spec is brand-new.
 */
export function addOverlay(spec: GraphSpec, overlay: Overlay): GraphSpec {
   const overlays = [...(spec.options.overlays ?? []), overlay]
   return setOption(spec, 'overlays', overlays)
}

/**
 * Remove the overlay at `overlayIndex`. Out-of-range returns unchanged. Removing the last overlay
 * DELETES the `overlays` key entirely (via setOption's undefined path), so a graph whose overlays
 * were all cleared serializes lean and compares equal to one that never had any.
 */
export function removeOverlay(spec: GraphSpec, overlayIndex: number): GraphSpec {
   const current = spec.options.overlays ?? []
   if (overlayIndex < 0 || overlayIndex >= current.length) return spec
   const overlays = current.filter((_overlay, index) => index !== overlayIndex)
   return setOption(spec, 'overlays', overlays.length > 0 ? overlays : undefined)
}

/**
 * Shallow-merge `partial` onto the overlay at `overlayIndex` (change its kind, target series, value,
 * label, or equation flag). Out-of-range returns unchanged. The merged overlay is a fresh object, so
 * the input spec is never mutated.
 */
export function updateOverlay(spec: GraphSpec, overlayIndex: number, partial: Partial<Overlay>): GraphSpec {
   const current = spec.options.overlays ?? []
   if (overlayIndex < 0 || overlayIndex >= current.length) return spec
   const overlays = current.map((overlay, index) =>
      index === overlayIndex ? { ...overlay, ...partial } : overlay)
   return setOption(spec, 'overlays', overlays)
}

// ############################
// # EQUATIONS (function type) #
// ############################
//
// The `function` chart type's payload (`GraphSpec.functionPlot`) is a completely different shape
// from `data`/`series`, a shared domain plus a list of named equations, so it gets its own small
// family of transforms here rather than being shoehorned through the category/series helpers
// above. Every helper below shares the same two invariants as the rest of this file:
//   - NON-EMPTY: the last remaining equation is never removed (keep >= 1).
//   - SANE DOMAIN: `samples` is always clamped to [FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES].
// and additionally SEEDS a `functionPlot` from the FUNCTION_DEFAULT_* constants whenever one is
// absent (a spec that has never been a `function` chart, or was switched away and back), so an
// author can never be looking at an editor with nothing to edit.

/** Default equation names for freshly added equations: f, g, h, ... wrapping through the alphabet
 *  (starting at "f" to echo the fence-grammar example in the stage-2 report / study). */
const EQUATION_NAME_LETTERS = 'fghijklmnopqrstuvwxyzabcde'

function defaultEquationName(equationIndex: number): string {
   return EQUATION_NAME_LETTERS[equationIndex % EQUATION_NAME_LETTERS.length]
}

/** The sane out-of-the-box functionPlot: the FUNCTION_DEFAULT_* domain + one blank equation. */
function defaultFunctionPlot(): FunctionPlot {
   return {
      domain: { xMin: FUNCTION_DEFAULT_X_MIN, xMax: FUNCTION_DEFAULT_X_MAX, samples: FUNCTION_DEFAULT_SAMPLES },
      equations: [{ name: defaultEquationName(0), expression: '' }],
   }
}

/** Return the spec's existing `functionPlot`, or a freshly seeded default when absent. */
function ensureFunctionPlot(spec: GraphSpec): FunctionPlot {
   return spec.functionPlot ?? defaultFunctionPlot()
}

/** Clamp a requested sample count into [FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES], rounding first
 *  so a fractional drag-slider value never sneaks a non-integer sample count into the spec. */
function clampSamples(samples: number): number {
   return Math.min(FUNCTION_MAX_SAMPLES, Math.max(FUNCTION_MIN_SAMPLES, Math.round(samples)))
}

/** Reassemble a fresh spec carrying a new `functionPlot`, everything else unchanged. */
function withFunctionPlot(spec: GraphSpec, functionPlot: FunctionPlot): GraphSpec {
   return { ...spec, functionPlot }
}

/**
 * Append a new equation (capped at MAX_SERIES, matching the same palette-slot cap the numeric
 * data grid's series enforce, so equation colors stay inside the validated 8-hue set). Seeds
 * `functionPlot` from the defaults first when the spec has never carried one.
 */
export function addEquation(spec: GraphSpec): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (functionPlot.equations.length >= MAX_SERIES) return withFunctionPlot(spec, functionPlot)
   const equations = [
      ...functionPlot.equations,
      { name: defaultEquationName(functionPlot.equations.length), expression: '' },
   ]
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/**
 * Remove the equation at `equationIndex`. No-op (equations unchanged, but `functionPlot` is still
 * seeded if it was absent) when it would remove the last equation or the index is out of range,
 * honoring the keep-at-least-one invariant.
 */
export function removeEquation(spec: GraphSpec, equationIndex: number): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (functionPlot.equations.length <= 1) return withFunctionPlot(spec, functionPlot)
   if (equationIndex < 0 || equationIndex >= functionPlot.equations.length) return withFunctionPlot(spec, functionPlot)
   const equations = functionPlot.equations.filter((_equation, index) => index !== equationIndex)
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/**
 * Set the `name` or `expression` text of the equation at `equationIndex`. Out-of-range returns the
 * spec with `functionPlot` merely seeded (no equation changed). An unparseable `expression` is
 * still written here, {@link addEquation}'s "never breaks the chart" contract means an
 * uncompileable expression simply draws nothing until it parses; validating and blocking the
 * keystroke is the editor's job (a live invalid-ring affordance), not this pure transform's.
 */
export function setEquationField(
   spec: GraphSpec,
   equationIndex: number,
   field: 'name' | 'expression',
   value: string,
): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (equationIndex < 0 || equationIndex >= functionPlot.equations.length) return withFunctionPlot(spec, functionPlot)
   const equations = functionPlot.equations.map((equation, index) =>
      index === equationIndex ? { ...equation, [field]: value } : equation)
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/**
 * Set (or clear) the per-equation color override at `equationIndex`, the function-chart
 * counterpart to {@link setSeriesColor}. Passing `undefined` drops the `color` key entirely,
 * resetting the curve back to its palette slot. Out-of-range returns the spec with `functionPlot`
 * merely seeded.
 */
export function setEquationColor(spec: GraphSpec, equationIndex: number, color: string | undefined): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (equationIndex < 0 || equationIndex >= functionPlot.equations.length) return withFunctionPlot(spec, functionPlot)
   const equations = functionPlot.equations.map((equation, index) => {
      if (index !== equationIndex) return equation
      const { color: _dropped, ...rest } = equation
      return color === undefined ? rest : { ...rest, color }
   })
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/**
 * Shallow-merge `partial` onto the shared domain (`xMin`/`xMax`/`samples`). `samples`, if present
 * in `partial`, is clamped to [FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES] so a hand-typed or
 * pathological value can never reach the stored spec (mirrors the renderer's own tolerant
 * `resolveFunctionDomain` clamp, applied here at the editing boundary instead).
 */
export function setDomain(spec: GraphSpec, partial: Partial<FunctionDomain>): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   const domain: FunctionDomain = { ...functionPlot.domain, ...partial }
   if (partial.samples !== undefined) {
      domain.samples = clampSamples(partial.samples)
   }
   return withFunctionPlot(spec, { ...functionPlot, domain })
}

/**
 * Insert a fresh blank equation AT `index`, shifting every later equation down. `index` may run
 * from 0 to the current equation count inclusive (an end insert equals {@link addEquation}); out of
 * that range returns the spec with `functionPlot` merely seeded. No-op once the equation count
 * reaches MAX_SERIES (the same palette-slot cap {@link addEquation} enforces). Drives the equation
 * row context menu's insert-before / insert-after. The new equation's name is the next default
 * letter (by the current count), matching {@link addEquation}.
 */
export function insertEquationAt(spec: GraphSpec, index: number): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (functionPlot.equations.length >= MAX_SERIES) return withFunctionPlot(spec, functionPlot)
   if (index < 0 || index > functionPlot.equations.length) return withFunctionPlot(spec, functionPlot)
   const equations = [...functionPlot.equations]
   equations.splice(index, 0, { name: defaultEquationName(functionPlot.equations.length), expression: '' })
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/**
 * Move the equation at `fromIndex` to `toIndex`, reordering the `equations` array. A no-op (returns
 * the spec with `functionPlot` merely seeded) when either index is out of range or they are equal.
 * The equation count never changes, so the keep-at-least-one invariant is untouched. Drives the
 * equation row drag-reorder.
 */
export function moveEquation(spec: GraphSpec, fromIndex: number, toIndex: number): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   const equationCount = functionPlot.equations.length
   if (fromIndex < 0 || fromIndex >= equationCount) return withFunctionPlot(spec, functionPlot)
   if (toIndex < 0 || toIndex >= equationCount) return withFunctionPlot(spec, functionPlot)
   if (fromIndex === toIndex) return withFunctionPlot(spec, functionPlot)
   const equations = [...functionPlot.equations]
   moveArrayItem(equations, fromIndex, toIndex)
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

// ##########################
// # SCATTER POINTS (scatter type) #
// ##########################
//
// The `scatter` chart type's payload (`GraphSpec.scatterPlot`) is a list of named (x, y) point
// series, no shared domain, no categories (unlike EQUATIONS above, which share one domain across
// every equation). Mirrors that section's shape: every helper SEEDS a `scatterPlot` from a sensible
// default whenever one is absent, and preserves two invariants:
//   - NON-EMPTY SERIES LIST: the last remaining series is never removed (keep >= 1).
//   - NON-EMPTY POINT LIST: the last remaining point in a series is never removed (keep >= 1).
// v1 is points-only (no per-series trendline, a deferred fast-follow, not built here).

/** The sane out-of-the-box scatterPlot: one blank-named series with a single point at the origin,
 *  so a freshly switched-to scatter chart is never rendered totally empty. */
function defaultScatterPlot(): ScatterPlot {
   return { series: [{ name: '', points: [{ x: 0, y: 0 }] }] }
}

/** Return the spec's existing `scatterPlot`, or a freshly seeded default when absent. */
function ensureScatterPlot(spec: GraphSpec): ScatterPlot {
   return spec.scatterPlot ?? defaultScatterPlot()
}

/** Reassemble a fresh spec carrying a new `scatterPlot`, everything else unchanged. */
function withScatterPlot(spec: GraphSpec, scatterPlot: ScatterPlot): GraphSpec {
   return { ...spec, scatterPlot }
}

/**
 * Append a new series (capped at MAX_SERIES, the same palette-slot cap the numeric data grid's
 * series enforce, so scatter colors stay inside the validated 8-hue set), seeded with one point at
 * the origin so it is never rendered empty. Seeds `scatterPlot` from the defaults first when the
 * spec has never carried one.
 */
export function addScatterSeries(spec: GraphSpec, name: string = ''): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (scatterPlot.series.length >= MAX_SERIES) return withScatterPlot(spec, scatterPlot)
   const series = [...scatterPlot.series, { name, points: [{ x: 0, y: 0 }] }]
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Remove the series at `seriesIndex`. No-op (series unchanged, but `scatterPlot` is still seeded
 * if it was absent) when it would remove the last series or the index is out of range, honoring
 * the keep-at-least-one-series invariant.
 */
export function removeScatterSeries(spec: GraphSpec, seriesIndex: number): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (scatterPlot.series.length <= 1) return withScatterPlot(spec, scatterPlot)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.filter((_series, index) => index !== seriesIndex)
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/** Set the display name of the series at `seriesIndex`. Out-of-range returns the spec with
 *  `scatterPlot` merely seeded. */
export function setScatterSeriesName(spec: GraphSpec, seriesIndex: number, name: string): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, index) =>
      index === seriesIndex ? { ...oneSeries, name } : oneSeries)
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Set (or clear) the per-series color override at `seriesIndex`, the scatter-chart counterpart
 * to {@link setSeriesColor}. Passing `undefined` drops the `color` key entirely, resetting the
 * series back to its palette slot. Out-of-range returns the spec with `scatterPlot` merely seeded.
 */
export function setScatterSeriesColor(spec: GraphSpec, seriesIndex: number, color: string | undefined): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, index) => {
      if (index !== seriesIndex) return oneSeries
      const { color: _dropped, ...rest } = oneSeries
      return color === undefined ? rest : { ...rest, color }
   })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Append a new point to the series at `seriesIndex`. The default is a BLANK point (non-finite x/y):
 * the editor renders it as an empty "–" gap to type over, and both the renderer and the fence
 * serializer skip a non-finite point, so an unfilled seed never draws a stray mark at the origin
 * nor persists as a real datum. Out-of-range returns the spec with `scatterPlot` merely seeded.
 */
export function addScatterPoint(
   spec: GraphSpec,
   seriesIndex: number,
   point: ScatterPoint = { x: NaN, y: NaN },
): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, index) =>
      index === seriesIndex ? { ...oneSeries, points: [...oneSeries.points, point] } : oneSeries)
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Remove the point at `pointIndex` from the series at `seriesIndex`. No-op (unchanged, but
 * `scatterPlot` still seeded if absent) when it would remove that series' last point, or either
 * index is out of range, honoring the keep-at-least-one-point-per-series invariant.
 */
export function removeScatterPoint(spec: GraphSpec, seriesIndex: number, pointIndex: number): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const targetSeries = scatterPlot.series[seriesIndex]
   if (targetSeries.points.length <= 1) return withScatterPlot(spec, scatterPlot)
   if (pointIndex < 0 || pointIndex >= targetSeries.points.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, index) => {
      if (index !== seriesIndex) return oneSeries
      return { ...oneSeries, points: oneSeries.points.filter((_point, pointIdx) => pointIdx !== pointIndex) }
   })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Set the `x` or `y` field of the point at (`seriesIndex`, `pointIndex`). Out-of-range indices
 * return the spec with `scatterPlot` merely seeded. A non-finite `value` is still written here,
 * mirroring {@link setEquationField}'s "never breaks the chart" contract: the renderer already
 * skips a non-finite point when computing the domain and drawing marks, so validating/blocking the
 * keystroke is an editor concern (a live invalid-ring affordance), not this pure transform's.
 */
export function setScatterPointField(
   spec: GraphSpec,
   seriesIndex: number,
   pointIndex: number,
   field: 'x' | 'y',
   value: number,
): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const targetSeries = scatterPlot.series[seriesIndex]
   if (pointIndex < 0 || pointIndex >= targetSeries.points.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, index) => {
      if (index !== seriesIndex) return oneSeries
      const points = oneSeries.points.map((point, pointIdx) =>
         pointIdx === pointIndex ? { ...point, [field]: value } : point)
      return { ...oneSeries, points }
   })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Insert a fresh series AT `index`, seeded with one point at the origin so it is never rendered
 * empty. `index` may run from 0 to the current series count inclusive (an end insert equals
 * {@link addScatterSeries}); out of that range returns the spec with `scatterPlot` merely seeded.
 * No-op once the series count reaches MAX_SERIES (the palette-slot cap). Drives the scatter series
 * head context menu's insert-before / insert-after.
 */
export function insertScatterSeriesAt(spec: GraphSpec, index: number, name: string = ''): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (scatterPlot.series.length >= MAX_SERIES) return withScatterPlot(spec, scatterPlot)
   if (index < 0 || index > scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const series = [...scatterPlot.series]
   series.splice(index, 0, { name, points: [{ x: 0, y: 0 }] })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Move the series at `fromIndex` to `toIndex`, reordering the `series` array. A no-op (returns the
 * spec with `scatterPlot` merely seeded) when either index is out of range or they are equal. The
 * series count never changes, so the keep-at-least-one-series invariant is untouched. Drives the
 * scatter series drag-reorder.
 */
export function moveScatterSeries(spec: GraphSpec, fromIndex: number, toIndex: number): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   const seriesCount = scatterPlot.series.length
   if (fromIndex < 0 || fromIndex >= seriesCount) return withScatterPlot(spec, scatterPlot)
   if (toIndex < 0 || toIndex >= seriesCount) return withScatterPlot(spec, scatterPlot)
   if (fromIndex === toIndex) return withScatterPlot(spec, scatterPlot)
   const series = [...scatterPlot.series]
   moveArrayItem(series, fromIndex, toIndex)
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Insert a fresh point AT `index` in the series at `seriesIndex`, shifting every later point down.
 * The default is a BLANK point (non-finite x/y), matching {@link addScatterPoint}: the editor
 * renders it as an empty "–" gap to type over, and both the renderer and the fence serializer skip
 * a non-finite point. `index` may run from 0 to the series' current point count inclusive (an end
 * insert equals {@link addScatterPoint}); out of that range, or an out-of-range `seriesIndex`,
 * returns the spec with `scatterPlot` merely seeded. Drives the point row context menu's
 * insert-before / insert-after.
 */
export function insertScatterPointAt(
   spec: GraphSpec,
   seriesIndex: number,
   index: number,
   point: ScatterPoint = { x: NaN, y: NaN },
): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const targetSeries = scatterPlot.series[seriesIndex]
   if (index < 0 || index > targetSeries.points.length) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, seriesIdx) => {
      if (seriesIdx !== seriesIndex) return oneSeries
      const points = [...oneSeries.points]
      points.splice(index, 0, point)
      return { ...oneSeries, points }
   })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/**
 * Move the point at `fromIndex` to `toIndex` WITHIN the series at `seriesIndex`, reordering only
 * that series' `points` array (other series untouched). A no-op (returns the spec with `scatterPlot`
 * merely seeded) when the series index is out of range, either point index is out of range, or the
 * two point indices are equal. The point count never changes, so the keep-at-least-one-point
 * invariant is untouched. Drives the scatter point drag-reorder.
 */
export function moveScatterPoint(spec: GraphSpec, seriesIndex: number, fromIndex: number, toIndex: number): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (seriesIndex < 0 || seriesIndex >= scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const targetSeries = scatterPlot.series[seriesIndex]
   const pointCount = targetSeries.points.length
   if (fromIndex < 0 || fromIndex >= pointCount) return withScatterPlot(spec, scatterPlot)
   if (toIndex < 0 || toIndex >= pointCount) return withScatterPlot(spec, scatterPlot)
   if (fromIndex === toIndex) return withScatterPlot(spec, scatterPlot)
   const series = scatterPlot.series.map((oneSeries, seriesIdx) => {
      if (seriesIdx !== seriesIndex) return oneSeries
      const points = [...oneSeries.points]
      moveArrayItem(points, fromIndex, toIndex)
      return { ...oneSeries, points }
   })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

// ##################################
// # HISTOGRAM DATA (histogram type) #
// ##################################
//
// The `histogram` chart type's payload (`GraphSpec.histogramData`) is a single flat sample list,
// no series axis, no shared domain, no categories (a histogram has exactly ONE dataset). Mirrors
// the EQUATIONS/SCATTER sections' seeding shape: every helper SEEDS a `histogramData` from a
// sensible default whenever one is absent, so an author can never be looking at an editor with
// nothing to edit. `bins` is the only field with a range invariant (clamped to
// [HISTOGRAM_MIN_BINS, HISTOGRAM_MAX_BINS]); `samples`/`name`/`color` have no structural invariant
// of their own (an empty sample list is valid, the renderer just draws a graceful empty plot).

/** The sane out-of-the-box histogramData: a small, real (non-empty) sample list so a freshly
 *  switched-to histogram chart is never rendered totally empty. Bin count is left unset (auto). */
function defaultHistogramData(): HistogramData {
   return { samples: [1, 2, 2, 3, 3, 3, 4, 4, 5] }
}

/** Return the spec's existing `histogramData`, or a freshly seeded default when absent. */
function ensureHistogramData(spec: GraphSpec): HistogramData {
   return spec.histogramData ?? defaultHistogramData()
}

/** Reassemble a fresh spec carrying a new `histogramData`, everything else unchanged. */
function withHistogramData(spec: GraphSpec, histogramData: HistogramData): GraphSpec {
   return { ...spec, histogramData }
}

/** Clamp a requested bin count into [HISTOGRAM_MIN_BINS, HISTOGRAM_MAX_BINS], rounding first so a
 *  fractional typed value never sneaks a non-integer bin count into the spec (mirrors
 *  {@link clampSamples}'s treatment of the function type's sample count). */
function clampBinCount(bins: number): number {
   return Math.min(HISTOGRAM_MAX_BINS, Math.max(HISTOGRAM_MIN_BINS, Math.round(bins)))
}

/**
 * Replace the whole raw sample list. Seeds `histogramData` from the default first when the spec
 * has never carried one. Non-finite entries are left as-is here, {@link computeHistogramBins}
 * (the renderer's binning function) already filters them out, so validating/blocking a stray token
 * is the editor's parsing concern (see molecules/HistogramEditor.tsx's tolerant text parse), not
 * this pure transform's.
 */
export function setHistogramSamples(spec: GraphSpec, samples: number[]): GraphSpec {
   const histogramData = ensureHistogramData(spec)
   return withHistogramData(spec, { ...histogramData, samples })
}

/**
 * Set (or clear) the manual bin-count override. Passing `undefined` DELETES the `bins` key
 * entirely, resetting the chart back to the automatic Sturges'-rule bin count, the editor's
 * "Auto" empty state. A defined value is rounded + clamped to
 * [HISTOGRAM_MIN_BINS, HISTOGRAM_MAX_BINS] so a hand-typed or pathological value can never reach
 * the stored spec (mirrors {@link setDomain}'s clamp of the function type's sample count).
 */
export function setHistogramBins(spec: GraphSpec, bins: number | undefined): GraphSpec {
   const histogramData = ensureHistogramData(spec)
   const { bins: _dropped, ...rest } = histogramData
   return withHistogramData(spec, bins === undefined ? rest : { ...rest, bins: clampBinCount(bins) })
}

/** Set the optional dataset name. Seeds `histogramData` from the default first when absent. */
export function setHistogramName(spec: GraphSpec, name: string): GraphSpec {
   const histogramData = ensureHistogramData(spec)
   return withHistogramData(spec, { ...histogramData, name })
}

/**
 * Set (or clear) the dataset color override, the histogram-chart counterpart to
 * {@link setSeriesColor}. Passing `undefined` drops the `color` key entirely, resetting the bars
 * back to their palette slot. Seeds `histogramData` from the default first when absent.
 */
export function setHistogramColor(spec: GraphSpec, color: string | undefined): GraphSpec {
   const histogramData = ensureHistogramData(spec)
   const { color: _dropped, ...rest } = histogramData
   return withHistogramData(spec, color === undefined ? rest : { ...rest, color })
}

// ##############################
// # TABLE LINK (STAGE 2b EDITOR) #
// ##############################
//
// The graph<->table LIVE LINK's editing surface: link/re-link to a table, adjust the label-column /
// orientation mapping, and unlink. Unlike every family above, these three helpers do NOT touch
// `data`/`options`/`functionPlot` shape invariants, they only ever read/write `spec.source`.
// `data` itself is left for the caller: on link/re-link it stays as-is (GraphBlock's existing
// debounced snapshot write-back, see docs/reports/2026-08-01-graph-table-link-arch.md, refreshes
// it from the newly linked table on the next resolve); on unlink the caller supplies the just-
// resolved snapshot to materialize (this module has no document/table access to resolve one itself).

/**
 * Link the spec to a table by `handle`, with the default mapping (label column 0, orient
 * `columns`). Overwrites any existing `source` (a re-link/change-table pick). `data` is left
 * untouched.
 */
export function setSource(spec: GraphSpec, handle: string): GraphSpec {
   return { ...spec, source: { handle } }
}

/**
 * Shallow-merge a mapping change (`labelColumn` and/or `orient`) onto the existing `source`. No-op
 * (returns the spec unchanged) if the spec isn't currently linked, defensive, since the editor's
 * mapping panel only ever renders while linked.
 */
export function updateSourceMapping(spec: GraphSpec, partial: Partial<Omit<GraphSource, 'handle'>>): GraphSpec {
   if (!spec.source) return spec
   return { ...spec, source: { ...spec.source, ...partial } }
}

/**
 * Unlink: materialize `snapshot` (the caller's just-resolved table data, see `resolveGraphSpec` in
 * `graphTableData.ts`) onto `data` and drop `source` entirely, so the graph reverts to a normal
 * self-contained, editable chart, the safe escape hatch, and the inverse of {@link setSource}.
 */
export function unlinkSource(spec: GraphSpec, snapshot: GraphData): GraphSpec {
   const { source: _dropped, ...rest } = spec
   return { ...rest, data: snapshot }
}

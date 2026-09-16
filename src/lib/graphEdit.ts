/*
 * Pure structural transforms for the graph block's interactive editor. Each takes a GraphSpec and
 * returns a brand-new one with one edit applied, never mutating the input. Two invariants every
 * helper preserves:
 *   - RECTANGULAR: every series' `values` length equals `labels` length.
 *   - NON-EMPTY: the last remaining category or series is never removed (keep >= 1).
 * These are about a sane editing model; the renderer separately tolerates empty data.
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

/** Clone the spec's data with a fresh series array and, when present, a fresh `categoryColors` array
 *  so the per-slice overrides survive (a plain `{ labels, series }` clone would drop them). */
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

/** Reassemble a fresh spec from cloned data. Spreading `spec` first keeps `functionPlot` and the
 *  other payloads alive across every data-editing transform. */
function withData(spec: GraphSpec, data: GraphData): GraphSpec {
   return { ...spec, data }
}

/** Move the item at `fromIndex` to `toIndex` in place (the array is already a fresh clone): the
 *  standard drag-reorder semantics. */
function moveArrayItem<Item>(array: Item[], fromIndex: number, toIndex: number): void {
   const [moved] = array.splice(fromIndex, 1)
   array.splice(toIndex, 0, moved)
}

/** Drop a `categoryColors` array with no actual override (all slots undefined), so a fully-reset
 *  spec serializes lean and compares equal to a never-colored one. */
function pruneCategoryColors(data: GraphData): void {
   if (data.categoryColors && data.categoryColors.every(color => color === undefined)) {
      delete data.categoryColors
   }
}

// #############
// # CATEGORIES #  (rows: a label + one aligned value per series)
// #############

/** Append a new category: every series gets a trailing `null` so the arrays stay rectangular. */
export function addCategory(spec: GraphSpec, label: string = ''): GraphSpec {
   const data = cloneData(spec)
   data.labels.push(label)
   for (const series of data.series) {
      series.values.push(null)
   }
   if (data.categoryColors) {
      data.categoryColors.push(undefined)
   }
   return withData(spec, data)
}

/** Remove the category at `rowIndex`, dropping its label and aligned value in every series. No-op on
 *  the last category or an out-of-range index. */
export function removeCategory(spec: GraphSpec, rowIndex: number): GraphSpec {
   if (spec.data.labels.length <= 1) return spec
   if (rowIndex < 0 || rowIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   data.labels.splice(rowIndex, 1)
   for (const series of data.series) {
      series.values.splice(rowIndex, 1)
   }
   if (data.categoryColors) {
      data.categoryColors.splice(rowIndex, 1)
      pruneCategoryColors(data)
   }
   return withData(spec, data)
}

/** Insert an empty category at `index`, splicing a `null` into every series (and an `undefined`
 *  color slot) to stay aligned. `index` runs 0..labelCount inclusive; out of range returns unchanged. */
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

/** Move the category at `fromIndex` to `toIndex`, reordering `labels`, every series' `values`, and
 *  `categoryColors` in lockstep. No-op when either index is out of range or they are equal. */
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
      // Pad to the label count so a sparse override array reorders without dropping short.
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

/** Set (or clear) the per-slice color override at `categoryIndex`, the radial counterpart to
 *  {@link setSeriesColor}. `undefined` clears the slot, dropping the whole array once all are clear.
 *  Out-of-range returns unchanged. */
export function setCategoryColor(spec: GraphSpec, categoryIndex: number, color: string | undefined): GraphSpec {
   if (categoryIndex < 0 || categoryIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   const categoryColors = data.categoryColors ? [...data.categoryColors] : []
   // Pad to the label count so a sparse override array never drifts short.
   while (categoryColors.length < data.labels.length) categoryColors.push(undefined)
   categoryColors[categoryIndex] = color
   data.categoryColors = categoryColors
   pruneCategoryColors(data)
   return withData(spec, data)
}

// ##########
// # SERIES #  (columns: a named track of values, one per category)
// ##########

/** Append a new series, backfilled with `null` per category. No-op at MAX_SERIES (the palette cap). */
export function addSeries(spec: GraphSpec, name: string = ''): GraphSpec {
   if (spec.data.series.length >= MAX_SERIES) return spec
   const data = cloneData(spec)
   data.series.push({ name, values: data.labels.map(() => null) })
   return withData(spec, data)
}

/** Insert a series at `index`, backfilled with `null` per category. `index` runs 0..seriesCount
 *  inclusive; out of range, or at MAX_SERIES, returns unchanged. */
export function insertSeriesAt(spec: GraphSpec, index: number, name: string = ''): GraphSpec {
   if (spec.data.series.length >= MAX_SERIES) return spec
   if (index < 0 || index > spec.data.series.length) return spec
   const data = cloneData(spec)
   data.series.splice(index, 0, { name, values: data.labels.map(() => null) })
   return withData(spec, data)
}

/** Move the series at `fromIndex` to `toIndex`. No-op when either index is out of range or equal. */
export function moveSeries(spec: GraphSpec, fromIndex: number, toIndex: number): GraphSpec {
   const seriesCount = spec.data.series.length
   if (fromIndex < 0 || fromIndex >= seriesCount) return spec
   if (toIndex < 0 || toIndex >= seriesCount) return spec
   if (fromIndex === toIndex) return spec
   const data = cloneData(spec)
   moveArrayItem(data.series, fromIndex, toIndex)
   return withData(spec, data)
}

/** Remove the series at `seriesIndex`. No-op on the last series or an out-of-range index. */
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

/** Set (or clear) the per-series color override at `seriesIndex`. `undefined` drops the `color` key,
 *  resetting to the palette slot. Out-of-range returns unchanged. */
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

/** Set the value at the (`rowIndex`, `seriesIndex`) cell. `null` marks a gap. Out-of-range returns
 *  unchanged. */
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

/** Switch the chart type, carrying the payloads through unchanged. Switching to `function`/`scatter`/
 *  `histogram` for the first time seeds a default payload so the Data tab always has something to
 *  render. */
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
   // A type change resets yMin/yMax: these are set through the function editor, and a range good for
   // f(x) is usually unviewable for a bar/line chart. Dropping them lets the new type auto-scale.
   if (type !== spec.type && (next.options.yMin !== undefined || next.options.yMax !== undefined)) {
      const options: GraphOptions = { ...next.options }
      delete options.yMin
      delete options.yMax
      next.options = options
   }
   // Switching to a type that can't render a log axis drops a stale `yScale: 'log'`, keeping the
   // stored spec honest about what is in effect.
   if (type !== spec.type && next.options.yScale === 'log' && !supportsLogScale(type)) {
      const options: GraphOptions = { ...next.options }
      delete options.yScale
      next.options = options
   }
   // A custom axisOrigin is a `function`/`scatter` concept; switching to any other type drops it,
   // matching the yScale-drop above.
   if (type !== spec.type && next.options.axisOrigin !== undefined && type !== 'function' && type !== 'scatter') {
      const options: GraphOptions = { ...next.options }
      delete options.axisOrigin
      next.options = options
   }
   return next
}

/** Set one presentation option. `undefined` deletes the key (absent means default), keeping the
 *  stored graph lean. Carries the payloads through so an option toggle never wipes equations. */
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

/** Whether a chart requesting `yScale: 'log'` would fall back to linear because its data touches
 *  zero or goes negative. An editor-only mirror of the renderer's axis-mode policy, so GraphBlock
 *  can show a "showing linear instead" hint. `function` charts reuse {@link computeFunctionYDomain}
 *  so they never drift from the renderer. */
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

/** Append one statistical overlay, via {@link setOption} so the spec stays brand-new. */
export function addOverlay(spec: GraphSpec, overlay: Overlay): GraphSpec {
   const overlays = [...(spec.options.overlays ?? []), overlay]
   return setOption(spec, 'overlays', overlays)
}

/** Remove the overlay at `overlayIndex`. Out-of-range returns unchanged. Removing the last one drops
 *  the `overlays` key, so a cleared graph serializes lean. */
export function removeOverlay(spec: GraphSpec, overlayIndex: number): GraphSpec {
   const current = spec.options.overlays ?? []
   if (overlayIndex < 0 || overlayIndex >= current.length) return spec
   const overlays = current.filter((_overlay, index) => index !== overlayIndex)
   return setOption(spec, 'overlays', overlays.length > 0 ? overlays : undefined)
}

/** Shallow-merge `partial` onto the overlay at `overlayIndex`. Out-of-range returns unchanged. */
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
// The `function` payload (`GraphSpec.functionPlot`) is a shared domain plus named equations, so it
// gets its own transforms. Invariants: the last equation is never removed (keep >= 1), `samples` is
// clamped to [FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES], and a `functionPlot` is seeded whenever
// absent so the editor always has something to edit.

/** Default equation names: f, g, h, ... wrapping through the alphabet. */
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

/** Clamp a sample count into [FUNCTION_MIN_SAMPLES, FUNCTION_MAX_SAMPLES], rounding first. */
function clampSamples(samples: number): number {
   return Math.min(FUNCTION_MAX_SAMPLES, Math.max(FUNCTION_MIN_SAMPLES, Math.round(samples)))
}

/** Reassemble a fresh spec carrying a new `functionPlot`, everything else unchanged. */
function withFunctionPlot(spec: GraphSpec, functionPlot: FunctionPlot): GraphSpec {
   return { ...spec, functionPlot }
}

/** Append a new equation, capped at MAX_SERIES (the palette-slot cap). Seeds `functionPlot` when absent. */
export function addEquation(spec: GraphSpec): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (functionPlot.equations.length >= MAX_SERIES) return withFunctionPlot(spec, functionPlot)
   const equations = [
      ...functionPlot.equations,
      { name: defaultEquationName(functionPlot.equations.length), expression: '' },
   ]
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/** Remove the equation at `equationIndex`. No-op (but still seeds `functionPlot`) on the last
 *  equation or an out-of-range index. */
export function removeEquation(spec: GraphSpec, equationIndex: number): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (functionPlot.equations.length <= 1) return withFunctionPlot(spec, functionPlot)
   if (equationIndex < 0 || equationIndex >= functionPlot.equations.length) return withFunctionPlot(spec, functionPlot)
   const equations = functionPlot.equations.filter((_equation, index) => index !== equationIndex)
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/** Set the `name` or `expression` of the equation at `equationIndex`. Out-of-range returns the spec
 *  with `functionPlot` merely seeded. An unparseable expression is still written (it draws nothing
 *  until it parses); validating the keystroke is the editor's job. */
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

/** Set (or clear) the per-equation color at `equationIndex`, the counterpart to {@link setSeriesColor}.
 *  Out-of-range returns the spec with `functionPlot` merely seeded. */
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

/** Shallow-merge `partial` onto the shared domain. `samples`, if present, is clamped so a
 *  pathological value never reaches the stored spec. */
export function setDomain(spec: GraphSpec, partial: Partial<FunctionDomain>): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   const domain: FunctionDomain = { ...functionPlot.domain, ...partial }
   if (partial.samples !== undefined) {
      domain.samples = clampSamples(partial.samples)
   }
   return withFunctionPlot(spec, { ...functionPlot, domain })
}

/** Insert a blank equation at `index`, named by the next default letter. `index` runs
 *  0..equationCount inclusive; out of range, or at MAX_SERIES, returns the spec merely seeded. */
export function insertEquationAt(spec: GraphSpec, index: number): GraphSpec {
   const functionPlot = ensureFunctionPlot(spec)
   if (functionPlot.equations.length >= MAX_SERIES) return withFunctionPlot(spec, functionPlot)
   if (index < 0 || index > functionPlot.equations.length) return withFunctionPlot(spec, functionPlot)
   const equations = [...functionPlot.equations]
   equations.splice(index, 0, { name: defaultEquationName(functionPlot.equations.length), expression: '' })
   return withFunctionPlot(spec, { ...functionPlot, equations })
}

/** Move the equation at `fromIndex` to `toIndex`. No-op (spec merely seeded) when either index is
 *  out of range or they are equal. */
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
// The `scatter` payload (`GraphSpec.scatterPlot`) is named (x, y) point series, no shared domain.
// Every helper seeds a `scatterPlot` when absent and keeps the last series and the last point in a
// series (keep >= 1 each).

/** The default scatterPlot: one blank-named series with a single point at the origin. */
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

/** Append a new series (capped at MAX_SERIES), seeded with one point at the origin. Seeds
 *  `scatterPlot` when absent. */
export function addScatterSeries(spec: GraphSpec, name: string = ''): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (scatterPlot.series.length >= MAX_SERIES) return withScatterPlot(spec, scatterPlot)
   const series = [...scatterPlot.series, { name, points: [{ x: 0, y: 0 }] }]
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/** Remove the series at `seriesIndex`. No-op (but seeds `scatterPlot`) on the last series or an
 *  out-of-range index. */
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

/** Set (or clear) the per-series color at `seriesIndex`, the counterpart to {@link setSeriesColor}.
 *  Out-of-range returns the spec with `scatterPlot` merely seeded. */
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

/** Append a point to the series at `seriesIndex`, defaulting to a blank (non-finite) point the
 *  editor shows as a "-" gap and the renderer/serializer skip. Out-of-range returns the spec merely
 *  seeded. */
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

/** Remove the point at `pointIndex` from the series at `seriesIndex`. No-op (but seeds `scatterPlot`)
 *  on that series' last point or an out-of-range index. */
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

/** Set the `x` or `y` of the point at (`seriesIndex`, `pointIndex`). Out-of-range returns the spec
 *  merely seeded. A non-finite value is still written (the renderer skips it); validating the
 *  keystroke is an editor concern. */
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

/** Insert a series at `index`, seeded with one point at the origin. `index` runs 0..seriesCount
 *  inclusive; out of range, or at MAX_SERIES, returns the spec merely seeded. */
export function insertScatterSeriesAt(spec: GraphSpec, index: number, name: string = ''): GraphSpec {
   const scatterPlot = ensureScatterPlot(spec)
   if (scatterPlot.series.length >= MAX_SERIES) return withScatterPlot(spec, scatterPlot)
   if (index < 0 || index > scatterPlot.series.length) return withScatterPlot(spec, scatterPlot)
   const series = [...scatterPlot.series]
   series.splice(index, 0, { name, points: [{ x: 0, y: 0 }] })
   return withScatterPlot(spec, { ...scatterPlot, series })
}

/** Move the series at `fromIndex` to `toIndex`. No-op (spec merely seeded) when either index is out
 *  of range or they are equal. */
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

/** Insert a point at `index` in the series at `seriesIndex`, defaulting to a blank (non-finite)
 *  point like {@link addScatterPoint}. `index` runs 0..pointCount inclusive; out of range, or an
 *  out-of-range `seriesIndex`, returns the spec merely seeded. */
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

/** Move the point at `fromIndex` to `toIndex` within the series at `seriesIndex`. No-op (spec merely
 *  seeded) when any index is out of range or the two point indices are equal. */
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
// The `histogram` payload (`GraphSpec.histogramData`) is one flat sample list, no series axis.
// Every helper seeds a `histogramData` when absent. `bins` is clamped to [HISTOGRAM_MIN_BINS,
// HISTOGRAM_MAX_BINS]; the other fields have no structural invariant (an empty sample list is valid).

/** The default histogramData: a small non-empty sample list, bin count left unset (auto). */
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

/** Clamp a bin count into [HISTOGRAM_MIN_BINS, HISTOGRAM_MAX_BINS], rounding first. */
function clampBinCount(bins: number): number {
   return Math.min(HISTOGRAM_MAX_BINS, Math.max(HISTOGRAM_MIN_BINS, Math.round(bins)))
}

/** Replace the whole raw sample list, seeding `histogramData` when absent. Non-finite entries are
 *  left as-is; `computeHistogramBins` filters them. */
export function setHistogramSamples(spec: GraphSpec, samples: number[]): GraphSpec {
   const histogramData = ensureHistogramData(spec)
   return withHistogramData(spec, { ...histogramData, samples })
}

/** Set (or clear) the manual bin-count override. `undefined` drops the `bins` key (back to the
 *  automatic Sturges' count); a defined value is rounded + clamped. */
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

/** Set (or clear) the dataset color, the counterpart to {@link setSeriesColor}. Seeds
 *  `histogramData` when absent. */
export function setHistogramColor(spec: GraphSpec, color: string | undefined): GraphSpec {
   const histogramData = ensureHistogramData(spec)
   const { color: _dropped, ...rest } = histogramData
   return withHistogramData(spec, color === undefined ? rest : { ...rest, color })
}

// ##############################
// # TABLE LINK EDITOR            #
// ##############################
//
// The graph<->table live link's editing surface. These helpers only read/write `spec.source`, never
// the shape invariants. `data` is left for the caller: on link/re-link GraphBlock's snapshot
// write-back refreshes it, on unlink the caller supplies the just-resolved snapshot.

/** Link the spec to a table by `handle`, with the default mapping. Overwrites any existing `source`.
 *  `data` is left untouched. */
export function setSource(spec: GraphSpec, handle: string): GraphSpec {
   return { ...spec, source: { handle } }
}

/** Shallow-merge a mapping change onto the existing `source`. No-op when the spec isn't linked. */
export function updateSourceMapping(spec: GraphSpec, partial: Partial<Omit<GraphSource, 'handle'>>): GraphSpec {
   if (!spec.source) return spec
   return { ...spec, source: { ...spec.source, ...partial } }
}

/** Unlink: materialize `snapshot` onto `data` and drop `source`, reverting to a self-contained
 *  chart. The inverse of {@link setSource}. */
export function unlinkSource(spec: GraphSpec, snapshot: GraphData): GraphSpec {
   const { source: _dropped, ...rest } = spec
   return { ...rest, data: snapshot }
}

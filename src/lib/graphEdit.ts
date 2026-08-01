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

import type { GraphSpec, GraphData, GraphType, GraphOptions, Overlay, FunctionDomain, FunctionPlot } from './graph'
import {
   MAX_SERIES,
   FUNCTION_DEFAULT_X_MIN,
   FUNCTION_DEFAULT_X_MAX,
   FUNCTION_DEFAULT_SAMPLES,
   FUNCTION_MIN_SAMPLES,
   FUNCTION_MAX_SAMPLES,
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
 * transform below — dropping it here would silently wipe an author's equations the next time they,
 * say, add a category on an unrelated bar chart's spec object reached via a shared helper.
 */
function withData(spec: GraphSpec, data: GraphData): GraphSpec {
   return { ...spec, data }
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

/** Set the text of the label at `rowIndex`. Out-of-range indices return the spec unchanged. */
export function setLabel(spec: GraphSpec, rowIndex: number, text: string): GraphSpec {
   if (rowIndex < 0 || rowIndex >= spec.data.labels.length) return spec
   const data = cloneData(spec)
   data.labels[rowIndex] = text
   return withData(spec, data)
}

/**
 * Set (or clear) the per-category (per-slice) color override at `categoryIndex` — the radial
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
 * Switch the chart type, carrying data + options + any existing functionPlot through unchanged.
 * Switching TO `function` for the first time (no functionPlot yet) seeds one from the
 * FUNCTION_DEFAULT_* constants + a single blank equation, so the Data tab's EquationEditor always
 * has something real to render the moment the type card is clicked — never an undefined payload.
 */
export function setType(spec: GraphSpec, type: GraphType): GraphSpec {
   const next: GraphSpec = { ...spec, type }
   if (type === 'function' && !next.functionPlot) {
      next.functionPlot = ensureFunctionPlot(spec)
   }
   return next
}

/**
 * Set one presentation option. Passing `undefined` DELETES the key (keeps a freshly-toggled-off
 * option out of the serialized spec, so the stored graph stays lean — the same "absent means
 * default" discipline the renderer's options already follow). Carries `functionPlot` through
 * unchanged (via the `{ ...spec }` spread) — an option toggle on a `function` chart must never
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
// from `data`/`series` — a shared domain plus a list of named equations — so it gets its own small
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
 * still written here — {@link addEquation}'s "never breaks the chart" contract means an
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
 * Set (or clear) the per-equation color override at `equationIndex` — the function-chart
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

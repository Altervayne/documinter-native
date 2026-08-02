/**
 * sliderClamp.ts, Pure clamp/snap helper behind SliderWithNumberInput.
 *
 * Factored out of the component so it is unit-testable without React/jsdom: typing a value into the
 * numeric field paired with a range slider must land INSIDE the slider's [min, max] window AND on a
 * valid step boundary, exactly like dragging the slider itself would produce.
 */

/** Clamp a raw value into [min, max], then snap it to the nearest step relative to min. */
export function clampToStep(raw: number, min: number, max: number, step: number): number {
   const clamped = Math.min(max, Math.max(min, raw))
   const stepsFromMin = Math.round((clamped - min) / step)
   const snapped = min + stepsFromMin * step
   // Shed float noise (e.g. 0.1 + 0.2-style drift) without rounding away legitimate precision.
   return Math.round(snapped * 1e6) / 1e6
}

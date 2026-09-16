/*
 * Clamp/snap helper behind SliderWithNumberInput: a value typed into the numeric field must land
 * inside [min, max] AND on a valid step boundary, exactly like dragging the slider produces.
 */

/** Clamp a raw value into [min, max], then snap it to the nearest step relative to min. */
export function clampToStep(raw: number, min: number, max: number, step: number): number {
   const clamped = Math.min(max, Math.max(min, raw))
   const stepsFromMin = Math.round((clamped - min) / step)
   const snapped = min + stepsFromMin * step
   // Shed float noise (e.g. 0.1 + 0.2-style drift) without rounding away legitimate precision.
   return Math.round(snapped * 1e6) / 1e6
}

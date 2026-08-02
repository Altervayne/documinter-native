/**
 * SliderWithNumberInput.tsx, A range slider paired with an editable numeric input.
 *
 * A single reusable control for the Presentation window's sliders (watermark opacity / rotation /
 * tile size / spacing, header max-height): one label, a full-width `<input type="range">`, and a
 * coupled `<input type="number">` so the user can drag OR type an exact value. Both controls share
 * one stored (raw) value + one clamp, dragging the slider updates the number, and a typed value is
 * clamped into [min, max] and snapped to the nearest step before it commits.
 *
 * `displayScale` / `unit` let the number field show a friendlier unit than the raw stored domain
 * (e.g. watermark opacity is stored as a 0..1 fraction but is friendlier to type as a 0..100 percent)
 * without the raw value, its clamp, or the slider itself ever leaving the stored domain.
 */

import { useState } from 'react'
import { clampToStep } from '../lib/sliderClamp'

// ###########
// # HELPERS #
// ###########

/** Round a value to a fixed number of decimals, for display only (never mutates the stored value). */
function roundToPrecision(value: number, precision: number): number {
   const factor = 10 ** precision
   return Math.round(value * factor) / factor
}

// #############
// # COMPONENT #
// #############

interface SliderWithNumberInputProps {
   label:    string
   value:    number   // the raw, stored value, the same domain the slider's min/max/step describe
   min:      number
   max:      number
   step:     number
   onChange: (next: number) => void
   /** Multiplies the raw value for the number field's display/typing domain (default 1 = no scaling). */
   displayScale?: number
   /** Suffix shown after the number field, e.g. 'px', '°', '%'. */
   unit?: string
   /** Decimal places the DISPLAYED (scaled) value is rounded to. Defaults to 0 (whole numbers). */
   displayPrecision?: number
}

export function SliderWithNumberInput({
   label, value, min, max, step, onChange,
   displayScale = 1, unit, displayPrecision = 0,
}: SliderWithNumberInputProps) {
   // While the number field is focused, its text is the source of truth (so partial typing like
   // "1" of "150" isn't clobbered by the canonical formatted value on every keystroke); on blur it
   // reverts to null and the field goes back to reflecting the committed, clamped value.
   const [editingText, setEditingText] = useState<string | null>(null)

   const displayValue = roundToPrecision(value * displayScale, displayPrecision)
   const shownText = editingText ?? String(displayValue)

   function commitDisplayText(text: string): void {
      const parsed = Number(text)
      if (text.trim() === '' || Number.isNaN(parsed)) return
      onChange(clampToStep(parsed / displayScale, min, max, step))
   }

   return (
      <label className="presentation-field">
         <span className="presentation-field-label">{label}</span>
         <div className="presentation-range-row">
            <input
               className="presentation-range"
               type="range"
               min={min}
               max={max}
               step={step}
               value={value}
               onChange={event => onChange(Number(event.target.value))}
            />
            <span className="presentation-number-wrap">
               <input
                  className="presentation-number"
                  type="number"
                  min={min * displayScale}
                  max={max * displayScale}
                  step={step * displayScale}
                  value={shownText}
                  aria-label={label}
                  onChange={event => {
                     setEditingText(event.target.value)
                     commitDisplayText(event.target.value)
                  }}
                  onBlur={() => setEditingText(null)}
               />
               {unit && <span className="presentation-number-unit">{unit}</span>}
            </span>
         </div>
      </label>
   )
}

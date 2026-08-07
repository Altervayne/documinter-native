// -- React Imports --
import { useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'

// -- Library Imports --
import { clsx } from '../lib/clsx'

// #########
// # TYPES #
// #########

export interface SegmentedIconToggleOption<Value extends string> {
   value: Value
   label: string
   /** Optional leading glyph. Omit for a text-only segment (e.g. a page-number format example, where
    *  the label itself is the glyph). */
   icon?: ReactNode
   /** Greyed out and unselectable (still shows its tooltip). Keyboard navigation skips it. */
   disabled?: boolean
}

interface SegmentedIconToggleProps<Value extends string> {
   options:   SegmentedIconToggleOption<Value>[]
   value:     Value
   onChange:  (value: Value) => void
   ariaLabel: string
}

// #############
// # COMPONENT #
// #############

/**
 * A horizontal row of icon + label buttons acting as a single-select toggle, a visual alternative
 * to a native `<select>` for a small, fixed set of options where the choice reads more clearly as a
 * glyph than as text (line style, arrowhead shape, and similar). Generic over the option value type
 * so it type-checks against any string-literal union without a cast at the call site.
 *
 * Built as a proper ARIA `radiogroup`/`radio` pair rather than a plain button row: the checked
 * option is the only one in the tab order (roving tabindex) and Left/Right/Up/Down arrow keys move
 * the checked option and focus together, wrapping at the ends, the standard radiogroup keyboard
 * contract. Styling is app-chrome only (`--color-*` tokens via the `.segmented-icon-toggle*` rules
 * in doc.css), so it reads correctly in both the light and dark app theme.
 */
export function SegmentedIconToggle<Value extends string>({
   options, value, onChange, ariaLabel,
}: SegmentedIconToggleProps<Value>) {
   const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

   // Moves the selection AND keyboard focus together in `direction` (+1 / -1), wrapping at both ends and
   // skipping any disabled option, so arrow keys never land on an unselectable segment.
   function moveSelection(fromIndex: number, direction: 1 | -1): void {
      for (let step = 1; step <= options.length; step++) {
         const index = ((fromIndex + direction * step) % options.length + options.length) % options.length
         if (!options[index].disabled) {
            onChange(options[index].value)
            buttonRefs.current[index]?.focus()
            return
         }
      }
   }

   function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
         event.preventDefault()
         moveSelection(index, 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
         event.preventDefault()
         moveSelection(index, -1)
      }
   }

   // The checked option is the roving-tabindex stop; if nothing matches `value` (shouldn't normally
   // happen), the first option stays reachable so the group is never entirely un-tabbable.
   const selectedIndex = options.findIndex(option => option.value === value)
   const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex

   return (
      <div className="segmented-icon-toggle" role="radiogroup" aria-label={ariaLabel}>
         {options.map((option, index) => {
            const isSelected = option.value === value
            return (
               <button
                  key={option.value}
                  ref={element => { buttonRefs.current[index] = element }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={index === tabbableIndex ? 0 : -1}
                  className={clsx('segmented-icon-toggle-option', isSelected && 'is-selected', option.disabled && 'is-disabled')}
                  onClick={() => { if (!option.disabled) onChange(option.value) }}
                  onKeyDown={event => handleKeyDown(event, index)}
                  title={option.label}
               >
                  {option.icon && <span className="segmented-icon-toggle-icon" aria-hidden="true">{option.icon}</span>}
                  <span className="segmented-icon-toggle-label">{option.label}</span>
               </button>
            )
         })}
      </div>
   )
}

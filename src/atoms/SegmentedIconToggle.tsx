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
   icon:  ReactNode
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

   // Moves the selection AND keyboard focus together to the option at `nextIndex`, wrapping around
   // both ends so Left from the first option reaches the last one and vice versa.
   function focusAndSelect(nextIndex: number): void {
      const wrappedIndex = (nextIndex + options.length) % options.length
      const nextOption = options[wrappedIndex]
      onChange(nextOption.value)
      buttonRefs.current[wrappedIndex]?.focus()
   }

   function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
         event.preventDefault()
         focusAndSelect(index + 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
         event.preventDefault()
         focusAndSelect(index - 1)
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
                  tabIndex={index === tabbableIndex ? 0 : -1}
                  className={clsx('segmented-icon-toggle-option', isSelected && 'is-selected')}
                  onClick={() => onChange(option.value)}
                  onKeyDown={event => handleKeyDown(event, index)}
                  title={option.label}
               >
                  <span className="segmented-icon-toggle-icon" aria-hidden="true">{option.icon}</span>
                  <span className="segmented-icon-toggle-label">{option.label}</span>
               </button>
            )
         })}
      </div>
   )
}

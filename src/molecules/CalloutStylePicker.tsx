import type { CalloutStyle } from '../types'
import { clsx } from '../lib/clsx'

// Callout accent colors live as CSS custom properties in doc.css so they
// automatically switch between light-doc and dark-doc palettes.
const STYLES: { value: CalloutStyle; cssVar: string }[] = [
   { value: 'info',    cssVar: '--callout-info-accent'    },
   { value: 'valid',   cssVar: '--callout-valid-accent'   },
   { value: 'warning', cssVar: '--callout-warning-accent' },
   { value: 'danger',  cssVar: '--callout-danger-accent'  },
]

interface CalloutStylePickerProps {
   current: CalloutStyle
   onChange: (style: CalloutStyle) => void
}

export function CalloutStylePicker({ current, onChange }: CalloutStylePickerProps) {
   return (
      <div className="flex items-center gap-1 p-2 -mb-4">
         {STYLES.map(({ value, cssVar }) => (
            <button
               key={value}
               onClick={() => onChange(value)}
               className={clsx(
                  'px-2.5 py-1 text-xs rounded-md border capitalize cursor-pointer transition-all',
                  current === value
                     ? 'font-semibold'
                     : 'border-current/20 opacity-50 hover:opacity-80',
               )}
               style={current === value
                  ? {
                       color:       `var(${cssVar})`,
                       borderColor: `var(${cssVar})`,
                       background:  `color-mix(in srgb, var(${cssVar}) 10%, transparent)`,
                    }
                  : undefined
               }
            >
               {value}
            </button>
         ))}
      </div>
   )
}

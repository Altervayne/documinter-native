import type { CalloutStyle } from '../types'
import { clsx } from '../lib/clsx'

const STYLES: { value: CalloutStyle; color: string }[] = [
   { value: 'info',    color: '#2563eb' },
   { value: 'valid',   color: '#16a34a' },
   { value: 'warning', color: '#d97706' },
   { value: 'danger',  color: '#e11d48' },
]

interface CalloutStylePickerProps {
   current: CalloutStyle
   onChange: (style: CalloutStyle) => void
}

export function CalloutStylePicker({ current, onChange }: CalloutStylePickerProps) {
   return (
      <div className="flex items-center gap-1 p-2">
         {STYLES.map(({ value, color }) => (
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
                  ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }
                  : undefined
               }
            >
               {value}
            </button>
         ))}
      </div>
   )
}

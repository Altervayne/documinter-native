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
    <div className="flex items-center gap-1 mb-1.5">
      <span className="font-mono text-xs text-muted mr-1.5">style:</span>
      {STYLES.map(({ value, color }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={clsx(
            'text-xs px-2 py-0.5 rounded cursor-pointer border transition-colors',
            current === value
              ? 'border-current font-bold'
              : 'border-transparent text-muted hover:text-text',
          )}
          style={current === value ? { color } : undefined}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { ChannelSlider } from './ChannelSlider'

export interface ChannelRowProps {
   label:      string
   labelColor: string
   value:      number
   min:        number
   max:        number
   gradient:   string
   onChange:   (value: number) => void
}

export function ChannelRow({ label, labelColor, value, min, max, gradient, onChange }: ChannelRowProps) {
   const [raw, setRaw] = useState(String(value))
   useEffect(() => { setRaw(String(value)) }, [value])

   function commit(rawValue: string) {
      const parsedValue = parseInt(rawValue, 10)
      if (!isNaN(parsedValue)) onChange(Math.max(min, Math.min(max, parsedValue)))
      setRaw(String(value))
   }

   return (
      <div className="flex items-center gap-2">
         <span className="font-mono text-xs font-bold w-4 text-center select-none" style={{ color: labelColor }}>
            {label}
         </span>
         <ChannelSlider value={value} min={min} max={max} gradient={gradient} onChange={onChange} />
         <input
            type="text"
            inputMode="numeric"
            value={raw}
            onChange={event => { setRaw(event.target.value) }}
            onBlur={event => commit(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') commit((event.target as HTMLInputElement).value) }}
            className="w-9 text-right text-xs font-mono bg-transparent text-text outline-none border-none"
         />
      </div>
   )
}

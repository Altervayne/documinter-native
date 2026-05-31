import { useRef } from 'react'

export interface ChannelSliderProps {
   value:    number
   min:      number
   max:      number
   gradient: string
   onChange: (value: number) => void
}

export function ChannelSlider({ value, min, max, gradient, onChange }: ChannelSliderProps) {
   const ref = useRef<HTMLDivElement>(null)

   function pick(event: React.PointerEvent<HTMLDivElement>) {
      const el = ref.current
      if (!el) return
      const bounds = el.getBoundingClientRect()
      const positionRatio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
      onChange(Math.round(min + positionRatio * (max - min)))
   }

   const pct = ((value - min) / (max - min)) * 100

   return (
      <div
         ref={ref}
         className="relative h-2 rounded-full flex-1 cursor-pointer touch-none"
         style={{ background: gradient }}
         onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pick(event) }}
         onPointerMove={event => { if (event.buttons === 0) return; pick(event) }}
      >
         <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-white pointer-events-none"
            style={{ left: `${pct}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.3)' }}
         />
      </div>
   )
}

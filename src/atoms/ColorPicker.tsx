import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Color math ───────────────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
   s /= 100; v /= 100
   const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
   let r = 0, g = 0, b = 0
   if      (h < 60)  { r = c; g = x }
   else if (h < 120) { r = x; g = c }
   else if (h < 180) { g = c; b = x }
   else if (h < 240) { g = x; b = c }
   else if (h < 300) { r = x; b = c }
   else              { r = c; b = x }
   return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
   r /= 255; g /= 255; b /= 255
   const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
   const v = max, s = max === 0 ? 0 : d / max
   let h = 0
   if (d !== 0) {
      if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (max === g) h = ((b - r) / d + 2) / 6
      else                h = ((r - g) / d + 4) / 6
   }
   return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
   r /= 255; g /= 255; b /= 255
   const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
   if (max === min) return [0, 0, Math.round(l * 100)]
   const d = max - min
   const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
   let h = 0
   if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
   else if (max === g) h = ((b - r) / d + 2) / 6
   else                h = ((r - g) / d + 4) / 6
   return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
   h /= 360; s /= 100; l /= 100
   if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
   const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
   const hue = (t: number) => {
      t = ((t % 1) + 1) % 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
   }
   return [Math.round(hue(h + 1/3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1/3) * 255)]
}

function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
   r /= 255; g /= 255; b /= 255
   const k = 1 - Math.max(r, g, b)
   if (k >= 1) return [0, 0, 0, 100]
   return [
      Math.round(((1 - r - k) / (1 - k)) * 100),
      Math.round(((1 - g - k) / (1 - k)) * 100),
      Math.round(((1 - b - k) / (1 - k)) * 100),
      Math.round(k * 100),
   ]
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
   c /= 100; m /= 100; y /= 100; k /= 100
   return [
      Math.round(255 * (1 - c) * (1 - k)),
      Math.round(255 * (1 - m) * (1 - k)),
      Math.round(255 * (1 - y) * (1 - k)),
   ]
}

function hexToRgb(hex: string): [number, number, number] | null {
   const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
   return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

function rgbToHex(r: number, g: number, b: number): string {
   return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')
}

// ─── Channel slider ────────────────────────────────────────────────────────────

interface SliderProps {
   value: number
   min: number
   max: number
   gradient: string
   onChange: (v: number) => void
}

function ChannelSlider({ value, min, max, gradient, onChange }: SliderProps) {
   const ref = useRef<HTMLDivElement>(null)

   function pick(e: React.PointerEvent<HTMLDivElement>) {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
      onChange(Math.round(min + x * (max - min)))
   }

   const pct = ((value - min) / (max - min)) * 100

   return (
      <div
         ref={ref}
         className="relative h-2 rounded-full flex-1 cursor-pointer touch-none"
         style={{ background: gradient }}
         onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e) }}
         onPointerMove={e => { if (e.buttons === 0) return; pick(e) }}
      >
         <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-white pointer-events-none"
            style={{ left: `${pct}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.3)' }}
         />
      </div>
   )
}

// ─── Channel row ───────────────────────────────────────────────────────────────

interface ChannelRowProps {
   label: string
   labelColor: string
   value: number
   min: number
   max: number
   gradient: string
   onChange: (v: number) => void
}

function ChannelRow({ label, labelColor, value, min, max, gradient, onChange }: ChannelRowProps) {
   const [raw, setRaw] = useState(String(value))
   useEffect(() => { setRaw(String(value)) }, [value])

   function commit(s: string) {
      const n = parseInt(s, 10)
      if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)))
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
            onChange={e => { setRaw(e.target.value) }}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
            className="w-9 text-right text-xs font-mono bg-transparent text-text outline-none border-none"
         />
      </div>
   )
}

// ─── Main component ────────────────────────────────────────────────────────────

type ColorMode = 'hex' | 'rgb' | 'hsl' | 'cmyk'
const MODES: ColorMode[] = ['hex', 'rgb', 'hsl', 'cmyk']

interface ColorPickerProps {
   value: string
   onChange: (hex: string) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
   const [mode, setMode] = useState<ColorMode>('hex')

   // ── Internal RGB state ───────────────────────────────────────────────────────
   // Source of truth. Avoids the prop→hex→derive feedback loop that causes
   // degenerate color conversions (e.g. hsl(*, *, 100%) always → [0,0,100]).
   const emittedHex = useRef(value)
   const [rgb, setRgb] = useState<[number, number, number]>(() => hexToRgb(value) ?? [249, 115, 22])

   const [r, g, b]          = rgb
   const [, hsvS, hsvV] = rgbToHsv(r, g, b)
   const [,, hslL]          = rgbToHsl(r, g, b)
   const [c, m, y, k]       = rgbToCmyk(r, g, b)

   // ── Sticky refs ──────────────────────────────────────────────────────────────
   // Preserve hue/saturation through degenerate colors (black, white, gray).
   // Only updated explicitly in onChange handlers and on external value changes —
   // never from derived RGB round-trips, which introduce rounding drift.
   const sHsvH  = useRef(rgbToHsv(r, g, b)[0])
   const sHslH  = useRef(rgbToHsl(r, g, b)[0])
   const sHslS  = useRef(rgbToHsl(r, g, b)[1])
   const sCmykC = useRef(c)
   const sCmykM = useRef(m)
   const sCmykY = useRef(y)

   // Only sync from external prop changes, not our own emissions.
   // Also update sticky refs from the new external color.
   useEffect(() => {
      if (value !== emittedHex.current) {
         const parsed = hexToRgb(value)
         if (parsed) {
            setRgb(parsed)
            const [nh, ns, nv] = rgbToHsv(...parsed)
            const [nlh, nls, nll] = rgbToHsl(...parsed)
            const [nc, nm, ny, nk] = rgbToCmyk(...parsed)
            if (ns > 0 && nv > 0) sHsvH.current = nh
            if (nll > 0 && nll < 100) { sHslH.current = nlh; if (nls > 0) sHslS.current = nls }
            if (nk < 100) { sCmykC.current = nc; sCmykM.current = nm; sCmykY.current = ny }
         }
      }
   }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

   const pureHue = rgbToHex(...hsvToRgb(sHsvH.current, 100, 100))

   const emit = useCallback((newRgb: [number, number, number]) => {
      const hex = rgbToHex(...newRgb)
      emittedHex.current = hex
      setRgb(newRgb)
      onChange(hex)
   }, [onChange])

   // ── SV square & hue bar ──────────────────────────────────────────────────────
   const svRef  = useRef<HTMLDivElement>(null)
   const hueRef = useRef<HTMLDivElement>(null)

   function pickSV(e: React.PointerEvent<HTMLDivElement>) {
      const el = svRef.current; if (!el) return
      const rect = el.getBoundingClientRect()
      const ns = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left)  / rect.width))  * 100)
      const nv = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)) * 100)
      emit(hsvToRgb(sHsvH.current, ns, nv))
   }

   function pickHue(e: React.PointerEvent<HTMLDivElement>) {
      const el = hueRef.current; if (!el) return
      const rect = el.getBoundingClientRect()
      const nh = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360)
      sHsvH.current = nh
      emit(hsvToRgb(nh, hsvS, hsvV))
   }

   // ── Hex input ────────────────────────────────────────────────────────────────
   const currentHex = rgbToHex(r, g, b)
   const [hexRaw, setHexRaw] = useState(currentHex.replace('#', ''))
   useEffect(() => { setHexRaw(currentHex.replace('#', '')) }, [currentHex]) // eslint-disable-line react-hooks/exhaustive-deps

   return (
      <div className="flex flex-col gap-2.5 select-none">

         {/* ── SV square ─────────────────────────────────────────────────────── */}
         <div
            ref={svRef}
            className="relative w-full rounded-md overflow-hidden cursor-crosshair touch-none"
            style={{
               height: 120,
               background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${pureHue})`,
            }}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pickSV(e) }}
            onPointerMove={e => { if (e.buttons === 0) return; pickSV(e) }}
         >
            <div
               className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white pointer-events-none"
               style={{ left: `${hsvS}%`, top: `${100 - hsvV}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }}
            />
         </div>

         {/* ── Hue bar ───────────────────────────────────────────────────────── */}
         <div
            ref={hueRef}
            className="relative w-full h-3 rounded-full cursor-pointer touch-none"
            style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pickHue(e) }}
            onPointerMove={e => { if (e.buttons === 0) return; pickHue(e) }}
         >
            <div
               className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white pointer-events-none"
               style={{ left: `${(sHsvH.current / 360) * 100}%`, background: pureHue, boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }}
            />
         </div>

         {/* ── Mode tabs ─────────────────────────────────────────────────────── */}
         <div className="flex gap-0.5 bg-bg rounded-lg p-0.5 border border-border/60">
            {MODES.map(m => (
               <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-1 rounded-md text-xs font-mono font-semibold uppercase tracking-wide transition-colors
                     ${mode === m ? 'bg-raised text-text shadow-sm' : 'text-muted hover:text-text'}`}
               >
                  {m}
               </button>
            ))}
         </div>

         {/* ── Mode content ──────────────────────────────────────────────────── */}
         <div className="flex flex-col gap-2">

            {mode === 'hex' && (
               <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md border border-border/60 shrink-0" style={{ background: currentHex }} />
                  <div className="flex items-center flex-1 bg-bg border border-border rounded-lg px-2.5 py-1.5 gap-1">
                     <span className="text-xs text-muted font-mono">#</span>
                     <input
                        type="text"
                        value={hexRaw}
                        onChange={e => {
                           const cleaned = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
                           setHexRaw(cleaned)
                           if (cleaned.length === 6) {
                              const parsed = hexToRgb('#' + cleaned)
                              if (parsed) emit(parsed)
                           }
                        }}
                        maxLength={6}
                        spellCheck={false}
                        className="flex-1 min-w-0 bg-transparent text-xs font-mono text-text outline-none"
                        placeholder="rrggbb"
                     />
                  </div>
               </div>
            )}

            {mode === 'rgb' && (
               <>
                  <ChannelRow label="R" labelColor="#e55" value={r} min={0} max={255}
                     gradient={`linear-gradient(to right, rgb(0,${g},${b}), rgb(255,${g},${b}))`}
                     onChange={v => emit([v, g, b])} />
                  <ChannelRow label="G" labelColor="#5a5" value={g} min={0} max={255}
                     gradient={`linear-gradient(to right, rgb(${r},0,${b}), rgb(${r},255,${b}))`}
                     onChange={v => emit([r, v, b])} />
                  <ChannelRow label="B" labelColor="#59f" value={b} min={0} max={255}
                     gradient={`linear-gradient(to right, rgb(${r},${g},0), rgb(${r},${g},255))`}
                     onChange={v => emit([r, g, v])} />
               </>
            )}

            {mode === 'hsl' && (
               <>
                  <ChannelRow label="H" labelColor="#aaa" value={sHslH.current} min={0} max={360}
                     gradient="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
                     onChange={v => { sHslH.current = v; emit(hslToRgb(v, sHslS.current, hslL)) }} />
                  <ChannelRow label="S" labelColor="#aaa" value={sHslS.current} min={0} max={100}
                     gradient={`linear-gradient(to right, hsl(${sHslH.current},0%,${hslL}%), hsl(${sHslH.current},100%,${hslL}%))`}
                     onChange={v => { sHslS.current = v; emit(hslToRgb(sHslH.current, v, hslL)) }} />
                  <ChannelRow label="L" labelColor="#aaa" value={hslL} min={0} max={100}
                     gradient={`linear-gradient(to right, hsl(${sHslH.current},${sHslS.current}%,0%), hsl(${sHslH.current},${sHslS.current}%,50%), hsl(${sHslH.current},${sHslS.current}%,100%))`}
                     onChange={v => emit(hslToRgb(sHslH.current, sHslS.current, v))} />
               </>
            )}

            {mode === 'cmyk' && (
               <>
                  <ChannelRow label="C" labelColor="#22c8d8" value={c} min={0} max={100}
                     gradient={`linear-gradient(to right, ${rgbToHex(...cmykToRgb(0,sCmykM.current,sCmykY.current,k))}, ${rgbToHex(...cmykToRgb(100,sCmykM.current,sCmykY.current,k))})`}
                     onChange={v => { sCmykC.current = v; emit(cmykToRgb(v, sCmykM.current, sCmykY.current, k)) }} />
                  <ChannelRow label="M" labelColor="#e840a0" value={m} min={0} max={100}
                     gradient={`linear-gradient(to right, ${rgbToHex(...cmykToRgb(sCmykC.current,0,sCmykY.current,k))}, ${rgbToHex(...cmykToRgb(sCmykC.current,100,sCmykY.current,k))})`}
                     onChange={v => { sCmykM.current = v; emit(cmykToRgb(sCmykC.current, v, sCmykY.current, k)) }} />
                  <ChannelRow label="Y" labelColor="#c8b800" value={y} min={0} max={100}
                     gradient={`linear-gradient(to right, ${rgbToHex(...cmykToRgb(sCmykC.current,sCmykM.current,0,k))}, ${rgbToHex(...cmykToRgb(sCmykC.current,sCmykM.current,100,k))})`}
                     onChange={v => { sCmykY.current = v; emit(cmykToRgb(sCmykC.current, sCmykM.current, v, k)) }} />
                  <ChannelRow label="K" labelColor="#888" value={k} min={0} max={100}
                     gradient={`linear-gradient(to right, ${rgbToHex(...cmykToRgb(sCmykC.current,sCmykM.current,sCmykY.current,0))}, ${rgbToHex(...cmykToRgb(sCmykC.current,sCmykM.current,sCmykY.current,100))})`}
                     onChange={v => emit(cmykToRgb(sCmykC.current, sCmykM.current, sCmykY.current, v))} />
               </>
            )}

         </div>
      </div>
   )
}

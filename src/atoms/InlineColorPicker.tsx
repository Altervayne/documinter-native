import { useRef } from 'react'

// ============================================================
// Types
// ============================================================

interface InlineColorPickerProps {
   /** The currently active color hex string, or undefined when none. */
   activeColor:  string | undefined
   /** Curated palette of hex strings to show as swatches. */
   palette:      readonly string[]
   /** Label for the "remove" button (localised). */
   removeLabel:  string
   /** Called with a hex color when the user picks one, or undefined to clear. */
   onChange:     (color: string | undefined) => void
   /** Called when the picker should be closed without a change. */
   onDismiss:    () => void
}

// ============================================================
// Component
// ============================================================

export function InlineColorPicker({
   activeColor,
   palette,
   removeLabel,
   onChange,
   onDismiss,
}: InlineColorPickerProps) {
   const customInputRef = useRef<HTMLInputElement>(null)

   function handleSwatchClick(color: string) {
      onChange(color)
   }

   function handleCustomClick() {
      customInputRef.current?.click()
   }

   function handleCustomChange(event: React.ChangeEvent<HTMLInputElement>) {
      onChange(event.target.value.toLowerCase())
   }

   function handleRemove() {
      onChange(undefined)
   }

   function handleKeyDown(event: React.KeyboardEvent) {
      if (event.key === 'Escape') {
         event.stopPropagation()
         onDismiss()
      }
   }

   return (
      <div
         className="absolute w-[168px] rounded-lg border border-border bg-raised shadow-xl overflow-hidden"
         style={{
            top:       'calc(100% + 6px)',
            left:      '50%',
            transform: 'translateX(-50%)',
            animation: 'link-panel-in 120ms ease-out both',
            zIndex:    10,
         }}
         onKeyDown={handleKeyDown}
      >
         {/* Swatch grid */}
         <div className="flex flex-wrap gap-1 p-2">
            {palette.map(color => {
               const isActive = activeColor === color
               return (
                  <button
                     key={color}
                     title={color}
                     onClick={() => handleSwatchClick(color)}
                     className="cursor-pointer rounded-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                     style={{
                        width:           22,
                        height:          22,
                        backgroundColor: color,
                        boxShadow:       isActive
                           ? `0 0 0 2px var(--color-raised), 0 0 0 4px ${color}`
                           : '0 0 0 1px rgba(0,0,0,0.18)',
                     }}
                  />
               )
            })}

            {/* Custom color swatch — opens a hidden native color input */}
            <button
               title="Custom color"
               onClick={handleCustomClick}
               className="cursor-pointer rounded-md border border-dashed border-border hover:border-muted transition-colors flex items-center justify-center text-muted hover:text-text text-[10px] font-mono focus:outline-none"
               style={{ width: 22, height: 22 }}
            >
               +
               <input
                  ref={customInputRef}
                  type="color"
                  value={activeColor ?? '#000000'}
                  onChange={handleCustomChange}
                  className="absolute w-0 h-0 opacity-0 pointer-events-none"
                  tabIndex={-1}
               />
            </button>
         </div>

         {/* Divider + Remove button */}
         <div className="border-t border-border px-2 py-1.5">
            <button
               onClick={handleRemove}
               className="w-full text-left text-xs text-muted hover:text-text transition-colors cursor-pointer px-1 py-0.5 rounded"
            >
               {removeLabel}
            </button>
         </div>
      </div>
   )
}

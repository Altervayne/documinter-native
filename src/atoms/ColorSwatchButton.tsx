// ============================================================
// Types
// ============================================================

interface ColorSwatchButtonProps {
   /** Hex color the swatch represents and applies when clicked. */
   color:    string
   /** Whether this swatch matches the currently active color (draws a ring). */
   isActive: boolean
   /** Called with the swatch color when clicked. */
   onPick:   (color: string) => void
}

// ============================================================
// Component
// ============================================================

/** A single 22px color swatch button shared by the curated and recent color rows. */
export function ColorSwatchButton({ color, isActive, onPick }: ColorSwatchButtonProps) {
   return (
      <button
         title={color}
         onClick={() => onPick(color)}
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
}

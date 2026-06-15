import { useState, useEffect } from 'react'

// ############################################################
// DropIndicator, accent-coloured insertion bar shown at a DnD
// drop target during a drag operation.
//
// Two-frame mount pattern:
//   1. Mounts with isVisible = false  → opacity-0
//   2. requestAnimationFrame fires   → isVisible = true → opacity-[0.85]
//   3. CSS transition on opacity runs smoothly (150 ms ease-out)
//
// This guarantees the browser renders one invisible frame before
// the transition starts.  Without it, the element mounts already
// at the final state and the CSS transition never fires (the
// browser paints the mounted + final-state in the same frame).
//
// The Tailwind motion-reduce:transition-none class makes the
// indicator appear instantly when prefers-reduced-motion is on,
// the element still mounts and becomes visible, just without a
// fade.
// ############################################################

export function DropIndicator() {
   const [isVisible, setIsVisible] = useState(false)

   useEffect(() => {
      const frameId = requestAnimationFrame(() => setIsVisible(true))
      return () => cancelAnimationFrame(frameId)
   }, [])

   return (
      <div
         className={[
            'absolute -top-px left-4 right-4 h-1 rounded-full pointer-events-none',
            'transition-opacity duration-150 ease-out motion-reduce:transition-none',
            isVisible ? 'opacity-[0.85]' : 'opacity-0',
         ].join(' ')}
         style={{ background: 'var(--doc-accent, var(--color-accent))' }}
      />
   )
}

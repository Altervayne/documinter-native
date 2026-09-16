import { useState, useEffect } from 'react'

/*
 * The accent insertion bar at a DnD drop target. It mounts invisible and flips to visible on the
 * next frame so the browser paints one opacity-0 frame first; without that the fade-in never fires.
 * motion-reduce shows it instantly.
 */
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

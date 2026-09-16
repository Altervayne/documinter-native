/**
 * Scroll a canvas element into view and flash it with the accent colour. IntersectionObserver so the
 * flash fires whether the target is already visible or only once the smooth-scroll reaches it; the rAF
 * waits for layout to settle before adding the animation class.
 */
export function scrollAndFlash(
   selector:    string,
   scrollBlock: ScrollLogicalPosition = 'start',
): void {
   const target = document.querySelector(selector)
   if (!(target instanceof HTMLElement)) return

   target.scrollIntoView({ behavior: 'smooth', block: scrollBlock })

   const observer = new IntersectionObserver((entries, obs) => {
      const entry = entries[0]
      if (!entry.isIntersecting) return
      obs.disconnect()
      requestAnimationFrame(() => {
         target.classList.add('doc-tree-nav-target')
         target.addEventListener(
            'animationend',
            () => target.classList.remove('doc-tree-nav-target'),
            { once: true },
         )
      })
   }, { threshold: 0.1 })

   observer.observe(target)
}

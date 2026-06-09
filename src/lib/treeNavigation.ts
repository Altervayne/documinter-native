/**
 * Scrolls a canvas element into view and briefly flashes it with the accent
 * colour to confirm the navigation landed.
 *
 * Uses IntersectionObserver so the flash fires immediately when the target is
 * already visible, or fires once the smooth-scroll brings it into the viewport.
 * requestAnimationFrame after intersection ensures the layout has settled before
 * the animation class is applied.
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

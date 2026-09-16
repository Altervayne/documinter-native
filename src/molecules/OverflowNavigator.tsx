import { useEffect, useState } from 'react'
import { TriangleAlert, ChevronUp, ChevronDown } from 'lucide-react'

import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface OverflowNavigatorProps {
   /** Ids of the pages carrying an unresolvable overflow, top to bottom. Empty hides the bar. */
   pageIds: string[]
}

// #############
// # COMPONENT #
// #############

/**
 * Floating status bar at the bottom of the editor canvas, shown while the document holds overflow
 * issues (blocks too tall for their sheet). Steps through them like a Find bar: each step scrolls
 * the offending page into view and flashes its shade. Editor chrome only, never exported.
 */
export function OverflowNavigator({ pageIds }: OverflowNavigatorProps) {
   const { t } = useLang()
   const [index, setIndex] = useState(0)
   const count = pageIds.length

   // Keep the cursor in range as issues are fixed or appear, without jumping the view.
   useEffect(() => {
      if (index > count - 1) setIndex(Math.max(0, count - 1))
   }, [count, index])

   if (count === 0) return null

   // Scroll the page at `nextIndex` (wrapped) into view and flash its shade. The shade only exists
   // on a too-tall page, which is exactly what pageIds names, so it is always there to flash.
   function focusIssue(nextIndex: number): void {
      const clamped = ((nextIndex % count) + count) % count
      setIndex(clamped)
      const pageId = pageIds[clamped]
      const pageElement = Array.from(document.querySelectorAll<HTMLElement>('[data-page-id]'))
         .find(element => element.getAttribute('data-page-id') === pageId)
      if (!pageElement) return
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const shade = pageElement.querySelector<HTMLElement>('.doc-page-overflow-shade')
      if (shade) {
         shade.classList.remove('doc-page-overflow-shade-flash')
         // Force a reflow so re-adding the class restarts the animation.
         void shade.offsetWidth
         shade.classList.add('doc-page-overflow-shade-flash')
      }
   }

   const noun = count === 1 ? t.overflowBarSingular : t.overflowBarPlural

   return (
      // Full-width flex row so the pill centres without a fractional transform (which would blur it);
      // only the pill catches the pointer, the row stays transparent to clicks below.
      <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none z-[60]">
         <div className="doc-overflow-nav pointer-events-auto">
            <TriangleAlert size={15} />
            <span className="doc-overflow-nav-count">{count} {noun}</span>
            <span className="doc-overflow-nav-pos">{index + 1} / {count}</span>
            <div className="doc-overflow-nav-divider" />
            <button type="button" className="doc-overflow-nav-btn" title={t.overflowBarPrev} onClick={() => focusIssue(index - 1)}>
               <ChevronUp size={15} />
            </button>
            <button type="button" className="doc-overflow-nav-btn" title={t.overflowBarNext} onClick={() => focusIssue(index + 1)}>
               <ChevronDown size={15} />
            </button>
         </div>
      </div>
   )
}

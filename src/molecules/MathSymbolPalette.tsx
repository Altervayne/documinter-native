import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { renderLatexToMathML, isTemmlReady, onTemmlReady } from '../lib/math'
import { MATH_SYMBOL_CATEGORIES } from '../lib/mathSymbols'
import type { MathSymbolCategoryKey, MathSymbolEntry } from '../lib/mathSymbols'
import { useLang } from '../contexts/LangContext'
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// #############
// # CONSTANTS #
// #############

const PALETTE_WIDTH    = 296
const PANEL_MAX_HEIGHT = 380

// #########
// # TYPES #
// #########

interface MathSymbolPaletteProps {
   /** The trigger button's viewport rect; the panel clamps itself around it. */
   anchorRect: DOMRect
   /** Splice a snippet's `insert` string into the source at the current caret/selection. */
   onInsert:   (insert: string) => void
   /** Close the palette (Escape / outside click). */
   onClose:    () => void
}

// #############
// # COMPONENT #
// #############

/**
 * Assisted-input symbol palette for the math block. An inline, viewport-clamped panel
 * (portaled to the body, like BlockTypePicker) anchored to the math editor's ƒ(x) toggle.
 * A type-to-filter input sits pinned at the top; below it the curated catalog is laid out
 * as categorized grids of glyph buttons.
 *
 * Each button shows the ACTUAL glyph — the entry's `latex` is rendered to inline MathML by
 * Temml, not printed as raw source — so the palette is scannable by sight; the human `name`
 * drives the tooltip, the aria-label, and the filter. Glyph rendering is gated on Temml
 * readiness (falling back to the raw `latex` text until then), mirroring MathBlock.
 *
 * Buttons commit their insert on MOUSEDOWN with preventDefault: that keeps focus on the
 * source textarea (never blurring it, which would fire its commit-on-blur and steal focus),
 * so the panel can inject a snippet and hand the caret straight back to the textarea.
 */
export function MathSymbolPalette({ anchorRect, onInsert, onClose }: MathSymbolPaletteProps) {
   const { t } = useLang()

   // Re-render once Temml finishes its one-time load, so glyphs replace the raw-text fallback.
   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   const [filterQuery, setFilterQuery] = useState('')
   const normalizedQuery = filterQuery.trim().toLowerCase()

   // Case-insensitive match across every category, on both the human name and the LaTeX.
   const matches = (entry: MathSymbolEntry): boolean =>
      normalizedQuery === '' ||
      entry.name.toLowerCase().includes(normalizedQuery) ||
      entry.latex.toLowerCase().includes(normalizedQuery)

   // Groups drive rendering (a header + its glyph grid); empty groups drop out while filtering.
   const groups = MATH_SYMBOL_CATEGORIES
      .map(category => ({ key: category.key, entries: category.entries.filter(matches) }))
      .filter(group => group.entries.length > 0)

   const categoryLabels: Record<MathSymbolCategoryKey, string> = {
      greek:          t.blockMathCategoryGreek,
      operators:      t.blockMathCategoryOperators,
      bigOperators:   t.blockMathCategoryBigOperators,
      fractionsRoots: t.blockMathCategoryFractions,
      scripts:        t.blockMathCategoryScripts,
      matrices:       t.blockMathCategoryMatrices,
      arrows:         t.blockMathCategoryArrows,
      accentsMisc:    t.blockMathCategoryAccents,
   }

   // Measured, two-sided clamp on both axes: flips above/below the trigger, then keeps the
   // panel fully on-screen even when neither side has enough room (shared with BlockTypePicker).
   const { ref: panelRef, top, left } = useViewportClampedPosition<HTMLDivElement>({
      type: 'rect', rect: anchorRect,
   })
   const openAbove = top < anchorRect.top

   const filterInputRef = useRef<HTMLInputElement>(null)
   useEffect(() => {
      filterInputRef.current?.focus()
   }, [])

   // Escape closes; the handler stops propagation so it does not also reach the block/editor.
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onClose])

   // Outside click closes. A glyph button's mousedown is preventDefault'd (so it never blurs
   // the textarea), but it still bubbles as a pointerdown — the contains() check keeps clicks
   // inside the panel from closing it.
   useEffect(() => {
      function onPointerDown(event: PointerEvent) {
         if (!panelRef.current?.contains(event.target as Node)) onClose()
      }
      document.addEventListener('pointerdown', onPointerDown)
      return () => document.removeEventListener('pointerdown', onPointerDown)
   }, [onClose, panelRef])

   return createPortal(
      <div
         ref={panelRef}
         className="math-symbol-palette"
         style={{
            top, left, width: PALETTE_WIDTH, maxHeight: PANEL_MAX_HEIGHT,
            animation: 'menu-in 120ms ease-out both',
            transformOrigin: openAbove ? '50% 100%' : '50% 0%',
         }}
      >
         <input
            ref={filterInputRef}
            type="text"
            value={filterQuery}
            onChange={event => setFilterQuery(event.target.value)}
            placeholder={t.blockMathSymbolFilter}
            className="math-symbol-palette-filter"
         />

         {/* Scroll lives on this INNER element, not the rounded outer box, so the scrollbar
             never squares off the rounded corners it would otherwise sit on. */}
         <div className="math-symbol-palette-scroll">
            {groups.length === 0 && (
               <div className="math-symbol-palette-empty">{t.blockMathSymbolNoMatches}</div>
            )}
            {groups.map(group => (
               <div key={group.key} className="math-symbol-palette-group">
                  <div className="math-symbol-palette-heading">{categoryLabels[group.key]}</div>
                  <div className="math-symbol-palette-grid">
                     {group.entries.map(entry => {
                        const rendered = temmlReady ? renderLatexToMathML(entry.latex, false) : null
                        return (
                           <button
                              key={entry.name}
                              type="button"
                              className="math-symbol-palette-btn"
                              title={entry.name}
                              aria-label={entry.name}
                              // MOUSEDOWN + preventDefault: do NOT blur the source textarea
                              // (which would commit-on-blur and steal focus). The click still
                              // inserts and the injection hands the caret back to the textarea.
                              onMouseDown={event => { event.preventDefault(); onInsert(entry.insert) }}
                           >
                              {rendered?.ok
                                 ? <span dangerouslySetInnerHTML={{ __html: rendered.mathml }} />
                                 : <span className="math-symbol-palette-raw">{entry.latex}</span>}
                           </button>
                        )
                     })}
                  </div>
               </div>
            ))}
         </div>
      </div>,
      document.body,
   )
}

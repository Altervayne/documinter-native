import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Grid3x3, Braces, Rows3 } from 'lucide-react'
import { renderLatexToMathML, isTemmlReady, onTemmlReady } from '../lib/math'
import { MATH_SYMBOL_CATEGORIES } from '../lib/mathSymbols'
import type { MathSymbolCategoryKey, MathSymbolEntry } from '../lib/mathSymbols'
import type { MathBuilderKind } from '../lib/mathStructures'
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

interface MathSymbolPaletteContentProps {
   /** Splice a snippet's `insert` string into the source at the current caret/selection. */
   onInsert: (insert: string) => void
   /**
    * Open the structured-construct builder for `kind`. Wired to the dedicated generator
    * launcher row (only shown when `showGenerators` is true), NOT to catalog entries, every
    * catalog entry now inserts its raw skeleton like any other symbol.
    */
   onOpenBuilder: (kind: MathBuilderKind) => void
   /**
    * Whether to render the "Generate…" launcher row (matrix / cases / aligned builders). True
    * in the editor context; false when the palette is opened from INSIDE a builder modal, the
    * recursion guard, so a builder can never offer to open another builder.
    */
   showGenerators: boolean
   /**
    * Focus the filter input on mount. True for the anchored popover (the palette is the active
    * surface, so type-to-filter should be ready). False for the draggable window, which is a
    * persistent TOOL beside the math source, it must NOT steal focus so the user keeps typing
    * LaTeX in the textarea while clicking symbols.
    */
   autoFocusFilter: boolean
}

// The anchored popover ALWAYS autofocuses its filter (it's the active surface), so it hardcodes
// `autoFocusFilter={true}` internally and does not expose it, Omit keeps callers from having to
// pass a prop the shell discards.
interface MathSymbolPaletteProps extends Omit<MathSymbolPaletteContentProps, 'autoFocusFilter'> {
   /** The trigger button's viewport rect; the panel clamps itself around it. */
   anchorRect: DOMRect
   /** Close the palette (Escape / outside click). */
   onClose: () => void
}

/** The three structured builders the launcher row can open, paired with their icons. */
const GENERATOR_LAUNCHERS: { kind: MathBuilderKind; Icon: typeof Grid3x3 }[] = [
   { kind: 'matrix',  Icon: Grid3x3 },
   { kind: 'cases',   Icon: Braces  },
   { kind: 'aligned', Icon: Rows3   },
]

// ####################
// # CONTENT COMPONENT #
// ####################

/**
 * The presentation-agnostic BODY of the symbol palette: the type-to-filter input, the pinned
 * generator launcher row, and the scrollable categorized grids of glyph buttons, plus all the
 * insertion wiring. It owns NO shell behavior (no portal, no viewport clamp, no Escape, no
 * outside-click). Whatever hosts it supplies the frame:
 *  - the anchored popover `MathSymbolPalette` (below) wraps it in a portaled, clamped box;
 *  - the math block wraps it in a draggable `BlockEditorWindow`, which owns drag / Escape / close.
 *
 * Each button shows the ACTUAL glyph, the entry's `latex` is rendered to inline MathML by Temml,
 * not printed as raw source, so the palette is scannable by sight; the human `name` drives the
 * tooltip, the aria-label, and the filter. Glyph rendering is gated on Temml readiness (falling
 * back to the raw `latex` text until then), mirroring MathBlock.
 *
 * Buttons commit their insert on MOUSEDOWN with preventDefault: that keeps focus on the source
 * textarea (never blurring it, which would fire its commit-on-blur and steal focus), so the panel
 * can inject a snippet and hand the caret straight back to the textarea.
 */
export function MathSymbolPaletteContent({ onInsert, onOpenBuilder, showGenerators, autoFocusFilter }: MathSymbolPaletteContentProps) {
   const { t } = useLang()

   // Re-render once Temml finishes its one-time load, so glyphs replace the raw-text fallback.
   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   const [filterQuery, setFilterQuery] = useState('')
   const normalizedQuery = filterQuery.trim().toLowerCase()
   const isFiltering     = normalizedQuery !== ''

   // Accordion state: the set of expanded categories. Default empty so the panel opens compact
   // (all collapsed). While filtering, every matching category is FORCED open regardless of the
   // set, search must surface matches instantly, without mutating the set the user built up.
   const [expandedKeys, setExpandedKeys] = useState<Set<MathSymbolCategoryKey>>(() => new Set())
   function toggleCategory(key: MathSymbolCategoryKey): void {
      setExpandedKeys(current => {
         const next = new Set(current)
         if (next.has(key)) next.delete(key)
         else next.add(key)
         return next
      })
   }

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
      greek:            t.blockMathCategoryGreek,
      operators:        t.blockMathCategoryOperators,
      relations:        t.blockMathCategoryRelations,
      negatedRelations: t.blockMathCategoryNegatedRelations,
      arrows:           t.blockMathCategoryArrows,
      bigOperators:     t.blockMathCategoryBigOperators,
      fractionsRoots:   t.blockMathCategoryFractions,
      accents:          t.blockMathCategoryAccents,
      matrices:         t.blockMathCategoryMatrices,
      fonts:            t.blockMathCategoryFonts,
      symbolsMisc:      t.blockMathCategorySymbols,
   }

   const generatorLabels: Record<MathBuilderKind, string> = {
      matrix:  t.blockMathGenerateMatrix,
      cases:   t.blockMathGenerateCases,
      aligned: t.blockMathGenerateAligned,
   }

   // Optional filter autofocus. Skipped in window mode so the palette never steals focus from the
   // math source textarea the user is typing in.
   const filterInputRef = useRef<HTMLInputElement>(null)
   useEffect(() => {
      if (autoFocusFilter) filterInputRef.current?.focus()
   }, [autoFocusFilter])

   return (
      <div className="math-symbol-palette-content">
         <input
            ref={filterInputRef}
            type="text"
            value={filterQuery}
            onChange={event => setFilterQuery(event.target.value)}
            placeholder={t.blockMathSymbolFilter}
            className="math-symbol-palette-filter"
         />

         {/* Generator launcher row, pinned under the filter, OUTSIDE the scroll area so it is
             always reachable. Hidden inside a builder (showGenerators === false) so a builder can
             never open another builder. MOUSEDOWN + preventDefault mirrors the glyph buttons:
             MathBlock snapshots the textarea caret on open, so the source must not blur here. */}
         {showGenerators && (
            <div className="math-symbol-palette-generators">
               <div className="math-symbol-palette-generator-heading">{t.blockMathGenerateHeading}</div>
               <div className="math-symbol-palette-generator-row">
                  {GENERATOR_LAUNCHERS.map(({ kind, Icon }) => (
                     <button
                        key={kind}
                        type="button"
                        className="math-symbol-palette-generator-btn"
                        title={generatorLabels[kind]}
                        aria-label={generatorLabels[kind]}
                        onMouseDown={event => { event.preventDefault(); onOpenBuilder(kind) }}
                     >
                        <Icon size={14} />
                        <span>{generatorLabels[kind]}</span>
                     </button>
                  ))}
               </div>
            </div>
         )}

         {/* Scroll lives on this INNER element, not the rounded outer box, so the scrollbar
             never squares off the rounded corners it would otherwise sit on. */}
         <div className="math-symbol-palette-scroll">
            {groups.length === 0 && (
               <div className="math-symbol-palette-empty">{t.blockMathSymbolNoMatches}</div>
            )}
            {groups.map(group => {
               // A category renders its grid only when open. Filtering forces every match open so
               // search surfaces everything instantly, without touching the user's expanded set.
               const isOpen = isFiltering || expandedKeys.has(group.key)
               return (
               <div key={group.key} className="math-symbol-palette-group">
                  <button
                     type="button"
                     className="math-symbol-palette-heading"
                     aria-expanded={isOpen}
                     aria-label={categoryLabels[group.key]}
                     // MOUSEDOWN + preventDefault keeps focus on the filter input (never blurs it),
                     // so toggling a section does not disturb the type-to-filter flow.
                     onMouseDown={event => event.preventDefault()}
                     onClick={() => toggleCategory(group.key)}
                  >
                     <ChevronRight
                        size={13}
                        className="math-symbol-palette-chevron"
                        style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
                     />
                     <span className="math-symbol-palette-heading-label">{categoryLabels[group.key]}</span>
                     <span className="math-symbol-palette-heading-count">{group.entries.length}</span>
                  </button>
                  {isOpen && (
                  <div className="math-symbol-palette-grid">
                     {group.entries.map(entry => {
                        const rendered = temmlReady ? renderLatexToMathML(entry.latex, false) : null
                        // Defensive fallback. Only inject MathML when Temml rendered cleanly
                        // (ok === true). Otherwise show text, never `dangerouslySetInnerHTML`
                        // of anything but verified-good markup, so a stray unsupported command
                        // can never paint a broken or blank button. While Temml is still loading
                        // (rendered === null) the raw LaTeX reads best; once it is ready and a
                        // render explicitly FAILED, the human name is the clearer fallback.
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
                                 : (
                                    <span className="math-symbol-palette-raw">
                                       {rendered ? entry.name : entry.latex}
                                    </span>
                                 )}
                           </button>
                        )
                     })}
                  </div>
                  )}
               </div>
               )
            })}
         </div>
      </div>
   )
}

// ###################
// # POPOVER COMPONENT #
// ###################

/**
 * Anchored-popover presentation of the symbol palette: an inline, viewport-clamped panel (portaled
 * to the body, like BlockTypePicker) anchored to a trigger button, that closes on Escape or an
 * outside click. It owns the SHELL behavior and hosts `MathSymbolPaletteContent` for the body.
 *
 * This is the presentation used by the math builder modal (filling cells). The math block itself
 * now hosts the CONTENT in a draggable BlockEditorWindow instead.
 */
export function MathSymbolPalette({ anchorRect, onInsert, onOpenBuilder, showGenerators, onClose }: MathSymbolPaletteProps) {
   // Measured, two-sided clamp on both axes: flips above/below the trigger, then keeps the
   // panel fully on-screen even when neither side has enough room (shared with BlockTypePicker).
   const { ref: panelRef, top, left } = useViewportClampedPosition<HTMLDivElement>({
      type: 'rect', rect: anchorRect,
   })
   const openAbove = top < anchorRect.top

   // Escape closes; the handler stops propagation so it does not also reach the block/editor.
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onClose])

   // Outside click closes. A glyph button's mousedown is preventDefault'd (so it never blurs
   // the textarea), but it still bubbles as a pointerdown, the contains() check keeps clicks
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
         <MathSymbolPaletteContent
            onInsert={onInsert}
            onOpenBuilder={onOpenBuilder}
            showGenerators={showGenerators}
            autoFocusFilter={true}
         />
      </div>,
      document.body,
   )
}

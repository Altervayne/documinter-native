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
   /** Open the structured-construct builder. Wired to the launcher row, not to catalog entries. */
   onOpenBuilder: (kind: MathBuilderKind) => void
   /** Render the "Generate..." launcher row. False inside a builder so it cannot open another. */
   showGenerators: boolean
   /** Focus the filter on mount. False for the draggable window, which must not steal focus from
    *  the math source textarea the user is typing in. */
   autoFocusFilter: boolean
}

interface MathSymbolPaletteProps extends Omit<MathSymbolPaletteContentProps, 'autoFocusFilter'> {
   /** The trigger's viewport rect; the panel clamps itself around it. */
   anchorRect: DOMRect
   onClose: () => void
}

const GENERATOR_LAUNCHERS: { kind: MathBuilderKind; Icon: typeof Grid3x3 }[] = [
   { kind: 'matrix',  Icon: Grid3x3 },
   { kind: 'cases',   Icon: Braces  },
   { kind: 'aligned', Icon: Rows3   },
]

// ####################
// # CONTENT COMPONENT #
// ####################

/**
 * Shell-agnostic body of the symbol palette: the type-to-filter input, the generator launcher row,
 * and the scrollable categorized glyph grids. It owns no shell behavior (no portal, clamp, Escape,
 * or outside-click); the host supplies the frame (the popover below, or a draggable BlockEditorWindow
 * on the math block). Each button renders the entry's `latex` to inline MathML via Temml so it is
 * scannable by sight, gated on Temml readiness (raw `latex` text until then). Buttons commit on
 * mousedown + preventDefault so the source textarea never blurs (which would fire commit-on-blur and
 * steal focus); the caret is handed straight back after the injection.
 */
export function MathSymbolPaletteContent({ onInsert, onOpenBuilder, showGenerators, autoFocusFilter }: MathSymbolPaletteContentProps) {
   const { t } = useLang()

   const [temmlReady, setTemmlReady] = useState(isTemmlReady())
   useEffect(() => onTemmlReady(() => setTemmlReady(true)), [])

   const [filterQuery, setFilterQuery] = useState('')
   const normalizedQuery = filterQuery.trim().toLowerCase()
   const isFiltering     = normalizedQuery !== ''

   // Default empty so the panel opens compact. Filtering forces every match open regardless of the
   // set, without mutating the set the user built up.
   const [expandedKeys, setExpandedKeys] = useState<Set<MathSymbolCategoryKey>>(() => new Set())
   function toggleCategory(key: MathSymbolCategoryKey): void {
      setExpandedKeys(current => {
         const next = new Set(current)
         if (next.has(key)) next.delete(key)
         else next.add(key)
         return next
      })
   }

   const matches = (entry: MathSymbolEntry): boolean =>
      normalizedQuery === '' ||
      entry.name.toLowerCase().includes(normalizedQuery) ||
      entry.latex.toLowerCase().includes(normalizedQuery)

   // Empty groups drop out while filtering.
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

         {/* Outside the scroll area so it stays reachable. Mousedown + preventDefault mirrors the
             glyph buttons so the snapshotted textarea caret is not lost to a blur. */}
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

         {/* Scroll on this inner element, not the rounded outer box, so the scrollbar never squares
             off the rounded corners. */}
         <div className="math-symbol-palette-scroll">
            {groups.length === 0 && (
               <div className="math-symbol-palette-empty">{t.blockMathSymbolNoMatches}</div>
            )}
            {groups.map(group => {
               const isOpen = isFiltering || expandedKeys.has(group.key)
               return (
               <div key={group.key} className="math-symbol-palette-group">
                  <button
                     type="button"
                     className="math-symbol-palette-heading"
                     aria-expanded={isOpen}
                     aria-label={categoryLabels[group.key]}
                     // Mousedown + preventDefault keeps focus on the filter so toggling a section
                     // does not disturb the type-to-filter flow.
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
                        // Only inject MathML when Temml rendered cleanly, so a stray unsupported
                        // command can never paint a broken button. While loading, the raw LaTeX
                        // reads best; once ready and failed, the human name is the clearer fallback.
                        return (
                           <button
                              key={entry.name}
                              type="button"
                              className="math-symbol-palette-btn"
                              title={entry.name}
                              aria-label={entry.name}
                              // Mousedown + preventDefault: do not blur the source textarea (which
                              // would commit-on-blur and steal focus); the insert still fires.
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
 * Anchored-popover presentation of the symbol palette: a viewport-clamped panel portaled to the
 * body, anchored to a trigger, closing on Escape or an outside click. Used by the math builder
 * modal; the math block hosts the content in a draggable BlockEditorWindow instead.
 */
export function MathSymbolPalette({ anchorRect, onInsert, onOpenBuilder, showGenerators, onClose }: MathSymbolPaletteProps) {
   // Two-sided clamp: flips above/below the trigger, then keeps the panel on-screen when neither
   // side fits (shared with BlockTypePicker).
   const { ref: panelRef, top, left } = useViewportClampedPosition<HTMLDivElement>({
      type: 'rect', rect: anchorRect,
   })
   const openAbove = top < anchorRect.top

   // Escape closes; stop propagation so it does not also reach the block/editor.
   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [onClose])

   // Outside click closes. A glyph mousedown is preventDefault'd but still bubbles as a
   // pointerdown; the contains() check keeps clicks inside the panel from closing it.
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

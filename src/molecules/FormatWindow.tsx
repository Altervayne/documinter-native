// -- Library Imports --
import { Ruler, Infinity as InfinityIcon, RectangleVertical, RectangleHorizontal, Ban, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'

// -- Component / Hook Imports --
import { BlockEditorWindow } from './BlockEditorWindow'
import { SliderWithNumberInput } from '../atoms/SliderWithNumberInput'
import { SegmentedIconToggle, type SegmentedIconToggleOption } from '../atoms/SegmentedIconToggle'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import {
   normalizeFormat,
   resolveInfiniteWidthPx,
   DEFAULT_A4_MARGINS,
   INFINITE_WIDTH_CUSTOM_MIN_PX,
   INFINITE_WIDTH_CUSTOM_MAX_PX,
   type DocFormat,
   type InfiniteWidth,
   type PageKind,
   type PageNumberAlign,
   type PageNumberStyle,
   type PageNumbering,
} from '../lib/format'
import { PAGE_NUMBER_STYLES } from '../lib/pageNumbering'

// #########
// # TYPES #
// #########

interface FormatWindowProps {
   /** The active document's format (undefined = today's infinite/normal-width default). */
   format?: DocFormat
   /** The anchor rect the window opens offset from (a degenerate rect = viewport-centered). */
   anchorRect: DOMRect
   /** Commit a new format object (or undefined to clear it back to the default), a real document
    *  change, mirrors PresentationWindow's onChange. */
   onChange: (next: DocFormat | undefined) => void
   /** Close the window. */
   onClose: () => void
}

type WidthChoice = 'narrow' | 'normal' | 'wide' | 'custom'

// A uniform-margin slider window (all four sides equal): the common Phase-2 case. Per-side margins
// are carried on the model but a per-side editor is deferred.
const MARGIN_MIN_MM = 0
const MARGIN_MAX_MM = 40

// #############
// # COMPONENT #
// #############

/**
 * The document-level Page setup editor: a NON-MODAL draggable window (reusing BlockEditorWindow /
 * useDraggableWindow), mirroring PresentationWindow / NavWindow. PHASE 2 exposes the format KIND
 * (Infinite / A4 Portrait / A4 Landscape) plus the infinite-canvas WIDTH (infinite only) and the page
 * MARGINS (A4 only). Switching kind is non-destructive: the section/block content is untouched, and
 * any page breaks (format.pages) ride along across a kind switch (they simply aren't rendered in
 * infinite mode), so an A4 → infinite → A4 round-trip preserves the pagination.
 */
export function FormatWindow({ format, anchorRect, onChange, onClose }: FormatWindowProps) {
   const { t } = useLang()
   // Normalize defensively so the controls always read a concrete, valid format, mirroring how
   // PresentationWindow reads straight off the (already-optional) presentation prop.
   const resolved = normalizeFormat(format)
   const kind = resolved.kind
   const isInfinite = kind === 'infinite'

   const width = resolved.width ?? 'normal'
   const isCustom = typeof width === 'object'
   const customWidthPx = isCustom ? width.custom : resolveInfiniteWidthPx(width)

   // Margins default to the shipped 20mm all-round; the uniform slider tracks the top side (all four
   // are kept equal by this control).
   const margins = resolved.margins ?? DEFAULT_A4_MARGINS
   const uniformMarginMm = margins.top

   function applyWidth(nextWidth: InfiniteWidth): void {
      onChange({ ...resolved, kind: 'infinite', width: nextWidth })
   }

   function handleChoiceChange(choice: WidthChoice): void {
      if (choice === 'custom') applyWidth({ custom: customWidthPx })
      else applyWidth(choice)
   }

   function handleKindChange(nextKind: PageKind): void {
      // Preserve width / margins / pages across the switch (each is ignored by the other kind, but
      // keeping them makes the switch reversible without data loss).
      onChange({ ...resolved, kind: nextKind })
   }

   function handleMarginChange(nextMm: number): void {
      onChange({ ...resolved, margins: { top: nextMm, right: nextMm, bottom: nextMm, left: nextMm } })
   }

   // ==========================
   //  Page numbering (A4 only)
   // ==========================
   const pageNumbering = resolved.pageNumbering
   type EdgeChoice = 'off' | PageNumberAlign

   // Commit a whole pageNumbering object, or clear it (both edges off ⇒ remove the field entirely).
   function applyPageNumbering(next: PageNumbering | undefined): void {
      const withoutNumbering = { ...resolved }
      delete withoutNumbering.pageNumbering
      onChange(next ? { ...withoutNumbering, pageNumbering: next } : withoutNumbering)
   }

   function setEdge(edge: 'top' | 'bottom', choice: EdgeChoice): void {
      const nextSlot = choice === 'off' ? undefined : { align: choice }
      const top    = edge === 'top'    ? nextSlot : pageNumbering?.top
      const bottom = edge === 'bottom' ? nextSlot : pageNumbering?.bottom
      if (!top && !bottom) { applyPageNumbering(undefined); return }
      applyPageNumbering({ style: pageNumbering?.style ?? 'plain', ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) })
   }

   function setStyle(style: PageNumberStyle): void {
      if (pageNumbering) applyPageNumbering({ ...pageNumbering, style })
   }

   // Off / Left / Center / Right as icon buttons (parity with the format-kind toggle).
   const edgeOptions: SegmentedIconToggleOption<EdgeChoice>[] = [
      { value: 'off',    label: t.formatPageNumberOff,         icon: <Ban size={15} /> },
      { value: 'left',   label: t.formatPageNumberAlignLeft,   icon: <AlignLeft size={15} /> },
      { value: 'center', label: t.formatPageNumberAlignCenter, icon: <AlignCenter size={15} /> },
      { value: 'right',  label: t.formatPageNumberAlignRight,  icon: <AlignRight size={15} /> },
   ]
   const styleLabels: Record<PageNumberStyle, string> = {
      plain:  t.pageNumberStylePlain,
      page:   t.pageNumberStylePage,
      slash:  t.pageNumberStyleSlash,
      pageOf: t.pageNumberStylePageOf,
      dashes: t.pageNumberStyleDashes,
   }
   const topChoice:    EdgeChoice = pageNumbering?.top?.align    ?? 'off'
   const bottomChoice: EdgeChoice = pageNumbering?.bottom?.align ?? 'off'

   const widthLabels: Record<WidthChoice, string> = {
      narrow: t.formatWidthNarrow,
      normal: t.formatWidthNormal,
      wide:   t.formatWidthWide,
      custom: t.formatWidthCustom,
   }
   const currentChoice: WidthChoice = isCustom ? 'custom' : width

   return (
      <BlockEditorWindow
         title={t.formatWindowTitle}
         icon={<Ruler size={15} />}
         anchorRect={anchorRect}
         onClose={onClose}
      >
         <div className="presentation-editor">
            {/* Format kind: Infinite / A4 Portrait / A4 Landscape. */}
            <section className="presentation-section">
               <span className="presentation-section-label">{t.formatKindLabel}</span>
               <p className="presentation-hint">{t.formatKindHint}</p>
               <SegmentedIconToggle<PageKind>
                  ariaLabel={t.formatKindLabel}
                  value={kind}
                  onChange={handleKindChange}
                  options={[
                     { value: 'infinite',      label: t.formatKindInfinite,     icon: <InfinityIcon size={15} /> },
                     { value: 'a4-portrait',   label: t.formatKindA4Portrait,   icon: <RectangleVertical size={15} /> },
                     { value: 'a4-landscape',  label: t.formatKindA4Landscape,  icon: <RectangleHorizontal size={15} /> },
                  ]}
               />
            </section>

            {/* Infinite width (infinite only). */}
            {isInfinite && (
               <section className="presentation-section">
                  <span className="presentation-section-label">{t.formatWidthLabel}</span>
                  <p className="presentation-hint">{t.formatWidthHint}</p>

                  <label className="presentation-field">
                     <span className="presentation-field-label">{t.formatWidthLabel}</span>
                     <select
                        className="presentation-select"
                        value={currentChoice}
                        onChange={event => handleChoiceChange(event.target.value as WidthChoice)}
                     >
                        {(['narrow', 'normal', 'wide', 'custom'] as const).map(choice => (
                           <option key={choice} value={choice}>{widthLabels[choice]}</option>
                        ))}
                     </select>
                  </label>

                  {isCustom && (
                     <SliderWithNumberInput
                        label={t.formatWidthCustomValue}
                        min={INFINITE_WIDTH_CUSTOM_MIN_PX}
                        max={INFINITE_WIDTH_CUSTOM_MAX_PX}
                        step={10}
                        value={customWidthPx}
                        unit="px"
                        onChange={next => applyWidth({ custom: next })}
                     />
                  )}
               </section>
            )}

            {/* Page margins (A4 only). Uniform (all four sides equal) this phase. */}
            {!isInfinite && (
               <section className="presentation-section">
                  <span className="presentation-section-label">{t.formatMarginsLabel}</span>
                  <p className="presentation-hint">{t.formatMarginsHint}</p>
                  <SliderWithNumberInput
                     label={t.formatMarginsValue}
                     min={MARGIN_MIN_MM}
                     max={MARGIN_MAX_MM}
                     step={1}
                     value={uniformMarginMm}
                     unit="mm"
                     onChange={handleMarginChange}
                  />
               </section>
            )}

            {/* Page numbering (A4 only). Top + bottom are independent edges; each is Off or L/C/R.
                The number style is offered once at least one edge is on. */}
            {!isInfinite && (
               <section className="presentation-section">
                  <span className="presentation-section-label">{t.formatPageNumberLabel}</span>
                  <p className="presentation-hint">{t.formatPageNumberHint}</p>

                  <div className="flex flex-col gap-1.5 mt-1">
                     <span className="presentation-field-label">{t.formatPageNumberTop}</span>
                     <SegmentedIconToggle<EdgeChoice>
                        ariaLabel={t.formatPageNumberTop}
                        value={topChoice}
                        onChange={choice => setEdge('top', choice)}
                        options={edgeOptions}
                     />
                  </div>

                  <div className="flex flex-col gap-1.5 mt-1">
                     <span className="presentation-field-label">{t.formatPageNumberBottom}</span>
                     <SegmentedIconToggle<EdgeChoice>
                        ariaLabel={t.formatPageNumberBottom}
                        value={bottomChoice}
                        onChange={choice => setEdge('bottom', choice)}
                        options={edgeOptions}
                     />
                  </div>

                  {pageNumbering && (
                     <label className="presentation-field">
                        <span className="presentation-field-label">{t.formatPageNumberStyle}</span>
                        <select
                           className="presentation-select"
                           value={pageNumbering.style}
                           onChange={event => setStyle(event.target.value as PageNumberStyle)}
                        >
                           {PAGE_NUMBER_STYLES.map(style => (
                              <option key={style} value={style}>{styleLabels[style]}</option>
                           ))}
                        </select>
                     </label>
                  )}
               </section>
            )}
         </div>
      </BlockEditorWindow>
   )
}

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
   resolveHeader,
   DEFAULT_A4_MARGINS,
   INFINITE_WIDTH_CUSTOM_MIN_PX,
   INFINITE_WIDTH_CUSTOM_MAX_PX,
   type DocFormat,
   type InfiniteWidth,
   type PageKind,
   type PageNumberStyle,
   type PageBand,
   type BandPosition,
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

// A uniform-margin slider window (all four sides equal), the common case. Per-side margins are
// carried on the model but a per-side editor is deferred.
const MARGIN_MIN_MM = 0
const MARGIN_MAX_MM = 40

// #############
// # COMPONENT #
// #############

/**
 * The document-level Page setup editor: a NON-MODAL draggable window (reusing BlockEditorWindow /
 * useDraggableWindow), mirroring PresentationWindow / NavWindow. It exposes the format KIND
 * (Infinite / A4 Portrait / A4 Landscape) plus the infinite-canvas WIDTH (infinite only) and the page
 * MARGINS (A4 only). Switching kind is non-destructive: the section/block content is untouched, and
 * any page breaks (format.pages) ride along across a kind switch (they simply aren't rendered in
 * infinite mode), so an A4 -> infinite -> A4 round-trip preserves the pagination.
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

   // Margins default to 20mm on every side; the uniform slider tracks the top side (all four
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
   //  Header + footer bands (A4 only)
   // ==========================
   type PositionChoice = 'off' | BandPosition
   const positions: BandPosition[] = ['left', 'center', 'right']
   const styleLabels: Record<PageNumberStyle, string> = {
      plain:  t.pageNumberStylePlain,
      page:   t.pageNumberStylePage,
      slash:  t.pageNumberStyleSlash,
      pageOf: t.pageNumberStylePageOf,
      dashes: t.pageNumberStyleDashes,
   }
   // Page-number format examples read as text (the label IS the glyph), so no leading icon.
   const styleOptions: SegmentedIconToggleOption<PageNumberStyle>[] = PAGE_NUMBER_STYLES.map(style => ({ value: style, label: styleLabels[style] }))

   // Off / Left / Center / Right position buttons; `blocked` greys out the position the sibling control
   // already holds, so a header page number and header text can never share a position.
   function positionOptions(blocked: PositionChoice): SegmentedIconToggleOption<PositionChoice>[] {
      return [
         { value: 'off',    label: t.formatBandNone,   icon: <Ban size={15} /> },
         { value: 'left',   label: t.formatBandLeft,   icon: <AlignLeft size={15} />,   disabled: blocked === 'left' },
         { value: 'center', label: t.formatBandCenter, icon: <AlignCenter size={15} />, disabled: blocked === 'center' },
         { value: 'right',  label: t.formatBandRight,  icon: <AlignRight size={15} />,  disabled: blocked === 'right' },
      ]
   }

   // Read the one optional page number / text item out of a band.
   function readNumber(band: PageBand): { position: PositionChoice; style: PageNumberStyle } {
      for (const position of positions) if (band[position]?.kind === 'pageNumber') return { position, style: (band[position] as { style: PageNumberStyle }).style }
      return { position: 'off', style: 'plain' }
   }
   function readText(band: PageBand): { position: PositionChoice; text: string } {
      for (const position of positions) if (band[position]?.kind === 'content') return { position, text: (band[position] as { text?: string }).text ?? '' }
      return { position: 'off', text: '' }
   }

   const header       = resolveHeader(resolved)
   const headerNumber = readNumber(header)
   const headerText   = readText(header)
   const footerNumber = readNumber(resolved.footer ?? {})

   // Rebuild the whole header from its two controls, so setting one never disturbs the other.
   function commitHeader(number: { position: PositionChoice; style: PageNumberStyle }, text: { position: PositionChoice; text: string }): void {
      const next: PageBand = {}
      if (number.position !== 'off') next[number.position] = { kind: 'pageNumber', style: number.style }
      if (text.position !== 'off')   next[text.position]   = { kind: 'content', text: text.text }
      onChange({ ...resolved, header: next })
   }
   // Footer: the credit always shows (auto-placed); the only control is an optional page number.
   function setFooterNumber(position: PositionChoice, style: PageNumberStyle): void {
      onChange({ ...resolved, footer: position === 'off' ? {} : { [position]: { kind: 'pageNumber', style } } })
   }

   // A page-number control (position + style), shared by the header and footer sections.
   function renderNumberControl(value: { position: PositionChoice; style: PageNumberStyle }, blocked: PositionChoice, onPosition: (position: PositionChoice) => void, onStyle: (style: PageNumberStyle) => void): React.ReactNode {
      return (
         <div className="flex flex-col gap-1.5 mt-1">
            <span className="presentation-field-label">{t.formatBandPageNumber}</span>
            <SegmentedIconToggle<PositionChoice> ariaLabel={t.formatBandPageNumber} value={value.position} onChange={onPosition} options={positionOptions(blocked)} />
            {value.position !== 'off' && (
               <SegmentedIconToggle<PageNumberStyle> ariaLabel={t.formatPageNumberStyle} value={value.style} onChange={onStyle} options={styleOptions} />
            )}
         </div>
      )
   }

   function renderHeaderEditor(): React.ReactNode {
      return (
         <section className="presentation-section">
            <span className="presentation-section-label">{t.formatHeaderLabel}</span>
            {renderNumberControl(headerNumber, headerText.position, position => commitHeader({ ...headerNumber, position }, headerText), style => commitHeader({ position: headerNumber.position, style }, headerText))}
            <div className="flex flex-col gap-1.5 mt-1">
               <span className="presentation-field-label">{t.formatBandText}</span>
               <SegmentedIconToggle<PositionChoice> ariaLabel={t.formatBandText} value={headerText.position} onChange={position => commitHeader(headerNumber, { ...headerText, position })} options={positionOptions(headerNumber.position)} />
               {headerText.position !== 'off' && (
                  <input
                     type="text"
                     className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-text"
                     value={headerText.text}
                     placeholder={t.formatBandTextPlaceholder}
                     onChange={event => commitHeader(headerNumber, { position: headerText.position, text: event.target.value })}
                  />
               )}
            </div>
         </section>
      )
   }

   function renderFooterEditor(): React.ReactNode {
      return (
         <section className="presentation-section">
            <span className="presentation-section-label">{t.formatFooterLabel}</span>
            <p className="presentation-hint">{t.formatFooterHint}</p>
            {renderNumberControl(footerNumber, 'off', position => setFooterNumber(position, footerNumber.style), style => setFooterNumber(footerNumber.position, style))}
         </section>
      )
   }

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

            {/* Page margins (A4 only). Uniform: all four sides equal. */}
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

            {/* Running header + footer bands (A4 only): each shows on every page in the margin, with
                left / center / right positions holding a page number, custom text, or the credit. */}
            {!isInfinite && (
               <section className="presentation-section">
                  <span className="presentation-section-label">{t.formatBandsLabel}</span>
                  <p className="presentation-hint">{t.formatBandsHint}</p>
               </section>
            )}
            {!isInfinite && renderHeaderEditor()}
            {!isInfinite && renderFooterEditor()}
         </div>
      </BlockEditorWindow>
   )
}

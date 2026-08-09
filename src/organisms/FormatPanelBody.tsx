// -- React Imports --
import { useRef, useState } from 'react'

// -- Library Imports --
import { Infinity as InfinityIcon, RectangleVertical, RectangleHorizontal, Ban, AlignLeft, AlignCenter, AlignRight, Upload, Trash2, SquareEqual, Move, Frame } from 'lucide-react'

// -- Component / Hook Imports --
import { SliderWithNumberInput } from '../atoms/SliderWithNumberInput'
import { SegmentedIconToggle, type SegmentedIconToggleOption } from '../atoms/SegmentedIconToggle'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import {
   normalizeFormat,
   resolveInfiniteWidthPx,
   resolveHeader,
   deriveMarginMode,
   DEFAULT_A4_MARGINS,
   INFINITE_WIDTH_CUSTOM_MIN_PX,
   INFINITE_WIDTH_CUSTOM_MAX_PX,
   type DocFormat,
   type InfiniteWidth,
   type PageKind,
   type PageNumberStyle,
   type PageBand,
   type BandPosition,
   type BandImage,
   type MarginMode,
   type PageMargins,
} from '../lib/format'
import { PAGE_NUMBER_STYLES } from '../lib/pageNumbering'
import { downscaleImageToDataUrl } from '../lib/imageDownscale'
import { HEADER_LOGO_MAX_EDGE } from '../lib/presentation'

// #########
// # TYPES #
// #########

interface FormatPanelBodyProps {
   /** The active document's format (undefined = today's infinite/normal-width default). */
   format?: DocFormat
   /** Commit a new format object (or undefined to clear it back to the default), a real document
    *  change, mirrors PresentationPanelBody's onChange. */
   onChange: (next: DocFormat | undefined) => void
}

type WidthChoice = 'narrow' | 'normal' | 'wide' | 'custom'

// Shared clamp for every margin slider, regardless of editing mode.
const MARGIN_MIN_MM = 0
const MARGIN_MAX_MM = 40

// #############
// # COMPONENT #
// #############

/**
 * The document-level Page setup editor body, chrome-free so the same form serves both the floating
 * FormatWindow (Document -> Page setup...) and a docked side panel. It exposes the format KIND
 * (Infinite / A4 Portrait / A4 Landscape) plus the infinite-canvas WIDTH (infinite only) and the page
 * MARGINS (A4 only). Switching kind is non-destructive: the section/block content is untouched, and
 * any page breaks (format.pages) ride along across a kind switch (they simply aren't rendered in
 * infinite mode), so an A4 -> infinite -> A4 round-trip preserves the pagination.
 *
 * Margins are always four independent values on the model; the editor offers three ways to edit them
 * (all sides at once, vertical/horizontal pairs, or each side on its own), picked up from the current
 * values on open and held as local UI state (see deriveMarginMode in lib/format.ts).
 *
 * The outer `.doc-settings-panel` owns the scroll + padding so the body fills its host (a docked panel
 * or the floating window body, whose padding is neutralized for `.doc-settings-panel` in doc.css).
 */
export function FormatPanelBody({ format, onChange }: FormatPanelBodyProps) {
   const { t } = useLang()
   const logoInputRef = useRef<HTMLInputElement>(null)
   // Normalize defensively so the controls always read a concrete, valid format, mirroring how
   // PresentationPanelBody reads straight off the (already-optional) presentation prop.
   const resolved = normalizeFormat(format)
   const kind = resolved.kind
   const isInfinite = kind === 'infinite'

   const width = resolved.width ?? 'normal'
   const isCustom = typeof width === 'object'
   const customWidthPx = isCustom ? width.custom : resolveInfiniteWidthPx(width)

   // Margins default to 20mm on every side. The editing mode (how many inputs the editor shows) is
   // local UI state, derived once from the incoming margins when the editor opens, so a document
   // already using four equal or arbitrary margins opens on the view that matches without forcing a
   // choice; the model underneath always keeps four independent values regardless of mode.
   const margins = resolved.margins ?? DEFAULT_A4_MARGINS
   const uniformMarginMm = margins.top
   const [marginMode, setMarginMode] = useState<MarginMode>(() => deriveMarginMode(margins))

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

   function applyAllEqualMargin(nextMm: number): void {
      onChange({ ...resolved, margins: { top: nextMm, right: nextMm, bottom: nextMm, left: nextMm } })
   }

   function applyAxisMargin(axis: 'vertical' | 'horizontal', nextMm: number): void {
      const next: PageMargins = axis === 'vertical'
         ? { ...margins, top: nextMm, bottom: nextMm }
         : { ...margins, left: nextMm, right: nextMm }
      onChange({ ...resolved, margins: next })
   }

   function applySideMargin(side: keyof PageMargins, nextMm: number): void {
      onChange({ ...resolved, margins: { ...margins, [side]: nextMm } })
   }

   // Switching mode only reshapes how the four values are grouped for editing; it also coalesces
   // them so the new mode's inputs start from something coherent instead of an arbitrary spread.
   function handleMarginModeChange(nextMode: MarginMode): void {
      setMarginMode(nextMode)
      if (nextMode === 'allEqual') {
         applyAllEqualMargin(margins.top)
      } else if (nextMode === 'verticalHorizontal') {
         onChange({ ...resolved, margins: { top: margins.top, bottom: margins.top, left: margins.left, right: margins.left } })
      }
      // eachSide keeps the four values exactly as they are.
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
   function readText(band: PageBand): { position: PositionChoice; text: string; image?: BandImage } {
      for (const position of positions) {
         const item = band[position]
         if (item?.kind === 'content') return { position, text: item.text ?? '', image: item.image }
      }
      return { position: 'off', text: '' }
   }

   const header          = resolveHeader(resolved)
   const headerNumber    = readNumber(header)
   const modelHeaderText = readText(header)
   const footerNumber    = readNumber(resolved.footer ?? {})

   // An empty text/brand slot has no persistent model form (an item with neither text nor logo normalizes
   // away), so a freshly picked position would snap straight back to "None". Hold that intent in local UI
   // state until real text or a logo fills the slot; once the model carries content, the model wins.
   const [localTextPosition, setLocalTextPosition] = useState<PositionChoice>(modelHeaderText.position)
   const headerTextPosition = modelHeaderText.position !== 'off' ? modelHeaderText.position : localTextPosition
   const headerText = { position: headerTextPosition, text: modelHeaderText.text, image: modelHeaderText.image }

   // Rebuild the whole header from its two controls, so setting one never disturbs the other. The text
   // slot can carry text AND / OR a logo image.
   function commitHeader(number: { position: PositionChoice; style: PageNumberStyle }, text: { position: PositionChoice; text: string; image?: BandImage }): void {
      const next: PageBand = {}
      if (number.position !== 'off') next[number.position] = { kind: 'pageNumber', style: number.style }
      if (text.position !== 'off')   next[text.position]   = { kind: 'content', ...(text.text ? { text: text.text } : {}), ...(text.image ? { image: text.image } : {}) }
      onChange({ ...resolved, header: next })
   }
   // Pick a logo image for the header text/brand slot: downscale to base64 (capped small for a margin
   // band), keeping whatever text is already there.
   async function handleLogoFile(file: File | undefined): Promise<void> {
      if (!file || !file.type.startsWith('image/')) return
      const image = await downscaleImageToDataUrl(file, HEADER_LOGO_MAX_EDGE)
      commitHeader(headerNumber, { position: headerText.position, text: headerText.text, image })
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
               <SegmentedIconToggle<PositionChoice> ariaLabel={t.formatBandText} value={headerText.position} onChange={position => { setLocalTextPosition(position); commitHeader(headerNumber, { ...headerText, position }) }} options={positionOptions(headerNumber.position)} />
               {headerText.position !== 'off' && (
                  <>
                     <input
                        type="text"
                        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-text"
                        value={headerText.text}
                        placeholder={t.formatBandTextPlaceholder}
                        onChange={event => commitHeader(headerNumber, { position: headerText.position, text: event.target.value, image: headerText.image })}
                     />
                     <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={event => { void handleLogoFile(event.target.files?.[0]); event.target.value = '' }}
                     />
                     {headerText.image ? (
                        <div className="presentation-thumb-row">
                           <span className="presentation-thumb" style={{ backgroundImage: `url("${headerText.image.src}")` }} aria-hidden="true" />
                           <div className="presentation-thumb-actions">
                              <button type="button" className="presentation-btn" onClick={() => logoInputRef.current?.click()}>
                                 <Upload size={13} /> {t.formatBandLogoReplace}
                              </button>
                              <button type="button" className="presentation-btn presentation-btn-danger" onClick={() => commitHeader(headerNumber, { position: headerText.position, text: headerText.text, image: undefined })}>
                                 <Trash2 size={13} /> {t.formatBandLogoRemove}
                              </button>
                           </div>
                        </div>
                     ) : (
                        <button type="button" className="presentation-btn" onClick={() => logoInputRef.current?.click()}>
                           <Upload size={13} /> {t.formatBandLogoAdd}
                        </button>
                     )}
                  </>
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
      <div className="doc-settings-panel flex-1 min-h-0 overflow-y-auto" style={{ padding: '0.85rem 0.95rem' }}>
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

            {/* Page margins (A4 only). Three editing modes over the same four stored values: all equal
                (one input), vertical/horizontal (two paired inputs), or each side independently. */}
            {!isInfinite && (
               <section className="presentation-section">
                  <span className="presentation-section-label">{t.formatMarginsLabel}</span>
                  <p className="presentation-hint">{t.formatMarginsHint}</p>
                  <SegmentedIconToggle<MarginMode>
                     ariaLabel={t.formatMarginsLabel}
                     value={marginMode}
                     onChange={handleMarginModeChange}
                     options={[
                        { value: 'allEqual',           label: t.formatMarginModeAllEqual, icon: <SquareEqual size={15} /> },
                        { value: 'verticalHorizontal', label: t.formatMarginModeAxis,     icon: <Move size={15} /> },
                        { value: 'eachSide',            label: t.formatMarginModeEachSide, icon: <Frame size={15} /> },
                     ]}
                  />

                  {marginMode === 'allEqual' && (
                     <SliderWithNumberInput
                        label={t.formatMarginsValue}
                        min={MARGIN_MIN_MM}
                        max={MARGIN_MAX_MM}
                        step={1}
                        value={uniformMarginMm}
                        unit="mm"
                        onChange={applyAllEqualMargin}
                     />
                  )}

                  {marginMode === 'verticalHorizontal' && (
                     <>
                        <SliderWithNumberInput
                           label={t.formatMarginVertical}
                           min={MARGIN_MIN_MM}
                           max={MARGIN_MAX_MM}
                           step={1}
                           value={margins.top}
                           unit="mm"
                           onChange={next => applyAxisMargin('vertical', next)}
                        />
                        <SliderWithNumberInput
                           label={t.formatMarginHorizontal}
                           min={MARGIN_MIN_MM}
                           max={MARGIN_MAX_MM}
                           step={1}
                           value={margins.left}
                           unit="mm"
                           onChange={next => applyAxisMargin('horizontal', next)}
                        />
                     </>
                  )}

                  {marginMode === 'eachSide' && (
                     <>
                        <SliderWithNumberInput
                           label={t.formatMarginTop}
                           min={MARGIN_MIN_MM}
                           max={MARGIN_MAX_MM}
                           step={1}
                           value={margins.top}
                           unit="mm"
                           onChange={next => applySideMargin('top', next)}
                        />
                        <SliderWithNumberInput
                           label={t.formatMarginRight}
                           min={MARGIN_MIN_MM}
                           max={MARGIN_MAX_MM}
                           step={1}
                           value={margins.right}
                           unit="mm"
                           onChange={next => applySideMargin('right', next)}
                        />
                        <SliderWithNumberInput
                           label={t.formatMarginBottom}
                           min={MARGIN_MIN_MM}
                           max={MARGIN_MAX_MM}
                           step={1}
                           value={margins.bottom}
                           unit="mm"
                           onChange={next => applySideMargin('bottom', next)}
                        />
                        <SliderWithNumberInput
                           label={t.formatMarginLeft}
                           min={MARGIN_MIN_MM}
                           max={MARGIN_MAX_MM}
                           step={1}
                           value={margins.left}
                           unit="mm"
                           onChange={next => applySideMargin('left', next)}
                        />
                     </>
                  )}
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
      </div>
   )
}

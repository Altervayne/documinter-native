// -- React Imports --
import { useRef, useState } from 'react'

// -- Library Imports --
import { Trash2, Upload } from 'lucide-react'

// -- Component / Hook Imports --
import { SliderWithNumberInput } from '../atoms/SliderWithNumberInput'
import { useLang } from '../contexts/LangContext'

// -- Lib Imports --
import { downscaleImageToDataUrl } from '../lib/imageDownscale'
import {
   makeWatermark,
   makeHeader,
   applyLinkedWatermarkSpacing,
   WATERMARK_MIN_OPACITY,
   WATERMARK_MAX_OPACITY,
   WATERMARK_MIN_ROTATION,
   WATERMARK_MAX_ROTATION,
   WATERMARK_MIN_TILE_SIZE,
   WATERMARK_MAX_TILE_SIZE,
   WATERMARK_MIN_SPACING,
   WATERMARK_MAX_SPACING,
   WATERMARK_MIN_OFFSET,
   WATERMARK_MAX_OFFSET,
   WATERMARK_MIN_SIZE,
   WATERMARK_MAX_SIZE,
   WATERMARK_DEFAULT_SIZE,
   WATERMARK_DEFAULT_ASPECT_RATIO,
   HEADER_MIN_MAX_HEIGHT,
   HEADER_MAX_MAX_HEIGHT,
   HEADER_LOGO_MAX_EDGE,
   type DocPresentationExtras,
   type Watermark,
   type WatermarkPosition,
   type Header,
   type HeaderPlacement,
   type HeaderAlign,
   type HeaderLogoSide,
} from '../lib/presentation'

// #########
// # TYPES #
// #########

interface PresentationPanelBodyProps {
   /** The active document's presentation extras (undefined = none set yet). */
   presentation?: DocPresentationExtras
   /** Commit a new extras object (or undefined to clear all extras) - a real document change. */
   onChange: (next: DocPresentationExtras | undefined) => void
}

// #############
// # COMPONENT #
// #############

/**
 * The document-level Presentation editor body, chrome-free so the same form serves both the floating
 * PresentationWindow (Document -> Presentation...) and a docked side panel. Its controls mutate the
 * document's `presentation` object; the live PREVIEW is the watermark rendered behind the document
 * sheet, which updates as these controls change, so there is deliberately no in-editor preview (same
 * rationale as the graph editor window).
 *
 * Navigation lives in its own NavPanelBody (Document -> Navigation...), so this body covers
 * Watermark + Header only. The outer `.doc-settings-panel` owns the scroll + padding so the body fills
 * its host (a docked panel or the floating window body, whose padding is neutralized in doc.css).
 */
export function PresentationPanelBody({ presentation, onChange }: PresentationPanelBodyProps) {
   const watermark = presentation?.watermark
   const header = presentation?.header

   // Patch the watermark field, collapsing an emptied extras object back to undefined so no empty
   // shell lingers in storage / export.
   function updateWatermark(nextWatermark: Watermark | undefined): void {
      const nextExtras: DocPresentationExtras = { ...presentation, watermark: nextWatermark }
      if (!nextExtras.watermark) delete nextExtras.watermark
      onChange(Object.keys(nextExtras).length === 0 ? undefined : nextExtras)
   }

   // Patch the header field, same collapse-to-undefined convention as updateWatermark.
   function updateHeader(nextHeader: Header | undefined): void {
      const nextExtras: DocPresentationExtras = { ...presentation, header: nextHeader }
      if (!nextExtras.header) delete nextExtras.header
      onChange(Object.keys(nextExtras).length === 0 ? undefined : nextExtras)
   }

   return (
      <div className="doc-settings-panel flex-1 min-h-0 overflow-y-auto" style={{ padding: '0.85rem 0.95rem' }}>
         <div className="presentation-editor">
            <WatermarkSection watermark={watermark} onChange={updateWatermark} />
            <HeaderSection header={header} onChange={updateHeader} />
         </div>
      </div>
   )
}

// #####################
// # WATERMARK SECTION #
// #####################

interface WatermarkSectionProps {
   watermark: Watermark | undefined
   onChange:  (next: Watermark | undefined) => void
}

const POSITION_OPTIONS: WatermarkPosition[] = [
   'center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
]

function WatermarkSection({ watermark, onChange }: WatermarkSectionProps) {
   const { t } = useLang()
   const inputRef = useRef<HTMLInputElement>(null)
   // Local UI-only state: whether the spacing sliders are linked (one "density" knob driving
   // spacingX === spacingY) or unlinked (two independent per-axis sliders). Not persisted on the
   // model - spacingX/spacingY are always stored independently; this just controls the widget.
   const [spacingLinked, setSpacingLinked] = useState(true)

   async function handleFile(file: File | undefined): Promise<void> {
      if (!file || !file.type.startsWith('image/')) return
      const { src, width, height } = await downscaleImageToDataUrl(file)
      const aspectRatio = height > 0 ? width / height : WATERMARK_DEFAULT_ASPECT_RATIO
      // Keep the existing opacity / fit / tile / position / rotation / tile-size / spacing when
      // replacing; a fresh pick gets defaults (but always the freshly-picked image's own aspect ratio).
      onChange(watermark ? { ...watermark, src, aspectRatio } : makeWatermark(src, aspectRatio))
   }

   const positionLabels: Record<WatermarkPosition, string> = {
      'center':       t.presentationWatermarkPositionCenter,
      'top':          t.presentationWatermarkPositionTop,
      'bottom':       t.presentationWatermarkPositionBottom,
      'top-left':     t.presentationWatermarkPositionTopLeft,
      'top-right':    t.presentationWatermarkPositionTopRight,
      'bottom-left':  t.presentationWatermarkPositionBottomLeft,
      'bottom-right': t.presentationWatermarkPositionBottomRight,
   }

   return (
      <section className="presentation-section">
         <span className="presentation-section-label">{t.presentationWatermarkSection}</span>

         {/* Hidden picker, driven by the choose / replace buttons below. */}
         <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = '' }}
         />

         {!watermark ? (
            // Empty state: just the picker + a hint. No watermark renders behind the sheet yet.
            <div className="presentation-empty">
               <button type="button" className="presentation-btn" onClick={() => inputRef.current?.click()}>
                  <Upload size={13} />{t.presentationWatermarkChoose}
               </button>
               <p className="presentation-hint">{t.presentationWatermarkEmptyHint}</p>
            </div>
         ) : (
            <>
               {/* A small thumbnail of the chosen asset (app-chrome - shows the raw image, not the
                   themed live watermark, which previews behind the document sheet). */}
               <div className="presentation-thumb-row">
                  <span className="presentation-thumb" style={{ backgroundImage: `url("${watermark.src}")` }} aria-hidden="true" />
                  <div className="presentation-thumb-actions">
                     <button type="button" className="presentation-btn" onClick={() => inputRef.current?.click()}>
                        <Upload size={13} />{t.presentationWatermarkReplace}
                     </button>
                     <button type="button" className="presentation-btn presentation-btn-danger" onClick={() => onChange(undefined)}>
                        <Trash2 size={13} />{t.presentationWatermarkRemove}
                     </button>
                  </div>
               </div>

               {/* Opacity (clamped for legibility); typed/shown as a whole-number percent. */}
               <SliderWithNumberInput
                  label={t.presentationWatermarkOpacity}
                  min={WATERMARK_MIN_OPACITY}
                  max={WATERMARK_MAX_OPACITY}
                  step={0.01}
                  value={watermark.opacity}
                  displayScale={100}
                  unit="%"
                  onChange={next => onChange({ ...watermark, opacity: next })}
               />

               {/* Rotation applies to both the single and tiled watermark. */}
               <SliderWithNumberInput
                  label={t.presentationWatermarkRotation}
                  min={WATERMARK_MIN_ROTATION}
                  max={WATERMARK_MAX_ROTATION}
                  step={1}
                  value={watermark.rotation}
                  unit="Â°"
                  onChange={next => onChange({ ...watermark, rotation: next })}
               />

               {/* Position offset: a fine X/Y nudge on top of the position anchor / pattern phase,
                   composed with rotation rather than replacing it. Applies to both the single and
                   tiled watermark, same as rotation. */}
               <SliderWithNumberInput
                  label={t.presentationWatermarkOffsetX}
                  min={WATERMARK_MIN_OFFSET}
                  max={WATERMARK_MAX_OFFSET}
                  step={1}
                  value={watermark.offsetX}
                  unit="px"
                  onChange={next => onChange({ ...watermark, offsetX: next })}
               />
               <SliderWithNumberInput
                  label={t.presentationWatermarkOffsetY}
                  min={WATERMARK_MIN_OFFSET}
                  max={WATERMARK_MAX_OFFSET}
                  step={1}
                  value={watermark.offsetY}
                  unit="px"
                  onChange={next => onChange({ ...watermark, offsetY: next })}
               />

               {/* Tile toggle. */}
               <label className="presentation-toggle">
                  <input
                     type="checkbox"
                     checked={watermark.tile}
                     onChange={event => onChange({ ...watermark, tile: event.target.checked })}
                  />
                  <span>{t.presentationWatermarkTile}</span>
               </label>

               {watermark.tile ? (
                  <>
                     {/* Tile size - the rendered width of one motif; height derives from the
                         stored aspect ratio so the image is never squashed. */}
                     <SliderWithNumberInput
                        label={t.presentationWatermarkTileSize}
                        min={WATERMARK_MIN_TILE_SIZE}
                        max={WATERMARK_MAX_TILE_SIZE}
                        step={4}
                        value={watermark.tileSize}
                        unit="px"
                        onChange={next => onChange({ ...watermark, tileSize: next })}
                     />

                     {/* Spacing: linked by default (one "density" slider drives spacingX === spacingY);
                         "adjust axes separately" unlinks it into independent horizontal / vertical sliders. */}
                     {spacingLinked ? (
                        <SliderWithNumberInput
                           label={t.presentationWatermarkSpacing}
                           min={WATERMARK_MIN_SPACING}
                           max={WATERMARK_MAX_SPACING}
                           step={2}
                           value={watermark.spacingX}
                           unit="px"
                           onChange={next => onChange(applyLinkedWatermarkSpacing(watermark, next))}
                        />
                     ) : (
                        <>
                           <SliderWithNumberInput
                              label={t.presentationWatermarkSpacingHorizontal}
                              min={WATERMARK_MIN_SPACING}
                              max={WATERMARK_MAX_SPACING}
                              step={2}
                              value={watermark.spacingX}
                              unit="px"
                              onChange={next => onChange({ ...watermark, spacingX: next })}
                           />
                           <SliderWithNumberInput
                              label={t.presentationWatermarkSpacingVertical}
                              min={WATERMARK_MIN_SPACING}
                              max={WATERMARK_MAX_SPACING}
                              step={2}
                              value={watermark.spacingY}
                              unit="px"
                              onChange={next => onChange({ ...watermark, spacingY: next })}
                           />
                        </>
                     )}

                     <label className="presentation-toggle">
                        <input
                           type="checkbox"
                           checked={!spacingLinked}
                           onChange={event => {
                              const unlinked = event.target.checked
                              setSpacingLinked(!unlinked)
                              // Re-linking collapses back to a single value (spacingX wins) so the
                              // linked slider has one unambiguous position to resume from.
                              if (!unlinked) onChange(applyLinkedWatermarkSpacing(watermark, watermark.spacingX))
                           }}
                        />
                        <span>{t.presentationWatermarkSpacingAdjustSeparately}</span>
                     </label>
                  </>
               ) : (
                  <>
                     {/* Size + position only apply to a single (non-tiled) image. Size is a percentage
                         of the page width; height is left to `auto` so the image's own aspect ratio is
                         preserved, mirroring the tiled case's tileSize slider. */}
                     <SliderWithNumberInput
                        label={t.presentationWatermarkSize}
                        min={WATERMARK_MIN_SIZE}
                        max={WATERMARK_MAX_SIZE}
                        step={1}
                        value={watermark.size ?? WATERMARK_DEFAULT_SIZE}
                        unit="%"
                        onChange={next => onChange({ ...watermark, size: next })}
                     />

                     <label className="presentation-field">
                        <span className="presentation-field-label">{t.presentationWatermarkPosition}</span>
                        <select
                           className="presentation-select"
                           value={watermark.position}
                           onChange={event => onChange({ ...watermark, position: event.target.value as WatermarkPosition })}
                        >
                           {POSITION_OPTIONS.map(position => (
                              <option key={position} value={position}>{positionLabels[position]}</option>
                           ))}
                        </select>
                     </label>
                  </>
               )}
            </>
         )}
      </section>
   )
}

// #####################
// # HEADER SECTION #
// #####################

interface HeaderSectionProps {
   header:   Header | undefined
   onChange: (next: Header | undefined) => void
}

const HEADER_PLACEMENT_OPTIONS: HeaderPlacement[] = ['above', 'beside']
const HEADER_ALIGN_OPTIONS: HeaderAlign[] = ['left', 'center', 'right']

function HeaderSection({ header, onChange }: HeaderSectionProps) {
   const { t } = useLang()
   const inputRef = useRef<HTMLInputElement>(null)

   async function handleFile(file: File | undefined): Promise<void> {
      if (!file || !file.type.startsWith('image/')) return
      // A logo doesn't need the watermark's full-size cap - HEADER_LOGO_MAX_EDGE keeps it small.
      const { src } = await downscaleImageToDataUrl(file, HEADER_LOGO_MAX_EDGE)
      // Keep the existing placement / align / maxHeight when replacing; a fresh pick gets defaults.
      onChange(header ? { ...header, src } : makeHeader(src))
   }

   const placementLabels: Record<HeaderPlacement, string> = {
      above:  t.presentationHeaderPlacementAbove,
      beside: t.presentationHeaderPlacementBeside,
   }
   const alignLabels: Record<HeaderAlign, string> = {
      left:   t.presentationHeaderAlignLeft,
      center: t.presentationHeaderAlignCenter,
      right:  t.presentationHeaderAlignRight,
   }

   return (
      <section className="presentation-section">
         <span className="presentation-section-label">{t.presentationHeaderSection}</span>

         {/* Hidden picker, driven by the choose / replace buttons below. */}
         <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = '' }}
         />

         {!header ? (
            // Empty state: just the picker + a hint. No logo renders in the header yet.
            <div className="presentation-empty">
               <button type="button" className="presentation-btn" onClick={() => inputRef.current?.click()}>
                  <Upload size={13} />{t.presentationHeaderChoose}
               </button>
               <p className="presentation-hint">{t.presentationHeaderEmptyHint}</p>
            </div>
         ) : (
            <>
               {/* A small thumbnail of the chosen asset (app-chrome - the live logo renders in the
                   document header, following the document theme). */}
               <div className="presentation-thumb-row">
                  <span className="presentation-thumb" style={{ backgroundImage: `url("${header.src}")` }} aria-hidden="true" />
                  <div className="presentation-thumb-actions">
                     <button type="button" className="presentation-btn" onClick={() => inputRef.current?.click()}>
                        <Upload size={13} />{t.presentationHeaderReplace}
                     </button>
                     <button type="button" className="presentation-btn presentation-btn-danger" onClick={() => onChange(undefined)}>
                        <Trash2 size={13} />{t.presentationHeaderRemove}
                     </button>
                  </div>
               </div>

               {/* Placement: on its own line above the title, or inline beside it. */}
               <label className="presentation-field">
                  <span className="presentation-field-label">{t.presentationHeaderPlacement}</span>
                  <select
                     className="presentation-select"
                     value={header.placement}
                     onChange={event => onChange({ ...header, placement: event.target.value as HeaderPlacement })}
                  >
                     {HEADER_PLACEMENT_OPTIONS.map(placement => (
                        <option key={placement} value={placement}>{placementLabels[placement]}</option>
                     ))}
                  </select>
               </label>

               {/* Alignment: horizontal placement of the logo (or, for "beside" + logoSide 'left',
                   the logo+title group; ignored for "beside" + logoSide 'right', which pins the
                   logo and title to opposite ends of the row instead). */}
               <label className="presentation-field">
                  <span className="presentation-field-label">{t.presentationHeaderAlign}</span>
                  <select
                     className="presentation-select"
                     value={header.align}
                     disabled={header.placement === 'beside' && header.logoSide === 'right'}
                     onChange={event => onChange({ ...header, align: event.target.value as HeaderAlign })}
                  >
                     {HEADER_ALIGN_OPTIONS.map(align => (
                        <option key={align} value={align}>{alignLabels[align]}</option>
                     ))}
                  </select>
               </label>

               {/* Logo side: "beside" only - which end of the row the logo pins to, with the title
                   at the other end. Left (default) keeps the logo+title grouped together per
                   `align`; right pins the logo opposite the title. */}
               {header.placement === 'beside' && (
                  <label className="presentation-field">
                     <span className="presentation-field-label">{t.presentationHeaderLogoSide}</span>
                     <select
                        className="presentation-select"
                        value={header.logoSide}
                        onChange={event => onChange({ ...header, logoSide: event.target.value as HeaderLogoSide })}
                     >
                        <option value="left">{t.presentationHeaderLogoSideLeft}</option>
                        <option value="right">{t.presentationHeaderLogoSideRight}</option>
                     </select>
                  </label>
               )}

               {/* Max height: a px cap on the rendered logo. */}
               <SliderWithNumberInput
                  label={t.presentationHeaderMaxHeight}
                  min={HEADER_MIN_MAX_HEIGHT}
                  max={HEADER_MAX_MAX_HEIGHT}
                  step={2}
                  value={header.maxHeight}
                  unit="px"
                  onChange={next => onChange({ ...header, maxHeight: next })}
               />
            </>
         )}
      </section>
   )
}

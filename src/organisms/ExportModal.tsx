import { useState } from 'react'
import { X, Download, Copy, Image, Sun, Moon } from 'lucide-react'
import { Button } from '../atoms/Button'
import { AccentSwatchGrid, type AccentSwatchOption, type AccentCustomSwatchOption } from '../molecules/AccentSwatchGrid'
import type { DocMeta, Section } from '../types'
import type { DocPresentationExtras } from '../lib/presentation'
import type { DocFormat } from '../lib/format'
import { generateExportHTML, downloadHTML, type ExportOptions } from '../lib/export'
import { exportMintdownFile } from '../lib/mintdown'
import { exportMarkdownFile } from '../lib/markdown'
import { downloadJSON } from '../lib/documentBackupFile'
import { ensureTemmlReady } from '../lib/math'
import type { Lang } from '../lib/i18n'
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'
import { ACCENT_PRESETS, accentPresetName } from '../lib/constants'

// #########
// # TYPES #
// #########

type ExportFormat = 'html' | 'mintdown' | 'markdown' | 'json'

interface ExportModalProps {
   meta: DocMeta
   sections: Section[]
   defaultTheme:  'light' | 'dark'
   defaultAccent: string
   /** Active document's presentation extras, baked into the exported HTML (watermark, …). */
   presentation?: DocPresentationExtras
   /** Active document's page format (infinite width, later paged A4), baked into the exported HTML's
    *  `.doc-card` width. */
   format?: DocFormat
   lang: Lang
   onClose: () => void
   /** Opens the document-level Presentation window (watermark / header / nav editing). */
   onOpenPresentation?: () => void
}

// #############
// # COMPONENT #
// #############

/**
 * Format-aware Export dialog. A format selector (HTML / Mintdown / Markdown) drives which options
 * and actions are shown. All three reuse the EXISTING serializers:
 *   - HTML    , the presentation options (theme + accent) + generate → downloadHTML / copy. Math
 *                is rendered by Temml, which loads asynchronously, so this path (and ONLY this path)
 *                awaits ensureTemmlReady() before generating. Mintdown/Markdown serialize the LaTeX
 *                source verbatim and need no await.
 *   - Mintdown, documentToMintdown → download (via exportMintdownFile). Lean, no options.
 *   - Markdown, documentToMarkdown → download (via exportMarkdownFile). Lean, no options.
 */
export function ExportModal({ meta, sections, defaultTheme, defaultAccent, presentation, format: docFormat, lang, onClose, onOpenPresentation }: ExportModalProps) {
   const [format, setFormat] = useState<ExportFormat>('html')
   const [theme, setTheme]   = useState<'light' | 'dark'>(defaultTheme)
   const [accent, setAccent] = useState(defaultAccent)
   // Whether the accent grid's "Custom accent…" tile is the selected choice, a genuine selection
   // on par with a preset swatch (see molecules/AccentSwatchGrid), not a disclosure toggle. Mirrors
   // the same local-flag pattern the document-background context menu uses (WysiwygArea's own
   // customAccentSelected) since this modal owns its own draft accent, independent of the document's.
   const [customAccentSelected, setCustomAccentSelected] = useState(false)
   const { t } = useLang()
   const { showToast } = useToast()

   // Presentation extras + document format ride into the HTML export via ExportOptions; the .mint /
   // .md paths never see them (they serialize content only). Renamed to docFormat above to avoid
   // colliding with this modal's own `format` state (the export FILE format selector, html/mintdown/
   // markdown, an unrelated concept that predates the document page format).
   const opts: ExportOptions = { theme, accent, lang, presentation, format: docFormat }

   // =========
   //  Actions
   // =========

   // HTML: Temml renders math to MathML synchronously, but it loads as a raw asset (see
   // lib/math.ts). Await readiness before generating so a fresh-load export still renders
   // equations rather than emitting "still loading" errors.
   async function handleHtmlDownload() {
      await ensureTemmlReady()
      downloadHTML(meta, sections, opts)
      showToast(t.downloaded, { type: 'success' })
      onClose()
   }

   async function handleHtmlCopy() {
      await ensureTemmlReady()
      const html = generateExportHTML(meta, sections, opts)
      navigator.clipboard.writeText(html).then(() => {
         showToast(t.htmlCopied, { type: 'success' })
         onClose()
      })
   }

   // Mintdown / Markdown: pure serialize + download, no async asset to await.
   function handleMintdownDownload() {
      exportMintdownFile(sections, meta)
      showToast(t.mintdownExported, { type: 'success' })
      onClose()
   }

   function handleMarkdownDownload() {
      exportMarkdownFile(sections, meta)
      showToast(t.markdownExported, { type: 'success' })
      onClose()
   }

   // Documinter JSON: the LOSSLESS, reopenable archive, the document's exact state (content +
   // theme/accent + presentation + page format), the counterpart to `parseDocumentBackup`/Open. It
   // uses the DOCUMENT's real theme/accent (`defaultTheme`/`defaultAccent`) + presentation + format,
   // NOT the HTML-export overrides above, since it snapshots the document itself, not a styled export.
   function handleJsonDownload() {
      downloadJSON(meta, sections, {
         docTheme:  defaultTheme,
         docAccent: defaultAccent,
         presentation,
         format:    docFormat,
      })
      showToast(t.downloaded, { type: 'success' })
      onClose()
   }

   // =======
   //  Render
   // =======

   // Extension-only labels (see i18n exportFormat*), the explanation moves to the hover tooltip
   // instead so the buttons stay short enough for four of them to breathe at once.
   const FORMAT_OPTIONS: { value: ExportFormat; label: string; tooltip: string }[] = [
      { value: 'html',     label: t.exportFormatHtml,     tooltip: t.exportFormatHtmlTooltip },
      { value: 'mintdown', label: t.exportFormatMintdown, tooltip: t.exportFormatMintdownTooltip },
      { value: 'markdown', label: t.exportFormatMarkdown, tooltip: t.exportFormatMarkdownTooltip },
      { value: 'json',     label: t.exportFormatJson,     tooltip: t.exportFormatJsonTooltip },
   ]

   // Accent grid data, built locally the same way buildDocumentMenuEntries does for the document
   // menu/context menu, but against this modal's own draft `accent` state rather than the live
   // document accent (a modal-scoped override the actual document never sees until re-applied).
   const isPresetAccentHex = (hex: string) => hex.toLowerCase() === accent.toLowerCase()

   const accentPresetOptions: AccentSwatchOption[] = ACCENT_PRESETS.map(hex => ({
      hex,
      name:   accentPresetName(hex, t),
      active: isPresetAccentHex(hex) && !customAccentSelected,
      onSelect: () => {
         setAccent(hex)
         setCustomAccentSelected(false)
      },
   }))

   const accentCustomOption: AccentCustomSwatchOption = {
      name:     t.bgMenuCustomAccentTitle,
      active:   customAccentSelected || !ACCENT_PRESETS.some(isPresetAccentHex),
      value:    accent,
      onSelect: () => setCustomAccentSelected(true),
      onChange: setAccent,
   }

   return (
      <div
         className="fixed inset-0 z-50 flex items-center justify-center"
         onClick={onClose}
      >
         {/* Backdrop */}
         <div className="absolute inset-0 bg-black/50" />

         {/* Modal */}
         <div
            className="relative z-10 bg-raised border border-border rounded-xl shadow-2xl p-5 w-96 flex flex-col gap-4"
            onClick={event => event.stopPropagation()}
         >
            {/* Header */}
            <div className="flex items-center justify-between">
               <span className="text-sm font-semibold text-text">{t.exportOptions}</span>
               <button
                  onClick={onClose}
                  className="text-muted hover:text-text transition-colors rounded p-0.5"
               >
                  <X size={14} />
               </button>
            </div>

            {/* Format selector */}
            <div className="flex flex-col gap-2">
               <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.exportFormat}</span>
               <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map(formatOption => (
                     <button
                        key={formatOption.value}
                        title={formatOption.tooltip}
                        onClick={() => setFormat(formatOption.value)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors
                           ${format === formatOption.value
                              ? 'bg-accent/10 border-accent/50 text-accent'
                              : 'border-border text-muted hover:text-text'
                           }`}
                     >
                        {formatOption.label}
                     </button>
                  ))}
               </div>
            </div>

            {/* HTML-only presentation options */}
            {format === 'html' && (
               <>
                  {/* Theme */}
                  <div className="flex flex-col gap-2">
                     <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.theme}</span>
                     <div className="flex gap-2">
                        {(['light', 'dark'] as const).map(themeOption => (
                           <button
                              key={themeOption}
                              onClick={() => setTheme(themeOption)}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs font-medium transition-colors capitalize
                                 ${theme === themeOption
                                    ? 'bg-accent/10 border-accent/50 text-accent'
                                    : 'border-border text-muted hover:text-text'
                                 }`}
                           >
                              {themeOption === 'light' ? <Sun size={13} /> : <Moon size={13} />}
                              {themeOption === 'light' ? t.light : t.dark}
                           </button>
                        ))}
                     </div>
                  </div>

                  {/* Accent color, the app's shared square swatch grid (molecules/AccentSwatchGrid),
                      the same one the Document-menu accent picker uses, rather than this dialog's
                      own bespoke circular swatches + always-shown ColorPicker. The grid ships its
                      own px-3/py-2 padding (sized for a dropdown-menu row); the negative-margin
                      wrapper cancels that back out so it sits flush with this modal's other rows. */}
                  <div className="flex flex-col gap-2">
                     <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.accent}</span>
                     <div className="-mx-3 -my-2">
                        <AccentSwatchGrid presets={accentPresetOptions} custom={accentCustomOption} />
                     </div>
                  </div>

                  {/* Presentation launcher, opens the non-modal Presentation window (watermark now;
                      header / nav in later passes). The Export dialog stays the discovery hub; the
                      live editing happens in the window, over the visible document. */}
                  {onOpenPresentation && (
                     <button
                        type="button"
                        onClick={onOpenPresentation}
                        className="flex items-center justify-center gap-2 py-1.5 rounded-lg border border-border text-xs font-medium text-muted hover:text-text hover:border-accent/50 transition-colors"
                     >
                        <Image size={13} />{t.presentationOpen}
                     </button>
                  )}
               </>
            )}

            {/* JSON: the lossless, reopenable archive, no styling options (it snapshots the doc as-is). */}
            {format === 'json' && (
               <p className="text-xs text-muted leading-relaxed">{t.exportJsonDescription}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
               {format === 'html' && (
                  <>
                     <Button variant="ghost" className="flex-1" onClick={handleHtmlCopy}>
                        <Copy size={13} />{t.copyHtml}
                     </Button>
                     <Button variant="primary" className="flex-1" onClick={handleHtmlDownload}>
                        <Download size={13} />{t.download}
                     </Button>
                  </>
               )}
               {format === 'mintdown' && (
                  <Button variant="primary" className="flex-1" onClick={handleMintdownDownload}>
                     <Download size={13} />{t.download}
                  </Button>
               )}
               {format === 'markdown' && (
                  <Button variant="primary" className="flex-1" onClick={handleMarkdownDownload}>
                     <Download size={13} />{t.download}
                  </Button>
               )}
               {format === 'json' && (
                  <Button variant="primary" className="flex-1" onClick={handleJsonDownload}>
                     <Download size={13} />{t.download}
                  </Button>
               )}
            </div>
         </div>
      </div>
   )
}

import { useState } from 'react'
import { X, Download, Copy, Image, Sun, Moon, Printer } from 'lucide-react'
import { Button } from '../atoms/Button'
import { AccentSwatchGrid, type AccentSwatchOption, type AccentCustomSwatchOption } from '../molecules/AccentSwatchGrid'
import type { DocMeta, Section } from '../types'
import type { DocPresentationExtras } from '../lib/presentation'
import type { DocFormat } from '../lib/format'
import { generateExportHTML, type ExportOptions } from '../lib/export'
import { downloadHTML, printDocument, computeDocumentPages, buildPagedExportHtml } from '../lib/exportLayout'
import { savePdf } from '../lib/platform/fileTransfer'
import { slugify } from '../lib/text'
import { exportMarkdownFile } from '../lib/markdown'
import { downloadMint } from '../lib/documentBackupFile'
import { ensureTemmlReady } from '../lib/math'
import type { Lang } from '../lib/i18n'
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'
import { ACCENT_PRESETS, accentPresetName } from '../lib/constants'

// #########
// # TYPES #
// #########

type ExportFormat = 'html' | 'pdf' | 'markdown' | 'mint'

interface ExportModalProps {
   meta: DocMeta
   sections: Section[]
   defaultTheme:  'light' | 'dark'
   defaultAccent: string
   /** Active document's presentation extras, baked into the exported HTML (watermark, and so on). */
   presentation?: DocPresentationExtras
   /** Active document's page format (infinite width or paged A4), baked into the exported HTML's
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

/** Format-aware Export dialog; the format selector (HTML / PDF / Markdown / Mint) drives which options
 *  and actions show. Each reuses the document's own serializers. HTML and PDF await ensureTemmlReady()
 *  first because Temml renders math to MathML and loads asynchronously; the others need no await. Mint
 *  is the native document file, a full-fidelity copy that reopens here, the counterpart to Open. */
export function ExportModal({ meta, sections, defaultTheme, defaultAccent, presentation, format: docFormat, lang, onClose, onOpenPresentation }: ExportModalProps) {
   const [format, setFormat] = useState<ExportFormat>('html')
   const [theme, setTheme]   = useState<'light' | 'dark'>(defaultTheme)
   const [accent, setAccent] = useState(defaultAccent)
   // Whether the accent grid's "Custom accent..." tile is the selected choice (a genuine selection on
   // par with a preset swatch, not a disclosure toggle). A local flag because this modal owns its own
   // draft accent, independent of the document's.
   const [customAccentSelected, setCustomAccentSelected] = useState(false)
   const { t } = useLang()
   const { showToast } = useToast()

   // Presentation extras + document format ride into the HTML export via ExportOptions; the .md path
   // never sees them (content only). Aliased to docFormat to avoid colliding with this modal's own
   // `format` state (the export FILE format). The paged layout is not threaded in: downloadHTML /
   // printDocument / computeDocumentPages self-measure it from the model.
   const opts: ExportOptions = { theme, accent, lang, presentation, format: docFormat }

   // =========
   //  Actions
   // =========

   // Await Temml readiness before generating (it loads as a raw asset, see lib/math.ts) so a fresh-load
   // export renders equations rather than "still loading" errors.
   async function handleHtmlDownload() {
      await ensureTemmlReady()
      await downloadHTML(meta, sections, opts)
      showToast(t.downloaded, { type: 'success' })
      onClose()
   }

   async function handleHtmlCopy() {
      await ensureTemmlReady()
      // Self-measure the paged layout so the copied HTML paginates from the model, not editor state.
      const { pages } = await computeDocumentPages(meta, sections, opts)
      const html = generateExportHTML(meta, sections, pages.length > 0 ? { ...opts, pagedLayout: pages } : opts)
      navigator.clipboard.writeText(html).then(() => {
         showToast(t.htmlCopied, { type: 'success' })
         onClose()
      })
   }

   // PDF: on native Windows, a save dialog then a WebView2 render straight to the file; everywhere else
   // (and on any native failure) the browser print dialog over the same export HTML. Awaits Temml so
   // equations lay out before either path renders. Paged documents only.
   async function handlePdf() {
      await ensureTemmlReady()
      const html = await buildPagedExportHtml(meta, sections, opts)
      await savePdf({
         suggestedName: slugify(meta.title) + '.pdf',
         html,
         landscape:     docFormat?.kind === 'a4-landscape',
         fallback:      () => printDocument(meta, sections, opts),
      })
      onClose()
   }

   // Markdown: pure serialize, then the save dialog.
   async function handleMarkdownDownload() {
      await exportMarkdownFile(sections, meta)
      showToast(t.markdownExported, { type: 'success' })
      onClose()
   }

   // Mint: the native, reopenable document file. Snapshots the DOCUMENT's real theme / accent /
   // presentation / format (defaultTheme / defaultAccent), NOT the HTML-export overrides above.
   async function handleMintDownload() {
      await downloadMint(meta, sections, {
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

   // PDF prints the paged export, so it is greyed out on an infinite canvas.
   const isPagedDocument = !!docFormat && docFormat.kind !== 'infinite'

   // Two rows: the content serializers (JSON / Markdown) above the rendered exports (HTML / PDF). The
   // labels are extension-only; the explanation lives in the hover tooltip.
   type FormatOption = { value: ExportFormat; label: string; tooltip: string; disabled?: boolean }
   const FORMAT_ROWS: FormatOption[][] = [
      [
         { value: 'mint',     label: t.exportFormatMint,     tooltip: t.exportFormatMintTooltip },
         { value: 'markdown', label: t.exportFormatMarkdown, tooltip: t.exportFormatMarkdownTooltip },
      ],
      [
         { value: 'html', label: t.exportFormatHtml, tooltip: t.exportFormatHtmlTooltip },
         { value: 'pdf',  label: t.exportFormatPdf,  tooltip: isPagedDocument ? t.exportFormatPdfTooltip : t.exportPdfNeedsPaged, disabled: !isPagedDocument },
      ],
   ]

   // Accent grid data, built against this modal's own draft `accent` state rather than the live document
   // accent (a modal-scoped override the document never sees until re-applied).
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
         <div className="absolute inset-0 bg-black/50" />

         <div
            className="relative z-10 bg-raised border border-border rounded-xl shadow-2xl p-5 w-96 flex flex-col gap-4"
            onClick={event => event.stopPropagation()}
         >
            <div className="flex items-center justify-between">
               <span className="text-sm font-semibold text-text">{t.exportOptions}</span>
               <button
                  onClick={onClose}
                  className="text-muted hover:text-text transition-colors rounded p-0.5"
               >
                  <X size={14} />
               </button>
            </div>

            <div className="flex flex-col gap-2">
               <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.exportFormat}</span>
               <div className="flex flex-col gap-2">
                  {FORMAT_ROWS.map((row, rowIndex) => (
                     <div key={rowIndex} className="flex gap-2">
                        {row.map(formatOption => (
                           <button
                              key={formatOption.value}
                              title={formatOption.tooltip}
                              // aria-disabled, not `disabled`, so the tooltip still shows on a greyed-out
                              // PDF option (disabled elements swallow title hovers).
                              aria-disabled={formatOption.disabled || undefined}
                              onClick={() => { if (!formatOption.disabled) setFormat(formatOption.value) }}
                              className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors
                                 ${format === formatOption.value
                                    ? 'bg-accent/10 border-accent/50 text-accent'
                                    : 'border-border text-muted hover:text-text'
                                 }
                                 ${formatOption.disabled ? ' opacity-40 cursor-not-allowed hover:text-muted' : ''}`}
                           >
                              {formatOption.label}
                           </button>
                        ))}
                     </div>
                  ))}
               </div>
            </div>

            {(format === 'html' || format === 'pdf') && (
               <>
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

                  {/* Accent color via the app's shared AccentSwatchGrid (same as the Document menu). The
                      grid ships its own px-3/py-2 dropdown-row padding; the negative-margin wrapper
                      cancels it so the grid sits flush with this modal's other rows. */}
                  <div className="flex flex-col gap-2">
                     <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.accent}</span>
                     <div className="-mx-3 -my-2">
                        <AccentSwatchGrid presets={accentPresetOptions} custom={accentCustomOption} />
                     </div>
                  </div>

                  {/* Opens the non-modal Presentation window (watermark, header, nav editing), where the
                      live editing happens over the visible document. */}
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

            {/* Mint: the native, reopenable document file, no styling options (it snapshots the doc as-is). */}
            {format === 'mint' && (
               <p className="text-xs text-muted leading-relaxed">{t.exportMintDescription}</p>
            )}

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
               {format === 'pdf' && (
                  <Button variant="primary" className="flex-1" onClick={handlePdf}>
                     <Printer size={13} />{t.saveAsPdf}
                  </Button>
               )}
               {format === 'markdown' && (
                  <Button variant="primary" className="flex-1" onClick={handleMarkdownDownload}>
                     <Download size={13} />{t.download}
                  </Button>
               )}
               {format === 'mint' && (
                  <Button variant="primary" className="flex-1" onClick={handleMintDownload}>
                     <Download size={13} />{t.download}
                  </Button>
               )}
            </div>
         </div>
      </div>
   )
}

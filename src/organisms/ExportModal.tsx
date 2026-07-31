import { useState } from 'react'
import { X, Download, Copy } from 'lucide-react'
import { Button } from '../atoms/Button'
import { ColorPicker } from 'react-piqua-color'
import type { DocMeta, Section } from '../types'
import { generateExportHTML, downloadHTML, type ExportOptions } from '../lib/export'
import { ensureTemmlReady } from '../lib/math'
import type { Lang } from '../lib/i18n'
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'
import { ACCENT_PRESETS } from '../lib/constants'

interface ExportModalProps {
   meta: DocMeta
   sections: Section[]
   defaultTheme:  'light' | 'dark'
   defaultAccent: string
   lang: Lang
   onClose: () => void
}

export function ExportModal({ meta, sections, defaultTheme, defaultAccent, lang, onClose }: ExportModalProps) {
   const [theme, setTheme]   = useState<'light' | 'dark'>(defaultTheme)
   const [accent, setAccent] = useState(defaultAccent)
   const { t } = useLang()
   const { showToast } = useToast()

   const opts: ExportOptions = { theme, accent, lang }

   // Temml renders math to MathML synchronously, but it loads as a raw asset (see
   // lib/math.ts). Await readiness before generating so a fresh-load export still
   // renders equations rather than emitting "still loading" errors.
   async function handleDownload() {
      await ensureTemmlReady()
      downloadHTML(meta, sections, opts)
      showToast(t.downloaded, { type: 'success' })
      onClose()
   }

   async function handleCopy() {
      await ensureTemmlReady()
      const html = generateExportHTML(meta, sections, opts)
      navigator.clipboard.writeText(html).then(() => {
         showToast(t.htmlCopied, { type: 'success' })
         onClose()
      })
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
            className="relative z-10 bg-raised border border-border rounded-xl shadow-2xl p-5 w-80 flex flex-col gap-4"
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

            {/* Theme */}
            <div className="flex flex-col gap-2">
               <span className="font-mono text-xs text-muted uppercase tracking-wider">{t.theme}</span>
               <div className="flex gap-2">
                  {(['light', 'dark'] as const).map(themeOption => (
                     <button
                        key={themeOption}
                        onClick={() => setTheme(themeOption)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors capitalize
                           ${theme === themeOption
                              ? 'bg-accent/10 border-accent/50 text-accent'
                              : 'border-border text-muted hover:text-text'
                           }`}
                     >
                        {themeOption === 'light' ? t.light : t.dark}
                     </button>
                  ))}
               </div>
            </div>

            {/* Accent color */}
            <div className="flex flex-col gap-3">
               <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted uppercase tracking-wider">Accent</span>
                  {/* Preset swatches */}
                  <div className="flex items-center gap-1.5">
                     {ACCENT_PRESETS.map(color => (
                        <button
                           key={color}
                           title={color}
                           onClick={() => setAccent(color)}
                           style={{ background: color }}
                           className={`w-4 h-4 rounded-full border-2 transition-all
                              ${accent === color
                                 ? 'border-text/70 scale-110'
                                 : 'border-transparent opacity-50 hover:opacity-90 hover:scale-105'
                              }`}
                        />
                     ))}
                  </div>
               </div>

               <ColorPicker value={accent} onChange={setAccent} />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
               <Button variant="ghost" className="flex-1" onClick={handleCopy}>
                  <Copy size={13} />{t.copyHtml}
               </Button>
               <Button variant="primary" className="flex-1" onClick={handleDownload}>
                  <Download size={13} />{t.download}
               </Button>
            </div>
         </div>
      </div>
   )
}

import { useState } from 'react'
import type { DocMeta, DocState, Mode, Section } from '../types'
import { Button } from '../atoms/Button'
import { ExportModal } from './ExportModal'
import { downloadJSON, loadJSONFile } from '../lib/storage'
import { Upload, Save, Download, Sun, Moon, Eye } from 'lucide-react'
import { LogoColor, LogoMono } from '../atoms/Logo'
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'

interface TopbarProps {
   meta:          DocMeta
   sections:      Section[]
   theme:         'dark' | 'light'
   docTheme:      'light' | 'dark'
   docAccent:     string
   mode:          Mode
   onLoad:        (state: DocState) => void
   onToggleTheme: () => void
   onSetMode:     (mode: Mode) => void
}

export function Topbar({ meta, sections, theme, docTheme, docAccent, mode, onLoad, onToggleTheme, onSetMode }: TopbarProps) {
   const [exportOpen, setExportOpen] = useState(false)
   const { t, lang, setLang } = useLang()
   const { showToast } = useToast()

   function handleDownloadJSON() {
      downloadJSON(meta, sections)
      showToast(t.jsonSaved, { type: 'success' })
   }

   function handleLoadJSON() {
      loadJSONFile(
         (state: DocState) => { onLoad(state); showToast(t.docLoaded, { type: 'success' }) },
         (msg: string) => showToast(msg, { type: 'error' }),
      )
   }

   const MODE_BUTTONS = [
      { value: 'preview' as Mode, icon: <Eye size={14} />, label: t.previewMode },
   ] as const

   return (
      <>
         <header className="h-12 shrink-0 flex items-center justify-between gap-4 px-5 bg-raised border-b border-border z-200">
            {/* Brand */}
            <div className="flex items-center gap-2 shrink-0 select-none">
               {theme === 'dark'
                  ? <LogoColor className="h-7 w-auto" />
                  : <LogoMono className="h-7 w-auto" style={{ color: 'var(--color-accent)' }} />
               }
               <span className="font-mono text-sm font-bold text-accent tracking-tight">documinter</span>
            </div>

            {/* Doc title breadcrumb */}
            <span className="font-mono text-xs text-muted/70 truncate flex-1 text-center select-none">
               {meta.title || t.untitledDoc}
            </span>

            {/* Actions */}
            <div className="flex gap-2 items-center shrink-0">
               <Button variant="ghost" onClick={handleLoadJSON}><Upload size={14} />{t.load}</Button>
               <Button variant="ghost" onClick={handleDownloadJSON}><Save size={14} />{t.save}</Button>
               {MODE_BUTTONS.map(({ value, icon, label }) => (
                  <Button
                     key={value}
                     variant="ghost"
                     size="icon"
                     onClick={() => onSetMode(value)}
                     title={label}
                     style={mode === value ? { color: 'var(--color-accent)' } : undefined}
                  >
                     {icon}
                  </Button>
               ))}
               <div className="w-px h-5 bg-border mx-1" />
               <Button variant="ghost" size="icon" onClick={onToggleTheme} title={theme === 'dark' ? t.toLightMode : t.toDarkMode}>
                  {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
               </Button>
               <div className="flex gap-0.5">
                  {(['en', 'fr'] as const).map(language => (
                     <button
                        key={language}
                        onClick={() => setLang(language)}
                        className={`px-2 py-1 rounded-md text-xs font-mono font-semibold uppercase transition-colors border
                           ${lang === language ? 'bg-accent/10 border-accent/50 text-accent' : 'border-border text-muted hover:text-text'}`}
                     >
                        {language}
                     </button>
                  ))}
               </div>
               <Button variant="primary" onClick={() => setExportOpen(true)}><Download size={14} />{t.export}</Button>
            </div>
         </header>

         {exportOpen && (
            <ExportModal
               meta={meta}
               sections={sections}
               defaultTheme={docTheme}
               defaultAccent={docAccent}
               lang={lang}
               onClose={() => setExportOpen(false)}
            />
         )}
      </>
   )
}

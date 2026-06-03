import { useRef, useState } from 'react'
import type { DocMeta, DocState, Mode, SaveStatus, Section } from '../types'
import { Button } from '../atoms/Button'
import { ExportModal } from './ExportModal'
import { downloadJSON, loadJSONFile } from '../lib/storage'
import { Upload, Save, Download, Sun, Moon, Eye, CircleDot, Loader2, CircleCheck } from 'lucide-react'
import { LogoColor, LogoMono } from '../atoms/Logo'
import { useLang } from '../contexts/LangContext'
import { useToast } from '../contexts/ToastContext'

// ============================================================
// Save status indicator
// ============================================================

interface SaveStatusIndicatorProps {
   status:     SaveStatus
   labelDirty:  string
   labelSaving: string
   labelSaved:  string
}

function SaveStatusIndicator({ status, labelDirty, labelSaving, labelSaved }: SaveStatusIndicatorProps) {
   const lastNonCleanRef = useRef<'dirty' | 'saving' | 'saved'>('dirty')
   if (status !== 'clean') lastNonCleanRef.current = status

   const displayed = lastNonCleanRef.current
   const isVisible = status !== 'clean'

   return (
      <div className={`flex items-center gap-1.5 font-mono text-xs select-none pointer-events-none transition-opacity duration-500 ${
         isVisible ? 'opacity-100' : 'opacity-0'
      } ${
         displayed === 'dirty'  ? 'text-yellow' :
         displayed === 'saving' ? 'text-muted'  :
         'text-green'
      }`}>
         {displayed === 'dirty'  && <CircleDot    size={12} />}
         {displayed === 'saving' && <Loader2      size={12} className="animate-spin" />}
         {displayed === 'saved'  && <CircleCheck  size={12} />}
         <span>
            {displayed === 'dirty'  ? labelDirty  :
             displayed === 'saving' ? labelSaving :
             labelSaved}
         </span>
      </div>
   )
}

interface TopbarProps {
   meta:          DocMeta
   sections:      Section[]
   theme:         'dark' | 'light'
   docTheme:      'light' | 'dark'
   docAccent:     string
   mode:          Mode
   saveStatus:    SaveStatus
   onLoad:        (state: DocState) => void
   onToggleTheme: () => void
   onSetMode:     (mode: Mode) => void
   onManualSave:  () => void
}

export function Topbar({ meta, sections, theme, docTheme, docAccent, mode, saveStatus, onLoad, onToggleTheme, onSetMode, onManualSave }: TopbarProps) {
   const [exportOpen, setExportOpen] = useState(false)
   const { t, lang, setLang } = useLang()
   const { showToast } = useToast()

   function handleDownloadJSON() {
      downloadJSON(meta, sections)
      onManualSave()
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

            {/* Doc title + save status */}
            <div className="flex-1 relative flex items-center justify-center">
               <span className="font-mono text-xs text-muted/70 truncate select-none">
                  {meta.title || t.untitledDoc}
               </span>
               <div className="absolute right-0 inset-y-0 flex items-center">
                  <SaveStatusIndicator
                     status={saveStatus}
                     labelDirty={t.unsavedChanges}
                     labelSaving={t.autosaving}
                     labelSaved={t.saved}
                  />
               </div>
            </div>

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

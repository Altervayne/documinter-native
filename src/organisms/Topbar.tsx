import { useState } from 'react'
import type { DocMeta, Section } from '../types'
import { Button } from '../atoms/Button'
import { ExportModal } from './ExportModal'
import { downloadJSON, loadJSONFile } from '../lib/saveload'
import type { DocState } from '../types'
import { Upload, Save, Download, Sun, Moon } from 'lucide-react'
import { LogoColor, LogoMono } from '../atoms/Logo'
import { useLang } from '../lib/LangContext'

interface TopbarProps {
  meta: DocMeta
  sections: Section[]
  theme: 'dark' | 'light'
  docTheme: 'light' | 'dark'
  docAccent: string
  onLoad: (state: DocState) => void
  onToast: (msg: string) => void
  onToggleTheme: () => void
}

export function Topbar({ meta, sections, theme, docTheme, docAccent, onLoad, onToast, onToggleTheme }: TopbarProps) {
  const [exportOpen, setExportOpen] = useState(false)
  const { t, lang, setLang } = useLang()

  function handleDownloadJSON() {
    downloadJSON(meta, sections)
    onToast(t.jsonSaved)
  }

  function handleLoadJSON() {
    loadJSONFile(state => {
      onLoad(state)
      onToast(t.docLoaded)
    })
  }

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
          <div className="w-px h-5 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={onToggleTheme} title={theme === 'dark' ? t.toLightMode : t.toDarkMode}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
          <div className="flex gap-0.5">
            {(['en', 'fr'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-1 rounded-md text-xs font-mono font-semibold uppercase transition-colors border
                  ${lang === l ? 'bg-accent/10 border-accent/50 text-accent' : 'border-border text-muted hover:text-text'}`}
              >
                {l}
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
          onToast={onToast}
        />
      )}
    </>
  )
}

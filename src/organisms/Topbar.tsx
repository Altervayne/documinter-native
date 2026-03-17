import { useState } from 'react'
import type { DocMeta, Section } from '../types'
import { Button } from '../atoms/Button'
import { ExportModal } from './ExportModal'
import { downloadJSON, loadJSONFile } from '../lib/saveload'
import type { DocState } from '../types'
import { Upload, Save, Download, Sun, Moon } from 'lucide-react'

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

  function handleDownloadJSON() {
    downloadJSON(meta, sections)
    onToast('JSON saved!')
  }

  function handleLoadJSON() {
    loadJSONFile(state => {
      onLoad(state)
      onToast('Document loaded!')
    })
  }

  return (
    <>
      <header className="h-12 shrink-0 flex items-center justify-between gap-4 px-5 bg-raised border-b border-border z-200">
        {/* Brand */}
        <span className="font-mono text-sm text-accent font-bold tracking-tight shrink-0 select-none">
          // documint
        </span>

        {/* Doc title breadcrumb */}
        <span className="font-mono text-xs text-muted/70 truncate flex-1 text-center select-none">
          {meta.title || 'Untitled document'}
        </span>

        {/* Actions */}
        <div className="flex gap-2 items-center shrink-0">
          <Button variant="ghost" onClick={handleLoadJSON}><Upload size={14} />Load</Button>
          <Button variant="ghost" onClick={handleDownloadJSON}><Save size={14} />Save</Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
          <Button variant="primary" onClick={() => setExportOpen(true)}><Download size={14} />Export</Button>
        </div>
      </header>

      {exportOpen && (
        <ExportModal
          meta={meta}
          sections={sections}
          defaultTheme={docTheme}
          defaultAccent={docAccent}
          onClose={() => setExportOpen(false)}
          onToast={onToast}
        />
      )}
    </>
  )
}

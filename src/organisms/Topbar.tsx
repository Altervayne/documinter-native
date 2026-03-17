import { useState } from 'react'
import type { DocMeta, Section } from '../types'
import { Button } from '../atoms/Button'
import { ExportModal } from './ExportModal'
import { downloadJSON, loadJSONFile } from '../lib/saveload'
import type { DocState } from '../types'
import { Upload, Save, Download } from 'lucide-react'

interface TopbarProps {
  meta: DocMeta
  sections: Section[]
  onLoad: (state: DocState) => void
  onToast: (msg: string) => void
}

export function Topbar({ meta, sections, onLoad, onToast }: TopbarProps) {
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
          <Button variant="primary" onClick={() => setExportOpen(true)}><Download size={14} />Export</Button>
        </div>
      </header>

      {exportOpen && (
        <ExportModal
          meta={meta}
          sections={sections}
          onClose={() => setExportOpen(false)}
          onToast={onToast}
        />
      )}
    </>
  )
}

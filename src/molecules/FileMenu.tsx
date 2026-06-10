import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FilePlus, Upload, Save, FileUp, FileDown, Download } from 'lucide-react'
import type { T } from '../lib/i18n'

// ============================================================
// Types
// ============================================================

interface FileMenuProps {
   onNewDocument:     () => void
   onLoadJSON:        () => void
   onSaveJSON:        () => void
   onImportMarkdown:  () => void
   onExportMarkdown:  () => void
   onImportMintdown:  () => void
   onExportMintdown:  () => void
   onOpenExportModal: () => void
   t: T
}

// ============================================================
// Component
// ============================================================

export function FileMenu({
   onNewDocument,
   onLoadJSON,
   onSaveJSON,
   onImportMarkdown,
   onExportMarkdown,
   onImportMintdown,
   onExportMintdown,
   onOpenExportModal,
   t,
}: FileMenuProps) {
   const [open, setOpen]   = useState(false)
   const containerRef       = useRef<HTMLDivElement>(null)

   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   function handleItemClick(callback: () => void) {
      callback()
      setOpen(false)
   }

   // ── Render ─────────────────────────────────────────────────

   return (
      <div ref={containerRef} className="relative">
         {/* Trigger */}
         <button
            onClick={() => setOpen(wasOpen => !wasOpen)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-mono font-medium
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border'
               }`}
         >
            {t.menuFile}
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {/* Dropdown */}
         {open && (
            <div className="absolute top-full mt-1.5 left-0 min-w-48 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden" style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}>
               <MenuItem
                  icon={<FilePlus size={13} />}
                  label={t.newDocument}
                  onClick={() => handleItemClick(onNewDocument)}
               />
               <MenuItem
                  icon={<Upload size={13} />}
                  label={t.load}
                  onClick={() => handleItemClick(onLoadJSON)}
               />
               <MenuItem
                  icon={<Save size={13} />}
                  label={t.save}
                  onClick={() => handleItemClick(onSaveJSON)}
               />
               <MenuSeparator />
               <MenuItem
                  icon={<FileUp size={13} />}
                  label={t.importMarkdown}
                  onClick={() => handleItemClick(onImportMarkdown)}
               />
               <MenuItem
                  icon={<FileDown size={13} />}
                  label={t.exportMarkdown}
                  onClick={() => handleItemClick(onExportMarkdown)}
               />
               <MenuSeparator />
               <MenuItem
                  icon={<FileUp size={13} />}
                  label={t.importMintdown}
                  onClick={() => handleItemClick(onImportMintdown)}
               />
               <MenuItem
                  icon={<FileDown size={13} />}
                  label={t.exportMintdown}
                  onClick={() => handleItemClick(onExportMintdown)}
               />
               <MenuSeparator />
               <MenuItem
                  icon={<Download size={13} />}
                  label={t.exportHtml}
                  onClick={() => handleItemClick(onOpenExportModal)}
               />
            </div>
         )}
      </div>
   )
}

// ============================================================
// Shared primitives (file-local)
// ============================================================

interface MenuItemProps {
   icon:     React.ReactNode
   label:    string
   onClick:  () => void
   disabled?: boolean
}

function MenuItem({ icon, label, onClick, disabled }: MenuItemProps) {
   return (
      <button
         onClick={onClick}
         disabled={disabled}
         className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
            transition-colors cursor-pointer hover:bg-border/50 text-text
            disabled:opacity-40 disabled:cursor-not-allowed"
      >
         <span className="text-muted">{icon}</span>
         <span className="flex-1">{label}</span>
      </button>
   )
}

function MenuSeparator() {
   return <div className="h-px bg-border my-1 mx-2" />
}

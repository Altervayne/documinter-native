import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FilePlus, Archive, FolderOpen, FileUp, FileDown, Save, SaveAll, HardDriveDownload, Upload } from 'lucide-react'
import type { T } from '../lib/i18n'

// #########
// # TYPES #
// #########

interface FileMenuProps {
   /** Binder vs document mode — drives which items are enabled. */
   mode: 'binder' | 'document'
   // Available in both modes:
   onNewDocument:    () => void
   onOpenTin:        () => void
   onOpenDocumint:   () => void
   onOpenMarkdown:   () => void
   onOpenMintdown:   () => void
   // Document mode only:
   onSave:           () => void
   onSaveAs:         () => void
   onExportDocumint: () => void
   onExportMarkdown: () => void
   onExportMintdown: () => void
   // Binder mode only:
   onImportDocumint: () => void
   onImportMarkdown: () => void
   onImportMintdown: () => void
   t: T
}

// #############
// # COMPONENT #
// #############

export function FileMenu({
   mode,
   onNewDocument, onOpenTin, onOpenDocumint, onOpenMarkdown, onOpenMintdown,
   onSave, onSaveAs, onExportDocumint, onExportMarkdown, onExportMintdown,
   onImportDocumint, onImportMarkdown, onImportMintdown,
   t,
}: FileMenuProps) {
   const [open, setOpen] = useState(false)
   const containerRef    = useRef<HTMLDivElement>(null)

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

   // Inapplicable groups are not mounted (invisible), at whole-group + separator granularity —
   // never individual items winking out mid-list.
   const isDocumentMode = mode === 'document'

   // =======
   //  Render
   // =======

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
            <div className="absolute top-full mt-1.5 left-0 min-w-56 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden" style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}>
               {/* New + Tin (both modes) */}
               <MenuItem icon={<FilePlus size={13} />} label={t.fileNewDocument} onClick={() => handleItemClick(onNewDocument)} />
               <MenuItem icon={<Archive size={13} />}  label={t.fileOpenTin}     onClick={() => handleItemClick(onOpenTin)} />
               <MenuSeparator />

               {/* Open into the editor (both modes) */}
               <MenuItem icon={<FolderOpen size={13} />} label={t.fileOpenDocumint} onClick={() => handleItemClick(onOpenDocumint)} />
               <MenuItem icon={<FileUp size={13} />}     label={t.fileOpenMarkdown} onClick={() => handleItemClick(onOpenMarkdown)} />
               <MenuItem icon={<FileUp size={13} />}     label={t.fileOpenMintdown} onClick={() => handleItemClick(onOpenMintdown)} />

               {/* Save + Export groups — document mode only (not mounted in binder mode) */}
               {isDocumentMode && (
                  <>
                     <MenuSeparator />
                     <MenuItem icon={<Save size={13} />}    label={t.fileSave}   onClick={() => handleItemClick(onSave)} />
                     <MenuItem icon={<SaveAll size={13} />} label={t.fileSaveAs} onClick={() => handleItemClick(onSaveAs)} />
                     <MenuSeparator />
                     <MenuItem icon={<HardDriveDownload size={13} />} label={t.fileExportDocumint} onClick={() => handleItemClick(onExportDocumint)} />
                     <MenuItem icon={<FileDown size={13} />}          label={t.fileExportMarkdown} onClick={() => handleItemClick(onExportMarkdown)} />
                     <MenuItem icon={<FileDown size={13} />}          label={t.fileExportMintdown} onClick={() => handleItemClick(onExportMintdown)} />
                  </>
               )}

               {/* Import group — binder mode only (not mounted in document mode) */}
               {!isDocumentMode && (
                  <>
                     <MenuSeparator />
                     <MenuItem icon={<Upload size={13} />} label={t.fileImportDocumint} onClick={() => handleItemClick(onImportDocumint)} />
                     <MenuItem icon={<FileUp size={13} />} label={t.fileImportMarkdown} onClick={() => handleItemClick(onImportMarkdown)} />
                     <MenuItem icon={<FileUp size={13} />} label={t.fileImportMintdown} onClick={() => handleItemClick(onImportMintdown)} />
                  </>
               )}
            </div>
         )}
      </div>
   )
}

// ##################################
// # SHARED PRIMITIVES (FILE-LOCAL) #
// ##################################

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
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
         <span className="text-muted">{icon}</span>
         <span className="flex-1">{label}</span>
      </button>
   )
}

function MenuSeparator() {
   return <div className="h-px bg-border my-1 mx-2" />
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, File, FilePlus, Archive, PackageOpen, FolderOpen, Download, Save, SaveAll, Upload, LayoutTemplate } from 'lucide-react'
import type { T } from '../lib/i18n'

// #############
// # CONSTANTS #
// #############

// Feed the right-edge guard below, sized to the dropdown's own `min-w-56` Tailwind width.
const DROPDOWN_WIDTH = 224
const EDGE_MARGIN     = 8

// #########
// # TYPES #
// #########

interface FileMenuProps {
   /** Binder vs document mode, drives which items are enabled. */
   mode: 'binder' | 'document'
   // Available in both modes:
   onNewDocument:    () => void
   /** Single, format-detecting Open (JSON backup / Markdown), document mode only. */
   onOpen:           () => void
   // Document mode only:
   onSave:           () => void
   onSaveAs:         () => void
   /** Save the active document's chrome as a reusable template, document mode only. */
   onSaveAsTemplate: () => void
   /** Single, format-aware Export dialog (HTML / PDF / Markdown / JSON), document mode only. */
   onExport:         () => void
   // Binder mode only:
   /** Format-detecting Import (JSON / Markdown), lands as a new binder record without opening a tab. */
   onImport:         () => void
   /** Download the whole binder as a `.tin` bundle. Binder mode only. */
   onSaveTin:        () => void
   /** Open a `.tin` bundle (merge into or replace the binder). Binder mode only. */
   onOpenTin:        () => void
   t: T
}

// #############
// # COMPONENT #
// #############

export function FileMenu({
   mode,
   onNewDocument, onOpen,
   onSave, onSaveAs, onSaveAsTemplate, onExport,
   onImport, onSaveTin, onOpenTin,
   t,
}: FileMenuProps) {
   const [open, setOpen] = useState(false)
   const [alignRight, setAlignRight] = useState(false)
   const containerRef    = useRef<HTMLDivElement>(null)

   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   // Light right-edge guard: on a narrow window, a left-aligned dropdown near the right side of
   // the header can overflow past the viewport edge. Flip to right-aligned when there isn't room.
   useLayoutEffect(() => {
      if (!open) return
      const containerRect = containerRef.current?.getBoundingClientRect()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (containerRect) setAlignRight(containerRect.left + DROPDOWN_WIDTH > window.innerWidth - EDGE_MARGIN)
   }, [open])

   function handleItemClick(callback: () => void) {
      callback()
      setOpen(false)
   }

   // Inapplicable groups drop out whole, never individual items winking out mid-list.
   const isDocumentMode = mode === 'document'

   return (
      <div ref={containerRef} className="relative">
         <button
            onClick={() => setOpen(wasOpen => !wasOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-medium
               border transition-colors cursor-pointer
               ${open
                  ? 'bg-accent/10 border-accent/50 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border'
               }`}
         >
            <File size={14} />
            <span className="hdr-collapse">{t.menuFile}</span>
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {open && (
            <div className={`absolute top-full mt-1.5 min-w-56 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden ${alignRight ? 'right-0 left-auto' : 'left-0'}`} style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: alignRight ? '100% 0%' : '0% 0%' }}>
               <MenuItem icon={<FilePlus size={13} />} label={t.fileNewDocument} onClick={() => handleItemClick(onNewDocument)} />

               {/* Open is workspace-only: the binder has no active document to replace. */}
               {isDocumentMode && (
                  <>
                     <MenuItem icon={<FolderOpen size={13} />} label={t.menuOpen} onClick={() => handleItemClick(onOpen)} />
                     <MenuSeparator />
                     <MenuItem icon={<Save size={13} />}          label={t.fileSave}         onClick={() => handleItemClick(onSave)} />
                     <MenuItem icon={<SaveAll size={13} />}       label={t.fileSaveAs}       onClick={() => handleItemClick(onSaveAs)} />
                     <MenuItem icon={<LayoutTemplate size={13} />} label={t.saveAsTemplate}  onClick={() => handleItemClick(onSaveAsTemplate)} />
                     <MenuSeparator />
                     <MenuItem icon={<Download size={13} />} label={t.menuExport} onClick={() => handleItemClick(onExport)} />
                  </>
               )}

               {!isDocumentMode && (
                  <>
                     <MenuSeparator />
                     <MenuItem icon={<Upload size={13} />}  label={t.fileImport}  onClick={() => handleItemClick(onImport)} />
                     <MenuSeparator />
                     <MenuItem icon={<Archive size={13} />} label={t.fileSaveTin} onClick={() => handleItemClick(onSaveTin)} />
                     <MenuItem icon={<PackageOpen size={13} />} label={t.fileOpenTin} onClick={() => handleItemClick(onOpenTin)} />
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

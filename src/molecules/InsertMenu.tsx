import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, LayoutGrid } from 'lucide-react'
import { BlockTypePicker } from './BlockTypePicker'
import type { BlockType } from '../types'
import type { T } from '../lib/i18n'

// #########
// # TYPES #
// #########

interface InsertMenuProps {
   /** ID of the last section, or null if there are no sections yet. */
   lastSectionId: string | null
   onAddSection:  () => void
   onAddBlock:    (sectionId: string, type: BlockType) => void
   t: T
}

// #############
// # COMPONENT #
// #############

export function InsertMenu({ lastSectionId, onAddSection, onAddBlock, t }: InsertMenuProps) {
   const [open, setOpen]                       = useState(false)
   const [blockPickerOpen, setBlockPickerOpen] = useState(false)
   const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null)

   const containerRef       = useRef<HTMLDivElement>(null)
   const addBlockButtonRef  = useRef<HTMLButtonElement>(null)

   // Close dropdown on outside click.
   useEffect(() => {
      if (!open) return
      function handleOutsideMouseDown(event: MouseEvent) {
         if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handleOutsideMouseDown)
      return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
   }, [open])

   function handleAddSectionClick() {
      onAddSection()
      setOpen(false)
   }

   function handleAddBlockClick() {
      if (!lastSectionId || !addBlockButtonRef.current) return
      setOpen(false)
      setPickerAnchorRect(addBlockButtonRef.current.getBoundingClientRect())
      setBlockPickerOpen(true)
   }

   function handleBlockTypeSelect(type: BlockType) {
      if (lastSectionId) onAddBlock(lastSectionId, type)
      setBlockPickerOpen(false)
      setPickerAnchorRect(null)
   }

   function handleBlockPickerClose() {
      setBlockPickerOpen(false)
      setPickerAnchorRect(null)
   }

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
            {t.menuInsert}
            <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
         </button>

         {/* Dropdown */}
         {open && (
            <div className="absolute top-full mt-1.5 left-0 min-w-48 rounded-lg border border-border bg-raised shadow-xl z-200 overflow-hidden" style={{ animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}>
               <button
                  onClick={handleAddSectionClick}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
                     transition-colors cursor-pointer hover:bg-border/50 text-text"
               >
                  <span className="text-muted"><Plus size={13} /></span>
                  <span className="flex-1">{t.addSection}</span>
               </button>

               <button
                  ref={addBlockButtonRef}
                  onClick={handleAddBlockClick}
                  disabled={!lastSectionId}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
                     transition-colors cursor-pointer hover:bg-border/50 text-text
                     disabled:opacity-40 disabled:cursor-not-allowed"
               >
                  <span className="text-muted"><LayoutGrid size={13} /></span>
                  <span className="flex-1">{t.addBlock}</span>
               </button>
            </div>
         )}

         {/* Block type picker portal */}
         {blockPickerOpen && pickerAnchorRect && (
            <BlockTypePicker
               anchorRect={pickerAnchorRect}
               onSelect={handleBlockTypeSelect}
               onClose={handleBlockPickerClose}
            />
         )}
      </div>
   )
}

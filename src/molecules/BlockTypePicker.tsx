import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignLeft, Heading3, Heading4, Info, Code2, List, Table, Image, Columns2 } from 'lucide-react'
import type { BlockType } from '../types'

interface PickerItem {
   type:        BlockType
   label:       string
   description: string
   Icon:        React.ElementType
}

const ALL_ITEMS: PickerItem[] = [
   { type: 'p',         Icon: AlignLeft, label: 'Paragraph',   description: 'Rich text — bold, italic, links' },
   { type: 'h3',        Icon: Heading3,  label: 'Heading 3',   description: 'Large section sub-heading' },
   { type: 'h4',        Icon: Heading4,  label: 'Heading 4',   description: 'Smaller sub-heading' },
   { type: 'callout',   Icon: Info,      label: 'Callout',     description: 'Highlighted note — info, warning, danger, valid' },
   { type: 'code',      Icon: Code2,     label: 'Code block',  description: 'Syntax-highlighted snippet' },
   { type: 'list',      Icon: List,      label: 'List',        description: 'Bullet points with optional sub-items' },
   { type: 'table',     Icon: Table,     label: 'Table',       description: 'Rows and columns with headers' },
   { type: 'image',     Icon: Image,     label: 'Image',       description: 'Photo or graphic with caption' },
   { type: 'container', Icon: Columns2,  label: 'Two columns', description: 'Side-by-side blocks with adjustable ratio' },
]

const PICKER_WIDTH  = 264
const ITEM_HEIGHT   = 44
const PADDING       = 8

interface BlockTypePickerProps {
   onSelect:         (type: BlockType) => void
   onClose:          () => void
   insideContainer?: boolean
   anchorRect:       DOMRect
   // Hint for which direction to prefer opening. Defaults to auto (based on space).
   preferAbove?:     boolean
}

export function BlockTypePicker({ onSelect, onClose, insideContainer, anchorRect, preferAbove }: BlockTypePickerProps) {
   const items = insideContainer ? ALL_ITEMS.filter(item => item.type !== 'container') : ALL_ITEMS
   const pickerHeight = items.length * ITEM_HEIGHT + PADDING * 2

   const [focused, setFocused] = useState(0)
   const listRef = useRef<HTMLDivElement>(null)

   // Compute fixed position
   const viewportHeight = window.innerHeight
   const viewportWidth  = window.innerWidth
   const spaceBelow     = viewportHeight - anchorRect.bottom - 8
   const spaceAbove     = anchorRect.top - 8
   const openAbove      = preferAbove
      ? spaceAbove >= 80
      : spaceBelow < pickerHeight && spaceAbove > spaceBelow

   const top  = openAbove ? anchorRect.top - pickerHeight - 4 : anchorRect.bottom + 4
   const left = Math.min(
      Math.max(8, anchorRect.left),
      viewportWidth - PICKER_WIDTH - 8,
   )

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
         if (event.key === 'ArrowDown') { event.preventDefault(); setFocused(current => (current + 1) % items.length); return }
         if (event.key === 'ArrowUp')   { event.preventDefault(); setFocused(current => (current - 1 + items.length) % items.length); return }
         if (event.key === 'Enter')     { event.preventDefault(); onSelect(items[focused].type); return }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [focused, items, onSelect, onClose])

   useEffect(() => {
      function onPointerDown(event: PointerEvent) {
         if (!listRef.current?.contains(event.target as Node)) onClose()
      }
      document.addEventListener('pointerdown', onPointerDown)
      return () => document.removeEventListener('pointerdown', onPointerDown)
   }, [onClose])

   return createPortal(
      <div
         ref={listRef}
         className="fixed z-[9999] rounded-xl border border-border bg-raised shadow-2xl overflow-hidden"
         style={{ top, left, width: PICKER_WIDTH, padding: PADDING }}
      >
         {items.map((item, index) => (
            <button
               key={item.type}
               className={[
                  'w-full flex items-center gap-3 px-3 rounded-lg transition-colors cursor-pointer text-left',
                  'border-0 bg-transparent',
                  focused === index
                     ? 'bg-accent/10 text-text'
                     : 'text-text/80 hover:bg-accent/6',
               ].join(' ')}
               style={{ height: ITEM_HEIGHT }}
               onPointerEnter={() => setFocused(index)}
               onClick={() => onSelect(item.type)}
            >
               <item.Icon size={15} className="shrink-0 text-muted" />
               <div className="min-w-0">
                  <span className="block text-xs font-semibold leading-tight">{item.label}</span>
                  <span className="block text-[10px] text-muted leading-tight truncate">{item.description}</span>
               </div>
            </button>
         ))}
      </div>,
      document.body,
   )
}

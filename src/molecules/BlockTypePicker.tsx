import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignLeft, Heading3, Heading4, Info, Code2, Sigma, List, ListChecks, Table, Image, Columns2, SeparatorHorizontal } from 'lucide-react'
import type { BlockType } from '../types'
import { useLang } from '../contexts/LangContext'
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

interface PickerItem {
   type:        BlockType
   label:       string
   description: string
   Icon:        React.ElementType
}

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
   const { t } = useLang()

   const allItems: PickerItem[] = [
      { type: 'p',         Icon: AlignLeft, label: t.blockParagraph, description: t.blockParagraphDesc },
      { type: 'h3',        Icon: Heading3,  label: t.blockH3,        description: t.blockH3Desc },
      { type: 'h4',        Icon: Heading4,  label: t.blockH4,        description: t.blockH4Desc },
      { type: 'callout',   Icon: Info,      label: t.blockCallout,   description: t.blockCalloutDesc },
      { type: 'code',      Icon: Code2,     label: t.blockCode,      description: t.blockCodeDesc },
      { type: 'math',      Icon: Sigma,     label: t.blockMath,      description: t.blockMathDesc },
      { type: 'list',      Icon: List,       label: t.blockList,       description: t.blockListDesc },
      { type: 'checklist', Icon: ListChecks, label: t.blockChecklist,  description: t.blockChecklistDesc },
      { type: 'table',     Icon: Table,     label: t.blockTable,      description: t.blockTableDesc },
      { type: 'image',     Icon: Image,     label: t.blockImage,      description: t.blockImageDesc },
      { type: 'container', Icon: Columns2,           label: t.blockContainer, description: t.blockContainerDesc },
      { type: 'hr',        Icon: SeparatorHorizontal, label: t.blockHr,        description: t.blockHrDesc },
   ]

   const items = insideContainer ? allItems.filter(item => item.type !== 'container') : allItems

   const [focused, setFocused] = useState(0)

   // Measured, two-sided clamp on both axes (flips above/below the anchor, then keeps the picker
   // fully on-screen even when neither side has enough room) — replaces the old height-estimate
   // heuristic that only handled the above/below choice and never clamped the vertical axis.
   const { ref: listRef, top, left } = useViewportClampedPosition<HTMLDivElement>({
      type: 'rect', rect: anchorRect, preferAbove,
   })
   const openAbove = top < anchorRect.top

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
   }, [onClose, listRef])

   return createPortal(
      <div
         ref={listRef}
         className="fixed z-[9999] rounded-xl border border-border bg-raised shadow-2xl overflow-hidden"
         style={{
            top, left, width: PICKER_WIDTH, padding: PADDING,
            animation: 'menu-in 120ms ease-out both',
            transformOrigin: openAbove ? '50% 100%' : '50% 0%',
         }}
      >
         {items.map((item, index) => (
            <button
               key={item.type}
               className={[
                  'w-full flex items-center gap-3 px-3 rounded-lg transition-colors cursor-pointer text-left',
                  'border-0',
                  focused === index
                     ? 'bg-accent/10 text-text'
                     : 'text-text/75 hover:text-text hover:bg-accent/10',
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

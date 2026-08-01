import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignLeft, Heading3, Heading4, Info, Code2, Sigma, BarChart3, List, ListChecks, Table, Image, Columns2, SeparatorHorizontal } from 'lucide-react'
import type { BlockType } from '../types'
import { useLang } from '../contexts/LangContext'
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

type PickerCategory = 'text' | 'lists' | 'codeMath' | 'mediaData' | 'layout'

interface PickerItem {
   type:        BlockType
   label:       string
   description: string
   Icon:        React.ElementType
   category:    PickerCategory
}

const PICKER_WIDTH     = 320
const PANEL_MAX_HEIGHT = 480
const ITEM_HEIGHT      = 44

// Category order the grouped list is rendered in. Headers for empty groups (all their
// items filtered out) are simply skipped further down.
const CATEGORY_ORDER: PickerCategory[] = ['text', 'lists', 'codeMath', 'mediaData', 'layout']

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
      { type: 'p',         Icon: AlignLeft, label: t.blockParagraph, description: t.blockParagraphDesc, category: 'text' },
      { type: 'h3',        Icon: Heading3,  label: t.blockH3,        description: t.blockH3Desc,        category: 'text' },
      { type: 'h4',        Icon: Heading4,  label: t.blockH4,        description: t.blockH4Desc,        category: 'text' },
      { type: 'callout',   Icon: Info,      label: t.blockCallout,   description: t.blockCalloutDesc,   category: 'text' },
      { type: 'list',      Icon: List,       label: t.blockList,       description: t.blockListDesc,       category: 'lists' },
      { type: 'checklist', Icon: ListChecks, label: t.blockChecklist,  description: t.blockChecklistDesc,  category: 'lists' },
      { type: 'code',      Icon: Code2,     label: t.blockCode,      description: t.blockCodeDesc,      category: 'codeMath' },
      { type: 'math',      Icon: Sigma,     label: t.blockMath,      description: t.blockMathDesc,      category: 'codeMath' },
      { type: 'image',     Icon: Image,     label: t.blockImage,      description: t.blockImageDesc,      category: 'mediaData' },
      { type: 'table',     Icon: Table,     label: t.blockTable,      description: t.blockTableDesc,      category: 'mediaData' },
      { type: 'graph',     Icon: BarChart3, label: t.blockGraph,      description: t.blockGraphDesc,      category: 'mediaData' },
      { type: 'container', Icon: Columns2,           label: t.blockContainer, description: t.blockContainerDesc, category: 'layout' },
      { type: 'hr',        Icon: SeparatorHorizontal, label: t.blockHr,        description: t.blockHrDesc,        category: 'layout' },
   ]

   const categoryLabels: Record<PickerCategory, string> = {
      text:      t.blockCategoryText,
      lists:     t.blockCategoryLists,
      codeMath:  t.blockCategoryCodeMath,
      mediaData: t.blockCategoryMediaData,
      layout:    t.blockCategoryLayout,
   }

   const items = insideContainer ? allItems.filter(item => item.type !== 'container') : allItems

   const [filterQuery, setFilterQuery] = useState('')
   const [focused, setFocused] = useState(0)

   const normalizedQuery = filterQuery.trim().toLowerCase()
   const filteredItems = normalizedQuery === ''
      ? items
      : items.filter(item =>
           item.label.toLowerCase().includes(normalizedQuery) ||
           item.description.toLowerCase().includes(normalizedQuery),
        )

   // Groups drive rendering (headers + their items); empty groups drop out entirely
   // while filtering. visibleItems is the flat, header-free order used for keyboard nav.
   const groups = CATEGORY_ORDER
      .map(categoryKey => ({
         key:   categoryKey,
         label: categoryLabels[categoryKey],
         items: filteredItems.filter(item => item.category === categoryKey),
      }))
      .filter(group => group.items.length > 0)
   const visibleItems = groups.flatMap(group => group.items)

   // Reset the focused item to the first match whenever the filter narrows or widens the list.
   useEffect(() => {
      setFocused(0)
   }, [filterQuery])

   // Measured, two-sided clamp on both axes (flips above/below the anchor, then keeps the picker
   // fully on-screen even when neither side has enough room) — replaces the old height-estimate
   // heuristic that only handled the above/below choice and never clamped the vertical axis.
   const { ref: listRef, top, left } = useViewportClampedPosition<HTMLDivElement>({
      type: 'rect', rect: anchorRect, preferAbove,
   })
   const openAbove = top < anchorRect.top

   const filterInputRef = useRef<HTMLInputElement>(null)
   useEffect(() => {
      filterInputRef.current?.focus()
   }, [])

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
         if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (visibleItems.length > 0) setFocused(current => (current + 1) % visibleItems.length)
            return
         }
         if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (visibleItems.length > 0) setFocused(current => (current - 1 + visibleItems.length) % visibleItems.length)
            return
         }
         if (event.key === 'Enter') {
            event.preventDefault()
            if (visibleItems[focused]) onSelect(visibleItems[focused].type)
            return
         }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
   }, [focused, visibleItems, onSelect, onClose])

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
         className="fixed z-[9999] flex flex-col rounded-xl border border-border bg-raised shadow-2xl overflow-hidden"
         style={{
            top, left, width: PICKER_WIDTH, maxHeight: PANEL_MAX_HEIGHT,
            animation: 'menu-in 120ms ease-out both',
            transformOrigin: openAbove ? '50% 100%' : '50% 0%',
         }}
      >
         <input
            ref={filterInputRef}
            type="text"
            value={filterQuery}
            onChange={event => setFilterQuery(event.target.value)}
            placeholder={t.blockFilterPlaceholder}
            className="mx-2 mt-2 mb-1 shrink-0 rounded-lg border border-border bg-base px-3 py-2 text-xs text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
         />
         {/* Scroll lives on this INNER element, not the rounded outer: a scrollbar on the rounded
             box itself squares off the corners it sits on, so we clip it inside the rounding
             instead (outer = rounded + overflow-hidden). min-h-0 lets it shrink under maxHeight. */}
         <div className="min-h-0 overflow-y-auto px-2 pb-2">
            {groups.map(group => (
               <div key={group.key}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                     {group.label}
                  </div>
                  {group.items.map(item => {
                     const index = visibleItems.indexOf(item)
                     return (
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
                           <item.Icon size={16} className="shrink-0 text-muted" />
                           <div className="min-w-0">
                              <span className="block text-xs font-semibold leading-tight">{item.label}</span>
                              <span className="block text-[10px] text-muted leading-tight truncate">{item.description}</span>
                           </div>
                        </button>
                     )
                  })}
               </div>
            ))}
         </div>
      </div>,
      document.body,
   )
}

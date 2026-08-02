// -- React Imports --
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

// -- Library Imports --
import { createPortal } from 'react-dom'

// -- Hook Imports --
import { useViewportClampedPosition } from '../hooks/useViewportClampedPosition'

// -- Molecule Imports --
import { AccentSwatchGrid, type AccentSwatchOption, type AccentCustomSwatchOption } from './AccentSwatchGrid'

// #########
// # TYPES #
// #########

export interface ContextMenuItem {
   label:     string
   icon?:     ReactElement
   onSelect:  () => void
   danger?:   boolean
   disabled?: boolean
}

/**
 * One row of a menu: an actionable item, a horizontal separator, a non-interactive section
 * header, or the accent picker's swatch grid (a nameless grid of color tiles + an inline-
 * expanding custom-color picker, see molecules/AccentSwatchGrid). Items are the entries without
 * a `type` discriminant.
 */
export type ContextMenuEntry =
   | ContextMenuItem
   | { type: 'separator' }
   | { type: 'header'; label: string }
   | { type: 'accent-grid'; presets: AccentSwatchOption[]; custom?: AccentCustomSwatchOption }

export interface ContextMenuProps {
   /** Click point in viewport coordinates (clientX / clientY). */
   position: { x: number; y: number }
   entries:  ContextMenuEntry[]
   onClose:  () => void
   /** Explicit pixel width; defaults to content width with a min applied by `className`. */
   width?:     number
   /** Overrides the default `min-w-[172px]` sizing wrapper when a menu needs its own width. */
   className?: string
}

// ############
// # INTERNAL #
// ############

function isMenuItem(entry: ContextMenuEntry): entry is ContextMenuItem {
   return !('type' in entry)
}

// Advance the roving focus by one step, skipping disabled items. Bounded by the item
// count so an all-disabled menu (should never happen in practice) can't spin forever.
function stepFocus(items: ContextMenuItem[], current: number, direction: 1 | -1): number {
   const count = items.length
   if (count === 0) return current
   let next = (current + direction + count) % count
   for (let guard = 0; items[next]?.disabled && guard < count; guard++) {
      next = (next + direction + count) % count
   }
   return next
}

// #############
// # COMPONENT #
// #############

/**
 * Portaled context menu with a declarative `entries` API (items, separators, section
 * headers). Owns viewport clamping (via useViewportClampedPosition, two-sided, measured),
 * roving-focus keyboard navigation, and outside-pointerdown / Escape / scroll dismissal.
 * Selecting an item runs its `onSelect` and then closes the menu.
 */
export function ContextMenu({ position, entries, onClose, width, className }: ContextMenuProps) {
   const { ref, top, left } = useViewportClampedPosition<HTMLDivElement>({
      type: 'point',
      x: position.x,
      y: position.y,
   })
   const [focusedIndex, setFocusedIndex] = useState(0)

   const items = entries.filter(isMenuItem)

   function selectItem(item: ContextMenuItem) {
      if (item.disabled) return
      item.onSelect()
      onClose()
   }

   // ============ Keyboard navigation ============
   useEffect(() => {
      function handleKeyDown(event: KeyboardEvent) {
         if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
         }
         if (event.key === 'ArrowDown') {
            event.preventDefault()
            setFocusedIndex(current => stepFocus(items, current, 1))
            return
         }
         if (event.key === 'ArrowUp') {
            event.preventDefault()
            setFocusedIndex(current => stepFocus(items, current, -1))
            return
         }
         if (event.key === 'Enter') {
            event.preventDefault()
            const item = items[focusedIndex]
            if (item && !item.disabled) { item.onSelect(); onClose() }
         }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
   }, [focusedIndex, items, onClose])

   // ============ Dismissal ============
   useEffect(() => {
      function handlePointerDown(event: PointerEvent) {
         if (!ref.current?.contains(event.target as Node)) onClose()
      }
      function handleScroll() { onClose() }
      document.addEventListener('pointerdown', handlePointerDown)
      window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
      return () => {
         document.removeEventListener('pointerdown', handlePointerDown)
         window.removeEventListener('scroll', handleScroll, { capture: true })
      }
   }, [onClose, ref])

   // Tracks the roving-focus index across the mixed entries list (items only).
   let itemIndex = -1

   return createPortal(
      <div
         ref={ref}
         className={[
            'fixed z-[9999] rounded-xl border border-border bg-raised shadow-2xl overflow-hidden',
            className ?? 'min-w-[172px]',
         ].join(' ')}
         style={{ top, left, width, animation: 'menu-in 120ms ease-out both', transformOrigin: '0% 0%' }}
      >
         {entries.map((entry, entryIndex) => {
            if ('type' in entry) {
               if (entry.type === 'separator') {
                  return <div key={`separator-${entryIndex}`} className="my-0.5 h-px mx-2 bg-border" />
               }
               if (entry.type === 'accent-grid') {
                  return <AccentSwatchGrid key={`accent-grid-${entryIndex}`} presets={entry.presets} custom={entry.custom} />
               }
               return (
                  <div
                     key={`header-${entryIndex}`}
                     className="px-3 pt-2 pb-1 text-[0.6rem] uppercase tracking-wider text-muted/60 font-semibold select-none"
                  >
                     {entry.label}
                  </div>
               )
            }

            itemIndex++
            const currentItemIndex = itemIndex
            const isFocused = focusedIndex === currentItemIndex
            return (
               <button
                  key={`item-${entryIndex}`}
                  disabled={entry.disabled}
                  className={[
                     'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs cursor-pointer border-0 transition-colors text-left',
                     entry.disabled
                        ? 'opacity-30 cursor-default'
                        : entry.danger
                           ? isFocused ? 'text-red bg-red/10'    : 'text-red/80 hover:text-red hover:bg-red/10'
                           : isFocused ? 'text-text bg-accent/10' : 'text-text/75 hover:text-text hover:bg-accent/10',
                  ].join(' ')}
                  onPointerEnter={() => !entry.disabled && setFocusedIndex(currentItemIndex)}
                  onClick={entry.disabled ? undefined : () => selectItem(entry)}
               >
                  {entry.icon && <span className="shrink-0">{entry.icon}</span>}
                  <span>{entry.label}</span>
               </button>
            )
         })}
      </div>,
      document.body,
   )
}

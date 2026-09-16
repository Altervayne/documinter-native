// -- React Imports --
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

// -- Library Imports --
import { ArrowRight, Circle, Dot, ListTree, Minus, Square } from 'lucide-react'

// -- Context / Hook Imports --
import { useLang } from '../../../contexts/LangContext'

// -- Component Imports --
import { SegmentedIconToggle, type SegmentedIconToggleOption } from '../../../atoms/SegmentedIconToggle'
import { BlockEditorWindow } from '../../../molecules/BlockEditorWindow'

// -- Library Imports (pure) --
import { ALL_LIST_MARKERS, isOrderedMarker, markerOrDefault } from '../../../lib/listMarkers'
import { setItemChildMarker } from '../../../lib/listItemTree'
import { listItemPlainText } from '../../../lib/document'

// -- Type Imports --
import type { Block, ListItem, ListMarker } from '../../../types'
import type { T } from '../../../lib/i18n'

// ######################
// # LIST MARKER CONTROL #
// ######################
//
// A trigger button beside a `list` block's "Add item" row (never on a checklist, never readOnly),
// opening a per-block BlockEditorWindow with one row per SUB-LIST in reading order: the root, then
// each item that owns children. Each row picks that sub-list's marker. Commits through the block
// `patch` lever, so the write flows through commitActiveEdit (undo/redo invariant). focusOnOpen={false}
// so the list keeps its caret/selection while markers are picked.

const BULLET_MARKERS = ALL_LIST_MARKERS.filter(marker => !isOrderedMarker(marker))
const NUMBER_MARKERS = ALL_LIST_MARKERS.filter(isOrderedMarker)

/** Longest sub-list preview kept in an "Under: <text>" row label before truncating. */
const PREVIEW_MAX_LENGTH = 30

/** Localised tooltip/label for one of the five bullet markers. */
function bulletLabel(marker: ListMarker, t: T): string {
   switch (marker) {
      case 'circle': return t.listMarkerCircle
      case 'square': return t.listMarkerSquare
      case 'dash':   return t.listMarkerDash
      case 'arrow':  return t.listMarkerArrow
      default:       return t.listMarkerDot
   }
}

/** The small lucide glyph drawn on a bullet option button. */
function bulletGlyph(marker: ListMarker): ReactNode {
   switch (marker) {
      case 'circle': return <Circle size={11} />
      case 'square': return <Square size={9} />
      case 'dash':   return <Minus size={12} />
      case 'arrow':  return <ArrowRight size={12} />
      default:       return <Dot size={16} />
   }
}

/** The glyph label for one of the five ordered markers (the glyph IS the label, no leading icon). */
function numberGlyphLabel(marker: ListMarker): string {
   switch (marker) {
      case 'lower-alpha': return 'a.'
      case 'upper-alpha': return 'A.'
      case 'lower-roman': return 'i.'
      case 'upper-roman': return 'I.'
      default:            return '1.'
   }
}

const BULLET_OPTIONS = (t: T): SegmentedIconToggleOption<ListMarker>[] =>
   BULLET_MARKERS.map(marker => ({ value: marker, label: bulletLabel(marker, t), icon: bulletGlyph(marker) }))

const NUMBER_OPTIONS: SegmentedIconToggleOption<ListMarker>[] =
   NUMBER_MARKERS.map(marker => ({ value: marker, label: numberGlyphLabel(marker) }))

// ##############
// # SUB-LISTS  #
// ##############

/** One pickable sub-list: the root (`itemId` null) or an item's child sub-list (`itemId` set). */
interface SubListRow {
   itemId: string | null
   label:  string
   marker: ListMarker
}

/** Truncate a preview to a sane length with an ellipsis, collapsing empty text to a placeholder. */
function previewText(item: ListItem): string {
   const text = listItemPlainText(item).trim()
   if (text.length === 0) return '…'
   return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text
}

/** The list's sub-lists in reading order (pre-order over the item tree): the root first, then every
 *  item that owns children, each row carrying that sub-list's current marker (default dot). */
function collectSubLists(block: Block, t: T): SubListRow[] {
   const rows: SubListRow[] = [
      { itemId: null, label: t.listMarkerRootLabel, marker: markerOrDefault(block.listMarker) },
   ]
   function walk(items: ListItem[]): void {
      for (const item of items) {
         if (item.children.length > 0) {
            rows.push({
               itemId: item.id,
               label:  `${t.listMarkerUnderLabel} ${previewText(item)}`,
               marker: markerOrDefault(item.childMarker),
            })
            walk(item.children)
         }
      }
   }
   walk(block.items ?? [])
   return rows
}

/** True when the whole list is back to default (root dot AND no item carries a child marker). */
function isAllDot(listMarker: ListMarker | undefined, items: ListItem[]): boolean {
   if (listMarker !== undefined && listMarker !== 'dot') return false
   function anyChildMarker(list: ListItem[]): boolean {
      return list.some(item =>
         (item.childMarker !== undefined && item.childMarker !== 'dot') || anyChildMarker(item.children),
      )
   }
   return !anyChildMarker(items)
}

// #############
// # TRIGGER   #
// #############

interface ListMarkerControlProps {
   block: Block
   patch: (partialBlock: Partial<Block>) => void
}

/** Trigger button + window for picking a `list` block's per-sub-list markers. Rows are derived from
 *  the block's item tree, so a freshly-indented parent gets its own "Under:" row on the next open. */
export function ListMarkerControl({ block, patch }: ListMarkerControlProps) {
   const { t } = useLang()
   const [isOpen, setIsOpen]         = useState(false)
   const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
   const triggerRef = useRef<HTMLButtonElement>(null)

   const subLists = collectSubLists(block, t)

   function toggle(): void {
      if (isOpen) {
         setIsOpen(false)
         return
      }
      setAnchorRect(triggerRef.current?.getBoundingClientRect() ?? null)
      setIsOpen(true)
   }

   // Set one sub-list's marker (root -> block.listMarker, else the item's childMarker), then drop
   // every marker when the whole list is back to dot, so a fully-default list stays byte-identical.
   function selectMarker(itemId: string | null, marker: ListMarker): void {
      const normalized = marker === 'dot' ? undefined : marker
      const nextListMarker = itemId === null ? normalized : block.listMarker
      const nextItems      = itemId === null
         ? (block.items ?? [])
         : setItemChildMarker(block.items ?? [], itemId, normalized)

      if (isAllDot(nextListMarker, nextItems)) {
         patch({ listMarker: undefined, items: nextItems })
      } else {
         patch({ listMarker: nextListMarker, items: nextItems })
      }
   }

   return (
      <>
         <button
            type="button"
            ref={triggerRef}
            className={isOpen ? 'doc-list-marker-btn is-open' : 'doc-list-marker-btn'}
            aria-label={t.listMarkerControlLabel}
            title={t.listMarkerControlLabel}
            onClick={toggle}
         >
            <ListTree size={14} />
         </button>
         {isOpen && anchorRect && (
            <BlockEditorWindow
               title={t.listMarkerControlLabel}
               icon={<ListTree size={15} />}
               anchorRect={anchorRect}
               focusOnOpen={false}
               onClose={() => setIsOpen(false)}
            >
               <ListMarkerRows subLists={subLists} onSelect={selectMarker} />
            </BlockEditorWindow>
         )}
      </>
   )
}

// ##########
// # ROWS   #
// ##########

interface ListMarkerRowsProps {
   subLists: SubListRow[]
   onSelect: (itemId: string | null, marker: ListMarker) => void
}

/** The per-sub-list marker rows, hosted inside the BlockEditorWindow body. */
function ListMarkerRows({ subLists, onSelect }: ListMarkerRowsProps) {
   const { t } = useLang()
   const bulletOptions = BULLET_OPTIONS(t)

   return (
      <div className="flex flex-col gap-2.5">
         {subLists.map((subList, index) => {
            const rowKey = subList.itemId ?? 'root'
            return (
               <div key={rowKey} className={index > 0 ? 'flex flex-col gap-1.5 pt-2.5 border-t border-border' : 'flex flex-col gap-1.5'}>
                  <span className="text-xs font-medium text-text select-none truncate" title={subList.label}>{subList.label}</span>
                  <div className="flex flex-col gap-1">
                     <span className="text-[0.65rem] text-muted/70 select-none">{t.listMarkerGroupBullets}</span>
                     <SegmentedIconToggle
                        options={bulletOptions}
                        value={subList.marker}
                        onChange={marker => onSelect(subList.itemId, marker)}
                        ariaLabel={`${t.listMarkerGroupBullets} - ${subList.label}`}
                     />
                  </div>
                  <div className="flex flex-col gap-1">
                     <span className="text-[0.65rem] text-muted/70 select-none">{t.listMarkerGroupNumbers}</span>
                     <SegmentedIconToggle
                        options={NUMBER_OPTIONS}
                        value={subList.marker}
                        onChange={marker => onSelect(subList.itemId, marker)}
                        ariaLabel={`${t.listMarkerGroupNumbers} - ${subList.label}`}
                     />
                  </div>
               </div>
            )
         })}
      </div>
   )
}

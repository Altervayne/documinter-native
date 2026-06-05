// -- React Imports --
import { useRef, useState, useEffect } from 'react'

// -- Library Imports --
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, TriangleAlert } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { useDocumentHandles } from '../../contexts/DocumentHandlesContext'
import { useLang } from '../../contexts/LangContext'

// -- Component Imports --
import { ParagraphBlock }   from './blocks/ParagraphBlock'
import { CalloutBlock }     from './blocks/CalloutBlock'
import { CodeBlock }        from './blocks/CodeBlock'
import { ListBlock }        from './blocks/ListBlock'
import { TableBlock }       from './blocks/TableBlock'
import { ImageBlock }       from './blocks/ImageBlock'
import { ContainerBlock }   from './blocks/ContainerBlock'
import { AnchorEditor }     from './blocks/AnchorEditor'
import { BlockContextMenu, type ListItemContextActions, type TableCellContextActions } from '../../molecules/BlockContextMenu'
import { BlockTypePicker }  from '../../molecules/BlockTypePicker'

// -- Lib / Util Imports --
import {
   generateHandle,
   getListItemContext,
   removeListItemById,
   moveListItemUp, moveListItemDown,
   indentListItem, unindentListItem,
} from '../../lib/document'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations } from '../../types'



interface WysiwygBlockProps {
   secId:  string
   block:  Block
   containerMutations?: ContainerMutations
   /** Inner block inside a container — uses ↑↓ instead of DnD */
   inner?:    boolean
   /** Static read-only view — no editing, no interactions */
   readOnly?: boolean
   /** ID of the block currently being dragged (for insertion indicator) */
   activeBlockId?: string | null
   // Handlers passed from parent (used by both inner and outer blocks)
   onInsertBefore?: (type: BlockType) => void
   onInsertAfter?:  (type: BlockType) => void
   onMoveUp?:       () => void
   onMoveDown?:     () => void
   // Inner block handlers (only when inner=true)
   onUpdate?:        (secId: string, blkId: string, patch: Partial<Block>) => void
   onRemove?:        () => void
   onDuplicate?:     () => void
   onAddListItem?: () => void
   onAddTableRow?:      () => void
   onRemoveLastRow?:    () => void
   onAddTableCol?:      () => void
   onInsertTableRowAt?: (rowIndex: number) => void
   onDeleteTableRowAt?: (rowIndex: number) => void
   onInsertTableColAt?: (colIndex: number) => void
   onDeleteTableColAt?: (colIndex: number) => void
}



export function WysiwygBlock({
   secId, block, containerMutations, activeBlockId,
   inner, readOnly,
   onInsertBefore, onInsertAfter,
   onMoveUp, onMoveDown,
   onUpdate, onRemove, onDuplicate,
   onAddListItem,
   onAddTableRow, onRemoveLastRow, onAddTableCol,
   onInsertTableRowAt, onDeleteTableRowAt, onInsertTableColAt, onDeleteTableColAt,
}: WysiwygBlockProps) {
   const ctx        = useDocumentMutations()
   const { t }      = useLang()
   const allHandles = useDocumentHandles()
   const isAnchorDupe = !readOnly && !!block.handle && allHandles.filter(handle => handle === block.handle).length > 1

   const [hovered,               setHovered]               = useState(false)
   const [contextMenu,           setContextMenu]           = useState<{ x: number; y: number } | null>(null)
   const [contextMenuListItemId, setContextMenuListItemId] = useState<string | null>(null)
   const [contextMenuTableCell,  setContextMenuTableCell]  = useState<{ rowIndex: number; colIndex: number; isHeader: boolean } | null>(null)
   const [pendingInsert,         setPendingInsert]         = useState<'before' | 'after' | null>(null)
   const [anchorEditing, setAnchorEditing] = useState(false)
   const [anchorDraft,   setAnchorDraft]   = useState('')
   const [anchorPos,     setAnchorPos]     = useState<{ top: number; right: number } | null>(null)
   const blockDivRef = useRef<HTMLDivElement>(null)

   // ── Anchor editor ──────────────────────────────────────────
   function openAnchorEditor() {
      setAnchorDraft(block.handle ?? generateHandle(block))
      setAnchorEditing(true)
   }
   function closeAnchorEditor() { setAnchorEditing(false) }
   function confirmAnchor() {
      const slug = anchorDraft.trim().toLowerCase()
         .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
      patch({ handle: slug || undefined })
      closeAnchorEditor()
   }
   function removeAnchor() { patch({ handle: undefined }); closeAnchorEditor() }

   useEffect(() => {
      if (anchorEditing) {
         const rect = blockDivRef.current?.getBoundingClientRect()
         // eslint-disable-next-line react-hooks/set-state-in-effect
         if (rect) setAnchorPos({ top: rect.top, right: window.innerWidth - rect.left + 10 })
      } else {
         setAnchorPos(null)
      }
   }, [anchorEditing])

   // ── Context menu ───────────────────────────────────────────
   function handleContextMenu(event: React.MouseEvent) {
      event.preventDefault()
      const target = event.target as Element

      // List item detection
      const listItemEl = target.closest('[data-list-item-id]')
      setContextMenuListItemId(listItemEl?.getAttribute('data-list-item-id') ?? null)

      // Table cell detection — derive row/col indices from the DOM structure
      if (block.type === 'table' && blockDivRef.current) {
         const cell = target.closest('td, th')
         if (cell && blockDivRef.current.contains(cell)) {
            const isHeader = cell.tagName.toLowerCase() === 'th'
            const row = cell.closest('tr')
            const colIndex = row
               ? Array.from(row.querySelectorAll(isHeader ? 'th' : 'td')).findIndex(el => el === cell)
               : 0
            const rowIndex = isHeader
               ? -1
               : (() => {
                  const tbody = cell.closest('tbody')
                  return tbody && row
                     ? Array.from(tbody.querySelectorAll('tr')).findIndex(el => el === row)
                     : 0
               })()
            setContextMenuTableCell({ rowIndex, colIndex, isHeader })
         } else {
            setContextMenuTableCell(null)
         }
      } else {
         setContextMenuTableCell(null)
      }

      setContextMenu({ x: event.clientX, y: event.clientY })
   }

   // ── DnD ────────────────────────────────────────────────────
   const sortable   = useSortable({ id: block.id, disabled: !!inner || !!readOnly })
   const dndStyle   = inner || readOnly
      ? {}
      : {
         transform:  CSS.Transform.toString(sortable.transform),
         transition: sortable.isDragging ? undefined : sortable.transition,
         opacity:    sortable.isDragging ? 0 : 1,
      }
   const showInsertLine = !readOnly && !inner && sortable.isOver && activeBlockId !== block.id

   // ── Mutation handlers ──────────────────────────────────────
   function patch(partialBlock: Partial<Block>) {
      if (inner && onUpdate) onUpdate(secId, block.id, partialBlock)
      else ctx.updateBlock(secId, block.id, partialBlock)
   }

   const handleRemove    = inner ? onRemove!    : () => ctx.removeBlock(secId, block.id)
   const handleDuplicate = inner ? onDuplicate! : () => ctx.duplicateBlock(secId, block.id)
   const handleListAdd          = inner ? onAddListItem!       : () => ctx.addListItem(secId, block.id)
   const handleRowAdd           = inner ? onAddTableRow!       : () => ctx.addTableRow(secId, block.id)
   const handleRowDel           = inner ? onRemoveLastRow!     : () => ctx.removeLastRow(secId, block.id)
   const handleColAdd           = inner ? onAddTableCol!       : () => ctx.addTableCol(secId, block.id)
   const handleInsertTableRowAt = inner ? onInsertTableRowAt!  : (rowIndex: number) => ctx.insertTableRowAt(secId, block.id, rowIndex)
   const handleDeleteTableRowAt = inner ? onDeleteTableRowAt!  : (rowIndex: number) => ctx.deleteTableRowAt(secId, block.id, rowIndex)
   const handleInsertTableColAt = inner ? onInsertTableColAt!  : (colIndex: number) => ctx.insertTableColAt(secId, block.id, colIndex)
   const handleDeleteTableColAt = inner ? onDeleteTableColAt!  : (colIndex: number) => ctx.deleteTableColAt(secId, block.id, colIndex)

   // ── Block picker anchorRect ────────────────────────────────
   function getBlockRect(): DOMRect {
      return blockDivRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0)
   }

   // ── Ref merge (DnD + blockDivRef) ──────────────────────────
   function setWrapRef(node: HTMLDivElement | null) {
      blockDivRef.current = node
      if (!inner && !readOnly) sortable.setNodeRef(node)
   }

   const wrapAttr = inner || readOnly ? {} : sortable.attributes

   // ── Content renderer ───────────────────────────────────────
   function renderBlockContent() {
      if (block.type === 'p' || block.type === 'h3' || block.type === 'h4')
         return <ParagraphBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'callout')
         return <CalloutBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'code')
         return <CodeBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'list')
         return <ListBlock block={block} patch={patch} onAddItem={handleListAdd} readOnly={readOnly} />
      if (block.type === 'table')
         return <TableBlock block={block} patch={patch} onAddRow={handleRowAdd} onAddCol={handleColAdd} onRemoveRow={handleRowDel} readOnly={readOnly} />
      if (block.type === 'image')
         return <ImageBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'container' && (containerMutations || readOnly))
         return <ContainerBlock block={block} patch={patch} containerMutations={containerMutations!} secId={secId} readOnly={readOnly} />
      return null
   }

   return (
      <div
         ref={setWrapRef} style={dndStyle} {...wrapAttr}
         className={[
            'relative rounded-md transition-colors my-4',
            !readOnly && hovered ? 'doc-block-hover' : '',
            isAnchorDupe ? 'ring-2 ring-amber-400/60' : '',
         ].join(' ')}
         onMouseEnter={readOnly ? undefined : () => setHovered(true)}
         onMouseLeave={readOnly ? undefined : () => setHovered(false)}
         onContextMenu={readOnly ? undefined : handleContextMenu}
      >
         {/* DnD insertion indicator */}
         {showInsertLine && (
            <div className="absolute -top-px left-0 right-0 h-0.5 rounded-sm opacity-70 pointer-events-none"
               style={{ background: 'var(--doc-accent, var(--color-accent))' }} />
         )}

         {/* DnD grip — outer blocks only, appears on hover */}
         {!inner && !readOnly && (
            <div
               {...sortable.listeners}
               className={[
                  'absolute -left-12 inset-y-0 flex items-center justify-center w-6',
                  'cursor-grab active:cursor-grabbing transition-opacity',
                  'text-muted/40 hover:text-muted/80',
                  hovered ? 'opacity-100' : 'opacity-0',
               ].join(' ')}
               title={t.dragToReorder}
            >
               <GripVertical size={30} />
            </div>
         )}

         {/* Anchor editor */}
         {!readOnly && anchorEditing && anchorPos && (
            <AnchorEditor
               draft={anchorDraft}
               currentHandle={block.handle}
               hasHandle={!!block.handle}
               onChange={setAnchorDraft}
               onConfirm={confirmAnchor}
               onClose={closeAnchorEditor}
               onRemove={removeAnchor}
               pos={anchorPos}
            />
         )}

         {/* Right-click context menu */}
         {contextMenu && (() => {
            let listItemActions: ListItemContextActions | undefined
            if (contextMenuListItemId && block.type === 'list') {
               const itemCtx = getListItemContext(block.items ?? [], contextMenuListItemId)
               if (itemCtx) {
                  const itemId = contextMenuListItemId
                  const rootItems = block.items ?? []
                  listItemActions = {
                     canMoveUp:   itemCtx.indexInParent > 0,
                     canMoveDown: itemCtx.indexInParent < itemCtx.siblingsCount - 1,
                     canIndent:   itemCtx.indexInParent > 0,
                     canUnindent: itemCtx.depth > 0,
                     onMoveUp:    () => patch({ items: moveListItemUp(rootItems, itemId) }),
                     onMoveDown:  () => patch({ items: moveListItemDown(rootItems, itemId) }),
                     onIndent:    () => patch({ items: indentListItem(rootItems, itemId) }),
                     onUnindent:  () => patch({ items: unindentListItem(rootItems, itemId) }),
                     onDelete:    () => patch({ items: removeListItemById(rootItems, itemId) }),
                  }
               }
            }
            let tableCellActions: TableCellContextActions | undefined
            if (contextMenuTableCell && block.type === 'table') {
               const { rowIndex, colIndex } = contextMenuTableCell
               const rowCount = block.rows?.length ?? 0
               const colCount = block.headers?.length ?? 0
               tableCellActions = {
                  rowIndex,
                  colIndex,
                  rowCount,
                  colCount,
                  onInsertRowAbove: () => handleInsertTableRowAt(rowIndex === -1 ? 0 : rowIndex),
                  onInsertRowBelow: () => handleInsertTableRowAt(rowIndex === -1 ? 0 : rowIndex + 1),
                  onInsertColLeft:  () => handleInsertTableColAt(colIndex),
                  onInsertColRight: () => handleInsertTableColAt(colIndex + 1),
                  onDeleteRow:      () => { if (rowIndex >= 0) handleDeleteTableRowAt(rowIndex) },
                  onDeleteCol:      () => handleDeleteTableColAt(colIndex),
               }
            }

            return (
               <BlockContextMenu
                  position={contextMenu}
                  canMoveUp={!!onMoveUp}
                  canMoveDown={!!onMoveDown}
                  hasAnchor={!!block.handle}
                  isAnchorDupe={isAnchorDupe}
                  onInsertBefore={() => setPendingInsert('before')}
                  onInsertAfter={() => setPendingInsert('after')}
                  onMoveUp={onMoveUp}
                  onMoveDown={onMoveDown}
                  onDuplicate={handleDuplicate}
                  onAnchorEdit={openAnchorEditor}
                  onDelete={handleRemove}
                  onClose={() => { setContextMenu(null); setContextMenuListItemId(null); setContextMenuTableCell(null) }}
                  listItem={listItemActions}
                  tableCell={tableCellActions}
               />
            )
         })()}

         {/* Block type picker for insert before / after */}
         {pendingInsert && (
            <BlockTypePicker
               anchorRect={getBlockRect()}
               preferAbove={pendingInsert === 'before'}
               insideContainer={!!inner}
               onSelect={(type: BlockType) => {
                  if (pendingInsert === 'before') onInsertBefore?.(type)
                  else onInsertAfter?.(type)
                  setPendingInsert(null)
               }}
               onClose={() => setPendingInsert(null)}
            />
         )}

         {/* Block content */}
         <div className="min-w-0">
            {renderBlockContent()}
         </div>

         {/* Duplicate anchor warning */}
         {isAnchorDupe && (
            <div className="flex items-center gap-1 mt-1 px-1 text-amber-500 text-xs font-medium">
               <TriangleAlert size={11} />
               <span>{t.duplicateAnchor} — #{block.handle}</span>
            </div>
         )}
      </div>
   )
}

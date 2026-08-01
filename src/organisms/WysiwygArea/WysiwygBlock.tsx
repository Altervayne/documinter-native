// -- React Imports --
import { useEffect, useRef, useState } from 'react'

// -- Library Imports --
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, TriangleAlert } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../contexts/DocumentMutationsContext'
import { useDocumentHandles } from '../../contexts/DocumentHandlesContext'
import { useBlockEditorWindow } from '../../contexts/BlockEditorWindowContext'
import { useLang } from '../../contexts/LangContext'
import { useAnchorEditor } from './useAnchorEditor'
import { useBlockContextMenu } from './useBlockContextMenu'

// -- Component Imports --
import { ParagraphBlock }   from './blocks/ParagraphBlock'
import { CalloutBlock }     from './blocks/CalloutBlock'
import { CodeBlock }        from './blocks/CodeBlock'
import { MathBlock }        from './blocks/MathBlock'
import { GraphBlock }       from './blocks/GraphBlock'
import { ListBlock, type ListItemOperations } from './blocks/ListBlock'
import { ChecklistBlock }   from './blocks/ChecklistBlock'
import { TableBlock }       from './blocks/TableBlock'
import { ImageBlock }       from './blocks/ImageBlock'
import { ContainerBlock }   from './blocks/ContainerBlock'
import { HrBlock }          from './blocks/HrBlock'
import { AnchorEditor }     from './blocks/AnchorEditor'
import { BlockContextMenu } from '../../molecules/BlockContextMenu'
import { BlockTypePicker }  from '../../molecules/BlockTypePicker'

// -- Type Imports --
import type { Block, BlockType, ContainerMutations, InlineContent, ListItem } from '../../types'



interface WysiwygBlockProps {
   secId:  string
   block:  Block
   containerMutations?: ContainerMutations
   /** Inner block inside a container, routes mutations through passed props */
   inner?:    boolean
   /** When inner=true, also enables DnD drag-to-reorder for this block */
   draggable?: boolean
   /** Which side the drag grip renders on, defaults to 'left' */
   gripSide?: 'left' | 'right'
   /** Static read-only view, no editing, no interactions */
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
   /** Inner-block-only lever for inserting an already-built sibling block right after this one
    *  (the graph<->table one-shot extract actions: "Create chart from this table" / "Extract
    *  data to a table"). Outer (non-inner) blocks route straight through ctx.insertBlockAfter. */
   onInsertBlockAfter?: (newBlock: Block) => void
   onAddListItem?: () => void
   onAddTableRow?:      () => void
   onRemoveLastRow?:    () => void
   onAddTableCol?:      () => void
   onInsertTableRowAt?: (rowIndex: number) => void
   onDeleteTableRowAt?: (rowIndex: number) => void
   onInsertTableColAt?: (colIndex: number) => void
   onDeleteTableColAt?: (colIndex: number) => void
   // Inner list-item operations (only when inner=true), routed through containerMutations
   onMoveListItemUp?:        (itemId: string) => void
   onMoveListItemDown?:      (itemId: string) => void
   onIndentListItem?:        (itemId: string) => void
   onUnindentListItem?:      (itemId: string) => void
   onRemoveListItem?:        (itemId: string) => void
   onInsertListItemAfter?:   (afterItemId: string, newItem: ListItem) => void
   onUpdateListItemRichText?:(itemId: string, richText: InlineContent) => void
   onReorderListItems?:      (parentItemId: string | null, oldIndex: number, newIndex: number) => void
   onToggleChecklistItem?:   (itemId: string) => void
}



export function WysiwygBlock({
   secId, block, containerMutations, activeBlockId,
   inner, draggable, gripSide = 'left', readOnly,
   onInsertBefore, onInsertAfter,
   onMoveUp, onMoveDown,
   onUpdate, onRemove, onDuplicate, onInsertBlockAfter,
   onAddListItem,
   onAddTableRow, onRemoveLastRow, onAddTableCol,
   onInsertTableRowAt, onDeleteTableRowAt, onInsertTableColAt, onDeleteTableColAt,
   onMoveListItemUp, onMoveListItemDown, onIndentListItem, onUnindentListItem, onRemoveListItem,
   onInsertListItemAfter, onUpdateListItemRichText, onReorderListItems, onToggleChecklistItem,
}: WysiwygBlockProps) {
   const ctx          = useDocumentMutations()
   const { t }        = useLang()
   const allHandles   = useDocumentHandles()
   const editorWindow = useBlockEditorWindow()
   const isAnchorDupe = !readOnly && !!block.handle && allHandles.filter(handle => handle === block.handle).length > 1
   // The block's editor window is open → highlight it and drop its inline controls (block-owned).
   const isWindowOpen = !readOnly && editorWindow.isEditing(block.id)

   // Unmount safety: a deleted / undone-away block clears its own open id so the context never
   // holds a dangling reference. Deliberately unmount-only (block.id is stable per instance) — the
   // functional clear (see clearIfEditing) keeps the captured context reference stale-closure safe.
   // Depending on `editorWindow` would re-run the cleanup on every openBlockId change and wrongly
   // clear the just-opened block, so it is intentionally excluded.
   // eslint-disable-next-line react-hooks/exhaustive-deps
   useEffect(() => () => editorWindow.clearIfEditing(block.id), [block.id])

   const [hovered,       setHovered]       = useState(false)
   const [pendingInsert, setPendingInsert] = useState<'before' | 'after' | null>(null)
   const blockDivRef = useRef<HTMLDivElement>(null)

   // ====
   //  DnD
   // ====
   // isDraggable: outer blocks always participate; inner blocks only when draggable=true
   const isDraggable = !!draggable || !inner
   const sortable    = useSortable({ id: block.id, disabled: !isDraggable || !!readOnly })
   const dndStyle    = !isDraggable || readOnly
      ? {}
      : {
         transform:  CSS.Transform.toString(sortable.transform),
         transition: sortable.isDragging ? undefined : sortable.transition,
         opacity:    sortable.isDragging ? 0 : 1,
      }
   const showInsertLine = !readOnly && isDraggable && sortable.isOver && activeBlockId !== block.id

   // ==================
   //  Mutation handlers
   // ==================
   function patch(partialBlock: Partial<Block>) {
      if (inner && onUpdate) onUpdate(secId, block.id, partialBlock)
      else ctx.updateBlock(secId, block.id, partialBlock)
   }

   const handleRemove    = inner ? onRemove!    : () => ctx.removeBlock(secId, block.id)
   const handleDuplicate = inner ? onDuplicate! : () => ctx.duplicateBlock(secId, block.id)
   const handleInsertBlockAfter = inner ? onInsertBlockAfter! : (newBlock: Block) => ctx.insertBlockAfter(secId, block.id, newBlock)
   const handleListAdd          = inner ? onAddListItem!       : () => ctx.addListItem(secId, block.id)
   const handleRowAdd           = inner ? onAddTableRow!       : () => ctx.addTableRow(secId, block.id)
   const handleRowDel           = inner ? onRemoveLastRow!     : () => ctx.removeLastRow(secId, block.id)
   const handleColAdd           = inner ? onAddTableCol!       : () => ctx.addTableCol(secId, block.id)
   const handleInsertTableRowAt = inner ? onInsertTableRowAt!  : (rowIndex: number) => ctx.insertTableRowAt(secId, block.id, rowIndex)
   const handleDeleteTableRowAt = inner ? onDeleteTableRowAt!  : (rowIndex: number) => ctx.deleteTableRowAt(secId, block.id, rowIndex)
   const handleInsertTableColAt = inner ? onInsertTableColAt!  : (colIndex: number) => ctx.insertTableColAt(secId, block.id, colIndex)
   const handleDeleteTableColAt = inner ? onDeleteTableColAt!  : (colIndex: number) => ctx.deleteTableColAt(secId, block.id, colIndex)

   // List-item operations, routed exactly like the table handlers above.
   const handleMoveListItemUp         = inner ? onMoveListItemUp!         : (itemId: string) => ctx.moveListItemUp(secId, block.id, itemId)
   const handleMoveListItemDown       = inner ? onMoveListItemDown!       : (itemId: string) => ctx.moveListItemDown(secId, block.id, itemId)
   const handleIndentListItem         = inner ? onIndentListItem!         : (itemId: string) => ctx.indentListItem(secId, block.id, itemId)
   const handleUnindentListItem       = inner ? onUnindentListItem!       : (itemId: string) => ctx.unindentListItem(secId, block.id, itemId)
   const handleRemoveListItem         = inner ? onRemoveListItem!         : (itemId: string) => ctx.removeListItem(secId, block.id, itemId)
   const handleInsertListItemAfter    = inner ? onInsertListItemAfter!    : (afterItemId: string, newItem: ListItem) => ctx.insertListItemAfter(secId, block.id, afterItemId, newItem)
   const handleUpdateListItemRichText = inner ? onUpdateListItemRichText! : (itemId: string, richText: InlineContent) => ctx.updateListItemRichText(secId, block.id, itemId, richText)
   const handleReorderListItems       = inner ? onReorderListItems!       : (parentItemId: string | null, oldIndex: number, newIndex: number) => ctx.reorderListItemsUnderParent(secId, block.id, parentItemId, oldIndex, newIndex)
   const handleToggleChecklistItem    = inner ? onToggleChecklistItem!    : (itemId: string) => ctx.toggleChecklistItem(secId, block.id, itemId)

   const listItemOps: ListItemOperations = {
      indent:         handleIndentListItem,
      unindent:       handleUnindentListItem,
      insertAfter:    handleInsertListItemAfter,
      remove:         handleRemoveListItem,
      updateRichText: handleUpdateListItemRichText,
      reorder:        handleReorderListItems,
      toggle:         handleToggleChecklistItem,
   }

   // =======================
   //  Anchor + context menu
   // =======================
   const anchor = useAnchorEditor({ block, blockDivRef, patch })
   const { contextMenuProps, openContextMenu } = useBlockContextMenu({
      block,
      blockDivRef,
      isAnchorDupe,
      onMoveUp,
      onMoveDown,
      onDuplicate: handleDuplicate,
      onDelete:    handleRemove,
      onAnchorEdit: anchor.openAnchorEditor,
      onRequestInsertBefore: () => setPendingInsert('before'),
      onRequestInsertAfter:  () => setPendingInsert('after'),
      onMoveListItemUp:   handleMoveListItemUp,
      onMoveListItemDown: handleMoveListItemDown,
      onIndentListItem:   handleIndentListItem,
      onUnindentListItem: handleUnindentListItem,
      onRemoveListItem:   handleRemoveListItem,
      onInsertTableRowAt: handleInsertTableRowAt,
      onDeleteTableRowAt: handleDeleteTableRowAt,
      onInsertTableColAt: handleInsertTableColAt,
      onDeleteTableColAt: handleDeleteTableColAt,
   })

   // ========================
   //  Block picker anchorRect
   // ========================
   function getBlockRect(): DOMRect {
      return blockDivRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0)
   }

   // ==============================
   //  Ref merge (DnD + blockDivRef)
   // ==============================
   function setWrapRef(node: HTMLDivElement | null) {
      blockDivRef.current = node
      if (isDraggable && !readOnly) sortable.setNodeRef(node)
   }

   const wrapAttr = !isDraggable || readOnly ? {} : sortable.attributes

   // =================
   //  Content renderer
   // =================
   function renderBlockContent() {
      if (block.type === 'p' || block.type === 'h3' || block.type === 'h4')
         return <ParagraphBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'callout')
         return <CalloutBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'code')
         return <CodeBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'math')
         return <MathBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'graph')
         return <GraphBlock block={block} patch={patch} onInsertBlockAfter={handleInsertBlockAfter} readOnly={readOnly} />
      if (block.type === 'list')
         return <ListBlock block={block} itemOps={listItemOps} onAddItem={handleListAdd} readOnly={readOnly} gripSide={gripSide} />
      if (block.type === 'checklist')
         return <ChecklistBlock block={block} itemOps={listItemOps} onAddItem={handleListAdd} readOnly={readOnly} gripSide={gripSide} />
      if (block.type === 'table')
         return <TableBlock block={block} patch={patch} onAddRow={handleRowAdd} onAddCol={handleColAdd} onRemoveRow={handleRowDel} onInsertBlockAfter={handleInsertBlockAfter} readOnly={readOnly} />
      if (block.type === 'image')
         return <ImageBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'container' && (containerMutations || readOnly))
         return <ContainerBlock block={block} patch={patch} containerMutations={containerMutations!} secId={secId} readOnly={readOnly} />
      if (block.type === 'hr')
         return <HrBlock block={block} patch={patch} readOnly={readOnly} />
      return null
   }

   return (
      <div
         ref={setWrapRef} style={dndStyle} {...wrapAttr}
         data-block-id={block.id}
         className={[
            'relative rounded-md transition-colors my-4',
            !readOnly && hovered ? 'doc-block-hover' : '',
            isAnchorDupe ? 'ring-2 ring-amber-400/60' : '',
            isWindowOpen ? 'doc-block-editing' : '',
         ].join(' ')}
         onMouseEnter={readOnly ? undefined : () => setHovered(true)}
         onMouseLeave={readOnly ? undefined : () => setHovered(false)}
         onContextMenu={readOnly ? undefined : openContextMenu}
      >
         {/* DnD insertion indicator */}
         {showInsertLine && (
            <div className="absolute -top-px left-0 right-0 h-0.5 rounded-sm opacity-70 pointer-events-none"
               style={{ background: 'var(--doc-accent, var(--color-accent))' }} />
         )}

         {/* DnD grip, outer blocks always, inner blocks when draggable=true */}
         {isDraggable && !readOnly && (
            <div
               {...sortable.listeners}
               className={[
                  gripSide === 'right'
                     ? 'absolute -right-12 inset-y-0 flex items-center justify-center w-6'
                     : 'absolute -left-12 inset-y-0 flex items-center justify-center w-6',
                  'cursor-grab active:cursor-grabbing transition-opacity',
                  'text-muted/60 hover:text-muted',
                  hovered ? 'opacity-100' : 'opacity-0',
               ].join(' ')}
               title={t.dragToReorder}
            >
               <GripVertical size={30} />
            </div>
         )}

         {/* Anchor editor */}
         {!readOnly && anchor.anchorEditing && anchor.anchorPos && (
            <AnchorEditor
               draft={anchor.anchorDraft}
               currentHandle={block.handle}
               hasHandle={!!block.handle}
               onChange={anchor.setAnchorDraft}
               onConfirm={anchor.confirmAnchor}
               onClose={anchor.closeAnchorEditor}
               onRemove={anchor.removeAnchor}
               pos={anchor.anchorPos}
            />
         )}

         {/* Right-click context menu */}
         {contextMenuProps && <BlockContextMenu {...contextMenuProps} />}

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

         <div className="min-w-0">
            {renderBlockContent()}
         </div>

         {/* Duplicate anchor warning */}
         {isAnchorDupe && (
            <div className="flex items-center gap-1 mt-1 px-1 text-amber-500 text-xs font-medium">
               <TriangleAlert size={11} />
               <span>{t.duplicateAnchor}, #{block.handle}</span>
            </div>
         )}
      </div>
   )
}

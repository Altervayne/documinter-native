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
import { usePageBreaks } from '../../contexts/PageBreaksContext'
import { useLang } from '../../contexts/LangContext'
import { useAnchorEditor } from './useAnchorEditor'
import { useBlockContextMenu } from './useBlockContextMenu'

// -- Component Imports --
import { ParagraphBlock }   from './blocks/ParagraphBlock'
import { CalloutBlock }     from './blocks/CalloutBlock'
import { CodeBlock }        from './blocks/CodeBlock'
import { MathBlock }        from './blocks/MathBlock'
import { GraphBlock }       from './blocks/GraphBlock'
import { DiagramBlock }     from './blocks/DiagramBlock'
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
import type { BlockLoc } from '../../lib/document'



interface WysiwygBlockProps {
   secId:  string
   block:  Block
   containerMutations?: ContainerMutations
   /** This block's location (section body or container column), attached to the sortable as drag
    *  data so the shared block DnD handler knows the source array on drop. Absent for readOnly. */
   blockLoc?: BlockLoc
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
   /** For a list/checklist rendered as a page-split fragment: where this fragment's root items start
    *  in the model block's full item list (see pageLayout.ts sliceListBlock). 0 for a whole (unsplit)
    *  list. Converts dnd-kit's fragment-relative root reorder indices to absolute model indices. */
   itemOffset?: number
   /** For a list/checklist rendered as a page-split fragment: whether this fragment holds the model
    *  block's last root item. True for a whole (unsplit) list. Gates the add-item button so a split
    *  list shows it once, on the page it ends on. */
   isListTail?: boolean
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
   secId, block, containerMutations, activeBlockId, blockLoc,
   inner, draggable, gripSide = 'left', readOnly,
   itemOffset = 0, isListTail = true,
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
   const pageBreaks   = usePageBreaks()
   const isAnchorDupe = !readOnly && !!block.handle && allHandles.filter(handle => handle === block.handle).length > 1
   // The block's editor window is open: highlight it and drop its inline controls (block-owned).
   const isWindowOpen = !readOnly && editorWindow.isEditing(block.id)

   // Unmount safety: a deleted / undone-away block clears its own open id so the context never
   // holds a dangling reference. Deliberately unmount-only (block.id is stable per instance), the
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
   const sortable    = useSortable({ id: block.id, disabled: !isDraggable || !!readOnly, data: { type: 'block', loc: blockLoc, blockId: block.id, blockType: block.type } })
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
   const handleReorderListItems       = inner ? onReorderListItems!       : (parentItemId: string | null, oldIndex: number, newIndex: number) => {
      // A split list/checklist fragment (see pageLayout.ts) renders only a slice of the model's root
      // items, so dnd-kit's root-level indices are relative to that slice. Offset them to absolute
      // model indices. Nested children are never sliced, so a non-root reorder needs no offset.
      const rootOffset = parentItemId === null ? itemOffset : 0
      ctx.reorderListItemsUnderParent(secId, block.id, parentItemId, oldIndex + rootOffset, newIndex + rootOffset)
   }
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
   // Paged-format page-break action: only for an OUTER, editable block in paged mode. Framed break-before
   // ("make THIS block start the page"): a break already pushing this block to a fresh page gives "remove";
   // a block that CAN start a fresh page (has a predecessor to anchor after) gives the create verb;
   // otherwise (the document's first block) no entry. Container inner blocks are never page-break targets.
   const pageBreakOption: { mode: 'insert' | 'remove'; onSelect: () => void } | undefined =
      (!inner && !readOnly && pageBreaks.paged)
         ? (pageBreaks.startsFreshPage(block.id)
            ? { mode: 'remove', onSelect: () => pageBreaks.mergeWithPrevious(block.id) }
            : (pageBreaks.canStartOnNewPage(block.id)
               ? { mode: 'insert', onSelect: () => pageBreaks.startOnNewPage(block.id) }
               : undefined))
         : undefined
   // Paged-format keep-together toggle: only for an OUTER, editable block of a splittable type (the only
   // types the paginator ever splits). Toggling routes through patch -> updateBlock -> commitActiveEdit,
   // so it is one undo entry. `keepTogether` is only ever true or absent, so the toggle clears it to
   // undefined rather than writing false.
   const isSplittableType = block.type === 'p' || block.type === 'list' || block.type === 'checklist'
   const keepTogetherOption: { active: boolean; onSelect: () => void } | undefined =
      (!inner && !readOnly && pageBreaks.paged && isSplittableType)
         ? {
            active:   block.keepTogether === true,
            onSelect: () => patch({ keepTogether: block.keepTogether ? undefined : true }),
         }
         : undefined
   // Paged-format keep-with-next toggle: for an OUTER, editable block of ANY type that has a following
   // top-level block to keep with (an atomic block can be pinned to its follower too, so this is not gated
   // to splittable types). A block with no successor has nothing to keep with, so `canBreakAfter` gates it
   // out. Toggling routes through patch -> updateBlock -> commitActiveEdit, so it is one undo entry, and
   // `keepWithNext` is only ever true or absent, so the toggle clears it to undefined rather than false.
   const keepWithNextOption: { active: boolean; onSelect: () => void } | undefined =
      (!inner && !readOnly && pageBreaks.paged && pageBreaks.canBreakAfter(block.id))
         ? {
            active:   block.keepWithNext === true,
            onSelect: () => patch({ keepWithNext: block.keepWithNext ? undefined : true }),
         }
         : undefined
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
      pageBreak: pageBreakOption,
      keepTogether: keepTogetherOption,
      keepWithNext: keepWithNextOption,
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
      if (block.type === 'diagram')
         return <DiagramBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'list')
         return <ListBlock block={block} itemOps={listItemOps} onAddItem={handleListAdd} patch={patch} readOnly={readOnly} gripSide={gripSide} isListTail={isListTail} itemOffset={itemOffset} />
      if (block.type === 'checklist')
         return <ChecklistBlock block={block} itemOps={listItemOps} onAddItem={handleListAdd} readOnly={readOnly} gripSide={gripSide} isListTail={isListTail} />
      if (block.type === 'table')
         return <TableBlock block={block} patch={patch} onAddRow={handleRowAdd} onAddCol={handleColAdd} onRemoveRow={handleRowDel} onInsertBlockAfter={handleInsertBlockAfter} readOnly={readOnly} />
      if (block.type === 'image')
         return <ImageBlock block={block} patch={patch} readOnly={readOnly} />
      if (block.type === 'container' && (containerMutations || readOnly))
         return <ContainerBlock block={block} patch={patch} containerMutations={containerMutations!} secId={secId} activeBlockId={activeBlockId} readOnly={readOnly} />
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

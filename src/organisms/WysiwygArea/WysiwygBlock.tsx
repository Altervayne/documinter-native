// -- React Imports --
import { useRef, useState, useCallback, useEffect } from 'react'

// -- Library Imports --
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../lib/DocumentMutationsContext'
import { useDocumentHandles } from '../../lib/DocumentHandlesContext'
import { useLang } from '../../lib/LangContext'

// -- Component Imports --
import { ParagraphBlock }  from './blocks/ParagraphBlock'
import { CalloutBlock }    from './blocks/CalloutBlock'
import { CodeBlock }       from './blocks/CodeBlock'
import { ListBlock }       from './blocks/ListBlock'
import { TableBlock }      from './blocks/TableBlock'
import { ImageBlock }      from './blocks/ImageBlock'
import { ContainerBlock }  from './blocks/ContainerBlock'
import { AnchorEditor }    from './blocks/AnchorEditor'
import { BlockSidebar }    from './blocks/BlockSidebar'

// -- Lib / Util Imports --
import { generateHandle } from '../../lib/helpers'

// -- Atom Imports --
import { TriangleAlert } from 'lucide-react'

// -- Type Imports --
import type { Block, ContainerMutations } from '../../types'

// ── Props ─────────────────────────────────────────────────────────────────────

interface WysiwygBlockProps {
   secId: string
   block: Block
   containerMutations?: ContainerMutations
   /** When true: inner block inside a container — uses ↑↓ buttons instead of DnD */
   inner?: boolean
   /** ID of the block currently being dragged (for showing insertion indicator) */
   activeBlockId?: string | null
   // Inner block handlers (only used when inner=true)
   onUpdate?: (secId: string, blkId: string, patch: Partial<Block>) => void
   onRemove?: () => void
   onMoveUp?:         () => void
   onMoveDown?:       () => void
   onAddListItem?:    () => void
   onRemoveLastItem?: () => void
   onAddTableRow?:    () => void
   onRemoveLastRow?:  () => void
   onAddTableCol?:    () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WysiwygBlock({
   secId, block, containerMutations, activeBlockId,
   inner, onUpdate, onRemove, onMoveUp, onMoveDown,
   onAddListItem, onRemoveLastItem,
   onAddTableRow, onRemoveLastRow, onAddTableCol,
}: WysiwygBlockProps) {
   const ctx        = useDocumentMutations()
   const { t }      = useLang()
   const allHandles = useDocumentHandles()
   const isAnchorDupe = !!block.handle && allHandles.filter(handle => handle === block.handle).length > 1

   const [sidebarActive, setSidebarActive] = useState(false)
   const [anchorEditing, setAnchorEditing] = useState(false)
   const [anchorDraft, setAnchorDraft]     = useState('')
   const [anchorPos, setAnchorPos]         = useState<{ top: number; right: number } | null>(null)
   const leaveTimer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
   const blockDivRef  = useRef<HTMLDivElement>(null)

   // ── Anchor editor ──────────────────────────────────────────────────────────

   function openAnchorEditor() {
      setAnchorDraft(block.handle ?? generateHandle(block))
      setAnchorEditing(true)
   }
   function closeAnchorEditor() { setAnchorEditing(false); setSidebarActive(false) }
   function confirmAnchor() {
      const slug = anchorDraft.trim().toLowerCase()
         .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
      patch({ handle: slug || undefined })
      closeAnchorEditor()
   }
   function removeAnchor() {
      patch({ handle: undefined })
      closeAnchorEditor()
   }

   // Compute fixed screen position when anchor editor opens, so it escapes overflow clipping
   useEffect(() => {
      if (anchorEditing) {
         const rect = blockDivRef.current?.getBoundingClientRect()
         if (rect) setAnchorPos({ top: rect.top, right: window.innerWidth - rect.left + 10 })
      } else {
         setAnchorPos(null)
      }
   }, [anchorEditing])

   // ── Sidebar visibility ────────────────────────────────────────────────────

   const showSidebar = useCallback(() => {
      if (activeBlockId && activeBlockId !== block.id) return
      clearTimeout(leaveTimer.current)
      setSidebarActive(true)
   }, [activeBlockId, block.id])
   const hideSidebar = useCallback(() => {
      leaveTimer.current = setTimeout(() => setSidebarActive(false), 120)
   }, [])
   const keepSidebarVisible = useCallback(() => {
      clearTimeout(leaveTimer.current)
   }, [])

   // ── DnD — only active for top-level blocks ────────────────────────────────

   const sortable = useSortable({ id: block.id, disabled: !!inner })
   const dndStyle = inner
      ? {}
      : {
         transform:  CSS.Transform.toString(sortable.transform),
         transition: sortable.isDragging ? undefined : sortable.transition,
         opacity:    sortable.isDragging ? 0 : 1,
      }
   const isSidebarShown = (sidebarActive || (!inner && sortable.isDragging)) && !anchorEditing
   const showInsertLine = !inner && sortable.isOver && activeBlockId !== block.id

   // ── Mutation routing: inner blocks use passed handlers, top-level use ctx ──

   function patch(partialBlock: Partial<Block>) {
      if (inner && onUpdate) onUpdate(secId, block.id, partialBlock)
      else ctx.updateBlock(secId, block.id, partialBlock)
   }

   const handleRemove    = inner ? onRemove!    : () => ctx.removeBlock(secId, block.id)
   const handleDuplicate = inner ? undefined     : () => ctx.duplicateBlock(secId, block.id)
   const handleListAdd   = inner ? onAddListItem!    : () => ctx.addListItem(secId, block.id)
   const handleListDel   = inner ? onRemoveLastItem! : () => ctx.removeLastItem(secId, block.id)
   const handleRowAdd    = inner ? onAddTableRow!    : () => ctx.addTableRow(secId, block.id)
   const handleRowDel    = inner ? onRemoveLastRow!  : () => ctx.removeLastRow(secId, block.id)
   const handleColAdd    = inner ? onAddTableCol!    : () => ctx.addTableCol(secId, block.id)

   // ── Block content dispatch ────────────────────────────────────────────────

   function renderBlockContent() {
      if (block.type === 'p' || block.type === 'h3' || block.type === 'h4') {
         return <ParagraphBlock block={block} patch={patch} />
      }
      if (block.type === 'callout') {
         return <CalloutBlock block={block} patch={patch} />
      }
      if (block.type === 'code') {
         return <CodeBlock block={block} patch={patch} />
      }
      if (block.type === 'list') {
         return <ListBlock block={block} patch={patch} onAddItem={handleListAdd} onRemoveLast={handleListDel} />
      }
      if (block.type === 'table') {
         return <TableBlock block={block} patch={patch} onAddRow={handleRowAdd} onAddCol={handleColAdd} onRemoveRow={handleRowDel} />
      }
      if (block.type === 'image') {
         return <ImageBlock block={block} patch={patch} />
      }
      if (block.type === 'container' && containerMutations) {
         return <ContainerBlock block={block} patch={patch} containerMutations={containerMutations} secId={secId} />
      }
      return null
   }

   // ── Wrapper ────────────────────────────────────────────────────────────────

   // Merge sortable's ref (for DnD) with blockDivRef (for anchor editor positioning)
   const setWrapRef = useCallback((node: HTMLDivElement | null) => {
      blockDivRef.current = node
      if (!inner) sortable.setNodeRef(node)
   }, [inner, sortable.setNodeRef])

   const wrapAttr = inner ? {} : sortable.attributes

   return (
      <div
         ref={setWrapRef} style={dndStyle} {...wrapAttr}
         className={`relative rounded-sm ${isAnchorDupe ? 'ring-2 ring-amber-400/60' : ''}`}
      >
         {showInsertLine && <div className="absolute -top-px left-0 right-0 h-0.5 rounded-sm opacity-70 pointer-events-none" style={{ background: 'var(--doc-accent, var(--color-accent))' }} />}

         {anchorEditing && anchorPos && (
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

         {isSidebarShown && (
            <BlockSidebar
               inner={!!inner}
               block={block}
               onMoveUp={onMoveUp}
               onMoveDown={onMoveDown}
               onDuplicate={handleDuplicate}
               onAnchorEdit={openAnchorEditor}
               onRemove={handleRemove}
               onMouseEnter={keepSidebarVisible}
               onMouseLeave={hideSidebar}
               dragListeners={sortable.listeners}
            />
         )}

         <div className="min-w-0" onMouseEnter={showSidebar} onMouseLeave={hideSidebar}>
            {renderBlockContent()}
         </div>

         {isAnchorDupe && (
            <div className="flex items-center gap-1 mt-1 px-1 text-amber-500 text-xs font-medium">
               <TriangleAlert size={11} />
               <span>{t.duplicateAnchor} — #{block.handle}</span>
            </div>
         )}
      </div>
   )
}

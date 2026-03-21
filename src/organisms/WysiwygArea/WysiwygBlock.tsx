// -- React Imports --
import { useRef, useState, useCallback } from 'react'
import type React from 'react'

// -- Library Imports --
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, ChevronUp, ChevronDown, Copy, Anchor, X } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../lib/DocumentMutationsContext'
import { useLang } from '../../lib/LangContext'

// -- Component Imports --
import { AddBlockRow } from '../../molecules/AddBlockRow'
import { ParagraphBlock } from './blocks/ParagraphBlock'
import { CalloutBlock }   from './blocks/CalloutBlock'
import { CodeBlock }      from './blocks/CodeBlock'
import { ListBlock }      from './blocks/ListBlock'
import { TableBlock }     from './blocks/TableBlock'
import { ImageBlock }     from './blocks/ImageBlock'

// -- Lib / Util Imports --
import { stripTags } from '../../lib/helpers'

// -- Type Imports --
import type { Block, ContainerMutations } from '../../types'

// ── Handle generation ─────────────────────────────────────────────────────────

function generateHandle(block: Block): string {
   const rawText = block.text
      ? stripTags(block.text)
      : block.code
         ? block.code.split('\n')[0]
         : block.items?.[0]?.text
            ? stripTags(block.items[0].text)
            : ''
   const slug = rawText.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 28)
   return slug || crypto.randomUUID().substring(0, 8)
}

// ── Container sub-components ──────────────────────────────────────────────────
// Kept inline to avoid a circular import (ContainerColumn renders WysiwygBlock)

interface ContainerColumnProps {
   secId:  string
   blkId:  string
   side:   'left' | 'right'
   blocks: Block[]
   cm:     ContainerMutations
}

function ContainerColumn({ secId, blkId, side, blocks, cm }: ContainerColumnProps) {
   const { t } = useLang()

   function makeInnerProps(innerBlock: Block, idx: number) {
      return {
         secId,
         block: innerBlock,
         inner: true as const,
         onUpdate: (_sid: string, innerBlkId: string, patch: Partial<Block>) =>
            cm.updateBlock(secId, blkId, side, innerBlkId, patch),
         onRemove: () => cm.removeBlock(secId, blkId, side, innerBlock.id),
         onMoveUp:         idx > 0                ? () => cm.moveBlock(secId, blkId, side, idx, idx - 1) : undefined,
         onMoveDown:       idx < blocks.length - 1 ? () => cm.moveBlock(secId, blkId, side, idx, idx + 1) : undefined,
         onAddListItem:    () => cm.addListItem(secId, blkId, side, innerBlock.id),
         onRemoveLastItem: () => cm.removeLastItem(secId, blkId, side, innerBlock.id),
         onAddTableRow:    () => cm.addTableRow(secId, blkId, side, innerBlock.id),
         onRemoveLastRow:  () => cm.removeLastRow(secId, blkId, side, innerBlock.id),
         onAddTableCol:    () => cm.addTableCol(secId, blkId, side, innerBlock.id),
      }
   }

   return (
      <div className="container-col">
         <div className="container-col-label">{side === 'left' ? t.leftColumn : t.rightColumn}</div>
         {blocks.map((block, idx) => (
            <WysiwygBlock key={block.id} {...makeInnerProps(block, idx)} />
         ))}
         <AddBlockRow insideContainer docStyle onAdd={type => cm.addBlock(secId, blkId, side, type)} />
      </div>
   )
}

// ── Main WysiwygBlock ────────────────────────────────────────────────────────

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

export function WysiwygBlock({
   secId, block, containerMutations, activeBlockId,
   inner, onUpdate, onRemove, onMoveUp, onMoveDown,
   onAddListItem, onRemoveLastItem,
   onAddTableRow, onRemoveLastRow, onAddTableCol,
}: WysiwygBlockProps) {
   const { t } = useLang()
   const ctx = useDocumentMutations()

   const [sidebarActive, setSidebarActive] = useState(false)
   const [anchorEditing, setAnchorEditing] = useState(false)
   const [anchorDraft, setAnchorDraft]     = useState('')
   const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

   const showSidebar = useCallback(() => {
      clearTimeout(leaveTimer.current)
      setSidebarActive(true)
   }, [])
   const hideSidebar = useCallback(() => {
      leaveTimer.current = setTimeout(() => setSidebarActive(false), 120)
   }, [])
   const keepSidebarVisible = useCallback(() => {
      clearTimeout(leaveTimer.current)
   }, [])

   // DnD — only active for top-level blocks
   const sortable = useSortable({ id: block.id, disabled: !!inner })
   const dndStyle = inner
      ? {}
      : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.5 : 1 }
   const showInsertLine = !inner && sortable.isOver && activeBlockId !== block.id

   // Route mutations: inner blocks use passed handlers, top-level use context
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

   // ── Block content ──────────────────────────────────────────────────────────

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
         return <ContainerBlockContent
            block={block} patch={patch}
            containerMutations={containerMutations} secId={secId}
         />
      }
      return null
   }

   // ── Wrapper ────────────────────────────────────────────────────────────────
   const wrapRef  = inner ? undefined : sortable.setNodeRef
   const wrapAttr = inner ? {} : sortable.attributes

   return (
      <>
      {showInsertLine && <div className="dnd-insert-line" />}
      <div ref={wrapRef} style={dndStyle} className="blk-wrap" {...wrapAttr}>
         {/* Anchor editor — replaces the sidebar while active, same position */}
         {anchorEditing && (
            <div className="blk-anchor-editor">
               <span className="blk-anchor-hash">#</span>
               <input
                  autoFocus
                  type="text"
                  className="blk-anchor-input"
                  value={anchorDraft}
                  placeholder="anchor-name"
                  spellCheck={false}
                  onChange={event => setAnchorDraft(event.target.value)}
                  onKeyDown={event => {
                     if (event.key === 'Enter') confirmAnchor()
                     if (event.key === 'Escape') closeAnchorEditor()
                  }}
                  onBlur={confirmAnchor}
               />
               {block.handle && (
                  <button
                     className="blk-anchor-remove"
                     onMouseDown={event => event.preventDefault()}
                     onClick={removeAnchor}
                     title={t.removeAnchor}
                  >
                     <X size={11} />
                  </button>
               )}
            </div>
         )}

         {/* Sidebar: handle + actions — hidden while anchor editor is open */}
         {sidebarActive && !anchorEditing && (
            <div className="blk-sidebar" onMouseEnter={keepSidebarVisible} onMouseLeave={hideSidebar}>
               {inner ? (
                  <>
                     {onMoveUp   && <button className="blk-sidebar-btn" onClick={onMoveUp}   title={t.moveUp}><ChevronUp size={14} /></button>}
                     {onMoveDown && <button className="blk-sidebar-btn" onClick={onMoveDown} title={t.moveDown}><ChevronDown size={14} /></button>}
                  </>
               ) : (
                  <div {...sortable.listeners} className="blk-sidebar-grip" title={t.dragToReorder}>
                     <GripVertical size={16} />
                  </div>
               )}
               {handleDuplicate && (
                  <button className="blk-sidebar-btn" onClick={handleDuplicate} title={t.duplicateBlock}>
                     <Copy size={14} />
                  </button>
               )}
               <button
                  className="blk-sidebar-btn"
                  style={block.handle ? { color: 'var(--doc-accent, var(--color-accent))' } : {}}
                  title={block.handle ? `#${block.handle} — ${t.editAnchor}` : t.addAnchor}
                  onClick={openAnchorEditor}
               >
                  <Anchor size={14} />
               </button>
               <button className="blk-sidebar-btn danger" onClick={handleRemove} title={t.deleteBlock}>
                  <Trash2 size={14} />
               </button>
            </div>
         )}

         <div className="blk-content" onMouseEnter={showSidebar} onMouseLeave={hideSidebar}>
            {renderBlockContent()}
         </div>
      </div>
      </>
   )
}

// ── ContainerBlock (inline — imports WysiwygBlock above, no circular dep) ─────

interface ContainerBlockContentProps {
   block:              Block
   patch:              (partial: Partial<Block>) => void
   containerMutations: ContainerMutations
   secId:              string
}

function ContainerBlockContent({ block, patch, containerMutations, secId }: ContainerBlockContentProps) {
   const ratio = block.ratio ?? 0.5

   function handleDividerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      event.preventDefault()
      const parent = event.currentTarget.parentElement!
      const rect   = parent.getBoundingClientRect()
      function onMove(pointerEvent: PointerEvent) {
         const newRatio = Math.max(0.1, Math.min(0.9, (pointerEvent.clientX - rect.left) / rect.width))
         patch({ ratio: Math.round(newRatio * 100) / 100 })
      }
      function onUp() {
         document.removeEventListener('pointermove', onMove)
         document.removeEventListener('pointerup',   onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup',   onUp)
   }

   return (
      <div className="container-block">
         <div className="container-cols">
            <div style={{ flex: ratio, minWidth: 0 }}>
               <ContainerColumn
                  secId={secId} blkId={block.id} side="left"
                  blocks={block.left ?? []} cm={containerMutations}
               />
            </div>
            <div className="container-divider" onPointerDown={handleDividerPointerDown}>
               <span className="container-ratio-badge">
                  {Math.round(ratio * 100)}/{Math.round((1 - ratio) * 100)}
               </span>
            </div>
            <div style={{ flex: 1 - ratio, minWidth: 0 }}>
               <ContainerColumn
                  secId={secId} blkId={block.id} side="right"
                  blocks={block.right ?? []} cm={containerMutations}
               />
            </div>
         </div>
      </div>
   )
}

// -- React Imports --
import { useRef, useState, useCallback } from 'react'
import type React from 'react'

// -- Library Imports --
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, ChevronUp, ChevronDown, Copy } from 'lucide-react'

// -- Context / Hook Imports --
import { useDocumentMutations } from '../../lib/DocumentMutationsContext'
import { useLang } from '../../lib/LangContext'

// -- Component Imports --
import { ContentEditable } from '../../atoms/ContentEditable'
import { AddBlockRow } from '../../molecules/AddBlockRow'
import { CalloutStylePicker } from '../../molecules/CalloutStylePicker'

// -- Lib / Util Imports --
import { highlight, LANG_LABELS } from '../../lib/highlight'
import { compressImage } from '../../lib/imageUtils'

// -- Type Imports --
import type { Block, CalloutStyle, CodeLang, ContainerMutations } from '../../types'

// ── Image sub-component ──────────────────────────────────────────────────────

interface ImageBlockProps {
   block: Block
   patch: (partialBlock: Partial<Block>) => void
}

function ImageBlock({ block, patch }: ImageBlockProps) {
   const { t } = useLang()
   const inputRef = useRef<HTMLInputElement>(null)
   const [dropping, setDropping] = useState(false)

   async function handleFile(file: File | undefined) {
      if (!file || !file.type.startsWith('image/')) return
      const src = await compressImage(file)
      patch({ src })
   }

   if (block.src) {
      return (
         <div>
            <img
               src={block.src}
               alt={block.alt ?? ''}
               style={{ maxWidth: '100%', height: 'auto', borderRadius: 4, display: 'block' }}
            />
            <ContentEditable
               tag="p"
               className="image-field image-alt"
               content={block.alt ?? ''}
               onBlur={value => patch({ alt: value })}
               singleLine
               spellCheck={false}
            />
            <ContentEditable
               tag="p"
               className="image-field image-caption"
               content={block.caption ?? ''}
               onBlur={value => patch({ caption: value })}
               singleLine
            />
            <div className="wysiwyg-util-row" style={{ marginTop: 6 }}>
               <button className="danger" onClick={() => patch({ src: '', alt: '', caption: '' })}>
                  ✕ Remove
               </button>
            </div>
         </div>
      )
   }

   return (
      <div
         className={`image-dropzone${dropping ? ' dropping' : ''}`}
         onDragOver={event => { event.preventDefault(); setDropping(true) }}
         onDragLeave={() => setDropping(false)}
         onDrop={event => { event.preventDefault(); setDropping(false); handleFile(event.dataTransfer.files[0]) }}
         onClick={() => inputRef.current?.click()}
      >
         <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={event => { handleFile(event.target.files?.[0]); event.target.value = '' }}
         />
         <p className="image-dropzone-hint">{t.dropImageHere}</p>
      </div>
   )
}

// ── Container sub-component ──────────────────────────────────────────────────

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
   // Inner block handlers (only used when inner=true)
   onUpdate?: (secId: string, blkId: string, patch: Partial<Block>) => void
   onRemove?: () => void
   onMoveUp?:        () => void
   onMoveDown?:      () => void
   onAddListItem?:    () => void
   onRemoveLastItem?: () => void
   onAddTableRow?:    () => void
   onRemoveLastRow?:  () => void
   onAddTableCol?:    () => void
}

export function WysiwygBlock({
   secId, block, containerMutations,
   inner, onUpdate, onRemove, onMoveUp, onMoveDown,
   onAddListItem, onRemoveLastItem,
   onAddTableRow, onRemoveLastRow, onAddTableCol,
}: WysiwygBlockProps) {
   const { t } = useLang()
   const ctx = useDocumentMutations()

   const [codeEditing, setCodeEditing] = useState(false)
   const [sidebarActive, setSidebarActive] = useState(false)
   const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

   const showSidebar = useCallback(() => {
      clearTimeout(leaveTimer.current)
      setSidebarActive(true)
   }, [])
   const hideSidebar = useCallback(() => {
      leaveTimer.current = setTimeout(() => setSidebarActive(false), 120)
   }, [])

   // DnD — only active for top-level blocks
   const sortable = useSortable({ id: block.id, disabled: !!inner })
   const dndStyle = inner
      ? {}
      : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.5 : 1 }

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

   let inner_content: React.ReactNode

   if (block.type === 'p') {
      inner_content = (
         <ContentEditable tag="p" content={block.text ?? ''} onBlur={value => patch({ text: value })} rich />
      )
   } else if (block.type === 'h3') {
      inner_content = (
         <ContentEditable tag="h3" content={block.text ?? ''} onBlur={value => patch({ text: value })} rich />
      )
   } else if (block.type === 'h4') {
      inner_content = (
         <ContentEditable tag="h4" content={block.text ?? ''} onBlur={value => patch({ text: value })} rich />
      )
   } else if (block.type === 'callout') {
      inner_content = (
         <>
            <CalloutStylePicker
               current={block.style ?? 'info'}
               onChange={(style: CalloutStyle) => patch({ style })}
            />
            <ContentEditable
               tag="p"
               className={`callout ${block.style ?? 'info'}`}
               content={block.text ?? ''}
               onBlur={value => patch({ text: value })}
               rich
            />
         </>
      )
   } else if (block.type === 'code') {
      const lang = block.lang ?? 'windev'
      inner_content = (
         <>
            <div className="lang-picker">
               <span>lang:</span>
               {(Object.keys(LANG_LABELS) as CodeLang[]).map(langOption => (
                  <button
                     key={langOption}
                     className={lang === langOption ? 'active' : ''}
                     onClick={() => patch({ lang: langOption })}
                  >
                     {LANG_LABELS[langOption]}
                  </button>
               ))}
            </div>
            {codeEditing ? (
               <pre>
                  <ContentEditable
                     tag="code"
                     content={block.code ?? ''}
                     spellCheck={false}
                     onBlur={value => { patch({ code: value }); setCodeEditing(false) }}
                  />
               </pre>
            ) : (
               <pre title={t.clickToEdit} onClick={() => setCodeEditing(true)} style={{ cursor: 'text' }}>
                  <code dangerouslySetInnerHTML={{ __html: highlight(block.code ?? '', lang) }} />
               </pre>
            )}
         </>
      )
   } else if (block.type === 'list') {
      inner_content = (
         <>
            <ul>
               {(block.items ?? []).map((item, itemIndex) => (
                  <ContentEditable
                     key={itemIndex}
                     tag="li"
                     content={item}
                     onBlur={value => {
                        const items = [...(block.items ?? [])]
                        items[itemIndex] = value
                        patch({ items })
                     }}
                     rich
                  />
               ))}
            </ul>
            <div className="wysiwyg-util-row">
               <button onClick={handleListAdd}>{t.addItem}</button>
               <button className="danger" onClick={handleListDel}>{t.removeLast}</button>
            </div>
         </>
      )
   } else if (block.type === 'table') {
      const headers = block.headers ?? []
      const rows    = block.rows ?? []
      inner_content = (
         <>
            <div className="table-wrap">
               <table>
                  <thead>
                     <tr>
                        {headers.map((header, columnIndex) => (
                           <ContentEditable
                              key={columnIndex}
                              tag="th"
                              content={header}
                              onBlur={value => {
                                 const newHeaders = [...headers]
                                 newHeaders[columnIndex] = value
                                 patch({ headers: newHeaders })
                              }}
                              rich
                           />
                        ))}
                     </tr>
                  </thead>
                  <tbody>
                     {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                           {row.map((cell, columnIndex) => (
                              <ContentEditable
                                 key={columnIndex}
                                 tag="td"
                                 content={cell}
                                 onBlur={value => {
                                    const newRows = rows.map(existingRow => [...existingRow])
                                    newRows[rowIndex][columnIndex] = value
                                    patch({ rows: newRows })
                                 }}
                                 rich
                              />
                           ))}
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
            <div className="wysiwyg-util-row">
               <button onClick={handleRowAdd}>{t.addRow}</button>
               <button onClick={handleColAdd}>{t.addCol}</button>
               <button className="danger" onClick={handleRowDel}>{t.removeRow}</button>
            </div>
         </>
      )
   } else if (block.type === 'image') {
      inner_content = <ImageBlock block={block} patch={patch} />
   } else if (block.type === 'container' && containerMutations) {
      const ratio = block.ratio ?? 0.5

      function handleDividerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
         event.preventDefault()
         const parent = event.currentTarget.parentElement!
         const rect   = parent.getBoundingClientRect()
         function onMove(pointerEvent: PointerEvent) {
            const ratio = Math.max(0.1, Math.min(0.9, (pointerEvent.clientX - rect.left) / rect.width))
            patch({ ratio: Math.round(ratio * 100) / 100 })
         }
         function onUp() {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup',   onUp)
         }
         document.addEventListener('pointermove', onMove)
         document.addEventListener('pointerup',   onUp)
      }

      inner_content = (
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

   // ── Wrapper ────────────────────────────────────────────────────────────────
   const wrapRef  = inner ? undefined : sortable.setNodeRef
   const wrapAttr = inner ? {} : sortable.attributes

   return (
      <div ref={wrapRef} style={dndStyle} className="blk-wrap" {...wrapAttr}>
         {/* Sidebar: handle + actions */}
         <div className={`blk-sidebar${sidebarActive ? ' active' : ''}`} onMouseEnter={showSidebar} onMouseLeave={hideSidebar}>
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
            <button className="blk-sidebar-btn danger" onClick={handleRemove} title={t.deleteBlock}>
               <Trash2 size={14} />
            </button>
         </div>
         <div className="blk-content" onMouseEnter={showSidebar} onMouseLeave={hideSidebar}>
            {inner_content}
         </div>
      </div>
   )
}

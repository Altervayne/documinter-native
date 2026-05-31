import { useRef, useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight, GripHorizontal } from 'lucide-react'
import { ContentEditable } from '../../../atoms/ContentEditable'
import { compressImage } from '../../../lib/image'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface ImageBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

export function ImageBlock({ block, patch, readOnly }: ImageBlockProps) {
   const { t } = useLang()
   const inputRef  = useRef<HTMLInputElement>(null)
   const imageRef  = useRef<HTMLImageElement>(null)
   const [dropping, setDropping]             = useState(false)
   const [draggingHeight, setDraggingHeight] = useState<number | null>(null)

   async function handleFile(file: File | undefined) {
      if (!file || !file.type.startsWith('image/')) return
      const src = await compressImage(file)
      patch({ src })
   }

   function handleResizeMouseDown(event: React.MouseEvent) {
      event.preventDefault()
      const startY      = event.clientY
      const startHeight = block.imageHeight ?? imageRef.current?.offsetHeight ?? 200

      function onMouseMove(moveEvent: MouseEvent) {
         const newHeight = Math.max(80, Math.min(800, startHeight + moveEvent.clientY - startY))
         setDraggingHeight(Math.round(newHeight))
      }

      function onMouseUp(upEvent: MouseEvent) {
         const rawHeight = Math.max(80, Math.min(800, startHeight + upEvent.clientY - startY))
         patch({ imageHeight: Math.round(rawHeight / 10) * 10 })
         setDraggingHeight(null)
         document.removeEventListener('mousemove', onMouseMove)
         document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
   }

   function handleHeightInputBlur(event: React.FocusEvent<HTMLInputElement>) {
      const raw = event.target.value.trim()
      if (!raw) { patch({ imageHeight: undefined }); return }
      const value = parseInt(raw, 10)
      if (!isNaN(value) && value >= 80 && value <= 800) patch({ imageHeight: value })
   }

   if (block.src) {
      const align         = block.align ?? 'center'
      const displayHeight = draggingHeight ?? block.imageHeight
      const flexAlign     = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

      const ALIGN_BUTTONS = [
         { value: 'left',   Icon: AlignLeft },
         { value: 'center', Icon: AlignCenter },
         { value: 'right',  Icon: AlignRight },
      ] as const

      return (
         <div>
            {/* Figure: only the image — so its width drives alignment with no min-width from controls */}
            <div className={`flex ${flexAlign}`}>
               <figure className="doc-figure" style={{ maxWidth: '100%' }}>
                  <div className="relative select-none rounded-md overflow-hidden">
                     <img
                        ref={imageRef}
                        src={block.src}
                        alt={block.alt ?? ''}
                        style={{
                           maxWidth:  '100%',
                           height:    displayHeight ?? 'auto',
                           objectFit: displayHeight ? 'cover' : undefined,
                           display:   'block',
                        }}
                     />

                     {/* Drag handle */}
                     {!readOnly && (
                        <div
                           className="absolute bottom-0 left-0 right-0 flex justify-center items-center py-0.5 cursor-ns-resize opacity-40 hover:opacity-100 transition-opacity bg-linear-to-t from-black/55 to-transparent"
                           onMouseDown={handleResizeMouseDown}
                        >
                           <GripHorizontal size={16} className="text-white drop-shadow" />
                        </div>
                     )}

                     {/* Height badge during drag */}
                     {!readOnly && draggingHeight !== null && (
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-xs font-mono bg-black/50 text-white pointer-events-none">
                           {draggingHeight} px
                        </div>
                     )}
                  </div>
               </figure>
            </div>

            {/* Controls: full-width, below the aligned figure */}
            <ContentEditable
               tag="p"
               className="image-field image-alt"
               content={block.alt ?? ''}
               onBlur={value => patch({ alt: value })}
               placeholder={t.imageAlt}
               singleLine
               spellCheck={false}
               readOnly={readOnly}
            />
            <ContentEditable
               tag="p"
               className="image-field image-caption"
               content={block.caption ?? ''}
               onBlur={value => patch({ caption: value })}
               placeholder={t.imageCaption}
               singleLine
               readOnly={readOnly}
            />
            {!readOnly && <div className="wysiwyg-util-row" style={{ marginTop: 6 }}>
               <div className="flex items-center gap-0.5">
                  {ALIGN_BUTTONS.map(({ value, Icon }) => (
                     <button
                        key={value}
                        onClick={() => patch({ align: value })}
                        className={`flex items-center justify-center p-1 rounded transition-colors ${
                           align === value
                              ? 'text-accent bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                              : 'text-gray-400 hover:text-gray-600'
                        }`}
                     >
                        <Icon size={13} />
                     </button>
                  ))}
               </div>
               <div className="flex items-center gap-1">
                  <input
                     key={block.imageHeight}
                     type="number"
                     min={80}
                     max={800}
                     defaultValue={block.imageHeight ?? ''}
                     placeholder="—"
                     onBlur={handleHeightInputBlur}
                     onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                     className="w-12 text-xs font-mono text-gray-400 bg-transparent border-b border-gray-200 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-gray-400">px</span>
                  {block.imageHeight !== undefined && (
                     <button
                        onClick={() => patch({ imageHeight: undefined })}
                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                     >
                        Auto
                     </button>
                  )}
               </div>
               <button className="danger" onClick={() => patch({ src: '', alt: '', caption: '' })}>
                  ✕ Remove
               </button>
            </div>}
         </div>
      )
   }

   if (readOnly) {
      return (
         <div className="image-dropzone" style={{ opacity: 0.4, cursor: 'default', pointerEvents: 'none' }}>
            <p className="image-dropzone-hint">No image</p>
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

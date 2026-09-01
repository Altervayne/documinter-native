import { useRef, useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight, GripHorizontal, Pencil, Trash2 } from 'lucide-react'
import { PlainEditable } from '../../../atoms/PlainEditable'
import { compressImage } from '../../../lib/image'
import { decodeImageSize } from '../../../lib/imageDownscale'
import { usePopAWindow } from 'react-pop-a-window'
import { useLang } from '../../../contexts/LangContext'
import { ImageMarkupEditor } from './ImageMarkupEditor'
import type { Block } from '../../../types'

interface ImageBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
   readOnly?: boolean
}

/**
 * The image block. A plain image (no `block.imageMarkup` overlay) renders and edits exactly as it
 * always has (byte-identical output). Once markup is added (the "Add markup" affordance below, or a
 * legacy `image-markup` block migrated in), rendering + editing hand off to {@link ImageMarkupEditor},
 * which owns the annotation canvas + floating tool window. Markup is a feature ON an image, not a
 * separate block type.
 */
export function ImageBlock({ block, patch, readOnly }: ImageBlockProps) {
   if (block.imageMarkup) return <ImageMarkupEditor block={block} patch={patch} readOnly={readOnly} />
   return <PlainImageBlock block={block} patch={patch} readOnly={readOnly} />
}

function PlainImageBlock({ block, patch, readOnly }: ImageBlockProps) {
   const { t } = useLang()
   const editorWindow = usePopAWindow()
   const inputRef  = useRef<HTMLInputElement>(null)
   const imageRef  = useRef<HTMLImageElement>(null)
   const [dropping, setDropping]             = useState(false)
   const [draggingHeight, setDraggingHeight] = useState<number | null>(null)

   async function handleFile(file: File | undefined) {
      if (!file || !file.type.startsWith('image/')) return
      const src = await compressImage(file)
      patch({ src })
   }

   // Turn markup on for this image: capture the base image's natural dimensions (the overlay's
   // normalized-0..1 coordinate system needs the aspect ratio) by decoding the current src, then
   // flip the block into markup mode and open the annotation editor in the same gesture.
   async function handleAddMarkup() {
      const { width, height } = block.src ? await decodeImageSize(block.src) : { width: 0, height: 0 }
      patch({ imageMarkup: { width, height, elements: [] } })
      editorWindow.open(block.id)
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
            {/* Figure: only the image, so its width drives alignment with no min-width from controls */}
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

                     {/* Annotate + remove, overlaid on the image so the controls row below has room in a
                         cramped column container. Hidden mid-drag so they never sit under the size badge. */}
                     {!readOnly && draggingHeight === null && (
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                           <button
                              type="button"
                              onClick={handleAddMarkup}
                              title={t.imageMarkupAdd}
                              aria-label={t.imageMarkupAdd}
                              className="doc-img-overlay-btn"
                           >
                              <Pencil size={14} />
                           </button>
                           <button
                              type="button"
                              onClick={() => patch({ src: '', alt: '', caption: '' })}
                              title={t.imageRemove}
                              aria-label={t.imageRemove}
                              className="doc-img-overlay-btn doc-img-overlay-btn-danger"
                           >
                              <Trash2 size={14} />
                           </button>
                        </div>
                     )}
                  </div>
               </figure>
            </div>

            {/* Controls: full-width, below the aligned figure */}
            <PlainEditable
               tag="p"
               className="image-field image-alt"
               content={block.alt ?? ''}
               onBlur={value => patch({ alt: value })}
               placeholder={t.imageAlt}
               singleLine
               spellCheck={false}
               readOnly={readOnly}
            />
            <PlainEditable
               tag="p"
               className="image-field image-caption"
               content={block.caption ?? ''}
               onBlur={value => patch({ caption: value })}
               placeholder={t.imageCaption}
               singleLine
               readOnly={readOnly}
            />
            {!readOnly && <div className="wysiwyg-util-row flex-wrap items-center" style={{ marginTop: 6 }}>
               <div className="flex items-center gap-0.5">
                  {ALIGN_BUTTONS.map(({ value, Icon }) => (
                     <button
                        key={value}
                        onClick={() => patch({ align: value })}
                        className={`flex items-center justify-center p-1 rounded transition-colors ${
                           align === value ? '' : 'doc-img-ctrl'
                        }`}
                        style={align === value ? {
                           color:      'var(--doc-accent, var(--color-accent))',
                           background: 'color-mix(in srgb, var(--doc-accent, var(--color-accent)) 12%, transparent)',
                        } : undefined}
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
                     className="w-12 text-xs font-mono doc-img-ctrl bg-transparent border-b border-current/30 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs doc-img-ctrl">px</span>
                  {block.imageHeight !== undefined && (
                     <button
                        onClick={() => patch({ imageHeight: undefined })}
                        className="text-xs doc-img-ctrl transition-colors"
                     >
                        Auto
                     </button>
                  )}
               </div>
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

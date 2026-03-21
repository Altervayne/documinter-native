import { useRef, useState } from 'react'
import { ContentEditable } from '../../../atoms/ContentEditable'
import { compressImage } from '../../../lib/imageUtils'
import { useLang } from '../../../lib/LangContext'
import type { Block } from '../../../types'

interface ImageBlockProps {
   block: Block
   patch: (partial: Partial<Block>) => void
}

export function ImageBlock({ block, patch }: ImageBlockProps) {
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

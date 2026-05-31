// -- React Imports --
import type React from 'react'

// -- Component Imports --
import { ContainerColumn } from './ContainerColumn'

// -- Type Imports --
import type { Block, ContainerMutations } from '../../../types'

export interface ContainerBlockProps {
   block:              Block
   patch:              (partial: Partial<Block>) => void
   containerMutations: ContainerMutations
   secId:              string
   readOnly?:          boolean
}

export function ContainerBlock({ block, patch, containerMutations, secId, readOnly }: ContainerBlockProps) {
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
                  blocks={block.left ?? []} cm={containerMutations} readOnly={readOnly}
               />
            </div>
            <div
               className="container-divider"
               onPointerDown={readOnly ? undefined : handleDividerPointerDown}
               style={{ cursor: readOnly ? 'default' : undefined }}
            >
               <span className="container-ratio-badge">
                  {Math.round(ratio * 100)}/{Math.round((1 - ratio) * 100)}
               </span>
            </div>
            <div style={{ flex: 1 - ratio, minWidth: 0 }}>
               <ContainerColumn
                  secId={secId} blkId={block.id} side="right"
                  blocks={block.right ?? []} cm={containerMutations} readOnly={readOnly}
               />
            </div>
         </div>
      </div>
   )
}

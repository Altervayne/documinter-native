import { useState } from 'react'
import { ContentEditable } from '../../../atoms/ContentEditable'
import { useLang } from '../../../lib/LangContext'
import type { Block } from '../../../types'

interface ListBlockProps {
   block:        Block
   patch:        (partial: Partial<Block>) => void
   onAddItem:    () => void
   onRemoveLast: () => void
}

export function ListBlock({ block, patch, onAddItem, onRemoveLast }: ListBlockProps) {
   const { t } = useLang()
   const listItems = block.items ?? []
   const [hoveredItemIndex, setHoveredItemIndex] = useState<number | null>(null)

   return (
      <>
         <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
            {listItems.map((listItem, itemIndex) => (
               <li
                  key={itemIndex}
                  style={{ marginBottom: 2 }}
                  onMouseEnter={() => setHoveredItemIndex(itemIndex)}
                  onMouseLeave={() => setHoveredItemIndex(null)}
               >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                     <span style={{ color: 'var(--c-muted, #6b7280)', flexShrink: 0, userSelect: 'none' }}>•</span>
                     <ContentEditable
                        tag="span"
                        content={listItem.text}
                        onBlur={value => {
                           const newItems = listItems.map((existing, idx) =>
                              idx === itemIndex ? { ...existing, text: value } : existing
                           )
                           patch({ items: newItems })
                        }}
                        rich
                        placeholder={t.clickToEdit}
                        style={{ flex: 1 }}
                     />
                     {hoveredItemIndex === itemIndex && (
                        <div style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
                           <button
                              className="list-sub-btn"
                              title={t.addSubItem}
                              onClick={() => {
                                 const newItems = listItems.map((existing, idx) =>
                                    idx === itemIndex ? { ...existing, children: [...(existing.children ?? []), ''] } : existing
                                 )
                                 patch({ items: newItems })
                              }}
                           >↳+</button>
                           {(listItem.children?.length ?? 0) > 0 && (
                              <button
                                 className="list-sub-btn danger"
                                 title={t.removeSubItem}
                                 onClick={() => {
                                    const newItems = listItems.map((existing, idx) =>
                                       idx === itemIndex ? { ...existing, children: existing.children?.slice(0, -1) } : existing
                                    )
                                    patch({ items: newItems })
                                 }}
                              >↳−</button>
                           )}
                        </div>
                     )}
                  </div>
                  {(listItem.children?.length ?? 0) > 0 && (
                     <ul style={{ listStyle: 'none', paddingLeft: 18, marginTop: 2 }}>
                        {listItem.children!.map((child, childIndex) => (
                           <li key={childIndex} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                              <span style={{ color: 'var(--c-muted, #9ca3af)', fontSize: '0.8em', flexShrink: 0, userSelect: 'none' }}>◦</span>
                              <ContentEditable
                                 tag="span"
                                 content={child}
                                 onBlur={value => {
                                    const newItems = listItems.map((existing, idx) => {
                                       if (idx !== itemIndex) return existing
                                       const newChildren = (existing.children ?? []).map((childText, cidx) =>
                                          cidx === childIndex ? value : childText
                                       )
                                       return { ...existing, children: newChildren }
                                    })
                                    patch({ items: newItems })
                                 }}
                                 rich
                                 style={{ flex: 1 }}
                              />
                           </li>
                        ))}
                     </ul>
                  )}
               </li>
            ))}
         </ul>
         <div className="wysiwyg-util-row">
            <button onClick={onAddItem}>{t.addItem}</button>
            <button className="danger" onClick={onRemoveLast}>{t.removeLast}</button>
         </div>
      </>
   )
}

import { ContentEditable } from '../../../atoms/ContentEditable'
import { useLang } from '../../../contexts/LangContext'
import type { Block } from '../../../types'

interface TableBlockProps {
   block:       Block
   patch:       (partial: Partial<Block>) => void
   onAddRow:    () => void
   onAddCol:    () => void
   onRemoveRow: () => void
   readOnly?:   boolean
}

export function TableBlock({ block, patch, onAddRow, onAddCol, onRemoveRow, readOnly }: TableBlockProps) {
   const { t } = useLang()
   const headers = block.headers ?? []
   const rows    = block.rows    ?? []

   return (
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
                           placeholder={t.clickToEdit}
                           readOnly={readOnly}
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
                              placeholder={t.clickToEdit}
                              readOnly={readOnly}
                           />
                        ))}
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
         {!readOnly && (
            <div className="wysiwyg-util-row">
               <button onClick={onAddRow}>{t.addRow}</button>
               <button onClick={onAddCol}>{t.addCol}</button>
               <button className="danger" onClick={onRemoveRow}>{t.removeRow}</button>
            </div>
         )}
      </>
   )
}

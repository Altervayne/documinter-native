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
            <div className="flex items-center gap-1.5 p-2 flex-wrap">
               <button
                  onClick={onAddRow}
                  className="px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-all border-current/20 opacity-50 hover:opacity-80"
               >
                  {t.addRow}
               </button>
               <button
                  onClick={onAddCol}
                  className="px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-all border-current/20 opacity-50 hover:opacity-80"
               >
                  {t.addCol}
               </button>
               <button
                  onClick={onRemoveRow}
                  className="px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-all border-red/30 text-red/60 opacity-70 hover:opacity-100 hover:bg-red/8"
               >
                  {t.removeRow}
               </button>
            </div>
         )}
      </>
   )
}

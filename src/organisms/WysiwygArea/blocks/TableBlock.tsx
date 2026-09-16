import { ContentEditable } from '../../../atoms/ContentEditable'
import { useLang } from '../../../contexts/LangContext'
import { graphDataFromTable } from '../../../lib/graphTableData'
import type { Block, InlineContent } from '../../../types'

interface TableBlockProps {
   block:       Block
   patch:       (partial: Partial<Block>) => void
   onAddRow:    () => void
   onAddCol:    () => void
   onRemoveRow: () => void
   /** Inserts an already-built block right after this one (the one-shot "Create chart" extract). */
   onInsertBlockAfter: (newBlock: Block) => void
   readOnly?:   boolean
}

export function TableBlock({ block, patch, onAddRow, onAddCol, onRemoveRow, onInsertBlockAfter, readOnly }: TableBlockProps) {
   const { t } = useLang()
   const richHeaders = block.richHeaders ?? []
   const richRows    = block.richRows    ?? []

   // One-shot extract: build a default bar chart from this table's data and drop it in after the
   // table. No link is retained.
   function handleCreateChart(): void {
      const newBlock: Block = {
         id:   crypto.randomUUID(),
         type: 'graph',
         graph: {
            type:    'bar',
            data:    graphDataFromTable(richHeaders, richRows),
            options: { legend: true },
         },
      }
      onInsertBlockAfter(newBlock)
   }

   return (
      <>
         <div className="table-wrap">
            <table>
               <thead>
                  <tr>
                     {richHeaders.map((headerContent, columnIndex) => (
                        <ContentEditable
                           key={columnIndex}
                           tag="th"
                           content={headerContent}
                           onCommit={(richText: InlineContent) => {
                              const newRichHeaders = [...richHeaders]
                              newRichHeaders[columnIndex] = richText
                              patch({ richHeaders: newRichHeaders })
                           }}
                           placeholder={t.clickToEdit}
                           readOnly={readOnly}
                        />
                     ))}
                  </tr>
               </thead>
               <tbody>
                  {richRows.map((row, rowIndex) => (
                     <tr key={rowIndex}>
                        {row.map((cellContent, columnIndex) => (
                           <ContentEditable
                              key={columnIndex}
                              tag="td"
                              content={cellContent}
                              onCommit={(richText: InlineContent) => {
                                 const newRichRows = richRows.map(existingRow => [...existingRow])
                                 newRichRows[rowIndex][columnIndex] = richText
                                 patch({ richRows: newRichRows })
                              }}
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
                  className="px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-all opacity-70 hover:opacity-100"
                  style={{
                     color:       'var(--callout-danger-accent)',
                     borderColor: 'color-mix(in srgb, var(--callout-danger-accent) 30%, transparent)',
                     background:  'color-mix(in srgb, var(--callout-danger-accent) 8%, transparent)',
                  }}
               >
                  {t.removeRow}
               </button>
               <button
                  onClick={handleCreateChart}
                  className="px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-all border-current/20 opacity-50 hover:opacity-80 ml-auto"
               >
                  {t.tableCreateChart}
               </button>
            </div>
         )}
      </>
   )
}

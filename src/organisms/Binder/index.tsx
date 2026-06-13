import { useMemo } from 'react'
import { BinderTopbar } from './BinderTopbar'
import { DocumentCard } from './DocumentCard'
import { useBinderDocuments } from '../../hooks/useBinderDocuments'
import { useLang } from '../../contexts/LangContext'

export interface BinderProps {
   /** id of the document currently open in the editor (pinned + badged in the grid). */
   currentDocumentId: string | null
   /** Close the binder and return to the editor. */
   onClose:           () => void
   /** Open a stored document in the editor. */
   onOpenDocument:    (id: string) => void
   /** Create a blank document and open it. */
   onNewDocument:     () => void
   /** Notify the editor that a document was deleted (so it can clear a now-stale current id). */
   onDocumentDeleted: (id: string) => void
}

/**
 * Binder root — the in-app document library. Replaces the editor full-screen when open.
 * The currently-open document is pinned first; the rest follow in updatedAt-descending
 * order (the order listDocuments already returns).
 */
export function Binder({ currentDocumentId, onClose, onOpenDocument, onNewDocument, onDocumentDeleted }: BinderProps) {
   const {
      documents, isLoading, handleDelete, handleDuplicate,
      handleExportHtml, handleExportMarkdown, handleExportMintdown,
   } = useBinderDocuments()
   const { t } = useLang()

   const orderedDocuments = useMemo(() => {
      const current = currentDocumentId
         ? documents.find(record => record.id === currentDocumentId)
         : undefined
      if (!current) return documents
      return [current, ...documents.filter(record => record.id !== currentDocumentId)]
   }, [documents, currentDocumentId])

   return (
      <div className="flex flex-col flex-1 min-h-0 bg-bg">
         <BinderTopbar onClose={onClose} onNewDocument={onNewDocument} />

         <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
               <div className="text-muted text-sm">…</div>
            ) : orderedDocuments.length === 0 ? (
               <div className="flex h-full items-center justify-center text-muted text-sm">{t.binderEmpty}</div>
            ) : (
               <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
                  {orderedDocuments.map(record => (
                     <DocumentCard
                        key={record.id}
                        record={record}
                        isCurrent={record.id === currentDocumentId}
                        onOpen={() => onOpenDocument(record.id)}
                        onDuplicate={() => handleDuplicate(record.id)}
                        onDelete={() => {
                           void handleDelete(record.id)
                           if (record.id === currentDocumentId) onDocumentDeleted(record.id)
                        }}
                        onExportHtml={() => handleExportHtml(record.id)}
                        onExportMarkdown={() => handleExportMarkdown(record.id)}
                        onExportMintdown={() => handleExportMintdown(record.id)}
                     />
                  ))}
               </div>
            )}
         </div>
      </div>
   )
}

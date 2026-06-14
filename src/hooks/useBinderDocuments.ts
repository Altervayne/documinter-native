import { useEffect, useState, useCallback } from 'react'
import type { BinderDocumentRecord } from '../types'
import {
   listDocuments, deleteDocument, duplicateDocument, moveDocument, reorderDocuments,
   loadDocument, saveDocument, type DocumentListFilter,
} from '../lib/storage'
import { downloadHTML } from '../lib/export'
import { exportMarkdownFile } from '../lib/markdown'
import { exportMintdownFile } from '../lib/mintdown'
import { useToast } from '../contexts/ToastContext'
import { useLang } from '../contexts/LangContext'

/**
 * Loads the filtered/sorted document list for the current binder view (lightweight records
 * only — no sections/base64) and exposes the card actions: delete (with undo), duplicate,
 * the three exports, move, and reorder. Mutations bump the shared data version (onChanged)
 * so the nav and grid refresh together. Re-reads when the filter or data version changes.
 */
export function useBinderDocuments(filter: DocumentListFilter, dataVersion: number, onChanged: () => void) {
   const { showToast } = useToast()
   const { t, lang }   = useLang()

   const { folderId, sortBy, sortDir, criteria } = filter
   // Serialize criteria for a stable effect dependency (the object identity changes each render).
   const criteriaKey = JSON.stringify(criteria ?? null)

   const [documents, setDocuments] = useState<BinderDocumentRecord[]>([])
   const [isLoading, setIsLoading] = useState(true)

   useEffect(() => {
      let active = true
      listDocuments({ folderId, sortBy, sortDir, criteria })
         .then(records => { if (active) { setDocuments(records); setIsLoading(false) } })
         .catch(error => {
            if (!active) return
            setIsLoading(false)
            // Surfacing this (was silently swallowed): a throw here shows an empty binder.
            console.error('[binder] listDocuments failed — grid will appear empty:', error)
            showToast(t.binderActionFailed, { type: 'error' })
         })
      return () => { active = false }
      // criteria is covered by criteriaKey (its serialized form); listing it too would re-run on identity churn.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [folderId, sortBy, sortDir, criteriaKey, dataVersion, showToast, t])

   const handleDelete = useCallback(async (id: string) => {
      try {
         // Snapshot the full document first so the toast can offer an undo (non-touching read).
         const snapshot = await loadDocument(id, { touch: false })
         await deleteDocument(id)
         onChanged()
         showToast(t.binderDocumentDeleted, {
            type: 'success',
            action: snapshot
               ? {
                    label: t.undo,
                    onClick: () => {
                       void saveDocument(
                          { meta: snapshot.meta, sections: snapshot.sections },
                          { docTheme: snapshot.docTheme, docAccent: snapshot.docAccent },
                          id,
                       ).then(onChanged)
                    },
                 }
               : undefined,
         })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t])

   const handleDuplicate = useCallback(async (id: string) => {
      try {
         await duplicateDocument(id)
         onChanged()
         showToast(t.binderDocumentDuplicated, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t])

   const handleMove = useCallback(async (id: string, targetFolderId: string) => {
      try {
         await moveDocument(id, targetFolderId)
         onChanged()
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t])

   const handleReorder = useCallback(async (orderedIds: string[]) => {
      try {
         await reorderDocuments(orderedIds)
         onChanged()
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t])

   const handleExportHtml = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id, { touch: false })
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         downloadHTML(loaded.meta, loaded.sections, { theme: loaded.docTheme, accent: loaded.docAccent, lang })
         showToast(t.downloaded, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t, lang])

   const handleExportMarkdown = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id, { touch: false })
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         exportMarkdownFile(loaded.sections, loaded.meta)
         showToast(t.markdownExported, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t])

   const handleExportMintdown = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id, { touch: false })
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         exportMintdownFile(loaded.sections, loaded.meta)
         showToast(t.mintdownExported, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t])

   return {
      documents,
      isLoading,
      handleDelete,
      handleDuplicate,
      handleMove,
      handleReorder,
      handleExportHtml,
      handleExportMarkdown,
      handleExportMintdown,
   }
}

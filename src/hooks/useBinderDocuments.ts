import { useCallback, useEffect, useState } from 'react'
import type { BinderDocumentRecord } from '../types'
import {
   listDocuments, deleteDocument, duplicateDocument, loadDocument, saveDocument,
} from '../lib/storage'
import { downloadHTML } from '../lib/export'
import { exportMarkdownFile } from '../lib/markdown'
import { exportMintdownFile } from '../lib/mintdown'
import { useToast } from '../contexts/ToastContext'
import { useLang } from '../contexts/LangContext'

/**
 * Loads the binder document list (updatedAt-descending, lightweight records only — no
 * sections/base64) and exposes the card actions: delete (with undo), duplicate, and the
 * three exports. Each export loads the full document on demand and runs a pure exporter.
 */
export function useBinderDocuments() {
   const { showToast } = useToast()
   const { t, lang }   = useLang()

   const [documents, setDocuments] = useState<BinderDocumentRecord[]>([])
   const [isLoading, setIsLoading] = useState(true)

   const refresh = useCallback(async () => {
      const records = await listDocuments()
      setDocuments(records)
      setIsLoading(false)
   }, [])

   // Initial load (guarded against the binder closing mid-flight).
   useEffect(() => {
      let active = true
      listDocuments()
         .then(records => { if (active) { setDocuments(records); setIsLoading(false) } })
         .catch(() => { if (active) setIsLoading(false) })
      return () => { active = false }
   }, [])

   const handleDelete = useCallback(async (id: string) => {
      try {
         // Snapshot the full document first so the toast can offer an undo.
         const snapshot = await loadDocument(id)
         await deleteDocument(id)
         await refresh()
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
                       ).then(refresh)
                    },
                 }
               : undefined,
         })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [refresh, showToast, t])

   const handleDuplicate = useCallback(async (id: string) => {
      try {
         await duplicateDocument(id)
         await refresh()
         showToast(t.binderDocumentDuplicated, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [refresh, showToast, t])

   const handleExportHtml = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id)
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         downloadHTML(loaded.meta, loaded.sections, { theme: loaded.docTheme, accent: loaded.docAccent, lang })
         showToast(t.downloaded, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t, lang])

   const handleExportMarkdown = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id)
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         exportMarkdownFile(loaded.sections, loaded.meta)
         showToast(t.markdownExported, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t])

   const handleExportMintdown = useCallback(async (id: string) => {
      try {
         const loaded = await loadDocument(id)
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
      refresh,
      handleDelete,
      handleDuplicate,
      handleExportHtml,
      handleExportMarkdown,
      handleExportMintdown,
   }
}

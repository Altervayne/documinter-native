import { useEffect, useState, useCallback } from 'react'
import type { BinderDocumentRecord } from '../types'
import { parseDocumentBackup } from '../lib/documentBackupFile'
import type { DocumentListFilter } from '../lib/binderSearch'
import { downloadHTML } from '../lib/exportLayout'
import { exportMarkdownFile } from '../lib/markdown'
import { useToast } from '../contexts/ToastContext'
import { useLang } from '../contexts/LangContext'
import { useBinderBackend } from '../contexts/BinderBackendContext'

/**
 * Loads the filtered/sorted document list for the current binder view (lightweight records
 * only, no sections/base64) and exposes the card actions: delete (with undo), duplicate,
 * the exports, move, and reorder. Mutations bump the shared data version (onChanged)
 * so the nav and grid refresh together. Re-reads when the filter or data version changes.
 */
export function useBinderDocuments(filter: DocumentListFilter, dataVersion: number, onChanged: () => void) {
   const { showToast } = useToast()
   const { t, lang }   = useLang()
   const backend       = useBinderBackend()

   const { folderId, sortBy, sortDir, criteria } = filter
   // Serialize criteria for a stable effect dependency (the object identity changes each render).
   const criteriaKey = JSON.stringify(criteria ?? null)

   const [documents, setDocuments] = useState<BinderDocumentRecord[]>([])
   const [isLoading, setIsLoading] = useState(true)

   useEffect(() => {
      let active = true
      backend.listDocuments({ folderId, sortBy, sortDir, criteria })
         .then(records => { if (active) { setDocuments(records); setIsLoading(false) } })
         .catch(error => {
            if (!active) return
            setIsLoading(false)
            // Log and toast the failure: an unhandled throw here would just leave the binder looking empty.
            console.error('[binder] listDocuments failed, grid will appear empty:', error)
            showToast(t.binderActionFailed, { type: 'error' })
         })
      return () => { active = false }
      // criteria is covered by criteriaKey (its serialized form); listing it too would re-run on identity churn.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [folderId, sortBy, sortDir, criteriaKey, dataVersion, showToast, t, backend])

   const handleDelete = useCallback(async (id: string) => {
      try {
         // Snapshot the full document first so the toast can offer an undo (non-touching read).
         const snapshot = await backend.loadDocument(id, { touch: false })
         await backend.deleteDocument(id)
         onChanged()
         showToast(t.binderDocumentDeleted, {
            type: 'success',
            action: snapshot
               ? {
                    label: t.undo,
                    onClick: () => {
                       void backend.saveDocument(
                          { meta: snapshot.meta, sections: snapshot.sections },
                          { docTheme: snapshot.docTheme, docAccent: snapshot.docAccent, presentation: snapshot.presentation },
                          id,
                       ).then(onChanged)
                    },
                 }
               : undefined,
         })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   // Import dropped JSON files as new documents in targetFolderId; non-JSON and non-backup files are
   // skipped. Restored documents keep the theme + accent from their backup. One summary toast.
   const handleImportJSON = useCallback(async (files: File[], targetFolderId: string) => {
      const jsonFiles = files.filter(file => file.name.toLowerCase().endsWith('.json'))
      if (jsonFiles.length === 0) { showToast(t.binderImportInvalid, { type: 'error' }); return }
      let imported = 0
      for (const file of jsonFiles) {
         try {
            const parsed = parseDocumentBackup(await file.text())
            if (!parsed) continue
            await backend.saveDocument(parsed.state, parsed.presentation, undefined, targetFolderId)
            imported++
         } catch { /* skip this file, keep importing the rest */ }
      }
      if (imported === 0) { showToast(t.binderImportInvalid, { type: 'error' }); return }
      onChanged()
      showToast(t.binderImportSuccess, { type: 'success' })
   }, [onChanged, showToast, t, backend])

   const handleDuplicate = useCallback(async (id: string) => {
      try {
         await backend.duplicateDocument(id)
         onChanged()
         showToast(t.binderDocumentDuplicated, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   const handleMove = useCallback(async (id: string, targetFolderId: string) => {
      try {
         await backend.moveDocument(id, targetFolderId)
         onChanged()
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   const handleReorder = useCallback(async (orderedIds: string[]) => {
      // Optimistic: reflect the new order in the drop's frame. The persist + re-read are async, so
      // without this the grid flashes the old order and the drop animation lands on a stale slot.
      setDocuments(current => {
         const byId = new Map(current.map(record => [record.id, record]))
         const next = orderedIds
            .map(id => byId.get(id))
            .filter((record): record is BinderDocumentRecord => record !== undefined)
         return next.length === current.length ? next : current
      })
      try {
         await backend.reorderDocuments(orderedIds)
         onChanged()
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
         onChanged()   // re-read restores the persisted order on failure
      }
   }, [onChanged, showToast, t, backend])

   const handleExportHtml = useCallback(async (id: string) => {
      try {
         const loaded = await backend.loadDocument(id, { touch: false })
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         await downloadHTML(loaded.meta, loaded.sections, { theme: loaded.docTheme, accent: loaded.docAccent, lang })
         showToast(t.downloaded, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t, lang, backend])

   const handleExportMarkdown = useCallback(async (id: string) => {
      try {
         const loaded = await backend.loadDocument(id, { touch: false })
         if (!loaded) { showToast(t.binderActionFailed, { type: 'error' }); return }
         await exportMarkdownFile(loaded.sections, loaded.meta)
         showToast(t.markdownExported, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [showToast, t, backend])

   return {
      documents,
      isLoading,
      handleDelete,
      handleImportJSON,
      handleDuplicate,
      handleMove,
      handleReorder,
      handleExportHtml,
      handleExportMarkdown,
   }
}

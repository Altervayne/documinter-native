// -- React Imports --
import { useCallback, useState } from 'react'

// -- Lib Imports --
import { parseTemplateBackup } from '../lib/templateBackupFile'
import { parseDocumentBackup } from '../lib/documentBackupFile'
import { captureTemplate } from '../lib/documentTemplate'
import { gunzipToString, parseTin, type TinFile } from '../lib/tinFile'

// -- Context Imports --
import { useToast } from '../contexts/ToastContext'
import { useLang } from '../contexts/LangContext'
import { useBinderBackend } from '../contexts/BinderBackendContext'

interface UseBinderFileImportOptions {
   /** Folder a dropped document lands in (the folder currently being viewed). */
   currentFolderId: string
   /** Re-read the binder lists once one or more files have imported. */
   onImported:      () => void
   /** A dropped `.tin` bundle bubbles up here (App owns the merge/replace mode dialog); the drop's
    *  folder is the merge target. */
   onTinDropped:    (tin: TinFile, targetFolderId: string) => void
}

/**
 * Owns the native HTML5 file-drop import for the whole binder body. This is a separate system from
 * dnd-kit's pointer-based card dragging, so the two never collide. A dropped file is routed by its
 * content: a template export (parseTemplateBackup) becomes a stored template, a document backup
 * (parseDocumentBackup) becomes a new document in the current folder, and anything else is skipped.
 * Both kinds are `.json`, so the routing is by marker, not by extension.
 */
export function useBinderFileImport({ currentFolderId, onImported, onTinDropped }: UseBinderFileImportOptions) {
   const { showToast } = useToast()
   const { t }         = useLang()
   const backend       = useBinderBackend()

   const [isFileDragOver, setIsFileDragOver] = useState(false)

   const handleFileDragOver = useCallback((event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return   // ignore non-file drags
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsFileDragOver(true)
   }, [])

   const handleFileDragLeave = useCallback((event: React.DragEvent) => {
      // Native dragleave also fires when crossing between child elements, only clear when the
      // cursor has actually left the drop container.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setIsFileDragOver(false)
   }, [])

   const handleFileDrop = useCallback(async (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setIsFileDragOver(false)

      const dropped = Array.from(event.dataTransfer.files)

      // A `.tin` is binary (gzip), so it takes its own path: read the bytes, gunzip, parse, then hand
      // the bundle up to App's mode dialog. Distinct from the text/JSON route below, which reads
      // file.text() and sniffs the content. One `.tin` per drop is handled (the dialog is modal).
      const tinFile = dropped.find(file => file.name.toLowerCase().endsWith('.tin'))
      if (tinFile) {
         try {
            const tin = parseTin(await gunzipToString(await tinFile.arrayBuffer()))
            if (!tin) { showToast(t.tinInvalid, { type: 'error' }); return }
            onTinDropped(tin, currentFolderId)
         } catch {
            showToast(t.tinInvalid, { type: 'error' })
         }
         return
      }

      const files = dropped.filter(file => file.name.toLowerCase().endsWith('.json'))
      if (files.length === 0) { showToast(t.binderImportInvalid, { type: 'error' }); return }

      let documentsImported = 0
      let templatesImported = 0
      for (const file of files) {
         try {
            const text = await file.text()
            // A template export carries the `documinterTemplate` marker; parseTemplateBackup returns
            // null for a document backup, so this check routes the file by its actual content.
            const template = parseTemplateBackup(text)
            if (template) {
               await backend.saveTemplate(captureTemplate(template.name, template.chrome, crypto.randomUUID(), Date.now()))
               templatesImported++
               continue
            }
            const document = parseDocumentBackup(text)
            if (document) {
               await backend.saveDocument(document.state, document.presentation, undefined, currentFolderId)
               documentsImported++
               continue
            }
            // Not a Documinter file, skip it and keep importing the rest.
         } catch { /* skip this file, keep importing the rest */ }
      }

      if (documentsImported === 0 && templatesImported === 0) {
         showToast(t.binderImportInvalid, { type: 'error' })
         return
      }
      onImported()
      // Two toasts only in the rare mixed drop (documents AND templates in one selection), which is fine.
      if (documentsImported > 0) showToast(t.binderImportSuccess, { type: 'success' })
      if (templatesImported > 0) showToast(t.templateImported, { type: 'success' })
   }, [currentFolderId, onImported, onTinDropped, showToast, t, backend])

   return { isFileDragOver, handleFileDragOver, handleFileDragLeave, handleFileDrop }
}

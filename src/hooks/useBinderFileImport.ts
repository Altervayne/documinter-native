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
 * Native HTML5 file-drop import for the whole binder body, separate from dnd-kit's pointer card dragging
 * so the two never collide. A dropped file is routed by content: a template export becomes a stored
 * template, a document file a new document in the current folder, anything else is skipped. A document
 * is a `.mint` (or a legacy `.json` backup), and template exports are `.json`, so routing is by marker,
 * not extension.
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
      // dragleave also fires crossing between children; only clear when the cursor left the container.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setIsFileDragOver(false)
   }, [])

   const handleFileDrop = useCallback(async (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setIsFileDragOver(false)

      const dropped = Array.from(event.dataTransfer.files)

      // A `.tin` is binary (gzip): read bytes, gunzip, parse, then hand the bundle to App's mode dialog.
      // One `.tin` per drop (the dialog is modal).
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

      const files = dropped.filter(file => {
         const name = file.name.toLowerCase()
         return name.endsWith('.mint') || name.endsWith('.json')
      })
      if (files.length === 0) { showToast(t.binderImportInvalid, { type: 'error' }); return }

      let documentsImported = 0
      let templatesImported = 0
      for (const file of files) {
         try {
            const text = await file.text()
            // parseTemplateBackup returns null for a document backup, so this routes by actual content.
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
      // Two toasts only on a mixed drop (documents AND templates in one selection).
      if (documentsImported > 0) showToast(t.binderImportSuccess, { type: 'success' })
      if (templatesImported > 0) showToast(t.templateImported, { type: 'success' })
   }, [currentFolderId, onImported, onTinDropped, showToast, t, backend])

   return { isFileDragOver, handleFileDragOver, handleFileDragLeave, handleFileDrop }
}

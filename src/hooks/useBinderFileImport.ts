// -- React Imports --
import { useCallback, useState } from 'react'

// -- Lib Imports --
import { parseTemplateBackup } from '../lib/templateBackupFile'
import { parseDocumentBackup } from '../lib/documentBackupFile'
import { saveDocument } from '../lib/binderDocuments'
import { captureTemplate } from '../lib/documentTemplate'
import { saveTemplate } from '../lib/templateStore'

// -- Context Imports --
import { useToast } from '../contexts/ToastContext'
import { useLang } from '../contexts/LangContext'

interface UseBinderFileImportOptions {
   /** Folder a dropped document lands in (the folder currently being viewed). */
   currentFolderId: string
   /** Re-read the binder lists once one or more files have imported. */
   onImported:      () => void
}

/**
 * Owns the native HTML5 file-drop import for the whole binder body. This is a separate system from
 * dnd-kit's pointer-based card dragging, so the two never collide. A dropped file is routed by its
 * content: a template export (parseTemplateBackup) becomes a stored template, a document backup
 * (parseDocumentBackup) becomes a new document in the current folder, and anything else is skipped.
 * Both kinds are `.json`, so the routing is by marker, not by extension.
 */
export function useBinderFileImport({ currentFolderId, onImported }: UseBinderFileImportOptions) {
   const { showToast } = useToast()
   const { t }         = useLang()

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

      const files = Array.from(event.dataTransfer.files).filter(file => file.name.toLowerCase().endsWith('.json'))
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
               await saveTemplate(captureTemplate(template.name, template.chrome, crypto.randomUUID(), Date.now()))
               templatesImported++
               continue
            }
            const document = parseDocumentBackup(text)
            if (document) {
               await saveDocument(document.state, document.presentation, undefined, currentFolderId)
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
   }, [currentFolderId, onImported, showToast, t])

   return { isFileDragOver, handleFileDragOver, handleFileDragLeave, handleFileDrop }
}

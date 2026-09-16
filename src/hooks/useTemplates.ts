import { useCallback, useEffect, useState } from 'react'
import { BUILT_IN_TEMPLATES, captureTemplate } from '../lib/documentTemplate'
import type { DocumentTemplate, TemplateChrome } from '../lib/documentTemplate'
import { downloadTemplate, loadTemplateFile } from '../lib/templateBackupFile'
import { useToast } from '../contexts/ToastContext'
import { useLang } from '../contexts/LangContext'
import { useBinderBackend } from '../contexts/BinderBackendContext'

/**
 * Loads the saved document templates (newest-updated first) and exposes the template actions:
 * save-from-chrome (capture a live document's chrome under a name), rename, delete, and duplicate.
 * The built-in templates (documentTemplate.BUILT_IN_TEMPLATES) are merged ahead of the stored ones;
 * they are not renamed / deleted in place (duplicate makes an editable, stored copy). Mutations bump
 * the shared data version (onChanged) so the list re-reads. Mirrors useBinderDocuments' shape.
 */
export function useTemplates(dataVersion: number, onChanged: () => void) {
   const { showToast } = useToast()
   const { t } = useLang()
   const backend = useBinderBackend()

   const [stored, setStored]       = useState<DocumentTemplate[]>([])
   const [isLoading, setIsLoading] = useState(true)

   useEffect(() => {
      let active = true
      backend.listTemplates()
         .then(list => { if (active) { setStored(list); setIsLoading(false) } })
         .catch(error => {
            if (!active) return
            setIsLoading(false)
            console.error('[templates] listTemplates failed:', error)
            showToast(t.binderActionFailed, { type: 'error' })
         })
      return () => { active = false }
   }, [dataVersion, showToast, t, backend])

   // Capture a live document's chrome into a named template and store it (values blanked, pages
   // stripped, presentation/format normalized by captureTemplate).
   const handleSave = useCallback(async (name: string, source: TemplateChrome) => {
      try {
         const template = captureTemplate(name, source, crypto.randomUUID(), Date.now())
         await backend.saveTemplate(template)
         onChanged()
         showToast(t.templateSaved, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   const handleRename = useCallback(async (id: string, name: string) => {
      try {
         await backend.renameTemplate(id, name, Date.now())
         onChanged()
         showToast(t.templateRenamed, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   const handleDelete = useCallback(async (id: string) => {
      try {
         await backend.deleteTemplate(id)
         onChanged()
         showToast(t.templateDeleted, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   // Duplicate any template (built-in or stored) into a fresh, editable, stored copy. The `builtIn`
   // flag is dropped so the copy is fully editable / deletable.
   const handleDuplicate = useCallback(async (template: DocumentTemplate) => {
      try {
         const now = Date.now()
         const { builtIn: _builtIn, ...rest } = template
         const copy: DocumentTemplate = {
            ...rest,
            id:        crypto.randomUUID(),
            name:      template.name + t.templateCopySuffix,
            createdAt: now,
            updatedAt: now,
         }
         await backend.saveTemplate(copy)
         onChanged()
         showToast(t.templateDuplicated, { type: 'success' })
      } catch {
         showToast(t.binderActionFailed, { type: 'error' })
      }
   }, [onChanged, showToast, t, backend])

   // Save a template as a portable `.documinter-template.json` file.
   const handleExport = useCallback(async (template: DocumentTemplate) => {
      await downloadTemplate(template)
      showToast(t.templateExported, { type: 'success' })
   }, [showToast, t])

   // Import a template file: pick it, capture it as a fresh stored template (new id + timestamps).
   const handleImport = useCallback(() => {
      void loadTemplateFile(
         parsed => {
            const template = captureTemplate(parsed.name, parsed.chrome, crypto.randomUUID(), Date.now())
            backend.saveTemplate(template)
               .then(() => { onChanged(); showToast(t.templateImported, { type: 'success' }) })
               .catch(() => showToast(t.binderActionFailed, { type: 'error' }))
         },
         () => showToast(t.templateImportInvalid, { type: 'error' }),
      ).catch(() => showToast(t.templateImportInvalid, { type: 'error' }))
   }, [onChanged, showToast, t, backend])

   const templates = [...BUILT_IN_TEMPLATES, ...stored]

   return { templates, isLoading, handleSave, handleRename, handleDelete, handleDuplicate, handleExport, handleImport }
}

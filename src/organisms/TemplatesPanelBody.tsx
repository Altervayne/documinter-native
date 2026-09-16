// -- React Imports --
import { useState } from 'react'

// -- Library Imports --
import { LayoutTemplate, Plus } from 'lucide-react'

// -- Type Imports --
import type { DocumentTemplate, TemplateChrome } from '../lib/documentTemplate'

// -- Molecule / Hook / Context Imports --
import { TemplateCard } from './Binder/TemplateCard'
import { PromptDialog } from '../molecules/PromptDialog'
import { ConfirmDialog } from '../molecules/ConfirmDialog'
import { useTemplates } from '../hooks/useTemplates'
import { useLang } from '../contexts/LangContext'

// #########
// # TYPES #
// #########

interface TemplatesPanelBodyProps {
   /** The active document's chrome (meta scaffold, theme, accent, presentation, page format), the
    *  source captured when the user saves the current document as a new template. No content. */
   currentChrome: TemplateChrome
   /** Create a new document pre-styled from a template and open it (the card's "Use" action). */
   onUse:   (template: DocumentTemplate) => void
   /** Overwrite the active document's chrome with a template's, keeping its content (card's "Apply"). */
   onApply: (template: DocumentTemplate) => void
}

// #############
// # COMPONENT #
// #############

/** The Templates panel's body: a docked, vertically-stacked mirror of the Binder's Templates view.
 *  Owns its own `useTemplates` instance so mutations refresh the list in place without App-level state.
 *  Chrome-free, so it renders the same docked or floating. Its cards are also drag sources
 *  (enableApplyDrag): dragging one onto the canvas applies it, same as the Apply button. */
export function TemplatesPanelBody({ currentChrome, onUse, onApply }: TemplatesPanelBodyProps) {
   const { t } = useLang()
   const [version, setVersion] = useState(0)
   const templates = useTemplates(version, () => setVersion(current => current + 1))

   // Text-input dialog shared by "save current as template" and "rename template", keyed by mode so one
   // PromptDialog instance covers both.
   const [nameDialog, setNameDialog] = useState<
      | { mode: 'save' }
      | { mode: 'rename'; templateId: string; initialName: string }
      | null
   >(null)
   const [pendingDelete, setPendingDelete] = useState<DocumentTemplate | null>(null)

   function handleConfirmName(name: string) {
      const dialog = nameDialog
      setNameDialog(null)
      if (!dialog) return
      if (dialog.mode === 'rename') { void templates.handleRename(dialog.templateId, name); return }
      void templates.handleSave(name, currentChrome)
   }

   function handleConfirmDelete() {
      const template = pendingDelete
      setPendingDelete(null)
      if (template) void templates.handleDelete(template.id)
   }

   const hasUserTemplates = templates.templates.some(template => !template.builtIn)

   return (
      <div className="flex-1 min-h-0 flex flex-col">
         <div className="px-2 pt-2">
            <button
               type="button"
               onClick={() => setNameDialog({ mode: 'save' })}
               className="w-full flex items-center justify-center gap-2 px-2 py-1.5 text-xs font-medium text-accent/70 hover:text-accent hover:bg-accent/8 rounded-md border border-dashed border-accent/25 hover:border-accent/50 transition-colors cursor-pointer"
            >
               <Plus size={13} />
               {t.saveAsTemplate}
            </button>
         </div>

         <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
            {templates.templates.map(template => (
               <TemplateCard
                  key={template.id}
                  template={template}
                  onUse={() => onUse(template)}
                  onApply={() => onApply(template)}
                  onDuplicate={() => void templates.handleDuplicate(template)}
                  onExport={() => templates.handleExport(template)}
                  onRename={() => setNameDialog({ mode: 'rename', templateId: template.id, initialName: template.name })}
                  onDelete={() => setPendingDelete(template)}
                  enableApplyDrag
               />
            ))}

            {!hasUserTemplates && (
               <div className="mt-1 flex flex-col items-center gap-2 py-6 px-3 rounded-lg border border-dashed border-accent/25 bg-accent/[0.03] text-center">
                  <LayoutTemplate size={20} className="text-accent/35" />
                  <div className="flex flex-col gap-0.5">
                     <span className="text-xs font-medium text-muted/60">{t.templatesPanelEmpty}</span>
                     <span className="text-xs font-medium text-accent/55">{t.templatesPanelEmptyHint}</span>
                  </div>
               </div>
            )}
         </div>

         {nameDialog && (
            <PromptDialog
               title={nameDialog.mode === 'rename' ? t.templateRenameTitle : t.saveAsTemplateTitle}
               label={t.saveAsTemplateLabel}
               initialValue={nameDialog.mode === 'rename' ? nameDialog.initialName : currentChrome.meta.title}
               confirmLabel={nameDialog.mode === 'rename' ? t.templateRenameConfirm : t.saveAsTemplateConfirm}
               cancelLabel={t.binderUnsavedCancel}
               onConfirm={handleConfirmName}
               onCancel={() => setNameDialog(null)}
            />
         )}

         {pendingDelete && (
            <ConfirmDialog
               title={t.templateDeleteTitle}
               message={t.templateDeleteWarning}
               confirmLabel={t.templateDelete}
               cancelLabel={t.binderUnsavedCancel}
               danger
               onConfirm={handleConfirmDelete}
               onCancel={() => setPendingDelete(null)}
            />
         )}
      </div>
   )
}
